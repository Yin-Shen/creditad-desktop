<template>
  <div class="bed-track-container" ref="wrapperRef">
    <div
      class="canvas-wrapper"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
      @wheel.prevent="onWheel"
      :style="{ cursor: isDragging ? 'grabbing' : 'grab' }"
    >
      <canvas ref="canvasRef"></canvas>

      <div v-if="hoverFeature" class="tooltip" :style="tipStyle">
        <div class="tip-title">
          {{ hoverFeature.name || 'Unnamed' }}
        </div>
        <div class="tip-body">
          <b>Pos:</b> {{ hoverFeature.start.toLocaleString() }} – {{ hoverFeature.end.toLocaleString() }}<br/>
          <b>Len:</b> {{ (hoverFeature.end - hoverFeature.start).toLocaleString() }} bp<br/>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  bedToken:      { type: String,  required: true },
  chromosome:    { type: String,  default: '1' },
  apiBaseUrl:    { type: String,  default: (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api') },
  vp:            { type: Object,  default: null },
  trackId:       { type: String,  required: true },
  /** When true, render every feature on a single horizontal lane.
   *  Used for the Disputed track where boundaries are guaranteed
   *  non-overlapping by the backend and visual stacking is a pure artifact. */
  singleLane:    { type: Boolean, default: false },
  /** Fill colour for features. Each TAD track should pass the
   *  per-method colour from VisualizationPage so reference tracks (insulation
   *  / topdom_like / contact_contrast / spectral_profile / network_modularity) are
   *  visually distinct. */
  trackColor:    { type: String,  default: '#5B5FC7' },
  /** Selected boundary's BD1 vote geometry, or null.
   *  { pos, tolBp, binBp, isSupporter, offsetBp }
   *  A BD1 vote is not a call at the candidate position: a method votes when any of its
   *  calls lands inside +/-tolBp. Drawing that window, and ringing the block the vote was
   *  actually taken from, is the only way to check "2/6 methods" against the picture. */
  voteHighlight: { type: Object,  default: null },
})

const emit = defineEmits([
  'vp-change',
  'stale-token',
])

/* ── DOM ── */
const canvasRef  = ref(null)
const wrapperRef = ref(null)

/* ── 瓦片参数 ── */
const TILE_SIZE   = 256
const tileCache   = new Map()
const resolutions = ref([])

/* ── 本地视口 ──
 * Source of truth: ``vpCenterBp`` + ``vpBpPerPx`` (matches the shared viewport
 * format emitted by Hi-C).  ``localX0`` / ``localScale`` are *derived* on
 * every render from the current ``canvas.width`` so a window resize cannot
 * leave them stale and offset relative to the heatmap.
 */
let localZ      = 2
let localX0     = 0    // derived: tile index at the left edge of the canvas
let localScale  = 1    // derived: pixels per bin = res / bpPerPx
let vpCenterBp  = 0
let vpBpPerPx   = 0

/* ── 交互 ── */
const isDragging = ref(false)
let dragStartX   = 0
let dragX0       = 0

/* ── Hover ── */
const hoverFeature = ref(null)
const tipStyle     = reactive({ left: '0px', top: '0px' })
let onscreenEls    = []

/* ── 渲染节流 ── */
let rafPending = false

/* ════════════════════════════════════════
 * 工具
 * ════════════════════════════════════════ */
function currentRes() { return resolutions.value[localZ] ?? 1 }

function emitVp() {
  emit('vp-change', {
    bpPerPx:  vpBpPerPx,
    centerBp: vpCenterBp,
    sourceId: props.trackId,
  })
}

/**
 * Re-derive ``localZ`` / ``localScale`` / ``localX0`` from the canonical
 * ``vpCenterBp`` / ``vpBpPerPx`` using the *current* canvas width.  Must be
 * called at the top of every ``draw()`` so a resize between frames cannot
 * desync this track from the heatmap.
 */
