<template>
  <div class="fade-in home">
    <div class="home-grid">
      <!-- ── Left: what this tool records ───────────────────────────────── -->
      <section class="thesis">
        <p class="eyebrow">{{ appName }}</p>
        <h1 class="thesis-title">Evidence for boundaries<br />you already called</h1>
        <p class="thesis-lead measure-narrow">
          CrediTAD annotates called TAD boundaries. It is not a caller, it does not
          rank callers, and it does not decide which boundaries are real. What it
          produces is a record you can read, re-compute and sign off on.
        </p>

        <!-- What one record holds, laid out the way the record is laid out. -->
        <dl class="fields" aria-label="Fields recorded per boundary">
          <div class="field-col">
            <dt>BD1</dt>
            <dd>Cross-caller agreement</dd>
            <span>named votes</span>
          </div>
          <div class="field-col">
            <dt>BD2</dt>
            <dd>CTCF enrichment</dd>
            <span>ChIP fold change</span>
          </div>
          <div class="field-col">
            <dt>BD3</dt>
            <dd>Cohesin enrichment</dd>
            <span>RAD21 ChIP</span>
          </div>
          <div class="field-col">
            <dt>BD4</dt>
            <dd>Loop-anchor overlap</dd>
            <span>BEDPE anchors</span>
          </div>
          <div class="field-col field-out">
            <dt>D1–D5</dt>
            <dd>Evidence tier</dd>
            <span>deterministic rule, per boundary</span>
          </div>
        </dl>
      </section>

      <!-- ── Right: two ways in ─────────────────────────────────────────── -->
      <section class="entries">
        <div class="card entry">
          <div class="section-head">
            <span class="section-title">Grade your own called boundaries</span>
          </div>
          <p class="entry-copy">
            A primary BED of called positions is required. A caller panel, Hi-C map,
            ChIP tracks and loop calls are each optional; anything you leave out is
            recorded as not assessed, never as a negative.
          </p>
          <button type="button" class="btn btn-outline btn-lg entry-cta" @click="setPage('import')">
            Import your boundaries
          </button>
        </div>

        <div class="card entry">
          <div class="section-head">
            <span class="section-title">Six packages ship with the app</span>
            <span class="section-note">GRCh38</span>
          </div>
          <p class="entry-copy scope-line">
            Three cell lines × two resolutions, already annotated —
            <b v-if="totalCandidates">{{ totalCandidates.toLocaleString('en-US') }}</b>
            <template v-if="totalCandidates"> candidate boundaries in total. </template>
            <template v-else>no download required. </template>
            Pick one and open it.
          </p>

          <div class="picker">
            <div class="picker-group" role="group" aria-label="Cell line">
              <button
                v-for="c in fullCells"
                :key="c"
                type="button"
                class="seg"
                :class="{ on: fullCell === c }"
                :aria-pressed="fullCell === c"
                :disabled="!!loadingExample"
                @click="fullCell = c"
              >{{ c }}</button>
            </div>
            <div class="picker-group" role="group" aria-label="Resolution">
              <button
                v-for="r in fullResolutions"
                :key="r"
                type="button"
                class="seg"
                :class="{ on: fullRes === r }"
                :aria-pressed="fullRes === r"
                :disabled="!!loadingExample"
                @click="fullRes = r"
              >{{ r / 1000 }} kb</button>
            </div>
          </div>

          <!-- The full shipped inventory, so the six packages are visible without
               having to work the picker to discover them. -->
          <table v-if="demoDatasets.length" class="inventory">
            <thead>
              <tr>
                <th scope="col"><span class="vh">Cell line</span></th>
                <th v-for="r in fullResolutions" :key="r" scope="col">{{ r / 1000 }} kb</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in fullCells" :key="c">
                <th scope="row">{{ c }}</th>
                <td
                  v-for="r in fullResolutions"
                  :key="r"
                  :class="{ on: fullCell === c && fullRes === r }"
                >
                  <!-- No per-package map marker: the bundled chr7 tracks are shared
                       by all six, and the two layers are stated once below. -->
                  <template v-if="metaFor(c, r)">
                    {{ metaFor(c, r).n_candidates.toLocaleString('en-US') }}
                  </template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>

          <p class="summary" aria-live="polite">
            <template v-if="fullMeta">
              <span class="summary-n">{{ fullMeta.n_candidates.toLocaleString('en-US') }}</span>
              <span class="summary-unit">candidates</span>
              <span class="summary-sep" aria-hidden="true">·</span>
              <span class="summary-meta">{{ fullMeta.assembly }}</span>
            </template>
            <template v-else-if="stillTrying">
              <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
              Reading the shipped packages…
            </template>
            <template v-else>Package metadata unavailable.</template>
          </p>

          <!-- Recoverable failure. Without this the page had no way back: the
               fetch ran once on mount and every control stayed disabled. -->
          <div v-if="metaError && !fullMeta" class="meta-error" role="status">
            <p>
              Could not read the shipped packages — <b>{{ metaError }}</b>.
              <template v-if="stillTrying">Starting the analysis backend — this can take a
        minute the first time the app runs. Retrying automatically ({{ metaAttempts }}/{{ MAX_AUTO_RETRIES }}).</template>
              <template v-else>The backend may not be running.</template>
            </p>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              :disabled="metaLoading"
              @click="loadDatasets({ auto: false })"
            >
              <i :class="metaLoading ? 'fas fa-spinner fa-spin' : 'fas fa-rotate-right'" aria-hidden="true"></i>
              {{ metaLoading ? 'Checking…' : 'Try again' }}
            </button>
            <!-- The desktop app collects the backend's startup steps and log, but until
                 now they were reachable only from a SPLASH failure. This failure happens
                 after the splash has already succeeded, so a user who got here had no way
                 to see or send why. -->
            <button
              v-if="hasDesktopDiagnostics"
              type="button"
              class="btn btn-outline btn-sm"
              data-testid="copy-diagnostics"
              @click="copyStartupDiagnostics"
            >
              <i :class="diagCopied ? 'fas fa-check' : 'fas fa-clipboard'" aria-hidden="true"></i>
              {{ diagCopied ? 'Copied' : 'Copy diagnostics' }}
            </button>
          </div>

          <!-- The single most-misread thing about the demos: what is annotated and
               what can be drawn are not the same extent. -->
          <dl class="layers">
            <div class="layer">
              <dt>Evidence</dt>
              <dd>
                <b>All 23 chromosomes.</b>
                Cards, tiers and caller votes work everywhere in the package.
              </dd>
            </div>
            <div class="layer">
              <dt>Browser view</dt>
              <dd>
                <b>chr7 only</b> with the bundled Hi-C map and ChIP tracks.
                Other chromosomes show evidence without a map until you
                <button type="button" class="inline-link" @click="setPage('datamanager')">add full-genome tracks</button>.
              </dd>
            </div>
          </dl>

          <button
            type="button"
            class="btn btn-primary btn-lg entry-cta"
            :disabled="!!loadingExample || !fullMeta"
            @click="loadMulticellExample(fullCell, fullRes)"
          >
            <i
              v-if="loadingExample === `${fullCell}:${fullRes}`"
              class="fas fa-spinner fa-spin"
              aria-hidden="true"
            ></i>
            {{ loadingExample === `${fullCell}:${fullRes}`
              ? 'Loading…'
              : `Load ${fullCell} ${fullRes / 1000} kb demo` }}
          </button>

          <!-- Loading a package takes seconds, not milliseconds: it reads the
               evidence table and opens the contact matrix. Say so, or a disabled
               page reads as a frozen one. -->
          <p v-if="loadingExample" class="loading-note" role="status">
            Reading {{ loadingExample.split(':')[0] }}
            {{ Number(loadingExample.split(':')[1]) / 1000 }} kb — evidence table and
            contact matrix. This takes a few seconds.
          </p>
        </div>

        <p v-if="demoNote" class="status" role="status">{{ demoNote }}</p>
      </section>
    </div>

    <footer class="foot">
      <div class="pipeline" aria-label="Method pipeline">
        <span>Called boundaries</span>
        <i aria-hidden="true">→</i>
        <span>BD1–BD4 fields</span>
        <i aria-hidden="true">→</i>
        <span>Tier D1–D5</span>
        <i aria-hidden="true">→</i>
        <span>Inspectable card</span>
      </div>
      <button type="button" class="btn btn-outline" @click="setPage('datamanager')">
        <i class="fas fa-download" aria-hidden="true"></i>
        Add full-genome tracks
      </button>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppState } from '../composables/useAppState'
