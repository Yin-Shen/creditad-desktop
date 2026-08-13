<template>
  <div class="import-page">
    <div class="import-shell">
      <!-- Page head sits on paper, not on a coloured slab: the only thing that
           earns a hue in this application is data. -->
      <header class="page-head">
        <div class="page-head-text">
          <h2 class="import-title">Annotate boundaries with graded evidence</h2>
          <p class="import-subtitle measure">Downstream evidence grading — boundaries you already called</p>
        </div>
        <div class="import-steps" role="group" aria-label="Progress">
          <span
            class="step"
            :class="{ done: step > 1, active: step === 1 }"
            :aria-current="step === 1 ? 'step' : undefined"
          >Select</span>
          <span class="step-line" :class="{ done: step > 1 }" aria-hidden="true"></span>
          <span
            class="step"
            :class="{ done: step > 2, active: step === 2 }"
            :aria-current="step === 2 ? 'step' : undefined"
          >Process</span>
          <span class="step-line" :class="{ done: step > 2 }" aria-hidden="true"></span>
          <span
            class="step"
            :class="{ active: step === 3 }"
            :aria-current="step === 3 ? 'step' : undefined"
          >Done</span>
        </div>
      </header>

      <div class="import-card">
        <div class="import-body">
          <!-- L0 required: primary BED -->
          <section class="section">
            <div class="section-head">
              <span class="section-title">Boundaries to grade</span>
              <span class="eyebrow head-tag">Required</span>
            </div>

            <div class="field-grid">
              <div class="field span-2">
                <label class="field-label" for="imp-primary-bed">Primary BED path</label>
                <p class="field-hint measure">Positions to annotate — your caller output, or the union of several.</p>
                <input
                  id="imp-primary-bed"
                  class="field-input path-input"
                  v-model="primaryBed"
                  placeholder="/data/union_boundaries.bed"
                >
              </div>

              <div class="field">
                <label class="field-label" for="imp-method-panel">Multi-method panel</label>
                <p class="field-hint">Optional → BD1 votes; one BED path per line or comma-separated.</p>
                <textarea
                  id="imp-method-panel"
                  class="field-input path-input ta"
                  v-model="methodBedsText"
                  rows="3"
                  placeholder="/data/TopDom.bed&#10;/data/SpectralTAD.bed&#10;/data/OnTAD.bed"
                ></textarea>
              </div>

              <div class="field aside">
                <p class="hint-block measure">
                  BD1 = how many panel methods call near each primary position.
                  Panel size n = number of method files (demo packages use 6).
                  Empty panel → single-caller (votes=1, n=1).
                </p>
              </div>
            </div>
          </section>

          <div class="section-pair">
            <!-- L1 optional: Hi-C -->
            <section class="section">
              <div class="section-head">
                <span class="section-title">Hi-C contact map</span>
                <span class="eyebrow head-tag">Optional</span>
                <button type="button" class="btn btn-outline btn-sm head-action" @click="showHic = !showHic">
                  {{ showHic ? 'Hide' : 'Add' }}
                </button>
              </div>
              <div v-if="showHic">
                <div class="field">
                  <label class="field-label" for="imp-mcool">mcool / .hic path</label>
                  <p class="field-hint measure">Heatmap only; does not re-call TADs unless the advanced option is on.</p>
                  <input
                    id="imp-mcool"
                    class="field-input path-input"
                    :class="{ 'field-error': !!mcoolError }"
                    v-model="mcoolPath"
                    placeholder="/data/sample.mcool"
                  >
                  <div v-if="mcoolLoading" class="field-status">Loading chromosomes…</div>
                  <div v-else-if="mcoolError" class="field-error-msg" role="alert">{{ mcoolError }}</div>
                </div>

                <div v-if="mcoolPath && availableChroms.length" class="chrom-section">
                  <div class="field-grid">
                    <div class="field">
                      <label class="field-label" for="imp-hic-resolution">Resolution (bp)</label>
                      <input id="imp-hic-resolution" class="field-input tabular" type="number" v-model="tadConfig.resolution" placeholder="25000">
                    </div>
                    <div class="field">
                      <label class="field-label" for="imp-hash-tag">Hash tag</label>
                      <input id="imp-hash-tag" class="field-input path-input" v-model="tadConfig.hash_tag" placeholder="sample1">
                    </div>
                  </div>
                  <div class="chrom-header">
                    <label class="field-label">Target chromosomes</label>
                    <div class="chrom-actions">
                      <button type="button" class="btn btn-ghost btn-sm" @click="selectedChroms = [...availableChroms]">All</button>
                      <button type="button" class="btn btn-ghost btn-sm" @click="selectedChroms = []">Clear</button>
                    </div>
                  </div>
                  <div class="chrom-selector-grid scrollbar">
                    <label
                      v-for="chrom in availableChroms"
                      :key="chrom"
                      class="chrom-checkbox"
                      :class="{ active: selectedChroms.includes(chrom) }"
                    >
                      <input type="checkbox" :value="chrom" v-model="selectedChroms">
                      <span>{{ chrom }}</span>
                    </label>
                  </div>
                  <div class="chrom-count">Selected: {{ selectedChroms.length }} / {{ availableChroms.length }}</div>

                  <div class="adv-box">
                    <label class="switch-row">
                      <input type="checkbox" v-model="runBuiltinCallers">
                      <span>Advanced: also run CrediTAD's own 5 built-in pure-Python callers on this mcool <b>(a different panel from the 6-caller demo packages)</b></span>
                    </label>
                    <div class="hint-block measure">
                      Dev / optional. Product path is annotate-from-BED (above).
                      Built-in callers are not the default CrediTAD pipeline.
                    </div>
                    <div v-if="runBuiltinCallers && methodBedList.length === 0" class="field adv-field">
                      <label class="field-label" for="imp-upload-mode">How to use primary BED with built-in panel</label>
                      <select id="imp-upload-mode" class="field-input" v-model="uploadMode">
                        <option value="evaluate">Evaluate primary (score; do not vote)</option>
                        <option value="contribute">Contribute primary as extra voter</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- L2 optional: ChIP / loops -->
            <section class="section">
              <div class="section-head">
                <span class="section-title">Supporting assays</span>
                <span class="eyebrow head-tag">BD2–BD4 · optional</span>
                <button type="button" class="btn btn-outline btn-sm head-action" @click="showChip = !showChip">
                  {{ showChip ? 'Hide' : 'Add' }}
                </button>
              </div>
              <div v-if="showChip">
                <div class="hint-block measure assays-note">
                  Only paths you enter are used. Demo ChIP / loops are never auto-attached to your import.
                </div>
                <div class="field">
                  <label class="field-label" for="imp-ctcf">CTCF BigWig <span class="field-tag">→ BD2</span></label>
                  <input id="imp-ctcf" class="field-input path-input" v-model="ctcfBw" placeholder="/data/CTCF.bigWig">
                </div>
                <div class="field stacked">
                  <label class="field-label" for="imp-rad21">RAD21 BigWig <span class="field-tag">→ BD3</span></label>
                  <input id="imp-rad21" class="field-input path-input" v-model="rad21Bw" placeholder="/data/RAD21.bigWig">
                </div>
                <div class="field stacked">
                  <label class="field-label" for="imp-loops">HiCCUPS loops <span class="field-tag">→ BD4</span></label>
                  <p class="field-hint">.bedpe or HiCCUPS .txt</p>
                  <input id="imp-loops" class="field-input path-input" v-model="loopsPath" placeholder="/data/GM12878_HiCCUPS_loops_hg38.bedpe">
                </div>
              </div>
              <div v-else class="hint-block measure">
                Collapsed. Without these, BD2–BD4 stay <b>not_assessable</b> on the card.
              </div>
            </section>
          </div>

          <section class="section">
            <div class="section-head">
              <span class="section-title">Sample provenance</span>
            </div>
            <div class="field-grid cols-3">
              <div class="field">
                <label class="field-label" for="imp-cell-line">Cell line</label>
                <p class="field-hint">Selects the BD2/BD3 background bands.</p>
                <select id="imp-cell-line" class="field-input" v-model="selectedCellLine">
                  <option value="GM12878">GM12878 (Lymphoblastoid)</option>
                  <option value="IMR90">IMR90 (Fibroblast)</option>
                  <option value="HepG2">HepG2 (Hepatocellular carcinoma)</option>
                  <option value="Other">Other / uncalibrated (BD2/BD3 cutpoints estimated from your tracks)</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="imp-assembly">Genome assembly</label>
                <!-- GRCh38 only: the shipped packages, the BD2/BD3 background bands
                     and the loop calls are all GRCh38, so accepting GRCh37 input here
                     would stamp provenance the rest of the tool cannot honour. Kept as
                     a control rather than as static text because it is recorded
                     provenance, and it is never inferred from the cell line. -->
                <p class="field-hint">GRCh38 only; calibration bands are GRCh38.</p>
                <select id="imp-assembly" class="field-input" v-model="selectedAssembly">
                  <option value="hg38">hg38 / GRCh38</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="imp-resolution">Resolution (bp)</label>
                <p class="field-hint">Bin size for tier BED ends + ChIP windows.</p>
                <input id="imp-resolution" class="field-input tabular" type="number" v-model="tadConfig.resolution" placeholder="25000">
              </div>
            </div>
            <div class="hint-block measure provenance-note">
              Demos and BD2/BD3 calibration are GRCh38. Stored as provenance on the card / export.
            </div>
          </section>

          <div class="preview-box" v-if="primaryBed.trim()">
            <div class="preview-title eyebrow">Will assess</div>
            <div class="preview-line"><span class="preview-key">BD1</span><span class="preview-sep"> · </span>n_methods = {{ previewNMethods }} {{ previewNMethods === 1 ? '(single-caller)' : '(multi-method panel)' }}</div>
            <div class="preview-line"><span class="preview-key">BD2 CTCF</span><span class="preview-sep"> · </span>{{ ctcfBw.trim() ? 'assessable' : 'not_assessable' }}</div>
            <div class="preview-line"><span class="preview-key">BD3 RAD21</span><span class="preview-sep"> · </span>{{ rad21Bw.trim() ? 'assessable' : 'not_assessable' }}</div>
            <div class="preview-line"><span class="preview-key">BD4 loops</span><span class="preview-sep"> · </span>{{ loopsPath.trim() ? 'assessable' : 'not_assessable' }}</div>
            <div class="preview-line preview-note" v-if="runBuiltinCallers && mcoolPath">+ CrediTAD's 5 built-in callers on mcool (advanced; not the demo's 6-caller panel)</div>
          </div>
        </div>

        <div class="import-footer">
          <span v-if="submitError" class="submit-error-msg" role="alert">{{ submitError }}</span>
          <button type="button" class="btn btn-ghost" @click="setPage('home')">Cancel</button>
          <button type="button" class="btn btn-primary" :disabled="!isReadyToSubmit || isProcessing" @click="submitFiles">
            Start annotation
          </button>
        </div>
      </div>
    </div>

    <div v-if="showLogModal" class="modal-bg modal-overlay" @click.self="closeLogModal">
      <div
        class="log-card"
        ref="logCardRef"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-label="Task execution logs"
        @keydown.esc.stop="closeLogModal"
        @keydown.tab="trapLogTab"
      >
        <div class="log-header">
          <div class="log-title">
            <i class="fas fa-terminal" aria-hidden="true"></i>
            <span>Task execution logs</span>
          </div>
          <div class="log-head-right">
            <div v-if="isProcessing" class="loader-spinner" role="status" aria-label="Running"></div>
            <div v-else-if="tadStatus === 'failed'" class="status-badge error">Failed</div>
            <div v-else class="status-badge success">Completed</div>
            <!-- The scrim eats every click behind it, so a run that ends in
                 'failed' used to be inescapable without reloading the app — which
                 also discarded every path the user had typed in. -->
            <button
              type="button"
              class="btn btn-ghost btn-sm log-close"
              data-testid="log-close"
              aria-label="Dismiss logs"
              :disabled="isProcessing"
              @click="closeLogModal"
            >
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div class="log-content scrollbar" ref="logContainer">
          <div v-for="(log, index) in logList" :key="index" class="log-line">
            <span class="log-timestamp">[{{ log.timestamp }}]</span> {{ log.message }}
          </div>
          <div v-if="logList.length === 0" class="log-placeholder">Initializing backend runtime...</div>
        </div>

        <div class="log-footer">
          <div class="log-info">
            {{ isProcessing ? currentProcessStep : (tadStatus === 'failed' ? 'Error occurred during processing.' : 'Task finished successfully!') }}
          </div>
          <button type="button" class="btn btn-primary" :disabled="isProcessing || tadStatus === 'failed'" @click="finalizeAndRedirect">
            Go to Visualization <i class="fas fa-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>