function recomputeViewport() {
  if (!resolutions.value.length || !canvasRef.value) return
  const resList = resolutions.value
  if (!vpBpPerPx) {
    return
  }
  // Pick the resolution layer with the closest log-distance to bpPerPx
  let bestZ = 0, bestDiff = Infinity
  for (let z = 0; z < resList.length; z++) {
    const d = Math.abs(Math.log(resList[z]) - Math.log(vpBpPerPx))
    if (d < bestDiff) { bestDiff = d; bestZ = z }
  }
  localZ     = bestZ
  const res  = resList[bestZ]
  const W    = canvasRef.value.width || 1
  localScale = res / vpBpPerPx
  // startBp = centerBp - W/2 * bpPerPx
  // localX0 (in tiles) = startBp / (TILE_SIZE * res)
  const startBp = vpCenterBp - (W / 2) * vpBpPerPx
  localX0 = startBp / (TILE_SIZE * res)
}

/* ════════════════════════════════════════
 * 外部视口同步
 * ════════════════════════════════════════ */
function applyExternalVp(vp) {
  if (!vp) return
  // chr-reset signal: discard view, defer to next emit
  if (vp.sourceId === 'chr-reset') {
    vpCenterBp = 0
    vpBpPerPx  = 0
    requestRender()
    return
  }
  if (!(vp.bpPerPx > 0)) return
  vpCenterBp = vp.centerBp
  vpBpPerPx  = vp.bpPerPx
  requestRender()
}

/* ════════════════════════════════════════
 * 瓦片获取
 * ════════════════════════════════════════ */
async function fetchTile(z, x) {
  const key = `${z}_${x}`
  if (tileCache.has(key)) return
  tileCache.set(key, [])
  try {
    // Pass the active chromosome so the backend serves chrom-relative tiles (genome-wide
    // BEDs otherwise come back in absolute genome coords and only chr1 aligns).
    const chromQ = props.chromosome != null ? `?chrom=${encodeURIComponent(props.chromosome)}` : ''
    const url = `${props.apiBaseUrl}/v1/tiles/1d/${props.bedToken}/${z}/${x}${chromQ}`
    const r   = await fetch(url)
    const j   = await r.json()
    tileCache.set(key, j.data ?? [])
    if (z === localZ) requestRender()
  } catch {
    tileCache.delete(key)
  }
}

/* ════════════════════════════════════════
 * 渲染
 * ════════════════════════════════════════ */
