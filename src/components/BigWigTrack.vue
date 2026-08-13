<template>
  <div class="bigwig-track" ref="wrapperRef">
    <canvas ref="canvasRef" @mousemove="onMouseMove" @mouseleave="hover.visible=false"></canvas>
    <!-- Y axis. Without it the row is a shape with no unit: the track autoscales to the
         current view, so a 1.06 peak and a 68.9 peak are drawn exactly the same height. -->
    <div v-if="axis" class="bw-axis" data-testid="bw-axis" aria-hidden="true">
      <span class="bw-tick bw-tick-max">{{ fmtVal(axis.max) }}</span>
      <span class="bw-tick bw-tick-half">{{ fmtVal(axis.half) }}</span>
      <span class="bw-tick bw-tick-zero">0</span>
    </div>
    <div v-if="axis" class="bw-scale" data-testid="bw-scale"
         :title="'Track rescales to the data in view. Highest value in this view: ' + axis.dataMax.toFixed(3)">
      autoscale · view max {{ fmtVal(axis.dataMax) }}
    </div>
    <div v-if="hover.visible" class="bw-tooltip" :style="{ left: hover.x + 'px', top: hover.y + 'px' }">
      {{ formatBp(hover.pos) }}: {{ hover.val.toFixed(2) }}
    </div>
    <div v-if="bwError" class="bw-err" data-testid="bw-error" role="alert">
      <i class="fas fa-triangle-exclamation" aria-hidden="true"></i> {{ bwError }}
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  bwToken:    { type: String, required: true },
  chromosome: { type: String, default: '1' },
  apiBaseUrl: { type: String, default: (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api') },
  vp:         { type: Object, default: null },
  trackId:    { type: String, required: true },
  fileName:   { type: String, default: '' },
  trackColor: { type: String, default: '#3B82F6' },
})

// A dead token must trigger the same session recovery as the Hi-C and BED tracks;
// without this a backend restart left the ChIP rows silently blank while the rest healed.
const emit = defineEmits(['vp-change', 'stale-token'])

const canvasRef = ref(null)
const wrapperRef = ref(null)
const hover = ref({ visible: false, x: 0, y: 0, pos: 0, val: 0 })
const bwError = ref('')
const axis = ref(null)

let chromLen = 0
let lastStart = 0, lastEnd = 0
let lastSignal = []
let fetchId = 0
let fetchTimer = null
let hasReceivedVp = false

function formatBp(v) {
  if (v >= 1e6) return `${(v/1e6).toFixed(2)}Mb`
  if (v >= 1e3) return `${(v/1e3).toFixed(1)}kb`
  return `${Math.round(v)}bp`
}

function chromAliases(name) {
  const n = String(name || '').trim()
  if (!n) return []
  const bare = n.replace(/^chr/i, '')
  return [...new Set([n, bare, `chr${bare}`, `Chr${bare}`])]
}

async function init() {
  try {
    const res = await fetch(`${props.apiBaseUrl}/genome/index/${props.bwToken}`)
    const data = await res.json()
    const list = data.chromosomes || []
    const aliases = chromAliases(props.chromosome)
    const c = list.find(x => aliases.includes(x.name) || aliases.includes(`chr${x.name}`))
    if (c) chromLen = c.length
  } catch (e) {}
}

function getViewRange() {
  if (!props.vp || !props.vp.bpPerPx || !canvasRef.value) return null
  const w = canvasRef.value.width
  const half = props.vp.bpPerPx * w / 2
  return {
    start: Math.max(0, Math.floor(props.vp.centerBp - half)),
    end:   Math.min(chromLen || 1e9, Math.ceil(props.vp.centerBp + half))
  }
}

function scheduleFetch() {
  if (fetchTimer) clearTimeout(fetchTimer)
  fetchTimer = setTimeout(doFetch, 100)
}

async function doFetch() {
  const cv = canvasRef.value
  if (!cv) return
  if (!props.chromosome) return
  const vr = getViewRange()
  if (!vr) return
  const { start, end } = vr
  if (end <= start) return

  const id = ++fetchId
  const bins = Math.min(cv.width, 600)
  try {
    const res = await fetch(
      `${props.apiBaseUrl}/bigwig/signal/${props.bwToken}/${props.chromosome}?start=${start}&end=${end}&bins=${bins}`
    )
    if (id !== fetchId) return
    if (!res.ok) {
      if (res.status === 404 || res.status === 410) {
        bwError.value = 'session expired — recovering…'
        emit('stale-token')
      } else {
        bwError.value = `signal load failed (HTTP ${res.status})`
      }
      return
    }
    const data = await res.json()
    if (id !== fetchId) return
    bwError.value = ''
    lastSignal = data.data || []
    lastStart = start
    lastEnd = end
    render()
  } catch (e) {
    if (id === fetchId) bwError.value = 'signal load failed (network/parse)'
  }
}

/* Nice round upper bound for the axis, so the printed number is readable and the
   same data does not jitter between 68.93 and 68.91 as the view moves by a pixel. */
