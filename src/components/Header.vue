<template>
  <header class="header">
    <h1 class="page-name">{{ breadcrumb }}</h1>

    <div class="rail">
      <!-- Loaded package, in the data face. -->
      <div class="readout" :class="{ empty: !hasData }">
        <span v-if="hasData && cellLine" class="readout-cell">{{ cellLine }}</span>
        <span v-if="hasData && cellLine" class="readout-sep" aria-hidden="true">·</span>
        <!-- Exact `assembly · resolution` string, kept as its own .font-mono node:
             the e2e suite reads this element to check the loaded session. -->
        <span class="font-mono">{{ dataBadge }}</span>
      </div>

      <!-- Extent of the two layers, always visible: the evidence table is
           genome-wide, the browser tracks may be a chr7 subset or absent. -->
      <div v-if="hasData" class="scope-chips">
        <span class="scope-chip" :title="`Evidence cards cover ${evidenceScope} of this package`">
          <i class="dot dot-full" aria-hidden="true"></i>evidence {{ evidenceScope }}
        </span>
        <span class="scope-chip" :class="{ off: !trackSource.ok }" :title="trackSource.title">
          <i class="dot" :class="trackSource.ok ? 'dot-full' : 'dot-off'" aria-hidden="true"></i>tracks {{ trackSource.label }}
        </span>
      </div>

      <!-- The tier ramp is the key to every tick and badge in the app, so it is
           permanent chrome. It is also the only colour the interface itself
           carries: everything else here is paper and ink. -->
      <div class="ramp" :title="`Evidence tier ramp: ${TIER_ORDER.slice().reverse().join(' → ')}`">
        <span class="ramp-end">D1</span>
        <span class="ramp-bar" aria-hidden="true">
          <i v-for="t in rampOrder" :key="t" :style="{ background: TIER_COLORS[t] }"></i>
        </span>
        <span class="ramp-end">D5</span>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { useAppState } from '../composables/useAppState'
import { useCounterStore } from '../store/stores'
import { TIER_COLORS, TIER_ORDER } from '../constants/tierColors'

const { page } = useAppState()
const store = useCounterStore()

// low → high, so the bar reads left-to-right like the D1 … D5 labels around it
const rampOrder = TIER_ORDER.slice().reverse()

const view = computed(() => store.file_view_obj || {})
const hasData = computed(() => !!(view.value.resolution || view.value.hic_token))
const cellLine = computed(() => view.value.cell_line || view.value.cell_demo || '')

const dataBadge = computed(() => {
  const o = view.value
  if (!o.resolution && !o.hic_token) return 'no data loaded'
  const r = o.resolution
  const res = r ? (r >= 1000 ? `${r / 1000}kb` : `${r}bp`) : '—'
  return o.assembly ? `${o.assembly} · ${res}` : res
})

const scope = computed(() => view.value.scope || null)

const evidenceScope = computed(() => {
  const n = scope.value?.evidence_chroms?.length
  return n ? `${n} chr` : 'genome-wide'
})

/* Which layer the browser tracks came from. Two exist: the chr7 subsets that ship
   with the app, and the optional full-genome files the user placed in their own
   folder. They resolve per track and per cell line, so a session can legitimately
   be a mix, and "am I looking at demo data or mine?" must be answerable at a
   glance rather than inferred from how much of the chromosome has signal. */
const trackSource = computed(() => {
  const s = scope.value
  if (!s) return { ok: false, label: '—', title: 'No session loaded.' }

  const map = s.map || {}
  const signal = s.signal || {}
  const parts = []
  parts.push(
    map.available
      ? `contact map: ${map.source === 'full_genome' ? 'your full-genome file' : 'bundled chr7 subset'}`
      : `contact map: none${map.blocked_reason ? ` (${map.blocked_reason})` : ''}`,
  )
  parts.push(
    signal.available
      ? `CTCF / RAD21: ${signal.source === 'full_genome' ? 'your full-genome files' : 'bundled chr7 subsets'}`
      : 'CTCF / RAD21: none',
  )
  const title =
    `${parts.join(' · ')}. Evidence cards are genome-wide either way; only the browser ` +
    'view depends on these files.'

  const sources = new Set(
    [map.available ? map.source : null, signal.available ? signal.source : null].filter(Boolean),
  )
  if (sources.size === 0) return { ok: false, label: 'none', title }
  if (sources.size > 1) return { ok: true, label: 'mixed', title }
  return sources.has('full_genome')
    ? { ok: true, label: 'your files', title }
    : { ok: true, label: 'chr7 demo', title }
})

const breadcrumb = computed(() => {
  const breadcrumbs = {
    home: 'Home',
    import: 'Import Files',
    visualization: 'Visualization',
    labels: 'Local Reviews',
    datamanager: 'Data Manager',
  }
  return breadcrumbs[page.value] || page.value
})
</script>

<style scoped>
.header {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 0 var(--s5);
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s4);
  position: sticky;
  top: 0;
  z-index: 50;
}

.page-name {
  font-family: var(--font-display);
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: 0.012em;
  color: var(--text-primary);
}

.rail {
  display: flex;
  align-items: center;
  gap: var(--s5);
}

.readout {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  white-space: nowrap;
}
.readout.empty { color: var(--text-muted); }
.readout-cell { font-family: var(--font-mono); color: var(--text-primary); }
.readout-sep { color: var(--text-muted); }

.scope-chips { display: flex; align-items: center; gap: var(--s3); }
.scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.03em;
  color: var(--text-secondary);
  white-space: nowrap;
}
.scope-chip.off { color: var(--text-muted); }
.dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.dot-full { background: var(--brand); }
.dot-off { background: transparent; box-shadow: 0 0 0 1px var(--ink-faint) inset; }

.ramp {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ramp-end {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.ramp-bar {
  display: flex;
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--rule);
}
.ramp-bar i { width: 13px; height: 8px; display: block; }

@media (max-width: 1200px) {
  .scope-chips { display: none; }
}
@media (max-width: 900px) {
  .readout { display: none; }
}
</style>