function requestRender() {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => { draw(); rafPending = false })
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas || !resolutions.value.length) return
  // Always re-derive layout from the canonical viewport (centerBp + bpPerPx)
  // using the *current* canvas.width, so a resize between frames cannot leave
  // this track offset relative to the Hi-C heatmap.
  recomputeViewport()
  if (!vpBpPerPx) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  const rootStyle = getComputedStyle(document.documentElement)
  const bgColor = rootStyle.getPropertyValue('--bg-card').trim() || '#fff'
  const labelColor = rootStyle.getPropertyValue('--text-primary').trim() || '#222'
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, W, H)

  const res       = currentRes()
  const pxPerTile = TILE_SIZE * localScale
  const visStartTile = Math.floor(localX0)
  const visEndTile   = Math.ceil(localX0 + W / pxPerTile)

  let features = []
  for (let tx = visStartTile; tx <= visEndTile; tx++) {
    if (tx < 0) continue
    const key  = `${localZ}_${tx}`
    const data = tileCache.get(key)
    if (data) features.push(...data)
    else fetchTile(localZ, tx)
  }

  const startBp = localX0 * TILE_SIZE * res
  const endBp   = (localX0 + W / pxPerTile) * TILE_SIZE * res
  const unique  = Array.from(
    new Map(features.map(f => [`${f.start}-${f.end}-${f.name}`, f])).values()
  ).filter(f => f.end >= startBp && f.start <= endBp)

  onscreenEls = []

  // -- Coordinate convention --------------------------------------------------
  // Backend BED `[start, end]` is a bin interval. Caller boundaries are almost
  // always one resolution bin (e.g. 25 kb). Painting every feature with a
  // 10 px floor made dense regions look like solid overlapping blocks when
  // zoomed out (true width << 1 px). We paint a *hairline tick* (2–3 px)
  // when the true footprint is small, and the true-width bar when zoomed in.
  // Hit-boxes stay wider so hover/click still work.
  // --------------------------------------------------------------------------
  const TICK_PX     = 2.5   // hairline when zoomed out
  const BAR_MIN_PX  = 3     // switch to true-width bar once footprint exceeds this
  const HIT_MIN_PX  = 12
  const BAR_H       = 14
  const laid = stagger(unique, startBp)
  const maxLv = laid.reduce((m, f) => Math.max(m, f.level || 0), 0)
  // Grow canvas height when staggered lanes are needed (cap at 4 lanes)
  const needH = Math.max(48, Math.min(4, maxLv + 1) * (BAR_H + 3) + 10)
  if (Math.abs(canvas.height - needH) > 1) {
    canvas.height = needH
    // background was cleared at old size — re-fill
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, W, needH)
  }
  const Hnow = canvas.height

  // ── BD1 vote window ────────────────────────────────────────────────────────
  // Painted UNDER the features so it never hides a block. bpToPx uses the same
  // startBp/res/localScale the features use, so the band cannot drift from them.
  const hl = props.voteHighlight
  const bpToPx = (bp) => (bp - startBp) / res * localScale
  if (hl && Number.isFinite(hl.pos) && Number.isFinite(hl.tolBp)) {
    // THE CANDIDATE'S MATCH FOOTPRINT, drawn at true width in the SAME lane band as the
    // caller blocks, so agreement is visible as overlap instead of having to be inferred
    // from the card's "2/6 methods".
    //
    // Geometry is the matching rule itself, not a decoration. A method votes iff one of
    // its call STARTS lies in [pos-tol, pos+tol]; a call drawn as the half-open bin
    // [start, start+res) therefore intersects [pos-tol, pos+tol+res) iff it votes — the
    // two are equivalent, so "block overlaps the footprint" and "block votes" are the
    // same statement. A non-voting call one bin further out starts exactly at
    // pos+tol+res, i.e. shares only the edge; the footprint is inset half a pixel on each
    // side so that case paints as clearly outside.
    // `res` here is the TILE resolution for the current zoom level, not the annotation's
    // bin size — using it for the +1 bin term drew a footprint of the wrong width at
    // every zoom. The bin size comes from the session (hl.binBp).
    const bin = Number(hl.binBp) > 0 ? Number(hl.binBp) : res
    const x0 = bpToPx(hl.pos - hl.tolBp) + 0.5
    const x1 = bpToPx(hl.pos + hl.tolBp + bin) - 0.5
    const w = Math.max(1, x1 - x0)
    const yTop = 2
    const yBot = Math.min(Hnow - 2, 5 + Math.min(4, maxLv + 1) * (BAR_H + 3))
    ctx.save()
    // A tint plus a solid rule, at lane height — not a full-height frame around the row.
    ctx.fillStyle = hl.isSupporter ? 'rgba(47,125,87,0.11)' : 'rgba(120,120,120,0.09)'
    ctx.fillRect(x0, yTop, w, yBot - yTop)
    ctx.strokeStyle = hl.isSupporter ? 'rgba(47,125,87,0.60)' : 'rgba(120,120,120,0.45)'
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(x0) + 0.5, yTop + 0.5, Math.round(w), yBot - yTop - 1)
    // Candidate position hairline, full height: it is what carries one coordinate down
    // through the caller rows.
    const xc = bpToPx(hl.pos)
    ctx.strokeStyle = 'rgba(29,63,143,0.38)'
    ctx.beginPath()
    ctx.moveTo(Math.round(xc) + 0.5, 0)
    ctx.lineTo(Math.round(xc) + 0.5, Hnow)
    ctx.stroke()
    // Named once, on the first caller track only: an unlabelled band is exactly the kind
    // of mark a reader has to guess at.
    if (hl.showLabel && w > 92) {
      ctx.fillStyle = labelColor
      ctx.globalAlpha = 0.62
      ctx.font = '500 9px Inter, sans-serif'
      ctx.fillText(`BD1 match window ±${Math.round(hl.tolBp / 1000)} kb`, x0 + 4, yBot + 10)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }

  // ── Aggregate regime ────────────────────────────────────────────────────────
  // Once the marks are closer together than the eye can separate, drawing them
  // individually produces a wall of identical hairlines: at whole-chromosome zoom a
  // caller row is 200-800 boundaries painted 2.5 px wide across ~970 px, which reads as
  // "the entire genome dumped into one row" rather than as data. The individual blocks
  // carry no information there — they are all the same width and colour, and nothing is
  // clickable on this track — so the row switches to a density histogram of the SAME
  // features and switches back the moment they are separable again.
  //
  // The switch is a property of the VIEW, not of each caller's density: it fires when one
  // resolution bin is narrower than one pixel, i.e. when two adjacent bins provably land
  // on the same pixel and no rendering can separate them. Every caller row shares one
  // viewport, so they all switch at the same zoom and the panel never shows some rows as
  // histograms and others as fences (a per-track count threshold did exactly that: at
  // 60 Mb, TopDom and SpectralTAD aggregated while OnTAD and MSTD stayed picket fences).
  // The count floor only keeps a genuinely sparse track from becoming a pointless
  // three-bar histogram.
  const binPx = laid.length ? (laid[0].endPx - laid[0].startPx) : Infinity
  const aggregate = binPx < 1 && laid.length > 40
  if (aggregate) {
    const bins = Math.max(40, Math.min(320, Math.floor(W / 3)))
    const counts = new Array(bins).fill(0)
    for (const f of laid) {
      const cxp = (f.startPx + f.endPx) / 2
      if (cxp < 0 || cxp > W) continue
      counts[Math.min(bins - 1, Math.max(0, Math.floor((cxp / W) * bins)))]++
    }
    const maxC = Math.max(1, ...counts)
    const bwid = W / bins
    const baseY = 5 + BAR_H
    ctx.fillStyle = props.trackColor
    for (let i = 0; i < bins; i++) {
      if (!counts[i]) continue
      const h = Math.max(2, (counts[i] / maxC) * BAR_H)
      ctx.globalAlpha = 0.45 + 0.45 * (counts[i] / maxC)
      ctx.fillRect(i * bwid, baseY - h, Math.max(1, bwid - 0.4), h)
    }
    ctx.globalAlpha = 1
    // baseline, so an empty stretch reads as "measured, nothing here"
    ctx.fillStyle = rootStyle.getPropertyValue('--rule-strong').trim() || '#ccc'
    ctx.fillRect(0, baseY, W, 1)
    ctx.fillStyle = labelColor
    ctx.globalAlpha = 0.55
    ctx.font = '500 9px Inter, sans-serif'
    ctx.fillText(`${laid.length} calls in view · density`, 4, baseY + 12)
    ctx.globalAlpha = 1
    onscreenEls = []
    return
  }

  laid.forEach(f => {
    const rxRaw = (f.start - startBp) / res * localScale
    const rwRaw = Math.max(0, (f.end - f.start) / res * localScale)
    // Hairline tick when true footprint is sub-pixel / tiny; true bar when zoomed in
    const isTick = rwRaw < BAR_MIN_PX
    const rw = isTick ? TICK_PX : rwRaw
    const rx = isTick ? (rxRaw + rwRaw / 2 - rw / 2) : rxRaw
    const rh = BAR_H
    const lane = Math.min(f.level || 0, 3)
    const ry = 5 + lane * (rh + 3)
    if (ry + rh > Hnow) return  // safety

    const hitW = Math.max(HIT_MIN_PX, rw)
    const hitX = (rxRaw + rwRaw / 2) - hitW / 2
    const featKey = `${f.chrom || ''}:${f.start}-${f.end}:${f.name || ''}`
    onscreenEls.push({ ...f, key: featKey, x: hitX, y: ry, w: hitW, h: rh })

    // Slightly lower alpha for stacked lanes so the base lane stays readable
    ctx.globalAlpha = isTick ? 0.92 : (0.78 - lane * 0.08)
    ctx.fillStyle   = props.trackColor
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function' && !isTick) {
      ctx.roundRect(rx, ry, rw, rh, rw >= 4 ? 2 : 0)
      ctx.fill()
    } else {
      // ticks: crisp vertical bar (no rounding so 2.5px stays sharp)
      ctx.fillRect(rx, ry, Math.max(1, rw), rh)
    }

    // The block this track's BD1 vote was actually taken from: the caller call nearest
    // the selected candidate inside the tolerance. Ringed so "which block is this vote?"
    // is answerable from the picture rather than from the card's wording alone.
    if (hl && hl.isSupporter && Number.isFinite(hl.offsetBp)) {
      const votePos = hl.pos + hl.offsetBp
      const binHalf = (Number(hl.binBp) > 0 ? Number(hl.binBp) : res) / 2
      if (Math.abs(f.start - votePos) < binHalf) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(31,107,70,0.95)'
        ctx.lineWidth = 1.4
        ctx.strokeRect(Math.round(rx) - 1.5, ry - 1.5,
                       Math.max(3, Math.round(rw)) + 3, rh + 3)
        // caret under the block that actually supplied this track's vote
        ctx.fillStyle = 'rgba(31,107,70,0.95)'
        const cx = Math.round(rx + Math.max(3, rw) / 2)
        ctx.beginPath()
        ctx.moveTo(cx - 3, ry + rh + 3)
        ctx.lineTo(cx + 3, ry + rh + 3)
        ctx.lineTo(cx, ry + rh + 7)
        ctx.closePath()
        ctx.fill()
      }
    }

    // Only label when zoomed in enough that bars don't collide
    if (!isTick && rwRaw >= 28 && f.name) {
      ctx.globalAlpha = 1
      ctx.fillStyle   = labelColor
      ctx.font        = '500 10px Inter, sans-serif'
      ctx.fillText(f.name, Math.max(0, rx), ry - 3)
    }
  })
  ctx.globalAlpha = 1

}

