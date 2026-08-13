<template>
  <div class="vci-track" ref="el" :style="{ height: trackH + 'px' }">
    <svg :width="w" :height="svgH" class="vci-svg">
      <!-- density ribbon when zoomed way out (many ticks per pixel) -->
      <g v-if="densityBars.length" class="dens">
        <rect
          v-for="(d, i) in densityBars"
          :key="'d'+i"
          :x="d.x" :y="svgH - 4" :width="d.w" :height="3"
          :fill="d.fill" :opacity="d.op"
        />
      </g>
      <rect
        v-for="b in visible"
        :key="b.boundary_id"
        :x="b._x" :y="b._y" :width="b._w" :height="b._h" rx="1"
        class="bnd"
        :class="{ sel: selectedId === b.boundary_id, tick: b._tick }"
        :fill="tierColor(b.auto_tier)"
        :data-testid="'tick-'+b.pos"
        role="button"
        :tabindex="b.boundary_id === keyboardId ? 0 : -1"
        :aria-label="tickLabel(b)"
        @click="$emit('select', b)"
        @keydown="onTickKeydown($event, b)"
      >
        <title>{{ b.boundary_id }} · {{ b.auto_tier }}{{ b.votes != null ? ` · ${b.votes} votes` : '' }}{{ b._binCount > 1 ? ` · strongest of ${b._binCount} boundaries in this column — zoom in to pick one` : '' }}</title>
      </rect>
    </svg>
    <div v-if="!vp || !vp.bpPerPx" class="vci-hint">Pan or zoom the Hi-C map — evidence-tier ticks follow the view</div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { tierColor } from '../constants/tierColors'

const props = defineProps({
  boundaries: { type: Array, default: () => [] },
  vp:         { type: Object, default: null },
  selectedId: { type: String, default: null },
  /** Annotation bin size (bp). Used for true footprint when zoomed in. */
  resolution: { type: [Number, String], default: 25000 },
})
const emit = defineEmits(['select'])

const el = ref(null)
const w = ref(900)
let ro = null

const RES = computed(() => {
  const n = Number(props.resolution)
  return Number.isFinite(n) && n > 0 ? n : 25000
})

// Hairline when zoomed out; true-width bar when footprint is visible.
const TICK_PX = 2.5
const BAR_MIN_PX = 3
const BAR_H = 14
const MAX_STACK = 3

/* Positions, sorted once per boundary list, so a pan does a binary search for the visible
   slice instead of scanning the whole chromosome. At genome zoom the list is 5–7k
   boundaries and the layout below re-runs on every viewport change; scanning and
   spread-copying all of them per frame was most of the drag cost. */
const sorted = computed(() => {
  const arr = props.boundaries || []
  const copy = arr.length ? arr.slice() : []
  copy.sort((a, b) => a.pos - b.pos)
  return copy
})

/** First index with pos >= target, over the pre-sorted list. */
function lowerBound(arr, target) {
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].pos < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