<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useAppState } from '../composables/useAppState'
import { useDialogFocus } from '../composables/useDialogFocus'
import { useCounterStore } from "../store/stores"

const file_view_obj_stores = useCounterStore()
const { setPage } = useAppState()
const API_BASE = (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api')
const isElectron = !!window.electronAPI

const step = ref(1)
const primaryBed = ref('')
const methodBedsText = ref('')
const showHic = ref(false)
const showChip = ref(false)
const mcoolPath = ref('')
const runBuiltinCallers = ref(false)
const uploadMode = ref('evaluate')
const ctcfBw = ref('')
const rad21Bw = ref('')
const loopsPath = ref('')
const selectedCellLine = ref('GM12878')
// Fixed: multicell demos + ENCODE fc tracks shipped with the app are GRCh38.
const selectedAssembly = ref('hg38')
const tadConfig = ref({
  resolution: 25000,
  hash_tag: 'sample1',
  fast_mode: true,
  output_dir: './tad_results',
})
const availableChroms = ref([])
const selectedChroms = ref([])
const mcoolError = ref('')
const mcoolLoading = ref(false)
const submitError = ref('')
const isProcessing = ref(false)
const showLogModal = ref(false)
const logList = ref([])
const logContainer = ref(null)
const tadStatus = ref('')
const currentProcessStep = ref('Waiting...')
const pendingTadBedTokens = ref([])
const logCardRef = ref(null)

const methodBedList = computed(() => {
  const raw = methodBedsText.value || ''
  return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
})

const previewNMethods = computed(() => {
  if (runBuiltinCallers.value && mcoolPath.value.trim()) {
    return uploadMode.value === 'contribute' && primaryBed.value.trim() ? 6 : 5
  }
  return Math.max(1, methodBedList.value.length)
})

/* The path box is a text field, so every keystroke used to fire a full
   register + chroms round trip (48 registrations for a 48-character path, each
   one holding a backend token). Worse, nothing tied a response to the input that
   asked for it: a slow failure for a path the user had already corrected came
   back later and latched its error onto the corrected path, disabling submit
   with a message naming a path no longer in the box. Debounce + a monotonic
   request id fix both; `mcoolReq` is the only writer gate for every field this
   watcher owns. */
const MCOOL_DEBOUNCE_MS = 350
let mcoolReq = 0
let mcoolDebounce = null

watch(mcoolPath, async (newPath) => {
  mcoolError.value = ''
  submitError.value = ''
  const req = ++mcoolReq
  if (!newPath || !newPath.trim()) {
    availableChroms.value = []
    selectedChroms.value = []
    mcoolLoading.value = false
    return
  }
  mcoolLoading.value = true
  await new Promise((resolve) => { mcoolDebounce = setTimeout(resolve, MCOOL_DEBOUNCE_MS) })
  if (req !== mcoolReq) return
  try {
    let res
    try {
      res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath, type: 'hic' })
      })
    } catch (netErr) {
      throw new Error(`Cannot reach backend: ${netErr.message || netErr}`)
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const errBody = await res.json()
        if (errBody && errBody.error) detail = errBody.error
      } catch (_) { /* non-JSON */ }
      throw new Error(`Failed to register mcool: ${detail}`)
    }
    const d = await res.json()
    if (!d || !d.token) throw new Error('Register response missing token')

    const chromRes = await fetch(`${API_BASE}/mcool/chroms/${d.token}`)
    if (!chromRes.ok) {
      let detail = `HTTP ${chromRes.status}`
      try {
        const errBody = await chromRes.json()
        if (errBody && errBody.error) detail = errBody.error
      } catch (_) { /* non-JSON */ }
      throw new Error(`Failed to load chromosomes: ${detail}`)
    }
    const chromData = await chromRes.json()
    const chroms = Array.isArray(chromData?.chromosomes) ? chromData.chromosomes : []
    if (req !== mcoolReq) return
    availableChroms.value = chroms
    selectedChroms.value = chroms.filter(c => typeof c === 'string' && !c.includes('_'))
    if (!chroms.length) {
      mcoolError.value = 'Backend returned no chromosomes — file may be empty or unreadable.'
    }
  } catch (e) {
    if (req !== mcoolReq) return
    availableChroms.value = []
    selectedChroms.value = []
    mcoolError.value = (e && e.message)
      ? e.message
      : 'Failed to load this mcool/.hic file.'
  } finally {
    // A superseded attempt must not clear the spinner the current one owns.
    if (req === mcoolReq) mcoolLoading.value = false
  }
})

