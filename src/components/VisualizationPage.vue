<template>
  <div class="visualization-container">

    <div class="controls">
      <div class="control-group">
        <label class="ctl-label" for="chr-select">Chromosome</label>
        <select id="chr-select" v-model="selectedChr" class="input" @change="onChrChange">
          <option v-for="chr in availableChroms" :key="chr.name" :value="chr.name">
            {{ chromOptionLabel(chr) }}
          </option>
        </select>
      </div>
      <div class="control-group">
        <label class="ctl-label" for="region-input">Region</label>
        <input
          id="region-input"
          type="text"
          class="input region-input"
          v-model="regionInput"
          placeholder="50,000,000-60,000,000"
          @keyup.enter="goToRegionInput"
        />
        <button class="btn btn-outline btn-sm nav-btn" @click="goToRegionInput">Go</button>
        <span v-if="regionError" class="region-error" data-testid="region-error">{{ regionError }}</span>
      </div>
      <div class="viewport-info">
        <span class="info-chip region-chip" v-if="viewRegion">chr{{ selectedChr }}:{{ viewRegion.start }}–{{ viewRegion.end }}</span>
      </div>
      <!-- Session recovery. 'recovering' is transient and NOT an alert; the two
           terminal states are, and each offers the action that actually resolves it. -->
      <div class="recovery-notice is-busy" v-if="recovery.state === 'recovering'"
           role="status" data-testid="session-recovering">
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Session expired — reloading this dataset…
      </div>
      <div class="recovery-notice is-failed"
           v-else-if="recovery.state === 'failed' || recovery.state === 'unrecoverable'"
           role="alert" data-testid="stale-session">
        <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
        <span data-testid="recovery-message">{{ recovery.message }}</span>
        <button v-if="recovery.state === 'failed'" class="recovery-btn"
                data-testid="recovery-retry" @click="retryRecovery">Retry</button>
        <button class="recovery-btn" data-testid="recovery-reimport"
                @click="goToImport">Re-import</button>
      </div>
      <div class="info-tag" v-if="store.file_view_obj?.mcoolPath">
        {{ store.file_view_obj.mcoolPath.split(/[\\/]/).pop() }}
      </div>
    </div>
    <div class="body-row">
      <!-- Track 面板 -->
      <div class="track-panel" ref="trackPanelRef">

        <div class="guide-line" v-if="guideXPx >= 0" :style="{ left: guideXPx + 'px' }"></div>

        <!-- What is annotated and what can be drawn are different extents. Say so
             here rather than letting a missing heatmap read as missing evidence. -->
        <div v-if="scopeNotice" class="scope-notice" data-testid="scope-notice">
          <div class="sn-main">{{ scopeNotice.text }}</div>
          <button type="button" class="btn btn-outline btn-sm" @click="setPage('datamanager')">
            Add full-genome tracks
          </button>
        </div>

        <div class="track-row" v-if="store.file_view_obj?.hic_token && store.file_view_obj?.mcoolPath">
          <div class="track-label">
            <span class="track-name">Hi-C contact map</span>
            <span class="badge track-badge" :title="hicResTitle" data-testid="hic-res-badge">
              mcool<template v-if="hicRenderRes && selectedHasMatrix"> · {{ binLabel(hicRenderRes) }}</template>
            </span>
          </div>
          <div class="track-content heatmap-container">
            <!-- The viewer stays MOUNTED when the chromosome has no matrix (it owns the
                 chromosome list); it is only hidden, so switching back does not refetch. -->
            <div v-show="!selectedHasMatrix" class="no-matrix-notice" data-testid="no-matrix-notice">
              No contact matrix for chr{{ selectedChr }} in this session — the bundled map covers
              {{ (matrixChroms || []).map(c => 'chr' + c.name).join(', ') || 'no chromosome' }}.
              Evidence, tiers and caller tracks below are unaffected.
            </div>
            <div v-show="selectedHasMatrix" class="hic-mount">
              <HiCViewer
                :key="store.file_view_obj.hic_token"
                :hicToken="store.file_view_obj.hic_token"
                :apiBaseUrl="apiBase"
                :vp="sharedVp"
                :selectedChromosome="hicChromosome"
                trackId="hic"
                @vp-change="onVpChange"
                @chroms-loaded="onChromsLoaded"
                @guide-x="onGuideX"
                @res-change="hicRenderRes = $event"
                @stale-token="onStaleToken"
              />
            </div>
          </div>
        </div>

        <div
          v-for="bw in (store.file_view_obj?.bigwig_tokens || [])"
          :key="bw.token"
          class="track-row"
        >
          <div class="track-label">
            <span class="track-name">{{ bw.fileName }}</span>
            <span class="badge track-badge">
              <i class="swatch" :style="{ background: bw.color || '#3B82F6' }" aria-hidden="true"></i>bigWig
            </span>
          </div>
          <div class="track-content">
            <BigWigTrack
              :bwToken="bw.token"
              :chromosome="selectedChr"
              :apiBaseUrl="apiBase"
              :vp="sharedVp"
              :trackId="bw.token"
              :fileName="bw.fileName"
              :trackColor="bw.color || '#3B82F6'"
              @vp-change="onVpChange"
              @stale-token="onStaleToken"
            />
          </div>
        </div>

        <div
          v-for="(item, bedIdx) in store.file_view_obj?.bed_tokens"
          :key="item.token"
          class="track-row"
        >
          <div class="track-label">
            <span class="track-name">{{ item.fileName }}</span>
            <span class="badge track-badge" title="Caller boundary track">
              <i class="swatch" :style="{ background: tadColor(item.fileName) }" aria-hidden="true"></i>caller
            </span>
            <!-- Always in the layout, even with nothing selected. Letting it appear on the
                 first click grew every caller row 68 -> 97 px and pushed the panel down
                 174 px, which read as the whole browser jumping when you picked a
                 boundary. It now only changes its text. -->
            <span class="badge vote-badge"
                  :class="voteBadge(item.fileName) ? voteBadge(item.fileName).cls : 'vb-idle'"
                  :title="voteBadge(item.fileName) ? voteBadge(item.fileName).title : ''"
                  :aria-hidden="voteBadge(item.fileName) ? 'false' : 'true'"
                  :data-testid="'vote-badge-' + item.fileName">
              {{ voteBadge(item.fileName) ? voteBadge(item.fileName).text : '—' }}
            </span>
          </div>
          <div class="track-content">
            <BedTrack
              :bedToken="item.token"
              :chromosome="selectedChr"
              :apiBaseUrl="apiBase"
              :vp="sharedVp"
              :trackId="item.token"
              :singleLane="false"
              :trackColor="tadColor(item.fileName)"
              :voteHighlight="voteHighlight(item.fileName, bedIdx)"
              @vp-change="onVpChange"
              @stale-token="onStaleToken"
            />
          </div>
        </div>

        <div
          v-if="!store.file_view_obj?.hic_token && !store.file_view_obj?.bed_tokens?.length"
          class="empty-state"
        >
          No data loaded. Open Home (demo) or Import Files.
        </div>

        <!-- Evidence-tier track (aligned to sharedVp) -->
        <div class="track-row" v-if="tierToken">
          <div class="track-label">
            <span class="track-name">Evidence tier</span>
            <span
              class="badge track-badge"
              :title="'Deterministic evidence tier; not a probability or truth label. '
                + 'Computed on ' + binLabel(analysisBinBp) + ' bins — the heatmap above is drawn '
                + 'at whatever matrix level fits the current zoom, which is usually a different number.'"
              data-testid="tier-res-badge"
            >
              <i class="swatch swatch-ramp" :style="{ background: tierRampGradient }" aria-hidden="true"></i>D5–D1 · {{ binLabel(analysisBinBp) }}
            </span>
          </div>
          <div class="track-content">
            <div v-if="tadvciLoading" class="tier-loading" data-testid="tier-loading" role="status">
              Loading evidence ticks for chr{{ selectedChr }}…
            </div>
            <TADVCITrack
              :boundaries="tadvciBoundaries"
              :vp="sharedVp"
              :selectedId="selectedTickId"
              :resolution="store.file_view_obj?.resolution || 25000"
              @select="onTadvciSelect"
            />
          </div>
        </div>

      </div><!-- /track-panel -->


      <!-- TAD-VCI graded-evidence curation panel -->
      <TADVCIEvidence
        v-if="tierToken"
        :boundary="tadvciSelected"
        :apiBase="apiBase"
        :resolution="store.file_view_obj?.resolution ?? null"
        :cellLine="store.file_view_obj?.cell_line ?? null"
        :assembly="store.file_view_obj?.assembly ?? null"
        :source="store.file_view_obj?.source ?? store.file_view_obj?.mcoolPath ?? null"
        :token="tierToken"
      />

    </div><!-- /body-row -->
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useCounterStore } from '../store/stores'
import { useAppState } from '../composables/useAppState'
import BedTrack    from './best_porp_bed.vue'
import HiCViewer   from './token_best_mcool.vue'
import BigWigTrack from './BigWigTrack.vue'
import TADVCITrack from './TADVCITrack.vue'
import TADVCIEvidence from './TADVCIEvidence.vue'
import { TIER_COLORS, TIER_ORDER } from '../constants/tierColors'