import { useCounterStore } from '../store/stores'

const { setPage, appName } = useAppState()
const store = useCounterStore()
const API_BASE = (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api')

const loadingExample = ref('')
const demoNote = ref('')

const fullCells = ['GM12878', 'IMR90', 'HepG2']
const fullResolutions = [25000, 10000]
const fullCell = ref('GM12878')
const fullRes = ref(25000)
const demoDatasets = ref([])

// Only this package ships a bundled contact map, and only for chr7.

const metaFor = (cell, resolution) =>
  demoDatasets.value.find(d => d.cell_line === cell && d.resolution === resolution) || null

const fullMeta = computed(() => metaFor(fullCell.value, fullRes.value))

const totalCandidates = computed(() =>
  demoDatasets.value.reduce((sum, d) => sum + (Number(d.n_candidates) || 0), 0)
)

/* The package list used to be fetched exactly once, on mount, with the error
   swallowed. The backend needs about fifteen seconds to come up, so a Home page
   that mounted first left every control permanently disabled with no way back
   except restarting the app. Retry automatically while it is plausibly still
   starting, then hand the user an explicit retry. */
const metaError = ref('')
const metaLoading = ref(false)
/* How long the page keeps waiting for the backend before it stops retrying by itself.
   The old budget was 5 attempts with a 1200*n ms backoff = 18 s, which is fine for the
   web app (the backend is already up) and far too short for the packaged desktop app:
   on a first launch the embedded Python has to start and import numpy/pandas/scipy/h5py/
   cooler/sklearn while the antivirus scans 8,800 freshly installed files. Users saw
   "Could not read the shipped packages" on a backend that was simply still starting.
   12 attempts with the same backoff is ~94 s of patience, and the message says what it
   is waiting for. */
const MAX_AUTO_RETRIES = 12
// A ref, not a plain let: `stillTrying` and the attempt counter in the template
// both read it, and a plain variable does not re-trigger them.
const metaAttempts = ref(0)
let metaTimer = null
let unmounted = false

async function loadDatasets({ auto = true } = {}) {
  clearTimeout(metaTimer)
  metaLoading.value = true
  if (!auto) metaAttempts.value = 0
  try {
    const res = await fetch(`${API_BASE}/tadvci/multicell_datasets`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    const list = d.datasets || []
    if (!list.length) {
      // Distinguish "the backend answered, and it can see nothing" from "no answer".
      // These have completely different causes — an empty install tree versus a backend
      // that has not finished starting — and the old wording covered both.
      const where = d.searched
        ? ` — it looked in ${d.searched} (exists: ${d.searched_exists}` +
          `${d.searched_entries ? `, entries: ${d.searched_entries.join(', ') || 'none'}` : ''})`
        : ''
      throw new Error(`the backend answered but found 0 demo packages${where}`)
    }
    if (unmounted) return
    demoDatasets.value = list
    metaError.value = ''
    metaAttempts.value = 0
  } catch (e) {
    if (unmounted) return
    metaError.value = String(e?.message || e)
    if (metaAttempts.value < MAX_AUTO_RETRIES) {
      metaAttempts.value += 1
      metaTimer = setTimeout(() => loadDatasets(), 1200 * metaAttempts.value)
    }
  } finally {
    if (!unmounted) metaLoading.value = false
  }
}

const stillTrying = computed(() => metaLoading.value || metaAttempts.value < MAX_AUTO_RETRIES)

/* Everything needed to diagnose a backend that started but is not answering, in one
   pasteable block: which endpoint failed, how many attempts, and the backend's own
   startup steps and log tail as captured by the Electron main process. */
const hasDesktopDiagnostics = Boolean(window.electronAPI?.getStartupEvents)
const diagCopied = ref(false)
async function copyStartupDiagnostics() {
  const lines = [
    'CrediTAD startup diagnostics',
    `when: ${new Date().toISOString()}`,
    `api base: ${API_BASE}`,
    `failing request: GET ${API_BASE}/tadvci/multicell_datasets`,
    `last error: ${metaError.value || '(none)'}`,
    `auto-retry attempts: ${metaAttempts.value}/${MAX_AUTO_RETRIES}`,
    '',
  ]
  try {
    const err = await window.electronAPI.getStartupError?.()
    if (err) lines.push(`splash error: ${err}`, '')
    const events = (await window.electronAPI.getStartupEvents?.()) || []
    lines.push('backend startup steps:')
    for (const e of events) {
      lines.push(`  ${e.step}: ${e.status}${e.message ? ` — ${e.message}` : ''}` +
                 (e.elapsed ? ` (${e.elapsed}s)` : ''))
    }
    if (!events.length) lines.push('  (none captured)')
    // The steps say how far it got; the log tail says why it stopped. Without this a
    // backend that exits AFTER reporting ready gives no reason at all.
    const tail = (await window.electronAPI.getBackendLogTail?.(60)) || []
    lines.push('', `backend log (last ${tail.length} lines):`)
    for (const l of tail) lines.push(`  ${l}`)
    if (!tail.length) lines.push('  (empty)')
  } catch (e) {
    lines.push(`could not read startup events: ${e}`)
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    diagCopied.value = true
    setTimeout(() => { diagCopied.value = false }, 4000)
  } catch {
    /* clipboard may be blocked; the text is still assembled for a future channel */
  }
}

onMounted(() => loadDatasets())
onUnmounted(() => {
  unmounted = true
  clearTimeout(metaTimer)
})

const loadMulticellExample = async (cell, resolution) => {
  if (loadingExample.value) return
  const key = `${cell}:${resolution}`
  loadingExample.value = key
  demoNote.value = ''
  try {
    const res = await fetch(`${API_BASE}/tadvci/use_multicell_example`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cell_line: cell, resolution }),
    })
    const d = await res.json()
    if (!res.ok) {
      alert(d.error || 'Failed to load package.')
      return
    }
    // Which chromosomes the viewer may offer. This used to be hard-coded — GM12878
    // 25 kb was pinned to chr7 because that was the only matrix that shipped — so a
    // user who had placed the full-genome file still saw a one-entry chromosome
    // list. Take it from what the backend actually resolved: the matrix's own
    // chromosomes when there is one, otherwise the chromosomes the evidence table
    // covers (both spellings, because the tracks and the matrix disagree on `chr`).
    // UNION, not "map if we have one". Preferring the matrix pinned the whole browser to
    // chr7 on any install without the optional full-genome download, hiding the 22 other
    // chromosomes this package ships evidence for. The matrix extent decides whether a
    // HEATMAP can be drawn (VisualizationPage marks those "evidence only"), never whether
    // a chromosome can be visited.
    const scope = d.scope || {}
    const fromMap = scope.map?.available ? (scope.map.chroms || []) : []
    const seen = new Set()
    const base = [...(scope.evidence_chroms || []), ...fromMap].filter((c) => {
      const bare = String(c).replace(/^chr/i, '')
      if (seen.has(bare)) return false
      seen.add(bare); return true
    })
    const chroms = base.flatMap((c) => {
      const bare = String(c).replace(/^chr/i, '')
      return [bare, `chr${bare}`]
    })
    if (!chroms.length) {
      for (let i = 1; i <= 22; i++) chroms.push(String(i), `chr${i}`)
      chroms.push('X', 'chrX')
    }
    const beds = (d.bed_tokens || []).map(b => ({ token: b.token, fileName: b.fileName }))
    if (!beds.length) {
      alert(`No caller BED tracks registered. Check example_data/multicell/${d.demo}/.`)
      return
    }
    store.file_view_obj = {
      hic_token: d.hic_token,
      annotation_token: d.annotation_token || null,
      mcoolPath: d.mcoolPath,
      selected_chroms: chroms,
      bed_tokens: beds,
      bigwig_tokens: (d.bigwig_tokens || []).map(b => ({
        token: b.token,
        fileName: b.fileName,
        color: b.fileName === 'CTCF' ? '#2563EB' : '#7C3AED',
      })),
      resolution: d.resolution || resolution,
      assembly: d.assembly || null,
      cell_line: d.cell_line || cell,
      cell_demo: d.cell_line || cell,
      source: `multicell_example:${d.demo}`,
      // Which layer each thing came from: evidence is genome-wide, browser tracks
      // may be chr7-only subsets or absent. The viewer states this per chromosome.
      scope: d.scope || null,
    }
    try { localStorage.setItem('creditad_fvo', JSON.stringify(store.file_view_obj)) } catch {}
    demoNote.value = d.note || ''
    setPage('visualization')
  } catch {
    alert('Failed to load package. Is the backend running?')
  } finally {
    loadingExample.value = ''
  }
}
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--s6) var(--s2) 0;
}