const MAX_LOG_LINES = 500
const addLog = (message) => {
  const cleanMsg = String(message || '').trim()
  if (!cleanMsg) return
  logList.value.push({ timestamp: new Date().toLocaleTimeString(), message: cleanMsg })
  if (logList.value.length > MAX_LOG_LINES) logList.value.shift()
  scrollToBottom()
}
const scrollToBottom = async () => {
  await nextTick()
  if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight
}

/* Unsubscribe with the closures `on()` hands back, not with
   `removeListener(channel)`: the preload implements that as
   `removeAllListeners(channel)`, so leaving this page also tore down the
   'server-log' subscription App.vue keeps for the startup diagnostics. */
let offServerLog = null
let offTadFinished = null

onMounted(() => {
  if (isElectron) {
    offServerLog = window.electronAPI.on('server-log', (data) => { addLog(data) }) || null
    offTadFinished = window.electronAPI.on('tad-finished', async (result) => {
      if (result.success) {
        addLog('Backend reported: TAD Detection Task Complete!')
        await checkTadStatusElectron(result.token)
        mergeAndFinalize()
      } else {
        isProcessing.value = false
        tadStatus.value = 'failed'
        addLog(`Task aborted: ${result.error}`)
      }
    }) || null
  }
})

onUnmounted(() => {
  offServerLog?.()
  offServerLog = null
  offTadFinished?.()
  offTadFinished = null
  if (mcoolDebounce) { clearTimeout(mcoolDebounce); mcoolDebounce = null }
  // Stop the web status poll: it is a self-rescheduling recursion with no other
  // owner, so an unmounted page kept calling the backend forever.
  pollCancelled = true
})