function featureVisWidthPx(startPx, endPx) {
  // Match paint geometry: hairline 2.5px when true width < 3px, else true width.
  const trueW = Math.max(0, endPx - startPx)
  return trueW < 3 ? 2.5 : trueW
}

function stagger(features, startBp) {
  const res = currentRes()
  // Single-lane mode: force level 0 (legacy Disputed path). Prefer stagger for
  // method / TADShop tracks so near-neighbours don't paint as one blob.
  if (props.singleLane) {
    return [...features].sort((a, b) => a.start - b.start).map(f => {
      const startPx = (f.start - startBp) / res * localScale
      const endPx   = (f.end   - startBp) / res * localScale
      return { ...f, level: 0, startPx, endPx }
    })
  }
  // Pack into vertical lanes using the *painted* width so hairline ticks only
  // stack when bars truly overlap in pixels. Adjacent bins that only touch at
  // an edge (common at 1-resolution spacing) stay on one lane — no brick wall.
  //
  // HAIRLINES ARE NEVER STAGGERED. Once a boundary's true footprint is below a pixel,
  // every tick is the same 2.5 px mark and stacking them into lanes does not separate
  // anything: at genome zoom a chromosome's ~2,200 visible calls became a two- or
  // three-row picket fence that read as corrupted rendering, and the lane count — hence
  // the canvas height — flipped between 48 and 78 px as tiles arrived, so the rows
  // appeared to jump whenever anything was clicked. Density at that zoom is carried by
  // the ribbon in draw(), the same way the evidence-tier track does it.
  const levels  = []
  const overlapTol = 1.0  // px of actual overlap required before stacking
  const MAX_LANES = 4
  return [...features].sort((a, b) => a.start - b.start).map(f => {
    const startPx = (f.start - startBp) / res * localScale
    const endPx   = (f.end   - startBp) / res * localScale
    const visW = featureVisWidthPx(startPx, endPx)
    if (endPx - startPx < 3) return { ...f, level: 0, startPx, endPx }
    const cx = (startPx + endPx) / 2
    const visStartPx = cx - visW / 2
    const visEndPx   = cx + visW / 2
    let lv = 0
    while (
      lv < MAX_LANES - 1 &&
      levels[lv] !== undefined &&
      (levels[lv] - visStartPx) > overlapTol
    ) lv++
    levels[lv] = Math.max(levels[lv] || 0, visEndPx)
    return { ...f, level: lv, startPx, endPx }
  })
}