.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: var(--s8);
  align-items: start;
}
@media (max-width: 1020px) {
  .home-grid { grid-template-columns: 1fr; gap: var(--s6); }
}

/* ── Thesis ───────────────────────────────────────────────────────────── */
.thesis-title {
  margin: var(--s3) 0 var(--s4);
  font-family: var(--font-display);
  font-size: var(--fs-3xl);
  font-weight: 600;
  line-height: 1.06;
  letter-spacing: -0.005em;
  color: var(--text-primary);
}
.thesis-lead {
  margin: 0 0 var(--s6);
  font-size: var(--fs-md);
  line-height: 1.55;
  color: var(--text-secondary);
}

/* ── The record ───────────────────────────────────────────────────────── */
.fields {
  margin: var(--s6) 0 0;
  border-top: 1px solid var(--rule-strong);
  max-width: 460px;
}
.field-col {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--s3);
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
}
.field-col dt {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--primary-text);
}
.field-col dd {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.35;
  color: var(--text-primary);
}
.field-col span {
  grid-column: 2;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  color: var(--text-muted);
}
/* The tier is the output of the four fields, not a fifth field. */
.field-out {
  border-bottom: none;
  border-top: 1px solid var(--rule-strong);
  margin-top: -1px;
  padding-top: 12px;
}
.field-out dt { color: var(--text-primary); }