const isReadyToSubmit = computed(() => {
  if (!primaryBed.value.trim()) return false
  if (mcoolError.value || mcoolLoading.value) return false
  if (runBuiltinCallers.value) {
    if (!mcoolPath.value.trim()) return false
    return availableChroms.value.length > 0 && selectedChroms.value.length > 0
  }
  return true
})

const mergeAndFinalize = () => {
  const currentUserBed = file_view_obj_stores.file_view_obj.bed_tokens || []
  const newTadBeds = pendingTadBedTokens.value || []
  const allBedsMap = new Map()
  currentUserBed.forEach(item => allBedsMap.set(item.token, item))
  newTadBeds.forEach(item => allBedsMap.set(item.token, item))
  file_view_obj_stores.file_view_obj = {
    ...file_view_obj_stores.file_view_obj,
    bed_tokens: Array.from(allBedsMap.values())
  }
  isProcessing.value = false
  step.value = 3
  currentProcessStep.value = 'All tasks completed!'
}

const TADVCI_TRACK_LABELS = ['insulation', 'topdom_like', 'contact_contrast', 'spectral_profile', 'network_modularity']

const registerTadOutputs = async (data) => {
  const tadOutputs = data.output_paths || {}
  const tadBedTokens = []
  for (const [label, filePath] of Object.entries(tadOutputs)) {
    if (!filePath) continue
    if (!TADVCI_TRACK_LABELS.includes(label) &&
        ['TAD_final', 'Disputed', 'Consensus', 'TADVCI_annotation', 'TADVCI_tier'].includes(label)) {
      continue
    }
    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, type: 'bed' })
      })
      const d = await res.json()
      if (res.ok) tadBedTokens.push({ token: d.token, path: filePath, fileName: label })
    } catch (e) {
      addLog(`Register ${label} failed: ${e.message}`)
    }
  }
  pendingTadBedTokens.value = tadBedTokens
}