/* ════════════════════════════════════════
 * 初始化
 * ════════════════════════════════════════ */
async function resetView() {
  if (!props.bedToken || !canvasRef.value) return
  tileCache.clear()
  try {
    let info = null
    const globalRes = await fetch(`${props.apiBaseUrl}/bed/global-info/${props.bedToken}`)
    if (globalRes.ok) {
      info = await globalRes.json()
    } else {
      const r = await fetch(`${props.apiBaseUrl}/bed/info/${props.bedToken}/${props.chromosome}`)
      if (r.ok) info = await r.json()
    }
    // Stale/invalid BED token (backend restarted / persisted token): no resolutions. Bail
    // cleanly (draw() short-circuits on empty) + signal the page to self-heal via use_cell,
    // instead of leaving resolutions undefined and throwing on every RAF.
    if (!info || !Array.isArray(info.available_resolutions) || !info.available_resolutions.length) {
      resolutions.value = []
      emit('stale-token')
      return
    }
    resolutions.value = info.available_resolutions
    // Tiles are cut per chromosome (fetchTile sends ?chrom=), so every viewport
    // number this track publishes has to be chromosome-relative. `global-info`
    // reports the *genome* length; seeding from it put the initial view ~1.5 Gb
    // out on a 23-chromosome BED, i.e. outside every chromosome, which rendered
    // as an empty browser with no error on the BED-only import path. The
    // per-chromosome `/bed/info` fallback already returns a chrom-local length.
    const chromKey   = String(props.chromosome ?? '').replace(/^chr/i, '')
    const chromEntry = Array.isArray(info.chromosomes)
      ? info.chromosomes.find(c => String(c?.name ?? '').replace(/^chr/i, '') === chromKey)
      : null
    const spanBp = Array.isArray(info.chromosomes)
      ? Number(chromEntry?.length) || 0
      : Number(info.genome_length) || 0

    if (props.vp?.bpPerPx > 0 && props.vp.sourceId !== props.trackId) {
      applyExternalVp(props.vp)
    } else if (spanBp > 0) {
      // No shared viewport yet — frame the whole current chromosome.
      //
      // ONLY from a canvas that has a real width. onMounted sets
      // `canvas.width = Math.max(1, wrapper.clientWidth)`, so a track that mounts before
      // the panel has laid out gets width 1 — and this line then published
      // bpPerPx = chromosomeLength / 1 to the SHARED viewport, collapsing every track in
      // the browser (Hi-C, bigWig, caller, tier) into a single vertical bar. It depended
      // on layout timing, so it struck intermittently on load. Defer instead: the resize
      // observer seeds once a real width arrives.
      pendingSeedSpanBp = spanBp
      seedFromSpan()
    }
    // spanBp === 0 means the active chromosome is not in this BED (or none is
    // selected yet): leave the viewport unset rather than publish a coordinate
    // no track can honour. The chromosome watcher re-runs resetView once it is.
    requestRender()
  } catch (e) {
    console.error('BedTrack resetView:', e)
  }
}

