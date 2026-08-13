<template>
  <div class="fade-in labels">
    <header class="labels-head">
      <div>
        <!-- Same name as the sidebar and the header title; the page used to call
             itself something else. -->
        <h2 class="page-title">Local reviews — decisions recorded on this machine</h2>
        <p class="page-lead measure">
          Versioned evidence-card reviews made in this local application. Actor labels are not authenticated.
        </p>
      </div>
      <div class="labels-actions">
        <button
          class="btn btn-outline"
          :disabled="!canExport"
          :title="exportBlockReason || 'Export local review assertions with active dataset provenance'"
          @click="exportReviewAssertionsJSON"
        >
          <i class="fas fa-download" aria-hidden="true"></i>Export JSON
        </button>
        <button
          class="btn btn-outline"
          :disabled="!canExport"
          :title="exportBlockReason || 'Export BED with active dataset provenance headers'"
          @click="exportReviewAssertionsBED"
        >
          <i class="fas fa-download" aria-hidden="true"></i>Export BED
        </button>
      </div>
    </header>

    <div class="card context-card" :class="{ 'context-blocked': !!exportBlockReason }" role="status">
      <div class="section-head">
        <span class="section-title">Active export context</span>
      </div>
      <div v-if="reviewExportState.ready" class="context-values font-mono tabular">
        {{ reviewExportState.context.assembly }} · {{ reviewExportState.context.cell }} ·
        {{ reviewExportState.context.resolution }} bp · {{ reviewExportState.context.source }}
      </div>
      <!-- Most block reasons are empty states (nothing loaded, nothing recorded yet),
           so they read as neutral copy; only a genuine load failure takes danger ink. -->
      <div
        v-if="exportBlockReason"
        class="context-status"
        :class="{ 'is-failure': !!vciLoadError }"
        data-testid="review-export-blocked"
      >
        Export unavailable: {{ exportBlockReason }}
      </div>
      <div v-else class="context-status">
        JSON and BED exports carry assembly, cell, resolution and source from this loaded dataset,
        and cover the {{ scopedRecords.length }} of {{ vciRecords.length }} records made against it.
      </div>
    </div>

    <div class="stats">
      <div class="stat-box">
        <div class="stat-value">{{ stats.total }}</div>
        <div class="stat-label">Total reviews</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">{{ stats.supported }}</div>
        <div class="stat-label">Supported locally</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">{{ stats.notSupported }}</div>
        <div class="stat-label">Not supported locally</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">{{ stats.uncertain }}</div>
        <div class="stat-label">Uncertain</div>
      </div>
    </div>

    <div class="card table-card">
      <!-- .measure sits on the text, not on the bordered box: on the box it cut the
           rule short at 68ch and left the right edge of the card unruled. -->
      <p class="table-note">
        <span class="measure">
          Per-record SHA-256 checksums cover canonical record fields; they do not authenticate identity or prove log completeness.
        </span>
      </p>
      <div class="table-scroll scrollbar">
        <table class="data-table">
          <thead>
            <tr>
              <th>Boundary</th>
              <!-- A boundary id is only chrom:pos, so two cell lines produce the
                   same one. Without this column the log reads as if every row
                   were about the dataset currently on screen. -->
              <th>Dataset</th>
              <th>v</th>
              <th>Reviewed tier</th>
              <th>Local assertion</th>
              <th>Actor label</th>
              <th>Rationale</th>
              <th>sha256</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="vciLoading">
              <td colspan="8" class="state-cell">
                <i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading local review assertions…
              </td>
            </tr>
            <tr v-else-if="vciLoadError">
              <td colspan="8" class="state-cell is-failure">
                {{ vciLoadError }}
              </td>
            </tr>
            <tr v-else-if="vciRecords.length === 0">
              <td colspan="8" class="state-cell">
                No local review assertions yet — review an evidence card on the Visualization page.
              </td>
            </tr>
            <tr v-for="record in vciRecords" :key="record.boundary_id + '-' + record.version" data-testid="vci-record-row">
              <td class="font-mono">{{ record.boundary_id }}</td>
              <td class="font-mono dataset-cell">{{ recordDataset(record) }}</td>
              <td class="font-mono tabular">{{ record.version }}</td>
              <td>
                <!-- Tier is data, so it keeps its hue — but as a tick from the shared
                     ramp, with the code itself set in ink so it always stays legible. -->
                <span class="tier">
                  <i class="tier-tick" :style="tierStyle(record.final_tier)" aria-hidden="true"></i>
                  <span class="font-mono tier-code">{{ record.final_tier }}</span>
                </span>
              </td>
              <td>{{ assertionText(record.review_decision?.verdict) }}</td>
              <td>{{ record.actor_label || 'unlabelled' }}</td>
              <td class="rationale">
                {{ record.review_decision?.rationale || '' }}
              </td>
              <td class="font-mono sha">{{ record.content_hash }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAppState } from '../composables/useAppState'
import { tierColor } from '../constants/tierColors'
import {
  attachReviewRecordSources,
  selectRecordsForContext,
  validateReviewRecordsForContext,
} from '../utils/reviewExport'

const {
  reviewExportState,
  exportReviewAssertionsJSON,
  exportReviewAssertionsBED,
} = useAppState()