const store = useCounterStore()
const { setPage } = useAppState()
const apiBase = (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api')

// Session token for the tier annotation (BED-only annotate uses annotation_token;
// mcool demos / imports still key on hic_token).
const tierToken = computed(() =>
  store.file_view_obj?.annotation_token || store.file_view_obj?.hic_token || null
)

// ── TAD-VCI graded-evidence layer (native to this viewer) ──
const tadvciBoundaries = ref([])
const tadvciSelected = ref(null)
const tadvciLoading = ref(false)
/* One chromosome's ticks are megabytes and take the better part of a second to
   arrive, so a quick second selection used to race the first: whichever landed
   last won, and a late reply for the previous chromosome painted its ticks under
   the new chromosome's coordinate readout. A reviewer could then open — and
   record a decision on — a boundary from a chromosome they were not looking at.
   Every write below is gated on still being the newest request. */
let tadvciSeq = 0
async function fetchTadvci(chrom) {
  const my = ++tadvciSeq
  if (!chrom) { tadvciBoundaries.value = []; tadvciLoading.value = false; return }
  const tok = tierToken.value
  tadvciLoading.value = true
  try {
    // Per-token tier: demos and user imports flow through /imported/{token}.
    if (tok) {
      const ri = await fetch(`${apiBase}/tadvci/imported/${tok}/${chrom}`)
      if (ri.ok) {
        const di = await ri.json()
        if (my !== tadvciSeq) return
        tadvciBoundaries.value = di.boundaries || []
        return
      }
    }
    // The static fallback serves the built-in GM12878 hg19 25 kb bundle. Using it for any
    // other session would draw one cell line's tiers on another's map, so it is gated on
    // the session actually being that bundle rather than on "we have nothing else".
    const fvo = store.file_view_obj || {}
    const isBuiltinGm = String(fvo.source || '').startsWith('builtin:')
      && fvo.cell_line === 'GM12878' && fvo.assembly === 'hg19'
      && Number(fvo.resolution) === 25000
    if (!isBuiltinGm) {
      if (my === tadvciSeq) tadvciBoundaries.value = []
      return
    }
    const r = await fetch(`${apiBase}/tadvci/annotation/${chrom}`)
    const payload = (await r.json()).boundaries || []
    if (my !== tadvciSeq) return
    tadvciBoundaries.value = payload
  } catch {
    if (my === tadvciSeq) tadvciBoundaries.value = []
  } finally {
    if (my === tadvciSeq) tadvciLoading.value = false
  }
}
/* Selecting a boundary fetches ITS card. The track list is deliberately slim — a full
   evidence card per boundary made one chromosome of a 10 kb package a 21.2 MB / 22.5 s
   download for data that only the panel ever reads, one boundary at a time. The tick is
   shown immediately from what the track already has, so the click never feels deferred,
   and the full card replaces it when it lands (typically a few ms; it is one row lookup
   in an already-parsed table). */
const cardCache = new Map()
/* The tick's own selected ring is driven by this, updated synchronously on click, so the
   click always feels instant even though the card is fetched. Committing the panel in one
   step (below) is what stops it rendering twice. */
const selectedTickId = ref(null)
// Matrix level currently rendered by the heatmap (published by HiCViewer). Independent of
// `analysisBinBp`: both demo packages of a cell line share ONE mcool, and the level drawn
// is picked from on-screen bp/px, so "GM12878 25 kb" does not mean a 25 kb heatmap.
const hicRenderRes = ref(null)
const analysisBinBp = computed(() => Number(store.file_view_obj?.resolution) || 0)
const hicResTitle = computed(() => {
  const drawn = hicRenderRes.value
  if (!drawn) return 'Hi-C contact matrix (mcool).'
  const bin = analysisBinBp.value
  const base = `Contact matrix drawn at ${binLabel(drawn)} bins, chosen to match the current zoom.`
  if (!bin) return base
  return drawn === bin
    ? `${base} That happens to equal the ${binLabel(bin)} analysis bin size; zooming changes it.`
    : `${base} The evidence tiers were computed on ${binLabel(bin)} bins — the two are independent.`
})
let cardSeq = 0
async function onTadvciSelect(b) {
  if (!b) { selectedTickId.value = null; tadvciSelected.value = null; return }
  const my = ++cardSeq
  selectedTickId.value = b.boundary_id
  const tok = tierToken.value
  const key = `${tok}|${b.boundary_id}`
  const cached = cardCache.get(key)
  if (cached) { tadvciSelected.value = cached; return }
  if (!tok) { tadvciSelected.value = { ...b, _cardError: 'no session token' }; return }
  const [chrom, pos] = String(b.boundary_id || '').split(':')
  if (!chrom || !pos) { tadvciSelected.value = { ...b, _cardError: 'unparseable boundary id' }; return }
  /* The panel keeps showing the PREVIOUS boundary for at most 180 ms. A card is one row
     lookup in an already-parsed table (~10 ms measured), so in practice it swaps in one
     step and nothing flickers. If the lookup does run long, the placeholder takes over so
     the panel can never sit on the wrong boundary silently. */
  const placeholder = setTimeout(() => {
    if (my === cardSeq) tadvciSelected.value = { ...b, _cardLoading: true }
  }, 180)
  try {
    const r = await fetch(`${apiBase}/tadvci/card/${encodeURIComponent(tok)}/${chrom}/${pos}`)
    if (my !== cardSeq) return          // a later click won
    if (!r.ok) { tadvciSelected.value = { ...b, _cardError: `HTTP ${r.status}` }; return }
    const full = (await r.json()).boundary
    if (my !== cardSeq || !full) return
    // Never let a mismatched reply paint under the wrong coordinate.
    if (full.boundary_id !== b.boundary_id) return
    if (cardCache.size > 200) cardCache.clear()
    cardCache.set(key, full)
    tadvciSelected.value = full
  } catch (e) {
    if (my === cardSeq) tadvciSelected.value = { ...b, _cardError: String(e) }
  } finally {
    clearTimeout(placeholder)
  }
}

/* ── BD1 vote provenance on the caller tracks ──────────────────────────────────
   "2/6 methods" is a count of methods with a call INSIDE a tolerance window, not a
   count of blocks drawn at the selected position. Reading the card against the
   picture used to be impossible: the tolerance was nowhere on screen and nothing
   said which block a vote had been taken from. Each caller track now draws the
   window and rings the block that supplied its vote. */
function callerKey(name) {
  return String(name || '').replace(/_boundaries\.bed$/i, '').replace(/\.bed$/i, '').trim()
}
const selectedVote = computed(() => {
  const b = tadvciSelected.value
  if (!b) return null
  const m = b.criteria?.BD1?.measured || {}
  const pos = Number(String(b.boundary_id || '').split(':')[1])
  const tolBp = Number(m.vote_tol_bp ?? b.vote_tol_bp)
  // Annotation bin size. The footprint a caller block has to overlap in order to vote is
  // [pos-tol, pos+tol+bin), so the bin has to travel with the highlight — the BED track's
  // own `res` is a per-zoom tile resolution and is not this number.
  const binBp = Number(store.file_view_obj?.resolution) || 0
  if (!Number.isFinite(pos) || !Number.isFinite(tolBp)) return null
  const byCaller = new Map()
  for (const s of (m.supporters || b.supporters || [])) {
    byCaller.set(callerKey(s.caller), Number.isFinite(Number(s.offset_bp)) ? Number(s.offset_bp) : null)
  }
  return { pos, tolBp, binBp, byCaller }
})
function voteHighlight(fileName, index) {
  const v = selectedVote.value
  if (!v) return null
  const key = callerKey(fileName)
  const isSupporter = v.byCaller.has(key)
  return {
    pos: v.pos,
    tolBp: v.tolBp,
    binBp: v.binBp,
    isSupporter,
    offsetBp: isSupporter ? v.byCaller.get(key) : null,
    showLabel: index === 0,
  }
}
/* Compact offset for the badge. The label column is 200 px and `.badge` is a fixed
   19 px tall, so a string long enough to wrap overflowed the box and printed its second
   line across the row divider. Full wording stays in the title. */
function shortBp(bp) {
  const sign = bp > 0 ? '+' : '-'
  const a = Math.abs(bp)
  return a % 1000 === 0 ? `${sign}${a / 1000} kb` : `${sign}${a.toLocaleString()} bp`
}
/* Unsigned bin-size label. `shortBp` above always carries a +/- because it formats vote
   OFFSETS; a bin size printed as "+25 kb" reads as a shift, not a width. */
function binLabel(bp) {
  const n = Number(bp)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n % 1000000 === 0) return `${n / 1000000} Mb`
  if (n % 1000 === 0) return `${n / 1000} kb`
  return `${n.toLocaleString()} bp`
}
function voteBadge(fileName) {
  const v = selectedVote.value
  if (!v) return null
  const key = callerKey(fileName)
  if (!v.byCaller.has(key)) return { text: 'no BD1 vote', cls: 'vb-no',
    title: `No call from ${key} within ±${v.tolBp.toLocaleString()} bp of the selected boundary.` }
  const off = v.byCaller.get(key)
  if (off === null) return { text: 'BD1 vote', cls: 'vb-yes', title: 'Supports the selected boundary; offset not recorded in this annotation.' }
  if (off === 0) return { text: 'BD1 vote · 0 bp', cls: 'vb-exact',
    title: `${key} called the selected position exactly (offset 0 bp).` }
  return { text: `BD1 vote · ${shortBp(off)}`, cls: 'vb-yes',
    title: `${key} has no call at the selected position; its vote comes from a call ${Math.abs(off).toLocaleString()} bp away, inside the ±${v.tolBp.toLocaleString()} bp match window.` }
}