/** Narrower than this, a canvas cannot define a viewport anyone should adopt. */
const MIN_SEED_PX = 64
let pendingSeedSpanBp = 0

/** Frame `pendingSeedSpanBp` across the canvas, but only once it is really that wide. */
function seedFromSpan() {
  if (!pendingSeedSpanBp) return
  const canvasW = canvasRef.value?.width || 0
  if (canvasW < MIN_SEED_PX) return          // try again from the resize observer
  if (props.vp?.bpPerPx > 0 && props.vp.sourceId !== props.trackId) {
    pendingSeedSpanBp = 0                    // somebody published a real viewport meanwhile
    return
  }
  vpBpPerPx  = Math.max(1, pendingSeedSpanBp / canvasW)
  vpCenterBp = pendingSeedSpanBp / 2
  pendingSeedSpanBp = 0
  emitVp()
  requestRender()
}

/* ════════════════════════════════════════
 * 交互
 * ════════════════════════════════════════ */
function onWheel(e) {
  if (!vpBpPerPx) return
  const factor     = e.deltaY > 0 ? 1.15 : 1 / 1.15   // wheel up -> zoom in -> smaller bpPerPx
  const W          = canvasRef.value?.width || 1
  // bp at the cursor before zoom
  const bpAtMouse  = vpCenterBp + (e.offsetX - W / 2) * vpBpPerPx
  vpBpPerPx       *= factor
  // keep that bp under the cursor after zoom
  vpCenterBp       = bpAtMouse - (e.offsetX - W / 2) * vpBpPerPx
  requestRender()
  emitVp()
}

