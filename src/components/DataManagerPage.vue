<template>
  <div class="data-manager fade-in">
    <header class="page-head">
      <h1 class="page-title">Data Manager — optional full-genome tracks</h1>
      <p class="page-lead measure">
        <b>Shipped demo tracks</b> are chr7-only (heatmap + CTCF/RAD21). Full-genome matrices
        are optional — use the Dataset setup guide (4DN / ENCODE), not the shipped filenames.
      </p>
    </header>

    <!-- Dataset setup guide (3 cell lines: mcool + BigWig + loops) -->
    <section class="block guide-block">
      <div class="section-head">
        <button
          type="button"
          class="head-toggle"
          :aria-expanded="guideOpen ? 'true' : 'false'"
          @click="guideOpen = !guideOpen"
        >
          <span class="section-title">Dataset setup guide</span>
          <i
            :class="guideOpen ? 'fas fa-chevron-up' : 'fas fa-chevron-down'"
            class="chev"
            aria-hidden="true"
          ></i>
        </button>
      </div>
      <p class="guide-sub measure">
        GM12878 · IMR90 · HepG2 — mcool (4DN) + CTCF/RAD21 BigWig (ENCODE) + loops
      </p>

      <!-- Where the app actually reads these from, and how many it can see. The
           guide used to be a static list, so a user who had downloaded everything
           saw the same screen as one who had downloaded nothing. -->
      <div v-if="catalog.shared_raw_root" class="raw-root">
        <div class="raw-root-line">
          <span class="eyebrow">Your files folder</span>
          <code class="raw-root-path" :title="catalog.shared_raw_root">{{ catalog.shared_raw_root }}</code>
        </div>
        <div class="raw-root-line">
          <span class="eyebrow">Detected</span>
          <span class="raw-root-count">
            <b>{{ catalog.optional_present }}</b> of {{ catalog.optional_total }} optional files
            <template v-if="catalog.optional_present === 0">
              — the browser uses the bundled chr7 subsets
            </template>
          </span>
        </div>
      </div>

      <div v-if="guideOpen" class="guide-body">
        <p v-if="catalog.purpose" class="guide-purpose measure">{{ catalog.purpose }}</p>
        <ul v-if="catalog.notes?.length" class="notes measure">
          <li v-for="(n, i) in catalog.notes" :key="i">{{ n }}</li>
        </ul>
        <p v-if="catalogError" class="msg-error measure">{{ catalogError }}</p>
        <p v-else-if="!catalog.cells?.length" class="msg-muted">
          <i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading catalog…
        </p>

        <div v-for="cell in catalog.cells || []" :key="cell.cell_line" class="cellgroup">
          <div class="cellgroup-head">
            <strong>{{ cell.cell_line }}</strong>
            <span class="guide-asm">{{ cell.assembly }}</span>
          </div>
          <div class="res-row" v-for="item in cell.items" :key="item.filename">
            <div class="res-main">
              <span class="badge">{{ item.role }}</span>
              <div class="res-text">
                <div class="res-label">{{ item.label }}</div>
                <div class="res-meta">
                  <code>{{ item.filename }}</code>
                  <span v-if="item.size_note"> · {{ item.size_note }}</span>
                </div>
                <div class="res-place">
                  <template v-if="item.ship_with_package">
                    Included in the app package
                  </template>
                  <template v-else>
                    Place under <code>{{ item.place_under }}</code>
                  </template>
                  <span v-if="item.used_for"> · {{ item.used_for }}</span>
                </div>
              </div>
            </div>
            <div class="res-actions">
              <span
                v-if="item.ship_with_package"
                class="res-state"
                :title="item.why_no_url || 'Included in the app package — no separate download'"
              >
                Ships with app
              </span>
              <span
                v-else-if="item.present"
                class="res-state res-found"
                :title="`Found at ${item.expected_path} — used instead of the chr7 subset`"
              >
                <i class="fas fa-check" aria-hidden="true"></i> In use
              </span>
              <a
                v-else-if="item.url"
                class="btn btn-sm btn-outline"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
                :title="`Not found at ${item.expected_path}`"
              >
                {{ item.role === 'mcool' ? '4DN page' : 'Download' }}
              </a>
              <span v-else class="res-state" :title="`Not found at ${item.expected_path}`">
                Place manually
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Status summary -->
    <section class="block" v-if="files.length || statusError">
      <div class="section-head">
        <span class="section-title">What the app can currently read on disk</span>
        <button class="btn btn-sm btn-outline head-action" @click="refresh" :disabled="refreshing">
          <i :class="refreshing ? 'fas fa-spinner fa-spin' : 'fas fa-sync-alt'" aria-hidden="true"></i>
          Refresh
        </button>
      </div>

      <!-- The file list disappearing used to be the only symptom of a failed
           status call, and the Refresh button disappeared with it, so the page
           told the user to click a button that was not on screen. -->
      <p v-if="statusError" class="msg-error measure" data-testid="status-error">{{ statusError }}</p>

      <div class="stats" v-if="files.length">
        <div class="stat-box">
          <div class="stat-value">{{ readyCount }}</div>
          <div class="stat-label">Ready</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{{ missingCount }}</div>
          <div class="stat-label">Missing</div>
        </div>
        <div class="stat-box" v-if="corruptedCount > 0">
          <div class="stat-value">{{ corruptedCount }}</div>
          <div class="stat-label">Corrupted</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{{ files.length }}</div>
          <div class="stat-label">Total</div>
        </div>
      </div>
    </section>

    <!-- File list by category -->
    <section v-for="cat in categories" :key="cat.key" class="block">
      <div class="section-head">
        <button
          type="button"
          class="head-toggle"
          :aria-expanded="isExpanded(cat.key) ? 'true' : 'false'"
          @click="toggleCategory(cat.key)"
        >
          <i
            :class="isExpanded(cat.key) ? 'fas fa-chevron-down' : 'fas fa-chevron-right'"
            class="chev chev-lead"
            aria-hidden="true"
          ></i>
          <span class="section-title">{{ cat.label }}</span>
        </button>
        <span class="cat-count" :class="catAllReady(cat.key) ? 'ready' : 'missing'">
          {{ catReadyCount(cat.key) }}/{{ catFiles(cat.key).length }}
        </span>
      </div>

      <transition name="expand">
        <div v-if="isExpanded(cat.key)" class="cat-body">
          <template v-for="group in catGroups(cat.key)" :key="group.cell">
          <!-- Shipped tracks cover three cell lines; without this heading the nine
               rows read as one undifferentiated list. -->
          <div v-if="group.cell" class="cell-head">
            <span class="cell-name">{{ group.cell }}</span>
            <span class="cell-count">{{ group.files.filter(x => x.present).length }}/{{ group.files.length }}</span>
          </div>
          <div v-for="f in group.files" :key="f.id" class="file-row" :class="{ present: f.present }">
            <div class="file-info">
              <div class="file-name">
                <i
                  :class="f.present ? 'fas fa-check-circle file-ok' : 'fas fa-times-circle file-miss'"
                  aria-hidden="true"
                ></i>
                <code>{{ f.filename }}</code>
                <span v-if="f.required" class="eyebrow req">Required</span>
              </div>
              <div class="file-desc measure">{{ f.description }}</div>
              <div class="file-meta">
                <span>{{ formatSize(f.size_mb) }}</span>
                <span class="file-dir" :title="f.dir">{{ shortenDir(f.dir) }}</span>
              </div>
            </div>

            <div class="file-actions">
              <!-- Download button -->
              <button
                v-if="!f.present && f.has_url"
                class="btn btn-sm btn-primary"
                :disabled="isDownloading(f.id)"
                @click="startDownload(f.id)"
              >
                <i :class="isDownloading(f.id) ? 'fas fa-spinner fa-spin' : 'fas fa-download'" aria-hidden="true"></i>
                {{ downloadLabel(f) }}
              </button>

              <!-- Manual instructions if no URL -->
              <button
                v-if="!f.present && !f.has_url"
                class="btn btn-sm btn-outline"
                @click="showManual(f)"
              >
                <i class="fas fa-info-circle" aria-hidden="true"></i>
                Manual
              </button>

              <!-- Verify button -->
              <button
                v-if="f.present"
                class="btn btn-sm btn-outline"
                @click="verifyFile(f.id)"
                :disabled="verifying[f.id]"
              >
                <i :class="verifying[f.id] ? 'fas fa-spinner fa-spin' : 'fas fa-shield-alt'" aria-hidden="true"></i>
                {{ verifyResults[f.id] === true ? 'Verified' : verifyResults[f.id] === false ? 'Failed' : 'Verify' }}
              </button>

              <!-- Status: present + verify outcome -->
              <span
                v-if="f.present && verifyResults[f.id] === false"
                class="status-bad"
                :title="verifyDetails[f.id]?.reason || 'Checksum failed'"
              >
                <i class="fas fa-exclamation-triangle" aria-hidden="true"></i> Corrupted
              </span>
              <span
                v-else-if="f.present && verifyResults[f.id] === true"
                class="status-ok"
              >
                <i class="fas fa-check" aria-hidden="true"></i> Verified
              </span>
              <span v-else-if="f.present" class="status-ok">
                <i class="fas fa-check" aria-hidden="true"></i> Present
              </span>
            </div>

            <!-- Verify failure details -->
            <div v-if="verifyResults[f.id] === false" class="verify-error-row">
              <div class="verify-error-msg">
                <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
                {{ verifyDetails[f.id]?.reason || 'Checksum verification failed.' }}
                <span v-if="verifyDetails[f.id]?.expected" class="verify-hash">
                  expected <code>{{ verifyDetails[f.id].expected }}</code>,
                  got <code>{{ verifyDetails[f.id].actual }}</code>
                </span>
              </div>
            </div>

            <!-- Progress bar -->
            <div v-if="starting[f.id] && !f.download" class="progress-row" data-testid="download-requesting">
              <span class="progress-text"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Requesting…</span>
            </div>
            <div v-if="f.download && f.download.status === 'downloading'" class="progress-row">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: f.download.percent + '%' }"></div>
              </div>
              <span class="progress-text">
                {{ f.download.downloaded_mb }} / {{ f.download.total_mb }} MB ({{ f.download.percent }}%)
              </span>
            </div>
            <div v-if="f.download && f.download.status === 'extracting'" class="progress-row">
              <span class="progress-text extracting"><i class="fas fa-file-archive" aria-hidden="true"></i> Extracting...</span>
            </div>
            <div v-if="f.download && f.download.status === 'verifying'" class="progress-row">
              <span class="progress-text verifying"><i class="fas fa-shield-alt" aria-hidden="true"></i> Verifying MD5...</span>
            </div>
            <div v-if="f.download && f.download.status === 'error'" class="progress-row">
              <span class="progress-text error"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i> {{ f.download.error }}</span>
            </div>
            <div v-if="f.download && f.download.status === 'done'" class="progress-row">
              <span class="progress-text success"><i class="fas fa-check-circle" aria-hidden="true"></i> Download complete!</span>
            </div>
          </div>
          </template>
        </div>
      </transition>
    </section>

    <!-- Manual download modal -->
    <div v-if="manualFile" class="modal-overlay" @click.self="manualFile = null">
      <div
        class="modal-box"
        ref="manualRef"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-label="Manual download instructions"
        @keydown.esc.stop="manualFile = null"
        @keydown.tab="onTabKeydown"
      >
        <div class="modal-header">
          <span>Manual download: <code>{{ manualFile.filename }}</code></span>
          <button class="modal-close" aria-label="Close" @click="manualFile = null">
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
        <div class="modal-body">
          <p class="measure">{{ manualFile.description }}</p>
          <div class="manual-steps">
            <div class="step-item">
              <span class="step-num">1</span>
              <div>
                <strong>Download the file</strong>
                <p v-if="manualFile.category === 'shipped_chr7_demo'">
                  This file is a <b>shipped chr7 demo track</b> (small, bundled with the app).
                  It is not the full-genome ENCODE download. For full-genome CTCF/RAD21/mcool,
                  use the <b>Dataset setup guide</b> above (place under CREDITAD_SHARED_RAW).
                </p>
                <p v-else>
                  See the Dataset setup guide above for 4DN / ENCODE full-genome links and
                  placement paths, or place a compatible file in the directory shown in step 2.
                </p>
              </div>
            </div>
            <div class="step-item">
              <span class="step-num">2</span>
              <div>
                <strong>Place the file in the correct directory</strong>
                <p>Copy the downloaded file to:</p>
                <code class="dir-path">{{ manualFile.dir }}</code>
              </div>
            </div>
            <div class="step-item">
              <span class="step-num">3</span>
              <div>
                <strong>Click "Refresh" to verify</strong>
                <p>After placing the file, click the Refresh button to check if it's detected.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Fallback notice -->
    <!-- .measure on the text, not on the ruled box: on the box it cut the rule
         short at 68ch. -->
    <div class="dm-fallback">
      <p class="measure">
      <strong>Can't download?</strong>
      You can manually download files and place them in the directories shown above.
      Click the <strong>Manual</strong> button next to any file for detailed instructions.
      After placing files, click <strong>Refresh</strong> to update status.
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useDialogFocus } from '../composables/useDialogFocus'