/* Evidence is genome-wide in every shipped package; the contact map and ChIP
   tracks are chr7-only subsets unless the user added full-genome files, and are
   withheld entirely if the only matrix on disk is on the wrong genome build. */
const scopeNotice = computed(() => {
  const s = store.file_view_obj?.scope
  if (!s) return null
  const nEvidence = (s.evidence_chroms || []).length
  const map = s.map || {}
  const signal = s.signal || {}

  if (!map.available) {
    const why = map.blocked_reason
      ? `No contact map is shown because ${map.blocked_reason}.`
      : 'No contact map is loaded for this session.'
    return {
      text: `${why} Evidence cards, tiers and caller tracks are unaffected and cover `
        + `${nEvidence || 'all'} chromosomes.`,
    }
  }

  // The two browser layers resolve per track, so a session can be part your data
  // and part demo subset. Say which is which instead of leaving the user to infer
  // it from where the signal stops.
  const bundled = []
  if (map.source === 'bundled_chr7') bundled.push('contact map')
  if (signal.available && signal.source === 'bundled_chr7') bundled.push('CTCF / RAD21')

  if (bundled.length === 2) {
    const shown = (map.chroms || ['7']).map(c => `chr${c}`).join(', ')
    return {
      text: `Browser tracks are the bundled ${shown} demo subsets, while this package's `
        + `evidence covers ${nEvidence} chromosomes. Add full-genome files to browse the rest.`,
    }
  }
  if (bundled.length === 1) {
    const other = bundled[0] === 'contact map' ? 'CTCF / RAD21' : 'the contact map'
    return {
      text: `Mixed sources: ${other} comes from your full-genome files, but the `
        + `${bundled[0]} is still the bundled chr7 subset, so it has no data outside chr7.`,
    }
  }
  return null
})

