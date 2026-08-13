import { computed, ref } from 'vue'
import pkg from '../../package.json'
import { useCounterStore } from '../store/stores'
import {
  attachReviewRecordSources,
  buildReviewAssertionsBED,
  buildReviewAssertionsJSON,
  resolveReviewExportContext,
} from '../utils/reviewExport'

const version = ref(pkg.version)
// Product/app name — single source of truth for all UI branding. (The scientific
// framework is "TAD-VCI" in the manuscript; the app/product is "CrediTAD".)
const appName = ref('CrediTAD')
// Always enter on Home — on first load AND on every refresh. The current page is
// deliberately NOT persisted: a reload drops the in-memory backend tokens, so resuming
// on Visualization would show a stale-token state; landing on Home lets the user pick a
// cell demo fresh. (file_view_obj is still persisted separately and self-heals on use.)
const page = ref('home')
const isDark = ref(false)
const showGuideModal = ref(false)

export function useAppState() {
  const store = useCounterStore()
  const reviewExportState = computed(() => resolveReviewExportContext(store.file_view_obj || {}))

  const setPage = (newPage) => {
    page.value = newPage   // session-only; intentionally not persisted (see `page` init above)
  }

  const toggleTheme = () => {
    isDark.value = !isDark.value
    if (isDark.value) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  const _download = (content, filename, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // Export application-level versioned decision records with per-record checksums.
  const _fetchRecords = async () => {
    const apiBase = (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api')
    const r = await fetch(`${apiBase}/tadvci/records`)
    const payload = await r.json()
    if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`)
    if (!Array.isArray(payload.records)) throw new Error('record response is malformed')
    return attachReviewRecordSources(payload.records)
  }

  const _reviewContextOrAlert = () => {
    const state = resolveReviewExportContext(store.file_view_obj || {})
    if (!state.ready) {
      alert(`Review export unavailable: current dataset context is missing ${state.missing.join(', ')}.`)
      return null
    }
    return state.context
  }

  const exportReviewAssertionsJSON = async () => {
    const context = _reviewContextOrAlert()
    if (!context) return
    let recs = []
    try { recs = await _fetchRecords() } catch (e) { alert('Could not fetch local review assertions: ' + e); return }
    if (!recs.length) { alert('No local review assertions to export yet — record a review decision first.'); return }
    try {
      const payload = buildReviewAssertionsJSON(recs, context)
      _download(JSON.stringify(payload, null, 2), 'creditad_local_review_assertions.json', 'application/json')
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  const exportReviewAssertionsBED = async () => {
    const context = _reviewContextOrAlert()
    if (!context) return
    let recs = []
    try { recs = await _fetchRecords() } catch (e) { alert('Could not fetch local review assertions: ' + e); return }
    if (!recs.length) { alert('No local review assertions to export yet — record a review decision first.'); return }
    try {
      _download(buildReviewAssertionsBED(recs, context), 'creditad_local_review_assertions.bed', 'text/plain')
    } catch (e) {
      alert(e.message || String(e))
    }
  }

  return {
    page,
    version,
    appName,
    isDark,
    showGuideModal,
    reviewExportState,
    setPage,
    toggleTheme,
    exportReviewAssertionsJSON,
    exportReviewAssertionsBED
  }
}