function onMouseDown(e) {
  if (!vpBpPerPx) return
  isDragging.value = true
  dragStartX = e.clientX
  dragX0     = vpCenterBp
  const onMove = (ev) => {
    if (!isDragging.value) return
    vpCenterBp = dragX0 - (ev.clientX - dragStartX) * vpBpPerPx
    requestRender()
    emitVp()
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', () => {
    isDragging.value = false
    window.removeEventListener('mousemove', onMove)
  }, { once: true })
}

/* ── Hover ── */
function onMouseMove(e) {
  if (isDragging.value) return
  const rect  = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left, my = e.clientY - rect.top
  const found = onscreenEls.find(el =>
    mx >= el.x && mx <= el.x + el.w && my >= el.y && my <= el.y + el.h
  )
  if (found !== hoverFeature.value) {
    hoverFeature.value = found ?? null
  }
  if (found) {
    tipStyle.left = `${mx + 14}px`
    tipStyle.top  = `${Math.max(-60, my - 70)}px`
  }
}

function onMouseLeave() { hoverFeature.value = null }

// 修改 watch vp
watch(
  () => props.vp,
  (vp) => {
    if (!vp || vp.sourceId === props.trackId || !resolutions.value.length) return

    // 如果是 chr-reset 信号，直接处理
    if (vp.sourceId === 'chr-reset') {
      applyExternalVp(vp)
      return
    }

    // 如果 HiC 发来的坐标对应的染色体和当前 BED 显示的不同，忽略
    if (vp.chrom && vp.chrom !== props.chromosome) return

    applyExternalVp(vp)
  },
  { deep: true }
)
/* ── 监听染色体切换 (新增逻辑) ── */
// watch chromosome 里加清除视口逻辑
watch(() => props.chromosome, async (newChr, oldChr) => {
  if (newChr && newChr !== oldChr) {
    tileCache.clear()
    // 先把本地视口归零，防止 resetView 用旧视口计算
    vpCenterBp = 0
    vpBpPerPx  = 0
    await resetView()
    requestRender()
  }
})

// Redraw when the selected boundary (or its vote geometry) changes.
watch(() => props.voteHighlight, () => requestRender(), { deep: true })

// Token rotation (demo re-register after backend restart)
watch(() => props.bedToken, async (t, prev) => {
  if (t && t !== prev) {
    tileCache.clear()
    vpCenterBp = 0
    vpBpPerPx = 0
    await resetView()
    requestRender()
  }
})

/* ── 生命周期 ── */
let themeObserver = null
let resizeObserver = null
onMounted(() => {
  const el = canvasRef.value
  if (!el || !wrapperRef.value) return
  el.width  = Math.max(1, wrapperRef.value.clientWidth)
  el.height = 48
  resizeObserver = new ResizeObserver(() => {
    // Wrapper / canvas may already be torn down by the time the observer
    // fires (route switch, hot reload, parent v-if).  Bail out silently.
    if (!canvasRef.value || !wrapperRef.value) return
    canvasRef.value.width = Math.max(1, wrapperRef.value.clientWidth)
    // Height is managed by draw() based on stagger lanes; keep current height
    // on width-only resize so we don't collapse multi-lane tracks.
    if (!canvasRef.value.height || canvasRef.value.height < 48) {
      canvasRef.value.height = 48
    }
    seedFromSpan()      // a viewport deferred at mount for want of a real width
    requestRender()
  })
  resizeObserver.observe(wrapperRef.value)
  // Redraw when the document flips between light/dark theme classes
  themeObserver = new MutationObserver(() => requestRender())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  resetView()
})
onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
.bed-track-container { width: 100%; background: var(--bg-card); }
.canvas-wrapper { position: relative; width: 100%; }
canvas { display: block; }

.tooltip {
  position: absolute;
  background: rgba(20,20,20,0.92);
  color: #fff;
  padding: 8px 12px;
  border-radius: 5px;
  font-size: 11px;
  pointer-events: none;
  z-index: 100;
  box-shadow: 0 2px 10px rgba(0,0,0,.35);
  max-width: 220px;
}
.tip-title { font-weight: 700; color: #ffd54f; margin-bottom: 4px; }
.tip-body  { line-height: 1.6; color: #ddd; }
</style>