const checkTadStatusElectron = async (token) => {
  try {
    const result = await window.electronAPI.getTadStatus(token)
    if (!result.success) throw new Error(result.message)
    const data = result.data
    if (data.status === 'running') {
      await new Promise(r => setTimeout(r, 2000))
      return checkTadStatusElectron(token)
    } else if (data.status === 'done') {
      tadStatus.value = 'completed'
      addLog('TAD detection completed.')
      await registerTadOutputs(data)
    } else if (data.status === 'failed') {
      tadStatus.value = 'failed'
      addLog(`TAD detection failed: ${data.error_msg}`)
    }
  } catch (error) {
    tadStatus.value = 'failed'
    addLog(`Error: ${error.message}`)
  }
}

/* An unbounded poll makes "stuck" and "failed" look identical in the UI: both
   leave a modal whose only button is disabled. Give it a wall clock and a
   cancel flag so a backend that never reports terminal status still resolves
   into a state the user can act on. */
const POLL_MAX_MS = 30 * 60 * 1000
let pollCancelled = false
let pollDeadline = 0

const pollTadStatusWeb = async (token) => {
  if (pollCancelled) return
  try {
    const res = await fetch(`${API_BASE}/tad/status/${token}`)
    const data = await res.json()
    if (data.status === 'running' || data.status === 'pending') {
      if (Date.now() > pollDeadline) {
        tadStatus.value = 'failed'
        isProcessing.value = false
        addLog(`Gave up waiting after ${Math.round(POLL_MAX_MS / 60000)} min — the task may still be `
          + 'running in the backend. Check the backend log, then re-run.')
        return
      }
      addLog('TAD detection in progress...')
      await new Promise(r => setTimeout(r, 5000))
      if (pollCancelled) return
      return pollTadStatusWeb(token)
    } else if (data.status === 'done') {
      tadStatus.value = 'completed'
      addLog('TAD detection completed.')
      await registerTadOutputs(data)
      mergeAndFinalize()
    } else if (data.status === 'failed') {
      tadStatus.value = 'failed'
      isProcessing.value = false
      addLog(`TAD detection failed: ${data.error_msg}`)
    }
  } catch (error) {
    tadStatus.value = 'failed'
    isProcessing.value = false
    addLog(`Polling error: ${error.message}`)
  }
}

const stemName = (p) => {
  const base = String(p).split('/').pop() || p
  return base.replace(/_boundaries\.bed$/i, '').replace(/\.bed$/i, '')
}