const trackPanelRef = ref(null)
// Session-recovery state machine. 'recovering' and 'failed' used to look identical
// (both left the same notice string, or in the failed case no notice at all), so a
// user whose backend never came back sat in front of a spinner forever.
//   idle          — nothing wrong, or recovery succeeded
//   recovering    — a regeneration request is in flight
//   failed        — the regeneration request itself failed; retrying can still work
//   unrecoverable — this session can never be regenerated (user's own import); only
//                   re-importing resolves it, so we do not offer Retry
const recovery = reactive({ state: 'idle', message: '' })
const guideXPx = ref(-1)
const regionInput = ref('')
const regionError = ref('')

function onGuideX(pct) {
  if (pct < 0 || !trackPanelRef.value) {
    guideXPx.value = -1
    return
  }
  const labelW = 200
  const panelW = trackPanelRef.value.clientWidth
  const contentW = panelW - labelW
  guideXPx.value = Math.round(labelW + pct * contentW)
}

/* ── 染色体 ── */
// Two extents, deliberately kept apart. The contact matrix may cover far fewer
// chromosomes than the evidence: the shipped demo packages carry a genome-wide evidence
// table but only a chr7 contact map, so driving this list from the matrix alone hid 22 of
// the 23 annotated chromosomes on any install without the optional full-genome download.
// availableChroms is the UNION; `hasMatrix` says which ones can also draw a heatmap.
const availableChroms = ref([])
const selectedChr     = ref('')
const matrixChroms    = ref([])   // from the mcool, via HiCViewer 'chroms-loaded'
const evidenceChroms  = ref([])   // from the caller BEDs (genome-wide in every demo package)

// What the heatmap is asked to draw. Pinned to the last chromosome the matrix actually
// has, so selecting an evidence-only chromosome hides the map instead of firing tile
// requests that can only 404.
const hicChromosome = ref('')
watch([selectedChr, matrixChroms], () => {
  if (matrixChroms.value.some(c => String(c.name) === String(selectedChr.value))) {
    hicChromosome.value = selectedChr.value
  }
})

const selectedHasMatrix = computed(() => {
  const c = availableChroms.value.find(x => String(x.name) === String(selectedChr.value))
  return c ? c.hasMatrix !== false : true
})

