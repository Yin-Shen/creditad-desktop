<template>
  <div class="hic-viewer">

    <div class="ruler-container">
      <canvas ref="rulerRef" class="ruler-canvas"></canvas>
    </div>

    <div
      class="canvas-wrapper"
      :class="{ 'is-zooming': isZooming }"
      ref="wrapperRef"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="() => { handleMouseUp(); emit('guide-x', -1); }"
      @wheel.prevent="handleWheel"
    >
      <canvas ref="canvasRef"></canvas>
      <div v-if="loadError" class="hic-error">
        <i class="fas fa-triangle-exclamation"></i>
        <span v-if="loadError==='backend-unreachable'">Backend unreachable — is the server running on :5001?</span>
        <span v-else>Session expired (data token no longer valid). Recovering…</span>
      </div>

      <div v-if="hoverInfo.visible" class="hover-tooltip"
           :style="{ left: hoverInfo.x + 'px', top: hoverInfo.y + 'px' }">
        <div class="tooltip-row">
          <span class="tooltip-label">Pos 1:</span>
          <span>{{ formatGenomicPosition(hoverInfo.pos1) }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Pos 2:</span>
          <span>{{ formatGenomicPosition(hoverInfo.pos2) }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Value:</span>
          <span>{{ hoverInfo.value }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Matrix bin:</span>
          <span>{{ currentResolutionText }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useCounterStore } from '../store/stores';

const store = useCounterStore();
const props = defineProps({
  hicToken:            { type: String, required: true },
  apiBaseUrl:          { type: String, default: (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api') },
  tileSize:            { type: Number, default: 256 },
  vp:                  { type: Object, default: null },
  trackId:             { type: String, default: 'hic' },
  selectedChromosome:  { type: String, default: '' },
});

const emit = defineEmits(['vp-change', 'chroms-loaded', 'guide-x', 'stale-token', 'res-change']);

/* ── 常量与状态 ── */
const CUSTOM_COLORS = [
  '#FFFFFF','#FFC733','#FFB300','#FF9900','#FF7F00',
  '#FF6600','#E64100','#CC2900','#991F00','#661400','#330A00','#000000',
];
function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}
const COLOR_LUT = CUSTOM_COLORS.map(h => hexToRgb(h));
// Zero-contact end of the colormap above. Not a theme colour — see renderCanvas().
const HEATMAP_BASE = CUSTOM_COLORS[0];

// Hard zoom-in floor, in bp per screen pixel. Previously this was `finest_level / 4`,
// which tied how far you may zoom to WHICH FILE you happen to have: the shipped chr7 demo
// stops at a 10 kb level, so its floor was 2500 bp/px and the narrowest reachable window
// was W x 2500 — about 3.2 Mb on a 1300 px track. TADs are 0.2-1 Mb, so on a plain install
// a single domain could never fill the panel, while a user who had downloaded the optional
// 1 kb-capable full-genome matrix could zoom 10x closer through the same UI. It is not a
// performance guard either: zooming IN needs monotonically fewer tiles (60 -> 13 -> 3
// across the old clamp point), so the bound was on the free side. A fixed floor makes both
// installs behave identically; past the finest level the bins simply render larger.
const MIN_BP_PER_PX = 200;

/** Level whose bin size is closest to one screen pixel, in log space. The one rule, used
 *  by the initial view, external viewport sync and the clamp, so the drawn level is a
 *  function of the viewport alone and never of the path taken to it. */
function bestZoomFor(bpPerPx, resList) {
  let best = 0, bestDiff = Infinity;
  resList.forEach((r, z) => {
    const d = Math.abs(Math.log(r) - Math.log(bpPerPx));
    if (d < bestDiff) { bestDiff = d; best = z; }
  });
  return best;
}

const canvasRef  = ref(null);
const rulerRef   = ref(null);
const wrapperRef = ref(null);
const loading    = ref(false);
const loadError  = ref('');   // '' | 'session-expired' | 'no-chromosomes' | 'backend-unreachable'
const isZooming  = ref(false);
let zoomTimer    = null;

const chromosome  = ref('');
const chromosomes = ref([]); // 这里只存储被过滤后的“合法”染色体

const centerX     = ref(0);
const offsetY     = ref(0);
const scale       = ref(1.0);
const currentZoom = ref(0);
const maxZoom     = ref(0);
const tilesetInfo = ref(null);
const tileCache   = ref(new Map());

const isDragging  = ref(false);
const lastMouseX  = ref(0);
const lastMouseY  = ref(0);
const hoverInfo   = ref({ visible: false, x: 0, y: 0, pos1: 0, pos2: 0, value: '...' });
const guideLineX  = ref(-1);

let renderRequested   = false;
let springAnimationId = null;

/* ── 计算属性 ── */
const currentResolutionText = computed(() => {
  if (!tilesetInfo.value) return '...';
  const res = tilesetInfo.value.available_resolutions[currentZoom.value];
  return formatResolution(res);
});

// The rendered matrix level is chosen from on-screen bp/px, so it is NOT the analysis bin
// size the tiers were computed at — the same mcool is shared by the 25 kb and 10 kb
// packages. Publish it so the page can show both numbers instead of letting the package
// label imply the heatmap is drawn at that resolution.
watch([currentZoom, tilesetInfo], () => {
  const list = tilesetInfo.value?.available_resolutions;
  if (Array.isArray(list) && list[currentZoom.value]) emit('res-change', list[currentZoom.value]);
}, { immediate: true });

const currentCenterPos = computed(() => {
  if (!tilesetInfo.value) return 0;
  return centerX.value * tilesetInfo.value.available_resolutions[currentZoom.value];
});

/* ── 数据获取与过滤逻辑 ── */

/** 1. 获取染色体列表并根据 Store 白名单过滤 */
async function fetchGenomeIndex() {
  loadError.value = '';
  try {
    const res  = await fetch(`${props.apiBaseUrl}/genome/index/${props.hicToken}`);
    // Stale/invalid token (e.g. backend restarted, or a persisted token from a previous
    // session): the response is {error:...} with no chromosomes. Do NOT call .filter on
    // undefined (that blanked the whole viewer). Surface a clear, recoverable error instead.
    if (!res.ok) {
      chromosomes.value = []; emit('chroms-loaded', []);
      loadError.value = 'session-expired';
      emit('stale-token');
      return;
    }
    const data = await res.json();
    const allChroms = Array.isArray(data?.chromosomes) ? data.chromosomes : [];
    if (!allChroms.length) {
      chromosomes.value = []; emit('chroms-loaded', []);
      loadError.value = 'no-chromosomes';
      emit('stale-token');
      return;
    }
    const whitelist = (store.file_view_obj?.selected_chroms || []).map(String);
    chromosomes.value = whitelist.length > 0
      ? allChroms.filter(c => whitelist.includes(String(c.name)))
      : allChroms;
    emit('chroms-loaded', chromosomes.value);
    if (chromosomes.value.length > 0 && !chromosome.value) {
      chromosome.value = chromosomes.value[0].name;
    }
  } catch (e) {
    console.error('fetchGenomeIndex:', e);
    loadError.value = 'backend-unreachable';
    emit('stale-token');
  }
}

/** 2. 加载特定染色体的矩阵信息 */
async function resetView() {
  if (!props.hicToken || !chromosome.value) return;

  // 双重保险：再次校验白名单
  const whitelist = (store.file_view_obj?.selected_chroms || []).map(String);
  if (whitelist.length > 0 && !whitelist.includes(String(chromosome.value))) {
    console.warn(`[Shield] Refused to load data for chromosome: ${chromosome.value}`);
    return;
  }

  loading.value = true;
  try {
    const res  = await fetch(`${props.apiBaseUrl}/hic/info/${props.hicToken}/${chromosome.value}`);
    const info = res.ok ? await res.json() : null;
    // Guard against stale token / error response: no length or resolutions → don't render
    // a broken viewer; flag for recovery.
    if (!info || !info.length || !Array.isArray(info.available_resolutions) || !info.available_resolutions.length) {
      loadError.value = 'session-expired';
      emit('stale-token');
      return;
    }
    loadError.value = '';
    tilesetInfo.value = {
      length: info.length,
      available_resolutions: info.available_resolutions,
      // Per-RESOLUTION intensity pre-scale (index aligns with available_resolutions):
      // 1 for raw-count levels (GM12878's coarse levels → identical to the original
      // rendering), and >1 for ICE-balanced levels so their median contact lands at the
      // same intensity GM12878's raw median renders at — balanced matrices then show full
      // TAD structure instead of a sparse near-white scatter. Necessary because the same
      // mcool can be raw at one resolution and balanced at another.
      color_scale_by_zoom: Array.isArray(info.color_scale_by_zoom) ? info.color_scale_by_zoom : null,
    };

    maxZoom.value     = info.available_resolutions.length - 1;

    // 6 Mb initial view. Pick the zoom LEVEL whose resolution matches the on-screen
    // bp/px (span / canvas width) — NOT the finest level. available_resolutions is sorted
    // coarse->fine, so the old `currentZoom = maxZoom` forced the FINEST resolution (e.g. 1 kb
    // for the full 4DN genome mcools), which rendered a 6 Mb window as ~hundreds of tiles each
    // slicing a 600M-pixel dataset → unusably slow + blank. Matching res to bp/px (like
    // syncExternalViewport) keeps any mcool at ~a handful of tiles, identical to the chr7 demo.
    // Pick the initial view inside the chromosome's largest GAP-FREE interval (safe_span,
    // from the backend) so it never lands on an empty telomere/centromere. The window size
    // adapts to the usable length (short chromosomes get a proportionally smaller window).
    const safe = (Array.isArray(info.safe_span) && info.safe_span.length === 2 && info.safe_span[1] > info.safe_span[0])
      ? info.safe_span : [0, info.length];
    const usable = safe[1] - safe[0];
    const span = Math.max(1000000, Math.min(6000000, Math.floor(usable * 0.8)));
    const cw0 = canvasRef.value?.width || 800;
    const targetBpPerPx = span / cw0;
    currentZoom.value = bestZoomFor(targetBpPerPx, info.available_resolutions);
    const currentRes = info.available_resolutions[currentZoom.value];
    const jitter = Math.max(0, usable - span);
    const randomCenter = safe[0] + Math.floor(span / 2 + Math.random() * jitter);
    centerX.value = randomCenter / currentRes;
    offsetY.value = 0;
    const cw = canvasRef.value?.width || 800;
    scale.value = cw * currentRes / span;
    // Clamp before publishing: a contig whose usable span is under the 1 Mb floor above
    // would otherwise start finer than the clamp allows and snap on the first gesture.
    clampViewport();
    emitVp();
    requestRender();
  } catch (e) {
    console.error('resetView Error:', e);
  } finally {
    loading.value = false;
  }
}

/** 辅助：同步视口参数 */
function syncExternalViewport(resList) {
    const bestZ = bestZoomFor(props.vp.bpPerPx, resList);
    currentZoom.value = bestZ;
    scale.value      = resList[bestZ] / props.vp.bpPerPx;
    centerX.value    = props.vp.centerBp / resList[bestZ];
    clampViewport();
    // If the clamp moved the viewport, the incoming one is unreachable here and every
    // other track is still on it — the region box accepts spans narrower than
    // MIN_BP_PER_PX x W, and the heatmap would sit wider than the tracks below it.
    // Publish the viewport we can actually show so the rest follow.
    const res = resList[currentZoom.value];
    const gotBpPerPx = res / scale.value;
    const gotCenter  = centerX.value * res;
    const off = Math.abs(gotBpPerPx - props.vp.bpPerPx) / (props.vp.bpPerPx || 1);
    if (off > 1e-6 || Math.abs(gotCenter - props.vp.centerBp) > gotBpPerPx) emitVp();
}

/* ── 监听器 ── */

// 监听 Token 变化（切换文件）
watch(() => props.hicToken, async (newVal) => {
  if (!newVal) return;
  tileCache.value.clear();
  // 重新获取索引并重置
  await fetchGenomeIndex();
  await resetView();
});

// 🚩 核心监听：监听染色体变化（无论是手动还是自动程序修改）
watch(chromosome, (newVal, oldVal) => {
  if (newVal && newVal !== oldVal) {
    handleChrChange();
  }
});

// 监听父组件传来的共享视口
watch(() => props.vp, (vp) => {
  if (!vp || vp.sourceId === props.trackId || !tilesetInfo.value) return;
  syncExternalViewport(tilesetInfo.value.available_resolutions);
  requestRender();
}, { deep: true });

async function handleChrChange() {
  tileCache.value.clear();
  await resetView();
}

watch(() => props.selectedChromosome, (newChr) => {
  if (newChr && newChr !== chromosome.value && chromosomes.value.some(c => c.name === newChr)) {
    chromosome.value = newChr;
  }
});

/* ── 渲染与坐标变换 (保持原版逻辑) ── */
function emitVp() {
  if (!tilesetInfo.value || !canvasRef.value) return
  const res = tilesetInfo.value.available_resolutions[currentZoom.value]
  emit('vp-change', {
    bpPerPx:  res / scale.value,
    centerBp: centerX.value * res,
    sourceId: props.trackId,
    chrom: chromosome.value,   // ← 新增
  })
}

let pendingTiles = [];
let fetchScheduled = false;

function queueTileFetch(z, r, c) {
  if (!tilesetInfo.value) return;
  const key = `${chromosome.value}_${z}_${r}_${c}`;
  if (tileCache.value.has(key)) return;
  tileCache.value.set(key, { loading: true });
  pendingTiles.push({ z, r, c, key, chrom: chromosome.value });
  if (!fetchScheduled) {
    fetchScheduled = true;
    requestAnimationFrame(flushTileQueue);
  }
}

async function flushTileQueue() {
  fetchScheduled = false;
  const batch = pendingTiles.splice(0, 12);
  if (batch.length === 0) return;
  const promises = batch.map(async ({ z, r, c, key, chrom }) => {
    try {
      const res = tilesetInfo.value.available_resolutions[z];
      const T = props.tileSize;
      const url = `${props.apiBaseUrl}/v1/tiles/2d/${props.hicToken}/${z}/${r}/${c}?chrom=${chrom}`;
      const response = await fetch(url);
      const apiData = await response.json();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = T;
      // intensity pre-scale for THIS zoom level (raw=1, balanced>1 per resolution)
      const scale = tilesetInfo.value?.color_scale_by_zoom?.[z];
      renderTileToCanvas(canvas, apiData.data ?? [], res, r, c, scale);
      tileCache.value.set(key, { canvas });
    } catch (e) { tileCache.value.delete(key); }
  });
  await Promise.all(promises);
  if (pendingTiles.length > 0) {
    requestAnimationFrame(flushTileQueue);
  }
  requestRender();
}

async function fetchTile(z, r, c) {
  queueTileFetch(z, r, c);
}

function renderTileToCanvas(canvas, data, res, tileR, tileC, scaleArg) {
  const T = props.tileSize;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(T, T);
  const buf = imgData.data;
  const len = buf.length;
  for (let i = 0; i < len; i += 4) {
    buf[i] = buf[i+1] = buf[i+2] = 255;
    buf[i+3] = 255;
  }
  if (data.length === 0) { ctx.putImageData(imgData, 0, 0); return; }

  // Intensity = log1p(v * scale) / log1p(100), one scale per zoom level (all tiles at the
  // same zoom share it → smooth heatmap). scale=1 for raw-count levels reproduces the
  // original chr7.mcool/GM12878 rendering exactly; scale>1 for ICE-balanced levels lifts
  // their median contact onto the same perceptual point, so balanced matrices show full
  // TAD structure instead of a sparse near-white scatter. Supplied per-resolution by /hic/info.
  const scale = (typeof scaleArg === 'number' && scaleArg > 0) ? scaleArg : 1;
  const logNorm = 1 / Math.log1p(100);
  const maxCI = COLOR_LUT.length - 1;
  const invRes = 1 / res;
  const offR = tileR * T;
  const offC = tileC * T;
  for (let i = 0, n = data.length; i < n; i++) {
    const p = data[i];
    const lr = (p.y * invRes | 0) - offR;
    const lc = (p.x * invRes | 0) - offC;
    if (lr >= 0 && lr < T && lc >= 0 && lc < T) {
      const idx = (lr * T + lc) << 2;
      const v = Math.min(1, Math.log1p(p.v * scale) * logNorm);
      const ci = (v * maxCI) | 0;
      const c = COLOR_LUT[ci];
      buf[idx] = c.r; buf[idx+1] = c.g; buf[idx+2] = c.b;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

let offscreenCanvas = null;

function render() {
  if (!canvasRef.value || !tilesetInfo.value) return;
  const T = props.tileSize;
  const { width, height } = canvasRef.value;
  // A hidden track (v-show while the selected chromosome has no matrix) reports a 0 x 0
  // wrapper. Rendering it built a 0-sized offscreen canvas, and drawImage throws on one:
  // "The image argument is a canvas element with width or height of 0".
  if (width < 1 || height < 1) return;

  if (!offscreenCanvas || offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
  }

  const buf = offscreenCanvas.getContext('2d', { alpha: false });
  // The contact map keeps a white base in BOTH themes on purpose: zero contact is the
  // white end of the colormap, as in every other Hi-C browser, so theming this surface
  // would change what a colour means. It is framed in the viewer instead (see
  // .heatmap-container in VisualizationPage.vue) so it reads as a lit data panel
  // rather than an unstyled block on the dark theme.
  buf.fillStyle = HEATMAP_BASE; buf.fillRect(0, 0, width, height);
  const corners = [screenToBin(0, 0), screenToBin(width, 0), screenToBin(0, height), screenToBin(width, height)];
  const minR = Math.floor(Math.min(...corners.map(p => p.r)));
  const maxR = Math.ceil( Math.max(...corners.map(p => p.r)));
  const minC = Math.floor(Math.min(...corners.map(p => p.c)));
  const maxC = Math.ceil( Math.max(...corners.map(p => p.c)));
  const currentRes = tilesetInfo.value.available_resolutions[currentZoom.value];
  const maxT = Math.ceil((tilesetInfo.value.length / currentRes) / T);
  let anyDrawn = false;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (r < 0 || c < 0 || r >= maxT || c >= maxT || r > c) continue;
      const { sx, sy, ss } = getTileScreenPos(r, c);
      const key = `${chromosome.value}_${currentZoom.value}_${r}_${c}`;
      const tile = tileCache.value.get(key);
      if (tile?.canvas) {
        buf.save(); buf.translate(sx, sy); buf.rotate(-Math.PI / 4); buf.scale(ss, ss);
        buf.drawImage(tile.canvas, 0, 0); buf.restore();
        anyDrawn = true;
      } else if (!tile) {
        fetchTile(currentZoom.value, r, c);
      }
    }
  }

  const ctx = canvasRef.value.getContext('2d', { alpha: false });
  // Always blit the offscreen buffer.  If no tile was drawn this frame
  // (cache miss after zoom-level switch), the buffer is white — preferable
  // to keeping a stale prior frame whose bp window no longer matches the
  // BED/BigWig tracks.  Tiles arrive asynchronously and trigger another
  // requestRender(), so the heatmap fills in within ~1 RAF.
  ctx.drawImage(offscreenCanvas, 0, 0);
}

function renderRuler() {
  if (!rulerRef.value || !tilesetInfo.value || !canvasRef.value) return;
  const ctx = rulerRef.value.getContext('2d');
  const { width, height } = rulerRef.value;
  const rootStyle = getComputedStyle(document.documentElement);
  const rulerBg = rootStyle.getPropertyValue('--bg-secondary').trim() || '#f8f9fa';
  const axisColor = rootStyle.getPropertyValue('--text-secondary').trim() || '#666';
  const labelColor = rootStyle.getPropertyValue('--text-primary').trim() || '#333';
  ctx.fillStyle = rulerBg; ctx.fillRect(0, 0, width, height);

  // Use the **shared viewport** (centerBp + bpPerPx) directly so the ruler
  // shows the exact same bp range that Hi-C tiles / BED / BigWig render.
  // Previous version used screenToBin().r and multiplied by res only, which
  // forgot the tile_size factor (T=256) and was 256× off — that's why the
  // ruler labels looked like kb instead of Mb.
  const res = tilesetInfo.value.available_resolutions[currentZoom.value];
  const bpPerPx = res / scale.value;
  const centerBp = centerX.value * res;
  const startPos = centerBp - (width / 2) * bpPerPx;
  const endPos   = centerBp + (width / 2) * bpPerPx;
  const range = endPos - startPos; if (range <= 0) return;
  const step = niceStep(range / 5);
  ctx.strokeStyle = axisColor; ctx.fillStyle = labelColor; ctx.font = '10px Arial';
  for (let pos = Math.ceil(startPos / step) * step; pos <= endPos; pos += step) {
    const x = ((pos - startPos) / range) * width;
    ctx.beginPath(); ctx.moveTo(x, height - 10); ctx.lineTo(x, height); ctx.stroke();
    ctx.fillText(formatGenomicPosition(pos), x + 2, height - 15);
  }
}

function requestRender() {
  if (renderRequested) return; renderRequested = true;
  requestAnimationFrame(() => { render(); renderRuler(); renderRequested = false; });
}

function screenToBin(px, py) {
  const T = props.tileSize, s = scale.value;
  const { width, height } = canvasRef.value;
  const wx = (px - width / 2) / s + centerX.value;
  const wy = (height - py + offsetY.value) / s;
  return { r: (wx - wy) / T, c: (wx + wy) / T };
}

function getTileScreenPos(r, c) {
  const T = props.tileSize, s = scale.value;
  const { width, height } = canvasRef.value;
  const worldX = (c + r) * T / 2; const worldY = (c - r) * T / 2;
  return { sx: width / 2 + (worldX - centerX.value) * s, sy: height - worldY * s - offsetY.value, ss: s / Math.sqrt(2) };
}

function formatResolution(res) {
  return res >= 1000000
    ? `${(res / 1000000).toFixed(1)}Mb`
    : `${(res / 1000).toFixed(1)}kb`;
}

/* ── 视口边界限制 ──
 * Keep zoom + pan inside the active chromosome so the heatmap never
 * blanks out due to out-of-range tile fetches.  Bounds:
 *   • bpPerPx ≤ chromLen / W       (cannot zoom out wider than the chrom)
 *   • bpPerPx ≥ MIN_BP_PER_PX      (see the constant — deliberately NOT ladder-derived)
 *   • W/2 * bpPerPx ≤ centerBp ≤ chromLen − W/2 * bpPerPx
 *     (if half-span exceeds chrom length, lock centre at chromLen/2)
 *   • |offsetY| ≤ canvas height    (vertical pan kept on screen)
 */
function clampViewport() {
  if (!tilesetInfo.value || !canvasRef.value) return;
  const chromLen = tilesetInfo.value.length;
  const resList = tilesetInfo.value.available_resolutions;
  if (!chromLen || !resList || !resList.length) return;
  const W = canvasRef.value.width || 1;
  const curRes = resList[currentZoom.value];

  // 1. Clamp bpPerPx
  let bpPerPx = curRes / scale.value;
  const maxBpPerPx = chromLen / W;
  if (bpPerPx > maxBpPerPx) bpPerPx = maxBpPerPx;
  if (bpPerPx < MIN_BP_PER_PX) bpPerPx = MIN_BP_PER_PX;
  scale.value = curRes / bpPerPx;

  // The level that fits the CLAMPED viewport. Without this the wheel's hysteresis band
  // (3.0 / 0.33, below) can strand the view on a level the clamp then pins in place: the
  // whole-chromosome view settled on 50 kb and never recovered, because the clamp holds
  // scale at 0.408, above the 0.33 needed to step down. The level would also depend on
  // HOW a viewport was reached — wheel vs region box vs another track — while the badge
  // in VisualizationPage claims it is "chosen to match the current zoom".
  const fitted = bestZoomFor(bpPerPx, resList);
  if (fitted !== currentZoom.value) {
    const K = resList[currentZoom.value] / resList[fitted];
    centerX.value *= K;
    currentZoom.value = fitted;
    scale.value = resList[fitted] / bpPerPx;
  }

  // 2. Clamp centerBp inside the chromosome
  const halfSpan = (W / 2) * bpPerPx;
  let centerBp = centerX.value * curRes;
  if (halfSpan * 2 >= chromLen) {
    centerBp = chromLen / 2;
  } else {
    centerBp = Math.max(halfSpan, Math.min(chromLen - halfSpan, centerBp));
  }
  centerX.value = centerBp / curRes;

  // 3. Clamp vertical drag so the heatmap stays in view
  const H = canvasRef.value.height || 1;
  if (offsetY.value > H) offsetY.value = H;
  if (offsetY.value < -H) offsetY.value = -H;
}

/* ── 交互事件 ── */
function handleWheel(e) {
  isZooming.value = true; if (zoomTimer) clearTimeout(zoomTimer);
  const speed = e.deltaY > 0 ? 0.85 : 1.15; scale.value *= speed;
  const resList = tilesetInfo.value.available_resolutions;
  // Use wider thresholds (3.0 / 0.33) so a quick wheel burst is unlikely to
  // straddle a zoom-level boundary mid-gesture and produce a blank frame.
  if (scale.value > 3.0 && currentZoom.value < maxZoom.value) {
    const K = resList[currentZoom.value] / resList[currentZoom.value + 1];
    currentZoom.value++; centerX.value *= K; scale.value /= K;
  } else if (scale.value < 0.33 && currentZoom.value > 0) {
    const K = resList[currentZoom.value] / resList[currentZoom.value - 1];
    currentZoom.value--; centerX.value *= K; scale.value /= K;
  }
  clampViewport();
  requestRender(); emitVp();
  zoomTimer = setTimeout(() => { isZooming.value = false; }, 300);
}

function handleMouseDown(e) { if (springAnimationId) cancelAnimationFrame(springAnimationId); isDragging.value = true; lastMouseX.value = e.clientX; lastMouseY.value = e.clientY; }
function handleMouseMove(e) {
  if (isDragging.value) {
    centerX.value -= (e.clientX - lastMouseX.value) / scale.value;
    offsetY.value += (e.clientY - lastMouseY.value);
    lastMouseX.value = e.clientX; lastMouseY.value = e.clientY;
    clampViewport();
    requestRender(); emitVp();
  } else {
    if (!canvasRef.value || !tilesetInfo.value) return;
    const rect = canvasRef.value.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    emit('guide-x', mx / rect.width);
    const { r, c } = screenToBin(mx, e.clientY - rect.top);
    const res = tilesetInfo.value.available_resolutions[currentZoom.value];
    if (r >= 0 && c >= 0 && c >= r) {
      hoverInfo.value = { visible: true, x: mx + 15, y: e.clientY - rect.top + 15, pos1: Math.floor(r * props.tileSize) * res, pos2: Math.floor(c * props.tileSize) * res, value: '...' };
    } else { hoverInfo.value.visible = false; }
  }
}
function handleMouseUp() {
  if (!isDragging.value) return; isDragging.value = false;
  const animate = () => {
    const diff = -offsetY.value;
    if (Math.abs(diff) < 0.1) { offsetY.value = 0; requestRender(); springAnimationId = null; return; }
    offsetY.value += diff * 0.2; requestRender(); springAnimationId = requestAnimationFrame(animate);
  };
  springAnimationId = requestAnimationFrame(animate);
}

/* ── 工具函数 ── */
function formatGenomicPosition(pos) { if (pos >= 1e6) return `${(pos / 1e6).toFixed(2)} Mb`; if (pos >= 1e3) return `${(pos / 1e3).toFixed(1)} kb`; return `${Math.round(pos)} bp`; }
function niceStep(rough) { const exp = Math.floor(Math.log10(rough || 1)); const base = Math.pow(10, exp); for (const m of [1, 2, 5, 10]) if (m * base >= rough) return m * base; return base * 10; }

/* ── 生命周期 ── */
let themeObserver = null;
onMounted(async () => {
  const resize = () => {
    if (!wrapperRef.value) return;
    const w = wrapperRef.value.clientWidth, h = wrapperRef.value.clientHeight;
    // Keep the last good size while hidden. Writing 0 here would also make the next
    // visible frame re-derive bpPerPx from a 1 px canvas, which is what used to collapse
    // every track into a vertical bar.
    if (w < 1 || h < 1) return;
    canvasRef.value.width  = w;
    canvasRef.value.height = h;
    rulerRef.value.width   = w;
    rulerRef.value.height  = 30;
    requestRender();
  };
  new ResizeObserver(resize).observe(wrapperRef.value);
  resize();
  themeObserver = new MutationObserver(() => requestRender());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // 💡 仅加载索引，加载逻辑交由 watch(chromosome) 处理
  await fetchGenomeIndex();
});
onBeforeUnmount(() => {
  themeObserver?.disconnect();
});
</script>

<style scoped>
.hic-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: sans-serif;
  background: var(--bg-card);
}

.ruler-container { height: 30px; border-bottom: 1px solid var(--border); }

.canvas-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--bg-secondary);
  cursor: crosshair;
}
.hic-error {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  gap: 8px; padding: 12px; text-align: center; font-size: 12px;
  color: var(--text-secondary); background: var(--bg-secondary);
}
.hic-error i { color: var(--warning, #E8883A); }
.canvas-wrapper canvas {
  display: block;
  width: 100%;
  height: 100%;
  transition: filter 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  will-change: filter;
}
.is-zooming canvas {
  filter: blur(4px) saturate(1.2);
}

.hover-tooltip {
  position: absolute;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  pointer-events: none;
  z-index: 10;
}
.tooltip-row   { display: flex; justify-content: space-between; gap: 15px; margin: 2px 0; }
.tooltip-label { color: #aaa; }

</style>