const layout = computed(() => {
  if (!props.vp || !props.vp.bpPerPx || !props.vp.centerBp) {
    return { items: [], dens: [], maxLv: 0 }
  }
  const W = w.value
  const bpp = props.vp.bpPerPx
  const startVisible = props.vp.centerBp - (W / 2) * bpp
  const res = RES.value
  const footprint = res / bpp
  const isTick = footprint < BAR_MIN_PX

  // Visible slice by binary search. The bp bounds are the exact inverse of the pixel test
  // this loop used to apply to every boundary (cx in [-20, W+20]), so the same set is kept.
  const all = sorted.value
  const bpLo = startVisible + (-20 - footprint / 2) * bpp
  const bpHi = startVisible + (W + 20 - footprint / 2) * bpp
  const raw = []
  for (let i = lowerBound(all, bpLo); i < all.length; i++) {
    const b = all[i]
    if (b.pos > bpHi) break
    const cx = (b.pos - startVisible) / bpp + footprint / 2
    const bw = isTick ? TICK_PX : footprint
    const bx = isTick ? cx - bw / 2 : (b.pos - startVisible) / bpp
    raw.push({ ...b, _cx: cx, _x: bx, _w: bw, _tick: isTick })
  }

  /* AGGREGATE REGIME — same switch point as the caller tracks (one annotation bin
     narrower than one pixel), so every row in the browser changes representation at the
     same zoom. Below that width two adjacent boundaries provably land on the same pixel:
     painting one 2.5 px mark each turned a chromosome-wide view into a solid wall of
     identical ticks stacked on three lanes, which is unreadable and is what "the whole
     genome shown at once" refers to.

     One rect per density bin instead, height by count, coloured by the STRONGEST tier in
     the bin. Each rect is still a real boundary — the strongest one in its bin, ties
     broken by position — so it stays clickable, keeps its testid/title, and the served
     tier behind every painted mark is still exactly the tier of the boundary it names. */
  const TIER_RANK = { D5: 5, D4: 4, D3: 3, D2: 2, D1: 1 }
  if (footprint < 1 && raw.length > 40) {
    const bins = Math.max(40, Math.min(320, Math.floor(W / 3)))
    const buckets = new Array(bins)
    for (const b of raw) {
      const i = Math.min(bins - 1, Math.max(0, Math.floor((b._cx / W) * bins)))
      const cur = buckets[i]
      if (!cur) { buckets[i] = { n: 1, rep: b }; continue }
      cur.n++
      const better = (TIER_RANK[b.auto_tier] || 0) - (TIER_RANK[cur.rep.auto_tier] || 0)
      if (better > 0 || (better === 0 && b.pos < cur.rep.pos)) cur.rep = b
    }
    const maxC = buckets.reduce((m, s) => Math.max(m, s ? s.n : 0), 1)
    const bw = W / bins
    const items = []
    for (let i = 0; i < bins; i++) {
      const s = buckets[i]
      if (!s) continue
      const h = Math.max(3, Math.round((s.n / maxC) * BAR_H))
      items.push({
        ...s.rep,
        _x: i * bw, _w: Math.max(1, bw - 0.4), _tick: false,
        _y: 8 + (BAR_H - h), _h: h, level: 0, _binCount: s.n,
      })
    }
    return { items, dens: [], maxLv: 0 }
  }

  // Stack only when painted ticks truly overlap (>1 px). Edge-adjacent bins stay flat.
  const levels = []
  const overlapTol = 1.0
  let maxLv = 0
  const items = raw.map(b => {
    const vs = b._x
    const ve = b._x + b._w
    let lv = 0
    while (
      lv < MAX_STACK - 1 &&
      levels[lv] !== undefined &&
      (levels[lv] - vs) > overlapTol
    ) lv++
    levels[lv] = Math.max(levels[lv] || 0, ve)
    if (lv > maxLv) maxLv = lv
    const y = 8 + lv * (BAR_H + 2)
    return { ...b, _y: y, _h: BAR_H, level: lv }
  })

  // Density ribbon under ticks when zoomed out and many features share pixels
  const dens = []
  if (footprint < 1 && raw.length > 40) {
    const bins = Math.min(120, Math.max(20, Math.floor(W / 8)))
    const counts = new Array(bins).fill(0)
    const tiers = new Array(bins).fill(null)
    for (const b of raw) {
      const i = Math.min(bins - 1, Math.max(0, Math.floor((b._cx / W) * bins)))
      counts[i]++
      // keep strongest tier seen in bin for colour (D5 > D1)
      const rank = { D5: 5, D4: 4, D3: 3, D2: 2, D1: 1 }
      const cur = tiers[i]
      if (!cur || (rank[b.auto_tier] || 0) > (rank[cur] || 0)) tiers[i] = b.auto_tier
    }
    const maxC = Math.max(1, ...counts)
    const bw = W / bins
    for (let i = 0; i < bins; i++) {
      if (!counts[i]) continue
      dens.push({
        x: i * bw,
        w: Math.max(1, bw - 0.5),
        fill: tierColor(tiers[i] || 'D3'),
        op: 0.25 + 0.55 * (counts[i] / maxC),
      })
    }
  }
  return { items, dens, maxLv }
})

const visible = computed(() => layout.value.items)
const densityBars = computed(() => layout.value.dens)
const svgH = computed(() => 8 + Math.min(MAX_STACK, layout.value.maxLv + 1) * (BAR_H + 2) + 10)
const trackH = computed(() => Math.max(42, svgH.value + 4))

/* Opening an evidence card was mouse-only: the ticks carried a click handler and
   nothing else, so Tab could never reach the one control this whole tool exists
   for. A genome-wide view paints thousands of them, so only one is in the tab
   order at a time (roving tabindex) and the arrow keys walk the rest. */
const keyboardId = computed(() => {
  const items = visible.value
  if (!items.length) return null
  const selected = items.find(b => b.boundary_id === props.selectedId)
  return (selected || items[0]).boundary_id
})

function tickLabel(b) {
  const votes = b.votes != null ? `, ${b.votes} votes` : ''
  return `${b.boundary_id}, evidence tier ${b.auto_tier}${votes}`
}

function focusTick(b) {
  nextTick(() => {
    el.value?.querySelector(`rect.bnd[data-testid="tick-${b.pos}"]`)?.focus?.()
  })
}

function onTickKeydown(event, b) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('select', b)
    return
  }
  const items = visible.value
  const i = items.findIndex(x => x.boundary_id === b.boundary_id)
  if (i < 0) return
  let j = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') j = Math.min(items.length - 1, i + 1)
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') j = Math.max(0, i - 1)
  else if (event.key === 'Home') j = 0
  else if (event.key === 'End') j = items.length - 1
  if (j === null || j === i) return
  event.preventDefault()
  emit('select', items[j])
  focusTick(items[j])
}

function measure() { if (el.value) w.value = el.value.clientWidth || 900 }
onMounted(() => { measure(); ro = new ResizeObserver(measure); if (el.value) ro.observe(el.value) })
onBeforeUnmount(() => { if (ro) ro.disconnect() })
</script>

<style scoped>
.vci-track { position: relative; width: 100%; min-height: 42px; }
.vci-svg { display: block; width: 100%; }
.vci-hint { position: absolute; top: 12px; left: 12px; font-size: var(--fs-xs); color: var(--text-muted); }
rect.bnd { cursor: pointer; }
rect.bnd.tick { opacity: 0.95; }
rect.bnd:hover { stroke: var(--text-primary); stroke-width: 1.4; }
rect.sel { stroke: var(--primary); stroke-width: 2.2; }
/* Stroke, not outline: the ring must not shift x/width, which the whole browser
   geometry is derived from. */
rect.bnd:focus { outline: none; }
rect.bnd:focus-visible { outline: none; stroke: var(--primary); stroke-width: 2.6; }
/* The tier ramp legend used to sit here, absolutely positioned over the ticks it
   was explaining. It now lives permanently in the app header (Header.vue), where
   it cannot occlude data and is available on every page. */
</style>