const API = (window.electronAPI ? 'http://127.0.0.1:5001' : '')
const files = ref([])
const refreshing = ref(false)
const statusError = ref('')
// Set from the click until the backend's own status shows up in a poll. Without
// it a Download click had no visible effect for seconds and invited repeat POSTs.
const starting = reactive({})
const manualFile = ref(null)
const manualRef = ref(null)
const { onTabKeydown } = useDialogFocus(manualFile, manualRef)
const verifying = reactive({})
const verifyResults = reactive({})
const verifyDetails = reactive({})
const guideOpen = ref(true)
const catalog = ref({ purpose: '', notes: [], cells: [], shared_raw_root: '', optional_present: 0, optional_total: 0 })
const catalogError = ref('')
let pollTimer = null

// Known category labels. Any backend category that is not listed here will
// still render — see ``categories`` computed below.
const KNOWN_CATEGORY_LABELS = {
  shipped_chr7_demo: 'Shipped demo tracks (chr7 only)',
}

function humanizeCategory(key) {
  if (!key) return 'Other'
  return key
    .split(/[_\-]/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

const categories = computed(() => {
  // Preserve known-category order first, then append any unknown categories
  // returned by the backend so newly added file groups are never silently
  // hidden in the UI.
  const seen = new Set()
  const out = []
  for (const key of Object.keys(KNOWN_CATEGORY_LABELS)) {
    if (files.value.some(f => f.category === key)) {
      out.push({ key, label: KNOWN_CATEGORY_LABELS[key] })
      seen.add(key)
    }
  }
  for (const f of files.value) {
    const key = f.category || 'uncategorized'
    if (!seen.has(key)) {
      out.push({ key, label: humanizeCategory(key) })
      seen.add(key)
    }
  }
  return out
})

const expandedCats = reactive({
  shipped_chr7_demo: true,
})

const readyCount = computed(() => files.value.filter(f => f.present && verifyResults[f.id] !== false).length)
const missingCount = computed(() =>
  files.value.filter(f => !f.present || verifyResults[f.id] === false).length
)
const corruptedCount = computed(() =>
  files.value.filter(f => f.present && verifyResults[f.id] === false).length
)

function catFiles(key) { return files.value.filter(f => f.category === key) }

/** Group a category's files by cell line, preserving backend order. */
function catGroups(key) {
  const groups = []
  const index = new Map()
  for (const f of catFiles(key)) {
    const cell = f.cell_line || ''
    if (!index.has(cell)) {
      index.set(cell, { cell, files: [] })
      groups.push(index.get(cell))
    }
    index.get(cell).files.push(f)
  }
  return groups
}

function catReadyCount(key) { return catFiles(key).filter(f => f.present).length }
function catAllReady(key) { return catFiles(key).every(f => f.present) }
function isExpanded(key) {
  // Default to expanded for any category not explicitly collapsed by the user
  return expandedCats[key] === undefined ? true : !!expandedCats[key]
}
function toggleCategory(key) {
  expandedCats[key] = !isExpanded(key)
}

function formatSize(mb) {
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${Math.round(mb * 1024)} KB`
}

function shortenDir(dir) {
  if (!dir) return ''
  const parts = dir.replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

function downloadLabel(f) {
  if (starting[f.id] && !f.download) return 'Requesting...'
  return isDownloading(f.id) ? 'Downloading...' : 'Download'
}

function isDownloading(id) {
  if (starting[id]) return true
  const f = files.value.find(x => x.id === id)
  return f?.download?.status === 'downloading' || f?.download?.status === 'extracting' || f?.download?.status === 'verifying'
}

async function refresh() {
  refreshing.value = true
  try {
    const resp = await fetch(`${API}/api/data/status`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    // A body without `files` used to assign undefined and take the template down
    // with it (`files.length` on undefined), so a malformed reply looked like a
    // blank page rather than a failure.
    if (!Array.isArray(data?.files)) throw new Error('status response has no file list')
    files.value = data.files
    statusError.value = ''
  } catch (e) {
    statusError.value = `Could not read file status from the backend (${e?.message || e}). `
      + 'It may still be starting up — click Refresh to try again.'
  } finally {
    refreshing.value = false
  }
}

async function loadCatalog() {
  catalogError.value = ''
  try {
    const resp = await fetch(`${API}/api/data/catalog`)
    if (!resp.ok) {
      catalogError.value = `Catalog unavailable (HTTP ${resp.status}). Restart backend if you just upgraded.`
      return
    }
    const data = await resp.json()
    catalog.value = {
      purpose: data.purpose || '',
      notes: data.notes || [],
      cells: data.cells || [],
      // Where the app reads the optional files from, and how many of them it can
      // currently see. Without these the guide cannot say whether the user's own
      // downloads are being used.
      shared_raw_root: data.shared_raw_root || '',
      optional_present: data.optional_present ?? 0,
      optional_total: data.optional_total ?? 0,
    }
  } catch (e) {
    catalogError.value = 'Could not load dataset catalog: ' + (e?.message || e)
  }
}

async function startDownload(id) {
  if (starting[id]) return
  starting[id] = true
  try {
    const resp = await fetch(`${API}/api/data/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      // Surface server error on the row via a synthetic progress state
      const f = files.value.find(x => x.id === id)
      if (f) {
        f.download = {
          status: 'error',
          error: data.error || `HTTP ${resp.status}`,
        }
      }
      console.error('Download rejected:', data)
      starting[id] = false
      return
    }
    // Local shared copy may finish immediately without a long poll
    if (data.status === 'done') {
      await refresh()
      starting[id] = false
      return
    }
    // Stays set until a poll shows the backend's own state for this file, so the
    // button never briefly returns to "Download" while the request is in flight.
    startPolling()
  } catch (e) {
    console.error('Download request failed:', e)
    const f = files.value.find(x => x.id === id)
    if (f) {
      f.download = { status: 'error', error: String(e?.message || e) }
    }
    starting[id] = false
  }
}