const submitAnnotatePath = async (hicToken) => {
  currentProcessStep.value = 'Annotating from BED(s)…'
  addLog('POST /api/tadvci/annotate (no silent demo ChIP)')
  const method_beds = methodBedList.value.map(p => ({ path: p, name: stemName(p) }))
  const payload = {
    primary_bed: primaryBed.value.trim(),
    primary_name: stemName(primaryBed.value.trim()),
    method_beds,
    ctcf_bw: ctcfBw.value.trim() || null,
    rad21_bw: rad21Bw.value.trim() || null,
    loops_path: loopsPath.value.trim() || null,
    cell_line: selectedCellLine.value,
    assembly: selectedAssembly.value,
    resolution: Number(tadConfig.value.resolution) || 25000,
    hash_tag: tadConfig.value.hash_tag || 'annotate',
    output_dir: tadConfig.value.output_dir || './tad_results',
    hic_token: hicToken || null,
  }
  const res = await fetch(`${API_BASE}/tadvci/annotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error || `annotate HTTP ${res.status}`)

  addLog(`Annotated ${d.n_boundaries} boundaries; BD1 n_methods=${d.n_methods}; panel=${(d.bd1_panel || []).join(',') || '(single)'}`)
  addLog(`Assessed: BD1${d.bd2_assessed ? '+BD2' : ''}${d.bd3_assessed ? '+BD3' : ''}${d.bd4_assessed ? '+BD4' : ''}`)
  if (d.tier_dist) addLog(`Tier dist: ${JSON.stringify(d.tier_dist)}`)

  const bwColors = { CTCF: '#2563EB', RAD21: '#7C3AED' }
  const sessionTok = d.session_token || d.annotation_token
  const bed_tokens = (d.bed_tokens || []).map(b => ({
    token: b.token, path: b.path, fileName: b.fileName,
  }))
  const bigwig_tokens = (d.bigwig_tokens || []).map(b => ({
    token: b.token,
    fileName: b.fileName,
    color: bwColors[b.fileName] || '#3B82F6',
  }))

  // Chrom list: from mcool selection if any, else load from primary BED
  let chroms = selectedChroms.value.length ? [...selectedChroms.value] : []
  if (!chroms.length && bed_tokens[0]?.token) {
    try {
      const gi = await fetch(`${API_BASE}/bed/global-info/${bed_tokens[0].token}`)
      if (gi.ok) {
        const g = await gi.json()
        const list = g.chromosomes || []
        chroms = list.map(c => (typeof c === 'string' ? c : c.name)).filter(Boolean)
      }
    } catch (_) { /* optional */ }
  }

  file_view_obj_stores.file_view_obj = {
    hic_token: hicToken || sessionTok,
    annotation_token: sessionTok,
    mcoolPath: mcoolPath.value.trim() || null,
    file_token: hicToken || sessionTok,
    bed_tokens,
    bigwig_tokens,
    selected_chroms: chroms,
    cell_line: selectedCellLine.value,
    assembly: selectedAssembly.value,
    source: `annotate:${primaryBed.value.trim()}`,
    resolution: Number(tadConfig.value.resolution) || 25000,
    bed_token: bed_tokens[0]?.token || null,
    n_methods: d.n_methods,
    bd1_panel: d.bd1_panel || [],
  }
  try { localStorage.setItem('creditad_fvo', JSON.stringify(file_view_obj_stores.file_view_obj)) } catch {}

  tadStatus.value = 'completed'
  isProcessing.value = false
  step.value = 3
  currentProcessStep.value = 'Annotation complete.'
}

const submitBuiltinPath = async () => {
  currentProcessStep.value = 'Registering mcool & starting built-in callers…'
  const res = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: mcoolPath.value, type: 'hic' })
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error)

  const cleanConfig = JSON.parse(JSON.stringify(tadConfig.value))
  const payload = {
    token: d.token,
    path: String(mcoolPath.value),
    selected_chroms: [...selectedChroms.value],
    method_set: 'tadvci',
    ctcf_bw: ctcfBw.value.trim() || null,
    rad21_bw: rad21Bw.value.trim() || null,
    loops_path: loopsPath.value.trim() || null,
    cell_line: selectedCellLine.value,
    assembly: selectedAssembly.value,
    user_bed_paths: primaryBed.value.trim() ? [primaryBed.value.trim(), ...methodBedList.value] : [...methodBedList.value],
    upload_mode: uploadMode.value,
    ...cleanConfig,
  }

  const bwColors = ['#2563EB', '#7C3AED']
  const bigwig_tokens = []
  for (const [i, p] of [ctcfBw.value.trim(), rad21Bw.value.trim()].entries()) {
    if (!p) continue
    try {
      const br = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p, type: 'bigwig' })
      })
      const bd = await br.json()
      if (br.ok) {
        bigwig_tokens.push({
          token: bd.token,
          fileName: i === 0 ? 'CTCF' : 'RAD21',
          color: bwColors[i],
        })
      }
    } catch (e) { addLog(`BigWig failed: ${p} — ${e.message}`) }
  }

  const bed_tokens = []
  for (const p of [primaryBed.value.trim(), ...methodBedList.value].filter(Boolean)) {
    try {
      const br = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p, type: 'bed' })
      })
      const bd = await br.json()
      if (br.ok) bed_tokens.push({ token: bd.token, path: p, fileName: stemName(p) })
    } catch (e) { addLog(`BED register failed: ${p}`) }
  }

  // Committing the session before the task is known to have started left a
  // half-built session pointing at a run that never happened whenever the launch
  // below threw. Persisting it matches submitAnnotatePath, whose session used to
  // be the only one that survived a reload.
  const commitSession = () => {
    file_view_obj_stores.file_view_obj = {
      hic_token: d.token,
      annotation_token: d.token,
      mcoolPath: mcoolPath.value,
      file_token: d.token,
      bed_tokens,
      bigwig_tokens,
      selected_chroms: [...selectedChroms.value],
      cell_line: selectedCellLine.value,
      assembly: selectedAssembly.value,
      source: mcoolPath.value,
      resolution: Number(cleanConfig.resolution) || null,
      bed_token: bed_tokens[0]?.token || null,
    }
    try { localStorage.setItem('creditad_fvo', JSON.stringify(file_view_obj_stores.file_view_obj)) } catch {}
  }

  if (isElectron) {
    const tadStartRes = await window.electronAPI.runTadDetection(payload)
    if (!tadStartRes.success) throw new Error(tadStartRes.message)
    commitSession()
    addLog(`TAD task started for chromosomes: ${selectedChroms.value.join(', ')}`)
    currentProcessStep.value = 'Processing TAD (Long task)...'
  } else {
    addLog(`TAD task starting via HTTP for chromosomes: ${selectedChroms.value.join(', ')}`)
    currentProcessStep.value = 'Processing TAD (Long task)...'
    const tadRes = await fetch(`${API_BASE}/tad/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const tadData = await tadRes.json()
    if (tadData.status === 'failed') throw new Error(tadData.error)
    commitSession()
    if (tadData.status === 'done') {
      tadStatus.value = 'completed'
      addLog('TAD detection completed.')
      await registerTadOutputs(tadData)
      mergeAndFinalize()
    } else {
      pollDeadline = Date.now() + POLL_MAX_MS
      pollTadStatusWeb(d.token)
    }
  }
}