function chromSortKey(name) {
  const n = Number(name)
  return Number.isFinite(n) ? [0, n, ''] : [1, 0, String(name)]
}

/** Union the two extents, matrix length winning when both know one. */
function mergeChroms() {
  const byName = new Map()
  for (const c of evidenceChroms.value) {
    byName.set(String(c.name), { name: String(c.name), length: c.length || 0, hasMatrix: false })
  }
  for (const c of matrixChroms.value) {
    const k = String(c.name)
    const prev = byName.get(k)
    byName.set(k, { name: k, length: c.length || prev?.length || 0, hasMatrix: true })
  }
  const whitelist = (store.file_view_obj?.selected_chroms || []).map(String)
  let list = [...byName.values()]
  if (whitelist.length) list = list.filter(c => whitelist.includes(c.name))
  list.sort((a, b) => {
    const [ka, na, sa] = chromSortKey(a.name), [kb, nb, sb] = chromSortKey(b.name)
    return ka - kb || na - nb || sa.localeCompare(sb)
  })
  availableChroms.value = list

  // Land on a chromosome that can actually draw a map, so the first thing the user sees
  // is never an empty heatmap just because chr1 sorts first.
  const stillThere = list.some(c => c.name === String(selectedChr.value))
  if (!stillThere) {
    const pick = list.find(c => c.hasMatrix) || list[0]
    if (pick) { selectedChr.value = pick.name; return pick.name }
  }
  return null
}

function chromOptionLabel(chr) {
  const size = chr.length ? ` (${formatBp(chr.length)})` : ''
  return `chr${chr.name}${size}${chr.hasMatrix === false ? ' — evidence only' : ''}`
}

function tadColor(name) {
  // Built-in detectors + TADShop member-caller tracks (demo / BYO)
  const map = {
    insulation:         '#e67e22',
    topdom_like:        '#8e44ad',
    corner_ranksum:     '#8e44ad',
    contact_contrast:   '#27ae60',
    spectral_profile:   '#16a085',
    laplacian_profile:  '#16a085',
    network_modularity: '#c0392b',
    // TADShop upstream tracks
    Consensus:          '#c0392b',
    TopDom:             '#8e44ad',
    SpectralTAD:        '#16a085',
    OnTAD:              '#e67e22',
    MSTD:               '#2980b9',
    arrowhead:          '#27ae60',
    DI:                 '#7f8c8d',
  }
  return map[name] || '#5B5FC7'
}

/* Track colours are chosen to read well as a FILL (the BED blocks, the BigWig
   area). Several of them sit at 2.8–3.3:1 against white, which is why they are no
   longer used as a label background: the badge is neutral and carries a small
   swatch instead, so the colour stays a legend for the track without having to
   also work as a text background. */
const tierRampGradient = TIER_ORDER
  .slice()
  .reverse()
  .map((t, i, a) => `${TIER_COLORS[t]} ${(i / a.length) * 100}% ${((i + 1) / a.length) * 100}%`)
  .join(', ')
  .replace(/^/, 'linear-gradient(90deg, ') + ')'

/* ── 染色体过滤逻辑 ── */
function onChromsLoaded(allChroms) {
  // These are the CONTACT MATRIX's chromosomes. They no longer define the whole list —
  // mergeChroms unions them with the evidence extent and applies the whitelist.
  matrixChroms.value = allChroms || []
  const picked = mergeChroms()
  if (picked || !selectedChr.value) fetchTadvci(selectedChr.value)
}

// 修改 onChrChange
function onChrChange() {
  // 加一个特殊 sourceId，让所有子组件都响应这个重置
  sharedVp.bpPerPx  = 0
  sharedVp.centerBp = 0
  sharedVp.sourceId = 'chr-reset'   // ← 新增
  tadvciSelected.value = null
  // All three belong to the chromosome being left: a complaint about the previous
  // entry, coordinates that mean something else here, and the old ticks.
  regionError.value = ''
  regionInput.value = ''
  tadvciBoundaries.value = []
  fetchTadvci(selectedChr.value)
}

/* ── 共享视口 ── */
const sharedVp = reactive({ bpPerPx: 0, centerBp: 0, sourceId: null })

// Self-heal a stale data token. Tokens live in backend memory; localStorage can
// hold dead tokens after a backend restart. Recover by re-calling the same demo
// endpoint that originally loaded the session (TADShop example vs use_cell).
let _recovering = false
function failRecovery(message) {
  recovery.state = 'failed'
  recovery.message = message
}
function blockRecovery(message) {
  recovery.state = 'unrecoverable'
  recovery.message = message
}
function goToImport() { setPage('import') }
function retryRecovery() {
  // A failed attempt latches so the tracks cannot spin the retry loop on every
  // redraw; an explicit Retry is what clears the latch.
  _recovering = false
  recovery.state = 'idle'
  recovery.message = ''
  onStaleToken()
}