async function verifyFile(id) {
  verifying[id] = true
  verifyResults[id] = null
  verifyDetails[id] = null
  try {
    const resp = await fetch(`${API}/api/data/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const data = await resp.json()
    verifyResults[id] = !!data.verified
    verifyDetails[id] = data
  } catch (e) {
    verifyResults[id] = false
    verifyDetails[id] = { reason: 'Verify request failed: ' + (e?.message || e) }
  } finally {
    verifying[id] = false
  }
}

function showManual(f) {
  manualFile.value = f
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    await refresh()
    // Hand each locally-started row back to the backend's own state as soon as
    // that state exists; otherwise the local flag would outlive the download.
    for (const id of Object.keys(starting)) {
      if (!starting[id]) continue
      const f = files.value.find(x => x.id === id)
      if (f && (f.download?.status || f.present)) starting[id] = false
    }
    const anyActive = files.value.some(f =>
      f.download && ['downloading', 'extracting', 'verifying'].includes(f.download.status)
    )
    if (!anyActive && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
      for (const id of Object.keys(starting)) starting[id] = false
    }
  }, 2000)
}

onMounted(() => {
  refresh()
  loadCatalog()
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<style scoped>
/* Paper and ink only. The one page in the app that carries no data hue at all:
   nothing here is a measurement, so nothing here earns a colour. Structure comes
   from hairlines and the section tick, emphasis from the type. */
.data-manager {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--s5) var(--s2) var(--s7);
}

/* ── Page head ────────────────────────────────────────────────────────────── */
.page-head { margin-bottom: var(--s6); }

.page-title {
  font-family: var(--font-display);
  font-size: var(--fs-2xl);
  font-weight: 600;
  letter-spacing: -0.004em;
  color: var(--text-primary);
}
.page-lead {
  margin: var(--s3) 0 0;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}
.page-lead b { font-weight: 600; color: var(--text-primary); }

.block { margin-bottom: var(--s6); }

/* A disclosure control that keeps the .section-head rule and tick intact. */
.head-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--s3);
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.head-toggle .section-title { flex: none; }
.head-toggle:hover .chev { color: var(--text-primary); }
.head-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }

.chev {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  transition: color var(--dur) var(--ease);
}
.chev-lead {
  margin-left: 0;
  width: 10px;
  flex: none;
}

.head-action { align-self: center; margin-left: auto; }

/* ── Dataset setup guide ──────────────────────────────────────────────────── */
.guide-block .section-head { margin-bottom: var(--s2); }
.raw-root {
  margin: var(--s4) 0 var(--s5);
  padding: var(--s3) var(--s4);
  border: 1px solid var(--rule);
  border-left: 2px solid var(--brand);
  border-radius: var(--r-sm);
  background: var(--bg-secondary);
}
.raw-root-line {
  display: flex;
  align-items: baseline;
  gap: var(--s3);
  padding: 3px 0;
}
.raw-root-line .eyebrow { flex: none; width: 110px; }
.raw-root-path {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text-primary);
  word-break: break-all;
}
.raw-root-count { font-size: var(--fs-sm); color: var(--text-secondary); }
.raw-root-count b { font-family: var(--font-mono); color: var(--text-primary); }
.res-found { color: var(--success-text); }

.guide-sub {
  margin: 0 0 var(--s5);
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-muted);
}

.guide-purpose {
  margin: 0 0 var(--s3);
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}

.notes {
  margin: 0 0 var(--s5);
  padding: 0;
  list-style: none;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--text-muted);
}
.notes li { position: relative; padding-left: 15px; margin-bottom: 3px; }
.notes li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  width: 7px;
  height: 1px;
  background: var(--rule-strong);
}

.msg-error {
  margin: 0 0 var(--s4);
  font-size: var(--fs-sm);
  color: var(--danger-text);
}
.msg-muted {
  margin: 0 0 var(--s4);
  font-size: var(--fs-sm);
  color: var(--text-muted);
}

.cellgroup { margin-bottom: var(--s5); }
.cellgroup-head {
  display: flex;
  align-items: baseline;
  gap: var(--s2);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--rule-strong);
}
.cellgroup-head strong {
  font-family: var(--font-display);
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-primary);
}
.guide-asm {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

/* One resource = one ruled line, not a card. */
.res-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s4);
  padding: 11px 0;
  border-bottom: 1px solid var(--rule);
}
.res-row:last-child { border-bottom: none; }

.res-main {
  display: flex;
  gap: var(--s3);
  flex: 1;
  min-width: 0;
}
.res-main .badge { flex: none; margin-top: 2px; }
.res-text { min-width: 0; }

.res-label {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text-primary);
}
.res-meta,
.res-place {
  margin-top: 3px;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--text-muted);
  word-break: break-word;
}
/* Filename and size are data: one mono run, no nested code chip. */
.res-meta {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
}
.res-meta code {
  padding: 0;
  background: none;
  font-size: inherit;
  color: var(--text-secondary);
}

.res-actions { flex: none; display: flex; align-items: center; }
.res-actions .btn { text-decoration: none; }

.res-state {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.03em;
  color: var(--text-muted);
  white-space: nowrap;
}

/* ── Status ───────────────────────────────────────────────────────────────── */
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s3);
}
.stats .stat-box { flex: 0 1 148px; }

/* ── Categories and file rows ─────────────────────────────────────────────── */
.cat-count {
  flex: none;
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}
.cat-count.ready { color: var(--text-primary); }
.cat-count.missing { color: var(--text-muted); }

.cell-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s3);
  padding: var(--s4) 0 6px;
  border-bottom: 1px solid var(--rule-strong);
}
.cell-head:first-child { padding-top: 0; }
.cell-name {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: 0.05em;
  color: var(--text-primary);
}
.cell-count {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  color: var(--text-muted);
}

.file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--s4);
  padding: 13px 0;
  border-bottom: 1px solid var(--rule);
}
.file-row:last-child { border-bottom: none; }

.file-info { flex: 1; min-width: 280px; }

.file-name {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-all;
}
.file-name code {
  padding: 0;
  background: none;
  font-size: inherit;
  color: inherit;
}
.file-ok { font-size: 11px; color: var(--ink); }
.file-miss { font-size: 11px; color: var(--ink-faint); }

.req { flex: none; }

.file-desc {
  margin-top: 5px;
  font-size: var(--fs-xs);
  line-height: 1.55;
  color: var(--text-secondary);
}

.file-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s4);
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.file-dir { word-break: break-all; }

.file-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
}

.status-ok,
.status-bad {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.status-ok { color: var(--text-muted); }
.status-bad { color: var(--danger-text); }

.verify-error-row { flex-basis: 100%; }

.verify-error-msg {
  padding: 7px 10px;
  border-left: 2px solid var(--danger);
  background: var(--bg-secondary);
  font-size: var(--fs-xs);
  line-height: 1.55;
  color: var(--danger-text);
}
.verify-hash { color: var(--text-muted); }
.verify-hash code {
  font-size: var(--fs-micro);
  color: var(--text-secondary);
}

/* ── Progress ─────────────────────────────────────────────────────────────── */
.progress-row {
  width: 100%;
  margin-top: 2px;
}
.progress-bar {
  height: 3px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 5px;
}
.progress-fill {
  height: 100%;
  background: var(--ink);
  transition: width 0.3s;
}
.progress-text {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.progress-text.extracting,
.progress-text.verifying,
.progress-text.success { color: var(--text-secondary); }
.progress-text.error { color: var(--danger-text); }

/* ── Modal ────────────────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(23, 24, 26, 0.34);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--s3);
  padding: var(--s4) var(--s5);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-display);
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-primary);
}
.modal-header code {
  font-size: var(--fs-sm);
  font-weight: 400;
  word-break: break-all;
}

.modal-close {
  flex: none;
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.modal-close:hover { color: var(--text-primary); }

.modal-body { padding: var(--s5); }
.modal-body > p {
  margin: 0 0 var(--s5);
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}

.manual-steps { display: flex; flex-direction: column; gap: var(--s4); }

.step-item { display: flex; gap: var(--s3); }

/* A ruled counter, not a filled chip: --on-ink is only guaranteed to pair with
   --primary, and a solid --ink disc would invert with the theme. */
.step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--rule-strong);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
  margin-top: 1px;
}

.step-item strong {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
}
.step-item p {
  max-width: 54ch;
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--text-secondary);
}
.step-item b { font-weight: 600; color: var(--text-primary); }

code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  background: var(--bg-secondary);
  color: var(--text-primary);
  padding: 1px 5px;
  border-radius: var(--r-xs);
  word-break: break-all;
}

.dir-path {
  display: block;
  margin-top: 6px;
  padding: 8px 11px;
  border: 1px solid var(--rule);
  border-radius: var(--r-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--fs-xs);
}

/* ── Fallback notice ──────────────────────────────────────────────────────── */
.dm-fallback {
  margin-top: var(--s6);
  padding-top: var(--s4);
  border-top: 1px solid var(--rule);
  font-size: var(--fs-xs);
  line-height: 1.65;
  color: var(--text-muted);
}
.dm-fallback p { margin: 0; }
.dm-fallback strong { font-weight: 600; color: var(--text-secondary); }

/* Transitions */
.expand-enter-active, .expand-leave-active { transition: all 0.2s ease; }
.expand-enter-from, .expand-leave-to { opacity: 0; max-height: 0; }

@media (max-width: 720px) {
  .res-row, .file-row { flex-direction: column; align-items: stretch; gap: var(--s3); }
  .file-info { min-width: 0; }
}
</style>