/* ── Entries ──────────────────────────────────────────────────────────── */
.entries { display: flex; flex-direction: column; gap: var(--s4); }

.entry { padding: var(--s5); }
.entry .section-head { margin-bottom: var(--s3); }

.entry-copy {
  margin: 0 0 var(--s5);
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}
.entry-cta { width: 100%; }

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s2);
  margin-bottom: var(--s4);
}
.picker-group {
  display: inline-flex;
  border: 1px solid var(--border-hover);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.seg {
  padding: 6px 13px;
  border: none;
  border-right: 1px solid var(--border-hover);
  background: var(--bg-card);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.seg:last-child { border-right: none; }
.seg:hover:not(:disabled):not(.on) { background: var(--bg-secondary); color: var(--text-primary); }
.seg.on { background: var(--primary); color: var(--on-ink); }
.seg:disabled { opacity: 0.45; cursor: not-allowed; }

.scope-line { margin-bottom: var(--s4); }
.scope-line b {
  font-family: var(--font-mono);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

/* Everything that ships, visible at once — the picker alone did not make the
   six packages discoverable. */
.inventory {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--s4);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xs);
}
.inventory thead th {
  padding: 0 var(--s2) 5px;
  text-align: right;
  font-weight: 500;
  font-size: var(--fs-micro);
  letter-spacing: 0.05em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--rule-strong);
}
.inventory thead th:first-child { text-align: left; }
.inventory tbody th {
  padding: 5px var(--s2);
  text-align: left;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--rule);
}
.inventory tbody td {
  padding: 5px var(--s2);
  text-align: right;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--rule);
}
.inventory tbody tr:last-child th,
.inventory tbody tr:last-child td { border-bottom: none; }
.inventory td.on {
  background: var(--brand-tint);
  color: var(--primary-text);
  box-shadow: inset 0 0 0 1px var(--brand-tint-2);
  border-radius: var(--r-xs);
}
.inv-note {
  font-style: normal;
  margin-left: 5px;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--warning-text);
}
.vh {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.summary {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 var(--s5);
  padding-top: var(--s3);
  border-top: 1px solid var(--rule);
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.summary-n {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-lg);
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.summary-unit { font-size: var(--fs-xs); color: var(--text-muted); }

/* Two layers, stated side by side rather than buried in a note. */
.layers { margin: 0 0 var(--s5); }
.layer {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: var(--s3);
  padding: 9px 0;
  border-top: 1px solid var(--rule);
}
.layer dt {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding-top: 2px;
}
.layer dd {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-secondary);
}
.layer dd b { font-weight: 600; color: var(--text-primary); }
.inline-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--primary-text);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.summary-meta { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted); }
.summary-sep { color: var(--text-muted); }

.status {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}

.meta-error {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s4);
  margin-bottom: var(--s4);
  padding: var(--s3);
  border: 1px solid var(--rule-strong);
  border-left: 2px solid var(--amber);
  border-radius: var(--r-sm);
  background: var(--bg-secondary);
}
.meta-error p {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-secondary);
}
.meta-error .btn { flex: none; }

.loading-note {
  margin: var(--s3) 0 0;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--text-muted);
}

/* ── Foot ─────────────────────────────────────────────────────────────── */
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s4);
  flex-wrap: wrap;
  margin-top: var(--s5);
  padding: var(--s4) 0 var(--s6);
  border-top: 1px solid var(--rule);
}
.pipeline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 9px;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pipeline i { font-style: normal; color: var(--text-muted); }
.foot .btn i { font-size: 11px; }
</style>