async function onStaleToken() {
  if (_recovering) return
  // Do not silently re-arm after a terminal outcome: the user has to act.
  if (recovery.state === 'failed' || recovery.state === 'unrecoverable') return
  const src = String(store.file_view_obj?.source || '')
  const isMulticell = src.startsWith('multicell_example')
  const isBuiltin = src.startsWith('builtin:')
  const cell = store.file_view_obj?.cell_demo || store.file_view_obj?.cell_line
  // Only sessions the app can regenerate byte-for-byte may be auto-recovered. A user's
  // own import (source 'annotate:*' / an uploaded path) cannot be: calling use_cell would
  // silently swap their data for the built-in GM12878 hg19 25 kb bundle while the UI kept
  // whatever cell line they had selected. Those sessions must be re-imported by the user.
  if (!isMulticell && !isBuiltin) {
    blockRecovery('Session expired (backend restarted). This dataset was imported by you, '
      + 'so it cannot be regenerated automatically — re-import your files to continue.')
    return
  }
  if (!cell) {
    blockRecovery('Session expired and the stored session has no cell line recorded, '
      + 'so the demo it came from cannot be identified. Load a demo again from Home, '
      + 'or re-import your files.')
    return
  }
  const resolution = store.file_view_obj?.resolution
  if (isMulticell && !resolution) {
    blockRecovery('Session expired and the stored session has no resolution recorded, '
      + 'so the demo package cannot be identified. Load a demo again from Home.')
    return
  }
  _recovering = true
  recovery.state = 'recovering'
  recovery.message = ''
  try {
    const r = isMulticell
      ? await fetch(`${apiBase}/tadvci/use_multicell_example`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cell_line: cell, resolution }),
        })
      : await fetch(`${apiBase}/tadvci/use_cell/${encodeURIComponent(cell)}`, { method: 'POST' })
    if (!r.ok) {
      failRecovery(`Session expired and reloading the ${cell} dataset failed `
        + `(HTTP ${r.status}). The backend may still be starting up.`)
      return
    }
    const d = await r.json()
    if (!d || !(d.hic_token || d.annotation_token)) {
      failRecovery('Session expired and the reload returned no usable session token. '
        + 'Retry, or re-import your files.')
      return
    }
    const autosomes = []
    for (let i = 1; i <= 22; i++) { autosomes.push(String(i), `chr${i}`) }
    if (isMulticell) { autosomes.push('X', 'chrX') }
    store.file_view_obj = {
      ...store.file_view_obj,
      hic_token: d.hic_token,
      annotation_token: d.annotation_token || null,
      mcoolPath: d.mcoolPath,
      selected_chroms: store.file_view_obj?.selected_chroms?.length
        ? store.file_view_obj.selected_chroms
        : autosomes,
      bigwig_tokens: (d.bigwig_tokens || []).map(b => ({
        token: b.token, fileName: b.fileName,
        color: b.fileName === 'CTCF' ? '#2563EB' : '#7C3AED',
      })),
      bed_tokens: (d.bed_tokens || []).map(b => ({ token: b.token, fileName: b.fileName })),
      resolution: d.resolution,
      assembly: d.assembly,
      cell_line: d.cell_line,
      cell_demo: d.cell_line,
      source: isMulticell ? `multicell_example:${d.demo}` : `builtin:${d.cell_line}`,
    }
    // Persist the refreshed tokens. Without this the next reload restores the dead
    // ones from localStorage and every session repeats the recovery round-trip.
    recovery.state = 'idle'
    recovery.message = ''
    try { localStorage.setItem('creditad_fvo', JSON.stringify(store.file_view_obj)) } catch {}
  } catch (e) {
    // Backend unreachable / request aborted. This is terminal until the user acts:
    // leaving it in 'recovering' is what made a dead backend look like a slow one.
    failRecovery(`Session expired and the backend could not be reached (${String(e && e.message || e)}).`)
  }
  finally {
    if (recovery.state === 'recovering') {
      // Should not happen; never leave the spinner as the final state.
      failRecovery('Session recovery ended in an unknown state. Retry, or re-import your files.')
    }
    setTimeout(() => { _recovering = false }, 1500)
  }
}

// Switching session token → wipe shared viewport + chrom so sizes don't leak across loads.
watch(() => tierToken.value, () => {
  sharedVp.bpPerPx = 0
  sharedVp.centerBp = 0
  sharedVp.sourceId = 'cell-switch'
  selectedChr.value = ''
  // Invalidate any tier request still in flight for the previous dataset.
  tadvciSeq += 1
  tadvciLoading.value = false
  tadvciBoundaries.value = []
})

// The evidence extent, from the primary caller BED. This runs for EVERY session, not just
// the BED-only path: with a chr7-only demo matrix it is the only source that knows the
// package annotates 23 chromosomes.
async function loadChromsFromBeds() {
  const beds = store.file_view_obj?.bed_tokens || []
  if (!beds.length) return
  try {
    const r = await fetch(`${apiBase}/bed/global-info/${beds[0].token}`)
    if (!r.ok) return
    const g = await r.json()
    const list = (g.chromosomes || []).map(c => {
      if (typeof c === 'string') return { name: c.replace(/^chr/i, ''), length: 0 }
      return { name: String(c.name || '').replace(/^chr/i, ''), length: c.length || c.end || 0, offset: c.offset || 0 }
    }).filter(c => c.name)
    if (!list.length) return
    evidenceChroms.value = list
    const picked = mergeChroms()
    if (picked) fetchTadvci(selectedChr.value)
    // Without a matrix there is no HiCViewer to seed the viewport, so do it here.
    // Seed a default viewport so BED tracks render without Hi-C. It has to frame
    // the chromosome onChromsLoaded actually selected — with a chromosome
    // whitelist that is not list[0], and a window sized from another
    // chromosome's length can start past the end of this one.
    if (!sharedVp.bpPerPx) {
      const active = list.find(c => c.name === selectedChr.value) || list[0]
      const L = active.length || 50_000_000
      sharedVp.centerBp = Math.floor(L / 2)
      sharedVp.bpPerPx = Math.max(1, Math.floor(L / trackContentWidthPx()))
      sharedVp.sourceId = 'bed-init'
    }
  } catch (_) { /* optional */ }
}

onMounted(() => { loadChromsFromBeds() })
watch(() => store.file_view_obj?.bed_tokens, () => { loadChromsFromBeds() }, { deep: true })

// Width (in pixels) of the actual track content area — same value the BED
// canvas uses so `viewRegion` and `goToRegionInput` agree on what fits on screen.
const TRACK_LABEL_WIDTH_PX = 200
function trackContentWidthPx() {
  if (trackPanelRef.value) {
    const w = trackPanelRef.value.clientWidth - TRACK_LABEL_WIDTH_PX
    if (w > 0) return w
  }
  return 800
}