const submitFiles = async () => {
  submitError.value = ''
  if (!primaryBed.value.trim()) {
    submitError.value = 'Primary BED path is required.'
    return
  }
  if (mcoolError.value) {
    submitError.value = mcoolError.value
    return
  }
  if (runBuiltinCallers.value && selectedChroms.value.length === 0) {
    submitError.value = 'Select at least one chromosome for built-in callers.'
    return
  }
  if (!isReadyToSubmit.value) {
    submitError.value = 'Provide a primary BED path to annotate.'
    return
  }

  step.value = 2
  logList.value = []
  showLogModal.value = true
  isProcessing.value = true
  tadStatus.value = 'running'
  pollCancelled = false

  try {
    addLog('=== Starting progressive annotation ===')
    addLog(`Primary: ${primaryBed.value.trim()}`)
    addLog(`Method panel (${methodBedList.value.length}): ${methodBedList.value.join(', ') || '(none — single-caller)'}`)
    addLog(`ChIP: CTCF=${ctcfBw.value.trim() || '—'} RAD21=${rad21Bw.value.trim() || '—'} loops=${loopsPath.value.trim() || '—'}`)

    if (runBuiltinCallers.value && mcoolPath.value.trim()) {
      addLog('Mode: advanced — CrediTAD 5 built-in callers on mcool (distinct from the 6-caller demo panel)')
      await submitBuiltinPath()
      return
    }

    // Default product path: annotate-from-BED
    let hicToken = null
    if (mcoolPath.value.trim()) {
      currentProcessStep.value = 'Registering mcool for heatmap…'
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: mcoolPath.value, type: 'hic' })
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'mcool register failed')
      hicToken = d.token
      addLog(`Hi-C registered for heatmap (token ${hicToken.slice(0, 8)}…)`)
    }
    await submitAnnotatePath(hicToken)
  } catch (err) {
    isProcessing.value = false
    tadStatus.value = 'failed'
    submitError.value = err.message
    addLog(`[ERROR]: ${err.message}`)
  }
}

const finalizeAndRedirect = () => {
  showLogModal.value = false
  setPage('visualization')
}

const closeLogModal = () => {
  // Only a run still in flight keeps the dialog captive; a finished or failed one
  // must be dismissible without losing the form.
  if (isProcessing.value) return
  showLogModal.value = false
}

const { onTabKeydown: trapLogTab } = useDialogFocus(showLogModal, logCardRef)
</script>

<style scoped>
/* ── Page shell ───────────────────────────────────────────────────────────── */
.import-page { padding-bottom: var(--s7); }
.import-shell { width: 100%; max-width: 1080px; margin: 0 auto; }

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s5);
  flex-wrap: wrap;
  padding-bottom: var(--s4);
  margin-bottom: var(--s5);
  border-bottom: 1px solid var(--rule-strong);
}
.import-title {
  font-family: var(--font-display);
  font-size: var(--fs-2xl);
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.004em;
  color: var(--text-primary);
}
.import-subtitle {
  margin: 7px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-secondary);
}

/* Progress reads as a scale on the axis: words in the data face, hairline
   between them, ink only on the step you are standing on. */
.import-steps { display: flex; align-items: center; gap: var(--s2); padding-bottom: 3px; }
.step {
  position: relative;
  padding-left: 8px;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: var(--track-caps);
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
}
.step.active { color: var(--text-primary); font-weight: 500; }
.step.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: 10px;
  margin-top: -5px;
  background: var(--ink);
}
.step-line { width: 26px; height: 1px; background: var(--rule-strong); }
.step-line.done { background: var(--ink); }

/* ── Card ─────────────────────────────────────────────────────────────────── */
.import-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.import-body {
  padding: var(--s5);
  display: flex;
  flex-direction: column;
  gap: var(--s6);
}

.section-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--s6);
  align-items: start;
}
@media (max-width: 1040px) {
  .section-pair { grid-template-columns: 1fr; }
}

.section-head .head-action { margin-left: auto; align-self: center; }
.head-tag { white-space: nowrap; }