const vciRecords = ref([])
const vciLoading = ref(true)
const vciLoadError = ref('')
const apiBase = (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api')

onMounted(async () => {
  try {
    const response = await fetch(`${apiBase}/tadvci/records`)
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
    if (!Array.isArray(payload.records)) throw new Error('record response is malformed')
    vciRecords.value = attachReviewRecordSources(payload.records)
  } catch (error) {
    vciRecords.value = []
    vciLoadError.value = `Could not load local review assertions: ${error.message || error}`
  } finally {
    vciLoading.value = false
  }
})

// The log spans every dataset the user has opened; only this dataset's rows are
// the export. Checking all of them made two reviewed datasets lock each other out
// with no way back other than deleting the log on disk.
const scopedRecords = computed(() => {
  if (!reviewExportState.value.ready) return []
  return selectRecordsForContext(vciRecords.value, reviewExportState.value.context)
})

const recordContextIssues = computed(() => {
  if (!reviewExportState.value.ready) return []
  return validateReviewRecordsForContext(scopedRecords.value, reviewExportState.value.context)
})

const exportBlockReason = computed(() => {
  if (!reviewExportState.value.ready) {
    return `current dataset context is missing ${reviewExportState.value.missing.join(', ')}`
  }
  if (vciLoading.value) return 'local review assertions are still loading'
  if (vciLoadError.value) return vciLoadError.value
  if (!vciRecords.value.length) return 'there are no local review assertions to export'
  if (!scopedRecords.value.length) {
    const c = reviewExportState.value.context
    return `none of the ${vciRecords.value.length} local review assertions were made against `
      + `${c.cell} · ${c.assembly} · ${c.resolution} bp`
  }
  if (recordContextIssues.value.length) {
    const extra = recordContextIssues.value.length > 1 ? ` (+${recordContextIssues.value.length - 1} more)` : ''
    return `${recordContextIssues.value[0]}${extra}`
  }
  return ''
})

const canExport = computed(() => !exportBlockReason.value)
const stats = computed(() => ({
  total: vciRecords.value.length,
  supported: vciRecords.value.filter((r) => r.review_decision?.verdict === 'supported_for_review').length,
  notSupported: vciRecords.value.filter((r) => r.review_decision?.verdict === 'not_supported_for_review').length,
  uncertain: vciRecords.value.filter((r) => r.review_decision?.verdict === 'uncertain').length,
}))

const ASSERTION_TEXT = {
  supported_for_review: 'Supported in this local review',
  not_supported_for_review: 'Not supported in this local review',
  uncertain: 'Uncertain',
}
// Shared D5→D1 ramp (constants/tierColors.js) so a tier here is the same colour as
// on the tier track and the evidence card.
function tierStyle(tier) { return { background: tierColor(tier) } }
function assertionText(assertion) { return ASSERTION_TEXT[assertion] || '—' }
function recordDataset(record) {
  const parts = [record?.cell_line, record?.assembly].filter(Boolean)
  if (record?.resolution) parts.push(`${record.resolution} bp`)
  return parts.length ? parts.join(' · ') : '—'
}
</script>

<style scoped>
.labels {
  max-width: 1000px;
  margin: 0 auto;
  padding-bottom: var(--s6);
}

/* ── Head ─────────────────────────────────────────────────────────────────── */
.labels-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s5);
  margin-bottom: var(--s5);
}
.page-title {
  font-family: var(--font-display);
  font-size: var(--fs-xl);
  font-weight: 600;
  letter-spacing: 0.004em;
  margin: 0;
}
.page-lead {
  margin: var(--s2) 0 0;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}
.labels-actions {
  display: flex;
  flex: none;
  gap: var(--s2);
}
@media (max-width: 720px) {
  .labels-head { flex-direction: column; gap: var(--s4); }
}

/* ── Export context ───────────────────────────────────────────────────────── */
/* The left rule is the same tick gesture used for section heads: ink while the
   context is exportable, faded when it is not. It is never an error colour. */
.context-card {
  padding: var(--s4) var(--s5);
  border-left: 2px solid var(--ink);
}
.context-card.context-blocked { border-left-color: var(--rule-strong); }
.context-card .section-head { margin-bottom: var(--s3); }

.context-values {
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.context-status {
  margin-top: 6px;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--text-muted);
}
.context-status.is-failure { color: var(--danger-text); }

/* ── Counts ───────────────────────────────────────────────────────────────── */
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: var(--s5) 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.stats .stat-box {
  border: none;
  border-right: 1px solid var(--rule);
  border-radius: 0;
  box-shadow: none;
  padding: var(--s4) var(--s4) var(--s3);
}
.stats .stat-box:last-child { border-right: none; }
@media (max-width: 720px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stats .stat-box:nth-child(2n) { border-right: none; }
  .stats .stat-box:nth-child(-n + 2) { border-bottom: 1px solid var(--rule); }
}

/* ── Record log ───────────────────────────────────────────────────────────── */
.table-card { overflow: hidden; }
.table-note {
  margin: 0;
  padding: var(--s3) var(--s4);
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-muted);
}
.table-note .measure { display: block; }
.table-scroll { overflow-x: auto; }

.data-table th { padding-top: var(--s3); }
.data-table th:first-child,
.data-table td:first-child { padding-left: var(--s4); }
.data-table th:last-child,
.data-table td:last-child { padding-right: var(--s4); }

.tier { display: inline-flex; align-items: center; gap: 7px; }
.tier-tick { width: 3px; height: 13px; border-radius: 1px; flex: none; }
.tier-code {
  font-size: var(--fs-xs);
  letter-spacing: 0.04em;
  color: var(--text-primary);
}

.dataset-cell { font-size: var(--fs-xs); white-space: nowrap; color: var(--text-secondary); }
.rationale { max-width: 240px; }
.sha {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.state-cell {
  padding: var(--s6) var(--s3);
  text-align: center;
  color: var(--text-muted);
}
.state-cell.is-failure { color: var(--danger-text); }
.data-table tr:hover td.state-cell { background: transparent; }
</style>