const viewRegion = computed(() => {
  if (!sharedVp.bpPerPx || !sharedVp.centerBp) return null
  const canvasW = trackContentWidthPx()
  const halfSpan = sharedVp.bpPerPx * canvasW / 2
  const s = Math.max(0, Math.round(sharedVp.centerBp - halfSpan))
  const e = Math.round(sharedVp.centerBp + halfSpan)
  return { start: s.toLocaleString(), end: e.toLocaleString() }
})
/* One shared-viewport publication per animation frame.
   A drag emits `vp-change` on every mousemove, which can fire several times per frame on a
   high-rate pointer; each one woke every track's deep watcher, so a single frame could pay
   for two or three full re-renders of the tier track, the six caller canvases and the
   bigWig rows. Coalescing to the last payload in the frame draws exactly the same thing —
   the intermediate positions were never going to reach the screen — and takes the
   genome-wide drag from p90 33 ms back to one frame. `sourceId` is preserved so a track
   still ignores its own echo. */
let vpPending = null
let vpFrame = 0
function flushVp() {
  vpFrame = 0
  if (!vpPending) return
  sharedVp.bpPerPx  = vpPending.bpPerPx
  sharedVp.centerBp = vpPending.centerBp
  sharedVp.sourceId = vpPending.sourceId
  vpPending = null
}
/** Length of the chromosome currently on screen, or 0 if not known yet. */
function currentChromLen() {
  const c = (availableChroms.value || []).find(x => String(x.name) === String(selectedChr.value))
  return Number(c?.length) || 0
}

/* A viewport published by ONE track is adopted by every other track, so a single bad
   payload destroys the whole browser. That happened: a caller track that mounted before
   the panel had laid out had canvas.width == 1 and published
   bpPerPx = chromosomeLength / 1, collapsing every row into one vertical bar. The track
   no longer seeds from a degenerate canvas, and this is the second line of defence —
   nothing may set the shared viewport to a scale the chromosome cannot support. */
function plausibleVp(p) {
  if (!p || !(Number(p.bpPerPx) > 0) || !Number.isFinite(Number(p.centerBp))) return false
  const len = currentChromLen()
  if (!len) return true                       // no chromosome metadata yet — cannot judge
  // Widest sensible view is the whole chromosome across the panel, with slack for
  // over-zoom-out; tightest is well below one base per pixel.
  const widest = (len / 200) // 200 px would already be an absurdly narrow panel
  return Number(p.bpPerPx) <= widest && Number(p.bpPerPx) >= 1e-3
}

function onVpChange(payload) {
  if (!plausibleVp(payload)) {
    console.warn('[viewport] ignored an implausible viewport from', payload?.sourceId,
                 'bpPerPx=', payload?.bpPerPx)
    return
  }
  vpPending = payload
  // chr-reset is a control signal, not a pan: apply it immediately so a chromosome switch
  // cannot be swallowed by a coalesced frame.
  if (payload.sourceId === 'chr-reset') { flushVp(); return }
  if (!vpFrame) vpFrame = requestAnimationFrame(flushVp)
}
onBeforeUnmount(() => { if (vpFrame) cancelAnimationFrame(vpFrame) })

function goToRegionInput() {
  regionError.value = ''
  const rawInput = regionInput.value.trim()
  if (!rawInput) { regionError.value = 'Enter a region, e.g. 50,000,000-51,000,000'; return }
  // strip a leading chrN: prefix + thousands separators, then require start-end
  const raw = rawInput.replace(/^chr\w+\s*:\s*/i, '').replace(/,/g, '').trim()
  const match = raw.match(/^(\d+)\s*[-]\s*(\d+)$/)
  if (!match) {
    regionError.value = 'Use start-end coordinates, e.g. 50,000,000-51,000,000 (or chr7:50,000,000-51,000,000)'
    return
  }
  const start = parseInt(match[1])
  const end = parseInt(match[2])
  if (isNaN(start) || isNaN(end)) { regionError.value = 'Invalid numbers in region'; return }
  if (end <= start) { regionError.value = 'End must be greater than start'; return }
  // Past the end of the chromosome the browser just goes blank, which in this
  // tool reads as "no evidence here" rather than "you are outside the sequence".
  const chromLen = Number(availableChroms.value.find(c => c.name === selectedChr.value)?.length) || 0
  if (chromLen > 0 && end > chromLen) {
    regionError.value = `chr${selectedChr.value} is ${chromLen.toLocaleString()} bp — `
      + `enter a region inside 0–${chromLen.toLocaleString()}`
    return
  }
  const centerBp = (start + end) / 2
  const span = end - start
  // Use the same canvas width that viewRegion uses to reverse-derive the range,
  // so the displayed window matches the requested span exactly.
  const canvasW = trackContentWidthPx()
  const bpPerPx = span / canvasW
  sharedVp.bpPerPx = bpPerPx
  sharedVp.centerBp = centerBp
  sharedVp.sourceId = 'nav-input'
}

/* ── 格式化 ── */
function formatBp(val) {
  if (!val && val !== 0) return '—'
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)} Mb`
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)} kb`
  return `${Math.round(val)} bp`
}

</script>

<style scoped>
.visualization-container {
  display: flex; flex-direction: column;
  /* 52 px is the app header; without subtracting it the tier track fell off the
     bottom of the window. */
  background: var(--bg-main); height: calc(100vh - 52px); overflow: hidden;
  color: var(--text-primary);
}

/* Instrument bar: paper, not a dark slab. Because it is now a themed surface,
   the notices below can use the theme tokens instead of the hand-measured
   colours the old fixed #2c3e50 bar forced on them. */
.controls {
  display: flex; align-items: center; gap: var(--s5);
  padding: 0 var(--s5); height: 46px; flex-shrink: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}