function niceCeil(v) {
  if (!(v > 0)) return 1
  const exp = Math.floor(Math.log10(v))
  const base = Math.pow(10, exp)
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (v <= m * base) return m * base
  }
  return 10 * base
}
function fmtVal(v) {
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

function render() {
  const cv = canvasRef.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  const W = cv.width, H = cv.height
  const rootStyle = getComputedStyle(document.documentElement)
  const bgColor = rootStyle.getPropertyValue('--bg-secondary').trim() || '#fafafa'
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, W, H)

  if (lastSignal.length === 0) { axis.value = null; return }
  // IMPORTANT: project signal bp positions through the **current** viewport
  // (props.vp.centerBp + props.vp.bpPerPx + canvas width), NOT the bp range
  // that was current when the data was fetched.  Otherwise, the moment the
  // user zooms/pans the bigwig still paints with the old range and visually
  // drifts away from Hi-C / BED.
  if (!props.vp || !(props.vp.bpPerPx > 0)) return
  const bpPerPx = props.vp.bpPerPx
  const startVisible = props.vp.centerBp - (W / 2) * bpPerPx
  const pad = 3
  // AUTOSCALE, NOW STATED. The height of a bar means nothing until you know what the top
  // of the track is: this axis rescales to whatever is in view, so a 1.06 peak and a 68.9
  // peak both fill the row when each is viewed alone. The ceiling is drawn and labelled.
  const dataMax = Math.max(...lastSignal.map(d => d.val), 0)
  const maxVal = niceCeil(dataMax || 0.01)
  // Bar width = one fetched bin's bp span projected to current px scale
  const binBpSpan = (lastEnd - lastStart) / lastSignal.length || 1
  const barW = Math.max(1, binBpSpan / bpPerPx)

  ctx.fillStyle = props.trackColor
  for (const d of lastSignal) {
    const x = (d.pos - startVisible) / bpPerPx
    if (x + barW < 0 || x > W) continue
    const h = (d.val / maxVal) * (H - pad * 2)
    ctx.fillRect(x, H - h - pad, barW + 0.5, h)
  }

  // Gridline at the half-scale mark; the 0 and max rules are drawn by the axis overlay.
  const rule = rootStyle.getPropertyValue('--rule-strong').trim() || '#ccc'
  ctx.strokeStyle = rule
  ctx.globalAlpha = 0.55
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  const yHalf = Math.round(H - pad - 0.5 * (H - pad * 2)) + 0.5
  ctx.moveTo(0, yHalf); ctx.lineTo(W, yHalf)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  axis.value = { max: maxVal, half: maxVal / 2, dataMax, pad }
}

function onMouseMove(e) {
  if (!canvasRef.value || lastSignal.length === 0) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const bpPos = lastStart + (mx / canvasRef.value.width) * (lastEnd - lastStart)
  let best = null, bestD = Infinity
  for (const d of lastSignal) {
    const dist = Math.abs(d.pos - bpPos)
    if (dist < bestD) { bestD = dist; best = d }
  }
  if (best) hover.value = { visible: true, x: mx + 10, y: 5, pos: best.pos, val: best.val }
}

watch(() => props.vp, (vp) => {
  if (!vp || vp.sourceId === props.trackId) return
  hasReceivedVp = true
  if (vp.sourceId === 'chr-reset') { scheduleFetch(); return }
  if (vp.chrom && vp.chrom !== props.chromosome) return
  // Immediate redraw with the new viewport (no wait for the next fetch)
  // so bigwig stays glued to the heatmap during zoom/pan.
  render()
  scheduleFetch()
}, { deep: true })

watch(() => props.chromosome, async () => {
  lastSignal = []
  await init()
  scheduleFetch()
})

let themeObserver = null
onMounted(async () => {
  const cv = canvasRef.value, wr = wrapperRef.value
  if (cv && wr) {
    cv.width = wr.clientWidth
    cv.height = 45
    new ResizeObserver(() => {
      if (!wr || !cv) return
      cv.width = wr.clientWidth
      cv.height = 45
      render()
    }).observe(wr)
  }
  themeObserver = new MutationObserver(() => render())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  await init()
  if (props.vp?.bpPerPx > 0) {
    hasReceivedVp = true
    scheduleFetch()
  }
})
onBeforeUnmount(() => {
  themeObserver?.disconnect()
})
</script>

<style scoped>
.bigwig-track { position: relative; width: 100%; height: 45px; }
.bigwig-track canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
/* Axis labels sit inside the row, right-aligned, over the plot's own left gutter.
   They are painted in HTML rather than on the canvas so they stay crisp on HiDPI and
   remain selectable text. */
.bw-axis {
  position: absolute; left: 0; top: 0; width: 46px; height: 100%;
  pointer-events: none; font-family: var(--font-mono); font-size: 9px;
  color: var(--text-secondary); font-variant-numeric: tabular-nums;
  isolation: isolate;   /* so the label plates below stay above the canvas */
}
.bw-axis .bw-tick { position: absolute; right: 3px; padding: 0 2px; line-height: 1; }
/* Translucent plate rather than a solid one: the labels sit over the plot (a solid
   gutter would shift the plot area and break pixel alignment with the Hi-C map and the
   caller tracks), so whatever is under them must stay visible. */
.bw-axis .bw-tick::before {
  content: ''; position: absolute; inset: -1px -1px; z-index: -1;
  background: var(--bg-secondary); opacity: 0.72; border-radius: 2px;
}
.bw-tick-max  { top: 2px; }
.bw-tick-half { top: 50%; transform: translateY(-50%); }
.bw-tick-zero { bottom: 1px; }
.bw-scale {
  position: absolute; right: 4px; top: 2px; pointer-events: auto;
  font-family: var(--font-mono); font-size: 9px; color: var(--text-muted);
  background: var(--bg-secondary); padding: 0 3px; border-radius: var(--r-xs);
}
.bw-tooltip {
  position: absolute; background: rgba(0,0,0,0.75); color: #fff;
  padding: 3px 8px; border-radius: 3px; font-size: 11px;
  pointer-events: none; white-space: nowrap;
}
.bw-err {
  position: absolute; top: 2px; left: 6px; font-size: 10px; color: var(--warning-text);
  background: rgba(180,83,9,.10); border: 1px solid rgba(180,83,9,.3);
  border-radius: 4px; padding: 1px 6px; pointer-events: none;
}
</style>