/* ── Fields ───────────────────────────────────────────────────────────────── */
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s4) var(--s5);
  align-items: start;
}
.field-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.span-2 { grid-column: 1 / -1; }
@media (max-width: 860px) {
  .field-grid,
  .field-grid.cols-3 { grid-template-columns: 1fr; }
}

.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field.stacked { margin-top: var(--s3); }
.field-label {
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.3;
  color: var(--text-primary);
}
.field-tag {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.field-hint {
  margin: -1px 0 2px;
  font-size: var(--fs-xs);
  line-height: 1.45;
  color: var(--text-muted);
}
.field-input { width: 100%; }
.ta { resize: vertical; min-height: 76px; line-height: 1.5; }
select.field-input { cursor: pointer; }

.field-input.field-error { border-color: var(--danger); }
.field-error-msg { font-size: var(--fs-xs); line-height: 1.45; color: var(--danger-text); }
.field-status { font-size: var(--fs-xs); color: var(--text-muted); }

.hint-block { font-size: var(--fs-xs); line-height: 1.55; color: var(--text-muted); }
.assays-note { margin-bottom: var(--s3); }
.provenance-note { margin-top: var(--s3); }

/* The BD1 note sits beside the panel box rather than under it: same information,
   half the vertical run. */
.aside {
  align-self: stretch;
  padding-left: var(--s4);
  border-left: 1px solid var(--rule);
}
.aside .hint-block { margin: 0; }
@media (max-width: 860px) {
  .aside { padding-left: 0; border-left: none; }
}

/* ── Chromosome picker ────────────────────────────────────────────────────── */
.chrom-section {
  margin-top: var(--s4);
  padding-top: var(--s4);
  border-top: 1px solid var(--rule);
}
.chrom-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s3);
  margin: var(--s4) 0 var(--s2);
}
.chrom-actions { display: flex; gap: 4px; }
.chrom-selector-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
  max-height: 152px;
  overflow-y: auto;
  padding: var(--s3);
  border: 1px solid var(--rule);
  border-radius: var(--r-sm);
  background: var(--bg-secondary);
}
.chrom-checkbox {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  color: var(--text-muted);
}
.chrom-checkbox input { accent-color: var(--primary); margin: 0; }
.chrom-checkbox.active { color: var(--text-primary); }
.chrom-count {
  margin-top: 7px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-micro);
  color: var(--text-muted);
}

.adv-box {
  margin-top: var(--s4);
  padding: var(--s3) var(--s4);
  border: 1px dashed var(--rule-strong);
  border-radius: var(--r-sm);
}
.switch-row {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-secondary);
  cursor: pointer;
}
.switch-row input { margin-top: 4px; accent-color: var(--primary); }
.adv-box .hint-block { margin-top: 6px; }
.adv-field { margin-top: var(--s3); }

/* ── Record preview ───────────────────────────────────────────────────────── */
.preview-box {
  border: 1px solid var(--rule-strong);
  border-radius: var(--r-sm);
  padding: var(--s3) var(--s4) var(--s4);
}
.preview-title { display: block; margin-bottom: var(--s2); }
.preview-line {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1.75;
  color: var(--text-primary);
}
.preview-key { color: var(--text-muted); }
.preview-sep { color: var(--text-muted); }
.preview-note { color: var(--text-muted); }

/* ── Footer ───────────────────────────────────────────────────────────────── */
.import-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s3);
  padding: var(--s3) var(--s5);
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}
.submit-error-msg {
  flex: 1;
  font-size: var(--fs-xs);
  line-height: 1.45;
  color: var(--danger-text);
  text-align: right;
}

/* ── Log modal ────────────────────────────────────────────────────────────── */
/* Scrim comes from the shared .modal-bg; only the stacking order is local, so
   the run log stays above every other overlay while a task is in flight. */
.modal-overlay { z-index: 2000; }
.log-card {
  width: min(860px, 92vw);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s3);
  padding: var(--s3) var(--s5);
  border-bottom: 1px solid var(--rule);
}
.log-title {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-family: var(--font-display);
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-primary);
}
.log-title i { font-size: 12px; color: var(--text-muted); }
.log-head-right { display: flex; align-items: center; gap: var(--s3); }
.log-close { padding: 0 8px; }

.log-content {
  height: 340px;
  overflow-y: auto;
  padding: var(--s4) var(--s5);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
.log-line {
  line-height: 1.6;
  color: var(--text-secondary);
  word-break: break-word;
}
.log-timestamp {
  margin-right: 6px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.log-placeholder { color: var(--text-muted); }

.log-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s4);
  padding: var(--s3) var(--s5);
}
.log-info { max-width: 70%; font-size: var(--fs-xs); color: var(--text-muted); }
.log-footer .btn i { font-size: 10px; }

.loader-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--rule-strong);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.status-badge {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: 500;
  letter-spacing: var(--track-caps);
  text-transform: uppercase;
}
.status-badge.success { color: var(--success-text); }
.status-badge.error { color: var(--danger-text); }
</style>