.control-group { display: flex; align-items: center; gap: var(--s2); }
.ctl-label {
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: var(--track-caps);
  text-transform: uppercase;
  color: var(--text-muted);
}
.region-input { width: 210px; font-family: var(--font-mono); }

.recovery-notice {
  display: flex; align-items: center; gap: var(--s2);
  font-size: var(--fs-xs); border-radius: var(--r-sm); padding: 3px 9px; white-space: nowrap;
}
.recovery-notice.is-busy {
  color: var(--warning-text);
  background: var(--bg-secondary);
  border: 1px solid var(--border-hover);
}
.recovery-notice.is-failed {
  color: var(--danger-text);
  background: var(--bg-secondary);
  border: 1px solid var(--danger);
  white-space: normal; max-width: 640px;
}
.recovery-btn {
  flex-shrink: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-xs); font-weight: 500; padding: 2px 9px; border-radius: var(--r-xs);
  background: var(--bg-card); color: var(--text-primary);
  border: 1px solid var(--border-hover); cursor: pointer;
}
.recovery-btn:hover { border-color: var(--primary); }

.region-error {
  color: var(--danger-text); font-size: var(--fs-xs);
  padding: 2px 8px; border-radius: var(--r-xs);
  background: var(--bg-secondary); border: 1px solid var(--danger);
}
.nav-btn { flex-shrink: 0; }
.viewport-info { display: flex; gap: 6px; margin-left: auto; }
/* The coordinate window is the single most-read value on this page. */
.info-chip {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--rule);
  padding: 3px 9px; border-radius: var(--r-xs);
}
.info-tag {
  font-family: var(--font-mono);
  font-size: var(--fs-micro); color: var(--text-muted);
  padding: 3px 0;
}

/* track + 侧栏并排 */
.body-row { display: flex; flex: 1; min-height: 0; overflow: hidden; }

.track-panel {
  flex: 1; background: var(--bg-card); border: none;
  border-right: 1px solid var(--border);
  overflow-y: auto; overflow-x: hidden;
  display: flex; flex-direction: column;
  position: relative;
  transition: background .2s, border-color .2s;
}
.track-row { display: flex; border-bottom: 1px solid var(--border); }
.track-row:last-child { border-bottom: none; }

.scope-notice {
  display: flex;
  align-items: center;
  gap: var(--s4);
  padding: 10px var(--s5);
  border-bottom: 1px solid var(--border);
  border-left: 2px solid var(--amber);
  background: var(--amber-tint);
}
.sn-main { flex: 1; font-size: var(--fs-xs); line-height: 1.5; color: var(--text-secondary); }

/* GEOMETRY IS LOAD-BEARING: the 200 px label column is mirrored by
   TRACK_LABEL_WIDTH_PX in this file and drives every bp→px mapping and the
   guide line. Type and colour only below. */
.track-label {
  width: 200px; flex-shrink: 0; padding: 12px 14px;
  background: var(--bg-secondary); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; justify-content: center; gap: 7px;
}
.track-name {
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.3;
  color: var(--text-primary);
}
/* Neutral badge; the track's own colour rides along as a swatch so it still
   works as a legend without becoming a coloured label. */
.track-badge { width: fit-content; gap: 5px; text-transform: none; }
.hic-mount { height: 100%; }
.no-matrix-notice {
  display: flex; align-items: center; height: 100%; min-height: 96px;
  padding: 12px 16px; font-size: var(--fs-sm); line-height: 1.5;
  color: var(--text-secondary); background: var(--bg-secondary);
}
.swatch {
  width: 8px; height: 8px; border-radius: 2px; display: block; flex: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12) inset;
}
.swatch-ramp { width: 22px; }

/* BD1 vote provenance, shown on each caller track while a boundary is selected. */
.vote-badge {
  width: fit-content; max-width: 100%; text-transform: none; margin-top: 3px;
  font-family: var(--font-mono); font-size: var(--fs-micro);
  border: 1px solid var(--rule-strong); border-radius: var(--r-xs); padding: 1px 5px;
  /* `.badge` is a fixed 19 px tall. Without these a long caller name or offset wrapped
     and the overflow printed outside the badge, across the row below it. */
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;
  line-height: 17px; box-sizing: border-box;
}
.vb-exact { color: var(--success-text); border-color: rgba(47,125,87,.55); }
.vb-yes   { color: var(--caution-text); border-color: rgba(154,78,20,.55); }
.vb-no    { color: var(--text-muted); border-style: dashed; }
/* Nothing selected: holds the row height without drawing attention. */
.vb-idle  { color: var(--ink-faint); border-color: transparent; }

.track-content     { flex: 1; min-height: 48px; position: relative; overflow: visible; background: var(--bg-card); }
/* The contact map keeps its white zero-contact base in both themes (the colormap
   defines what white means), so on the dark theme it is framed rather than left
   as a bare slab. */
.heatmap-container { min-height: 400px; }
.dark .heatmap-container { box-shadow: inset 0 0 0 1px var(--rule-strong); }

.guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(var(--primary-rgb), 0.45);
  pointer-events: none;
  z-index: 50;
}
.empty-state { padding: var(--s8) var(--s5); text-align: center; color: var(--text-muted); font-size: var(--fs-sm); }

/* The tier track went blank for about a second on every chromosome change with
   nothing to say why, which is indistinguishable from "no evidence here". */
.tier-loading {
  position: absolute; top: 12px; left: 12px; z-index: 10;
  font-size: var(--fs-xs); color: var(--text-muted);
}

/* Scoped override of the global .input so the two controls in the bar sit at the
   same 28 px height as the Go button. */
.controls .input {
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border-hover);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  outline: none;
  font-size: var(--fs-xs);
  color: var(--text-primary);
}
.controls .input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.09);
}

</style>
