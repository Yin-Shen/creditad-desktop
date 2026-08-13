<template>
  <div class="vci-evidence">
    <div class="ve-header">
      <span class="ve-title">Evidence card for the selected boundary</span>
    </div>
    <div v-if="!boundary" class="ve-empty" data-testid="ve-empty">
      Click a tick on the <b>Evidence tier</b> track to inspect graded support and optionally record a local review.
    </div>
    <div v-else class="ve-body">
      <div class="ve-bid-row">
        <span class="ve-bid" data-testid="ev-bid">{{ boundary.boundary_id }}</span>
        <span class="tier-badge" data-testid="ev-auto-tier"
              :style="{ background: tierColor(boundary.auto_tier), color: tierTextColor(boundary.auto_tier) }">{{ boundary.auto_tier }}</span>
      </div>
      <div v-if="boundary.user_bed" class="ve-byo" data-testid="ev-userbed">
        <i class="fas fa-upload"></i> your uploaded boundary — same evidence grading as demos
      </div>
      <div v-if="boundary._cardLoading" class="ve-loading" data-testid="ev-card-loading" role="status">
        loading evidence for this boundary…
      </div>
      <div v-else-if="boundary._cardError" class="ve-err" data-testid="ev-card-error" role="alert">
        <i class="fas fa-circle-xmark" aria-hidden="true"></i>
        Could not load the evidence for this boundary ({{ boundary._cardError }}). The tier
        shown above comes from the track; the graded criteria are not displayed rather than
        shown stale.
      </div>
      <div class="ve-rulebox" data-testid="ev-tier-why">
        <div class="ve-rule-title">Why this tier ({{ boundary.tier_rule || 'max_support_v2' }})</div>
        <div class="ve-rule-body">{{ boundary.tier_why || '—' }}</div>
        <div v-if="bd1VotesLine" class="ve-rule-bd1" data-testid="ev-bd1-votes">{{ bd1VotesLine }}</div>
        <div v-if="boundary.supporting_callers" class="ve-rule-callers" data-testid="ev-callers">
          callers: {{ boundary.supporting_callers }}
        </div>
        <div class="ve-rule-note">
          Tier = evidence support, not accuracy or ground truth. Raising BD2–BD4 never lowers the tier; missing assays stay <b>not_assessable</b>.
        </div>
      </div>
      <div v-if="boundary.bands_disclosure" class="ve-bandwarn" data-testid="ev-bandwarn">
        <i class="fas fa-triangle-exclamation"></i> {{ boundary.bands_disclosure }}
      </div>
      <div class="ve-assessed" data-testid="ev-assessed-row">
        <span
          v-for="code in BD_CODES"
          :key="code"
          class="ass-chip"
          :class="isAssessed(code) ? 'ass-yes' : 'ass-no'"
          :data-testid="'ass-'+code"
          :title="isAssessed(code) ? (boundary.criteria?.[code]?.grade || 'assessed') : ('not assessable — needs ' + (boundary.criteria?.[code]?.requires || code))"
        >{{ code }} · {{ isAssessed(code) ? (boundary.criteria?.[code]?.grade || 'ok') : 'n/a' }}</span>
      </div>
      <table class="ve-crit">
        <tbody>
          <template v-for="(c,code) in boundary.criteria" :key="code">
          <tr :data-testid="'crit-'+code">
            <td class="cc"><b>{{ code }}</b><span class="cls" :class="'cls-'+c.role" :title="c.availability+' · '+c.grading">{{ c.role }}</span></td>
            <td class="cn">{{ c.name }}
              <span v-if="code === 'BD1' && boundary.votes != null" class="cins"
                    title="number of method BEDs with a call inside the position-matching tolerance">· {{ boundary.votes }}{{ boundary.n_methods != null ? '/' + boundary.n_methods : '' }} vote{{ boundary.votes === 1 ? '' : 's' }}</span>
              <span v-if="code === 'BD1' && c.insulation_strength != null" class="cins"
                    title="insulation boundary-strength from the Hi-C map (continuous companion to the vote count)">· insulation {{ c.insulation_strength }}</span>
              <span v-if="c.grade === 'not_assessable'" class="cneed">needs {{ c.requires }}</span>
            </td>
            <td class="cg" :data-testid="'grade-'+code">
              <span class="gpill" :class="'g-'+c.grade" :title="gradeTitle(code, c)">
                <span class="gdots" aria-hidden="true">{{ gradeDots(c.grade) }}</span>{{ c.grade }}
              </span>
            </td>
          </tr>
          <!-- What was actually measured. A grade word on its own is not inspectable:
               the same word covers a fold that beats 99% of random windows and one that
               barely clears the cut. -->
          <tr v-if="chipMeasure(c)" class="mrow" :data-testid="'measured-'+code">
            <td></td>
            <td colspan="2" class="mcell">
              <div class="mnum">
                <b>fold {{ chipMeasure(c).fold.toFixed(3) }}</b>
                <span class="msub">= mean over ±{{ (chipMeasure(c).window_bp/2000).toFixed(0) }} kb ÷ background {{ fmtBg(chipMeasure(c).background_mean) }}</span>
              </div>
              <svg class="mscale" :viewBox="'0 0 220 26'" preserveAspectRatio="none" role="img"
                   :aria-label="scaleLabel(c)">
                <line x1="0" :y1="16" x2="220" :y2="16" class="max" />
                <g v-for="t in scaleTicks(c)" :key="t.key">
                  <line :x1="t.x" y1="9" :x2="t.x" y2="20" :class="'mtick mtick-'+t.key" />
                  <text :x="t.x" y="26" class="mlab" text-anchor="middle">{{ t.label }}</text>
                </g>
                <circle :cx="scaleMark(c)" cy="16" r="3.6" class="mdot" :class="'mdot-'+c.grade" />
              </svg>
              <div class="mpct" v-if="chipMeasure(c).null_percentile != null">
                rank in this cell's random ±25 kb windows:
                <b>p{{ chipMeasure(c).null_percentile.toFixed(1) }}</b>
                — {{ chipMeasure(c).random_windows_at_or_above.toFixed(1) }}% of random windows reach it
              </div>
              <div class="mcuts">
                cutpoints (percentiles of that null): weak {{ chipMeasure(c).cutpoints.weak }} ·
                moderate {{ chipMeasure(c).cutpoints.moderate }} · strong {{ chipMeasure(c).cutpoints.strong }}
              </div>
            </td>
          </tr>
          <!-- BD1: which caller supplied each vote, and from how far away. -->
          <tr v-if="code === 'BD1' && bd1Measure" class="mrow" data-testid="measured-BD1">
            <td></td>
            <td colspan="2" class="mcell">
              <div class="mnum" v-if="bd1Measure.vote_tol_bp != null">
                <b>match window ±{{ (bd1Measure.vote_tol_bp/1000).toFixed(0) }} kb</b>
                <span class="msub" v-if="bd1Measure.vote_tol_bins != null">= ±{{ bd1Measure.vote_tol_bins }} bin{{ bd1Measure.vote_tol_bins === 1 ? '' : 's' }}</span>
              </div>
              <table class="msup" v-if="bd1Measure.supporters">
                <tr v-for="s in bd1Measure.supporters" :key="s.caller">
                  <td class="ms-name">{{ s.caller }}</td>
                  <td class="ms-off" :class="{ 'ms-exact': s.offset_bp === 0 }">
                    <template v-if="s.offset_bp == null">offset not recorded</template>
                    <template v-else-if="s.offset_bp === 0">at this position</template>
                    <template v-else>{{ s.offset_bp > 0 ? '+' : '' }}{{ s.offset_bp.toLocaleString() }} bp<span v-if="s.offset_bins != null"> ({{ s.offset_bins > 0 ? '+' : '' }}{{ s.offset_bins }} bin)</span></template>
                  </td>
                </tr>
              </table>
              <div class="mwarn" v-if="bd1Measure.n_supporters_at_this_position != null"
                   data-testid="bd1-exact-count">
                {{ bd1Measure.n_supporters_at_this_position }} of {{ (bd1Measure.supporters || []).length }}
                supporting caller{{ (bd1Measure.supporters || []).length === 1 ? '' : 's' }} called this exact position.
              </div>
              <div class="mcuts" v-if="boundary.bd1_match_rule">{{ boundary.bd1_match_rule }}</div>
            </td>
          </tr>
          <tr v-if="code === 'BD4' && c.measured" class="mrow" data-testid="measured-BD4">
            <td></td>
            <td colspan="2" class="mcell">
              <div class="mnum">
                <b>{{ c.measured.loop_anchor_count }} loop anchor{{ c.measured.loop_anchor_count === 1 ? '' : 's' }}</b>
                <span class="msub">within ±{{ (c.measured.window_bp/1000).toFixed(0) }} kb</span>
              </div>
              <div class="mcuts">cutpoints: ≥2 strong · 1 moderate · 0 none</div>
            </td>
          </tr>
          </template>
        </tbody>
      </table>

      <div class="ve-signout">
        <div class="so-title">Review decision</div>
        <label>actor label (local, not authenticated)</label>
        <input v-model="form.actorLabel" class="inp" data-testid="actor-label"
               maxlength="200" placeholder="e.g. reviewer_1">
        <label>reviewed tier</label>
        <select v-model="form.tier" class="sel" data-testid="override-tier">
          <option v-for="t in TIERS" :key="t" :value="t">{{ t }}</option>
        </select>
        <label>verdict</label>
        <select v-model="form.verdict" class="sel" data-testid="verdict">
          <option value="supported_for_review">supported for this review</option>
          <option value="not_supported_for_review">not supported for this review</option>
          <option value="uncertain">uncertain</option>
        </select>
        <label>rationale (required)</label>
        <textarea v-model="form.rationale" class="ta" data-testid="rationale"
          placeholder="why you retain or change this evidence tier"></textarea>
        <button class="so-btn" :disabled="busy || !recordContextReady" data-testid="signout-btn" @click="signout">
          {{ busy ? 'Recording…' : 'Record decision' }}
        </button>
        <div class="ve-err" v-if="!recordContextReady" data-testid="record-context-error">
          Review recording unavailable: load a dataset with assembly, cell, resolution and source metadata.
        </div>
        <div class="ve-err" v-if="err" data-testid="signout-error" role="alert">
          <i class="fas fa-circle-xmark" aria-hidden="true"></i> {{ err }}
        </div>
        <div class="ve-ok" v-if="result" data-testid="signout-result">
          <i class="fas fa-circle-check" aria-hidden="true"></i> recorded · record schema
          <b data-testid="snap-version">{{ result.snapshot.version }}</b>
          · <b data-testid="snap-final">{{ result.snapshot.final_tier }}</b>
          · record-field checksum matches <b data-testid="snap-verified">{{ result.checksum_matches }}</b><br>
          <code data-testid="snap-hash">{{ result.snapshot.content_hash }}</code>
        </div>
      </div>

      <div class="ve-hist" v-if="history.length" data-testid="history">
        <div class="hist-title" data-testid="history-title">
          history ({{ history.length }})
          <span v-if="historyScope" class="hist-scope" data-testid="history-scope">{{ historyScope }}</span>
          <span v-else class="hist-scope" data-testid="history-scope-none">all scopes</span>
        </div>
        <div v-for="h in history" :key="h.version" class="hist-row">
          v{{ h.version }} · {{ h.final_tier }} · <span class="hc">{{ h.actor_label || 'unlabelled' }}</span>
          <div class="hr" v-if="h.review_decision">“{{ h.review_decision.rationale }}”</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { tierColor } from '../constants/tierColors'
import { bindReviewRecordSource } from '../utils/reviewExport'

// Tier badge text colour, measured against the shared ramp: only D5 (#1d4ed8) is dark
// enough for white type. D4 (#3b82f6) gives 3.68:1 with white and 5.16:1 with the dark
// ink, so it takes the dark one along with D3..D1.
function tierTextColor(tier) {
  return tier === 'D5' ? '#ffffff' : '#0c1116'
}

const props = defineProps({
  boundary: { type: Object, default: null },
  apiBase:  { type: String, default: (window.electronAPI ? 'http://127.0.0.1:5001/api' : '/api') },
  // context metadata written into the versioned application record
  resolution: { type: [Number, String], default: null },
  cellLine:   { type: String, default: null },
  assembly:   { type: String, default: null },
  source:     { type: String, default: null },
  token:      { type: String, default: null },
})
const emit = defineEmits(['recorded'])

const TIERS = ['D5', 'D4', 'D3', 'D2', 'D1']
const BD_CODES = ['BD1', 'BD2', 'BD3', 'BD4']
const form = reactive({ tier: 'D3', verdict: 'supported_for_review', rationale: '', actorLabel: 'local_user' })
const busy = ref(false); const err = ref(''); const result = ref(null)
const history = ref([])
const recordContextReady = computed(() => (
  Boolean(props.assembly?.trim()) &&
  Boolean(props.cellLine?.trim()) &&
  Number.isInteger(Number(props.resolution)) &&
  Number(props.resolution) > 0 &&
  Boolean(props.source?.trim())
))
function isAssessed(code) {
  const g = props.boundary?.criteria?.[code]?.grade
  if (g && g !== 'not_assessable') return true
  const list = props.boundary?.assessed
  return Array.isArray(list) && list.includes(code)
}
/* ── What was measured, shown next to the grade ──────────────────────────────
   A grade word is not inspectable on its own. `weak` spans everything from the
   p75 to the p90 of the cell's random-window null, and before 2026-07-29 it
   started at the null's MEDIAN — a value half of random genomic windows reach.
   The card now carries the observed fold, what it was divided by, the cutpoints
   and where the value sits in that null, so the reader can check the grade
   instead of trusting it. */
const GRADE_DOTS = { strong: '●●●', moderate: '●●○', weak: '●○○', none: '○○○', not_assessable: '—' }
function gradeDots(g) { return GRADE_DOTS[g] || '' }
function gradeTitle(code, c) {
  if (c.grade === 'not_assessable') return 'not assessable — needs ' + (c.requires || code)
  return c.grading || c.grade
}
/** BD2/BD3 measurement block, or null for criteria without a fold. */
function chipMeasure(c) {
  const m = c && c.measured
  if (!m || typeof m.fold !== 'number' || !m.cutpoints) return null
  return m
}
const bd1Measure = computed(() => props.boundary?.criteria?.BD1?.measured || null)

function fmtBg(v) { return v == null ? 'n/a' : Number(v).toFixed(4) }

/* Linear fold axis from 0 to just past the strong cut (or past the observed
   value when it overshoots), so the distance between the measurement and each
   cutpoint is a real distance on screen rather than a word. */
function scaleMax(c) {
  const m = chipMeasure(c)
  return Math.max(m.cutpoints.strong * 1.12, m.fold * 1.08, 0.01)
}
function scaleX(c, v) { return Math.max(0, Math.min(220, (v / scaleMax(c)) * 220)) }
function scaleTicks(c) {
  const m = chipMeasure(c)
  return ['weak', 'moderate', 'strong']
    .filter(k => m.cutpoints[k] != null)
    .map(k => ({ key: k, x: scaleX(c, m.cutpoints[k]), label: m.cutpoints[k].toFixed(2) }))
}
function scaleMark(c) { return scaleX(c, chipMeasure(c).fold) }
function scaleLabel(c) {
  const m = chipMeasure(c)
  return `observed fold ${m.fold.toFixed(3)}; cutpoints weak ${m.cutpoints.weak}, moderate ${m.cutpoints.moderate}, strong ${m.cutpoints.strong}`
}

const bd1VotesLine = computed(() => {
  const b = props.boundary
  if (!b || b.votes == null) return ''
  const n = b.n_methods != null ? b.n_methods : '?'
  const mod = b.bd1_moderate_at != null ? b.bd1_moderate_at : '⌈0.6n⌉'
  const str = b.bd1_strong_at != null ? b.bd1_strong_at : '⌈0.8n⌉'
  const grade = b.criteria?.BD1?.grade || '?'
  return `BD1: ${b.votes}/${n} methods → ${grade}  (moderate≥${mod}, strong≥${str})`
})

watch(() => props.boundary && props.boundary.boundary_id, async () => {
  err.value = ''; result.value = null
  if (!props.boundary) { history.value = []; return }
  // Never seed a required select with a value it cannot hold: an annotation TSV
  // without a D_tier column (possible on a BYO import) left the control with no
  // selection while the record button stayed live, so the only thing standing
  // between that and a bad record was the backend's 422.
  form.tier = TIERS.includes(props.boundary.auto_tier) ? props.boundary.auto_tier : 'D3'
  form.verdict = 'supported_for_review'; form.rationale = ''
  await loadHistory()
})

// A boundary id is only "chrom:pos" — GM12878 hg38 10 kb and K562 hg38 25 kb both
// produce e.g. "1:46200000". Asking the log for that bare id returns EVERY cell line's
// decision for that coordinate, so a reviewer inspecting K562 would see a colleague's
// GM12878 verdict as if it were about the boundary in front of them. Qualify the lookup
// with the dataset context; the backend (tad_vci.curation.load_history) parses the
// "@cell/assembly/resolution" suffix and filters the log to that scope.
const historyScope = computed(() => {
  const cell = (props.cellLine || '').trim()
  const asm = (props.assembly || '').trim()
  const res = Number(props.resolution)
  if (!cell || !asm || !Number.isInteger(res) || res <= 0) return ''
  return `${cell}/${asm}/${res}`
})

async function loadHistory() {
  const selector = props.boundary.boundary_id + (historyScope.value ? `@${historyScope.value}` : '')
  try {
    const r = await fetch(`${props.apiBase}/tadvci/history/${encodeURIComponent(selector)}`)
    history.value = (await r.json()).history || []
  } catch { history.value = [] }
}

async function signout() {
  if (busy.value || !props.boundary || !recordContextReady.value) return
  if (!form.rationale.trim()) {
    // The backend rejects an empty rationale with 422; saying so here saves a
    // round trip that could only ever fail.
    err.value = 'A rationale is required before a decision can be recorded.'
    result.value = null
    return
  }
  busy.value = true; err.value = ''; result.value = null
  try {
    const r = await fetch(`${props.apiBase}/tadvci/signout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boundary_id: props.boundary.boundary_id, final_tier: form.tier,
                             verdict: form.verdict, rationale: form.rationale, actor_label: form.actorLabel,
                             resolution: props.resolution, cell_line: props.cellLine,
                             assembly: props.assembly, token: props.token })
    })
    const j = await r.json()
    if (!r.ok) { err.value = j.error || 'recording failed'; return }
    result.value = j
    if (!bindReviewRecordSource(j.snapshot?.content_hash, props.source)) {
      err.value = 'Review recorded, but its local source binding could not be saved; export remains unavailable.'
    }
    await loadHistory()
    emit('recorded', j)
  } catch (e) { err.value = String(e) }
  finally { busy.value = false }
}
</script>

<style scoped>
/* The evidence card is the deliverable of this whole tool, so it is set like a
   record: hairline rules, one column, coordinates and grades in the data face,
   and no colour except the tier ramp and the four grade words. */
.vci-evidence { width: 320px; flex-shrink: 0; background: var(--bg-card);
  display: flex; flex-direction: column; overflow-y: auto; max-height: 100%; }
.ve-header {
  position: sticky; top: 0; z-index: 2;
  padding: 0 var(--s4); height: 46px; display: flex; align-items: center;
  background: var(--bg-card); border-bottom: 1px solid var(--border);
}
.ve-title { font-family: var(--font-display); font-size: var(--fs-base); font-weight: 600; color: var(--text-primary); }
.ve-empty { color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.6; padding: var(--s5) var(--s4); }
.ve-body { padding: var(--s4); }

.ve-bid-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s2);
  padding-bottom: var(--s3); border-bottom: 1px solid var(--rule-strong); }
.ve-bid { font-family: var(--font-mono); font-size: var(--fs-base); font-weight: 500;
  font-variant-numeric: tabular-nums; color: var(--text-primary); word-break: break-all; }
/* Background + text colour are bound inline from the shared TIER_COLORS ramp
   (../constants/tierColors.js) so a D-tier badge matches the tier track exactly. */
.tier-badge { flex: none; padding: 3px 10px; border-radius: var(--r-xs);
  font-family: var(--font-mono); font-weight: 500; font-size: var(--fs-sm); letter-spacing: 0.04em; }

.ve-crit { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); margin-top: var(--s3); }
.ve-crit td { padding: 7px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
.ve-crit tr:last-child td { border-bottom: none; }
.cc { width: 58px; }
.cc b { font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 500;
  letter-spacing: 0.05em; color: var(--text-primary); }
.cn { color: var(--text-secondary); line-height: 1.4; }
.cneed { display: block; font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.cins { font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-muted);
  margin-left: 4px; white-space: nowrap; }
.cls { display: block; margin-top: 2px; font-family: var(--font-mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.cg { font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 500;
  text-align: right; white-space: nowrap; }
/* Grade chips carry an ordinal dot glyph as well as colour. Colour alone put
   "weak" (dark orange-brown) and "none" (grey) at nearly the same visual weight,
   so a reader scanning the card could not tell a graded positive from a graded
   negative — the exact confusion the v1 weak band already invited. */
.gpill { display: inline-flex; align-items: baseline; gap: 5px;
  padding: 2px 7px; border-radius: var(--r-xs); border: 1px solid transparent; }
.gdots { font-size: 9px; letter-spacing: 0.5px; opacity: 0.85; }
.g-strong { color: var(--success-text); background: rgba(47,125,87,.13); border-color: rgba(47,125,87,.42); }
.g-moderate { color: var(--warning-text); background: rgba(184,121,31,.13); border-color: rgba(184,121,31,.40); }
.g-weak { color: var(--caution-text); background: transparent; border-color: rgba(154,78,20,.55); }
.g-none { color: var(--text-muted); background: transparent; border-style: dashed; border-color: var(--rule-strong); }
.g-not_assessable { color: var(--ink-faint); background: transparent; border: 0; font-style: italic; }

/* Measurement rows: the numbers behind the grade. */
.mrow td { border-bottom: 1px solid var(--rule); padding-top: 0; }
.mcell { padding-bottom: 9px !important; }
.mnum { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-primary); }
.mnum .msub { color: var(--text-muted); font-size: var(--fs-micro); margin-left: 5px; }
.mscale { display: block; width: 100%; height: 26px; margin: 5px 0 3px; overflow: visible; }
.mscale .max { stroke: var(--rule-strong); stroke-width: 1; }
.mscale .mtick { stroke-width: 1.2; }
.mscale .mtick-weak { stroke: var(--caution-text); }
.mscale .mtick-moderate { stroke: var(--warning-text); }
.mscale .mtick-strong { stroke: var(--success-text); }
.mscale .mlab { font-family: var(--font-mono); font-size: 8.5px; fill: var(--text-muted); }
.mscale .mdot { fill: var(--text-muted); stroke: var(--bg-card); stroke-width: 1.2; }
.mscale .mdot-strong { fill: var(--success-text); }
.mscale .mdot-moderate { fill: var(--warning-text); }
.mscale .mdot-weak { fill: var(--caution-text); }
.mpct, .mcuts { font-size: var(--fs-micro); color: var(--text-muted); line-height: 1.45; margin-top: 3px; }
.mpct b { color: var(--text-primary); font-family: var(--font-mono); }
.msup { width: 100%; border-collapse: collapse; margin: 4px 0 2px; }
.msup td { border: 0; padding: 1px 0; font-family: var(--font-mono); font-size: var(--fs-micro); }
.ms-name { color: var(--text-secondary); }
.ms-off { text-align: right; color: var(--caution-text); white-space: nowrap; }
.ms-off.ms-exact { color: var(--success-text); }
.mwarn { font-size: var(--fs-micro); color: var(--text-secondary); margin-top: 3px; line-height: 1.45; }

.ve-loading {
  margin: var(--s3) 0 0; padding: 7px 9px;
  border: 1px dashed var(--rule-strong); border-radius: var(--r-sm);
  font-size: var(--fs-xs); color: var(--text-muted);
}
.ve-byo, .ve-bandwarn {
  display: flex; align-items: baseline; gap: 6px;
  margin: var(--s3) 0 0; padding: 7px 9px;
  border: 1px solid var(--rule-strong); border-radius: var(--r-sm);
  background: var(--bg-secondary);
  font-size: var(--fs-xs); line-height: 1.45;
}
.ve-byo { color: var(--text-secondary); }
.ve-bandwarn { color: var(--warning-text); border-color: var(--warning); }
.ve-byo i, .ve-bandwarn i { flex: none; }

/* Why this tier — the inspectable derivation. */
.ve-rulebox {
  margin: var(--s4) 0 0; padding: var(--s3);
  border: 1px solid var(--rule); border-radius: var(--r-sm);
  background: var(--bg-secondary);
  font-size: var(--fs-xs); line-height: 1.5; color: var(--text-secondary);
}
.ve-rule-title { font-family: var(--font-mono); font-size: var(--fs-micro); font-weight: 500;
  text-transform: uppercase; letter-spacing: var(--track-caps);
  color: var(--text-muted); margin-bottom: 5px; }
.ve-rule-body { color: var(--text-primary); font-size: var(--fs-sm); line-height: 1.45; margin-bottom: 6px; }
.ve-rule-bd1 { font-family: var(--font-mono); font-size: var(--fs-micro);
  color: var(--text-primary); margin-bottom: 3px; }
.ve-rule-callers { font-family: var(--font-mono); font-size: var(--fs-micro);
  color: var(--text-muted); word-break: break-all; }
.ve-rule-note { margin-top: 7px; padding-top: 6px; border-top: 1px solid var(--rule);
  font-size: var(--fs-micro); color: var(--text-muted); }

.ve-assessed { display: flex; flex-wrap: wrap; gap: 5px; margin: var(--s3) 0 0; }
.ass-chip { font-family: var(--font-mono); font-size: var(--fs-micro); padding: 2px 7px;
  border-radius: var(--r-xs); letter-spacing: 0.02em; }
.ass-yes { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--rule-strong); }
.ass-no { background: transparent; color: var(--text-muted); border: 1px dashed var(--rule-strong); }

.ve-signout { margin-top: var(--s5); border-top: 1px solid var(--rule-strong); padding-top: var(--s4); }
.so-title { font-family: var(--font-display); font-size: var(--fs-base); font-weight: 600;
  margin-bottom: var(--s1); color: var(--text-primary); }
.ve-signout label { display: block; font-size: var(--fs-xs); color: var(--text-muted); margin: var(--s3) 0 3px; }
.sel, .ta, .inp { width: 100%; padding: 6px 9px; border: 1px solid var(--border-hover); border-radius: var(--r-sm);
  background: var(--bg-card); color: var(--text-primary);
  font-family: var(--font-sans); font-size: var(--fs-sm); line-height: 1.4; box-sizing: border-box; outline: none; }
.sel:focus, .ta:focus, .inp:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.09); }
.ta { min-height: 62px; resize: vertical; }
.so-btn { margin-top: var(--s4); width: 100%; height: 32px;
  background: var(--primary); color: var(--on-ink); border: 0; border-radius: var(--r-sm);
  font-family: var(--font-sans); font-size: var(--fs-sm); font-weight: 500; cursor: pointer; }
.so-btn:hover:not(:disabled) { background: var(--primary-hover); }
.so-btn:disabled { opacity: .4; cursor: default; }

.ve-err { color: var(--danger-text); font-size: var(--fs-xs); margin-top: var(--s2); line-height: 1.45; }
.ve-ok { margin-top: var(--s3); background: var(--bg-secondary); border: 1px solid var(--rule-strong);
  border-left: 2px solid var(--success); border-radius: var(--r-sm);
  padding: 9px 10px; font-size: var(--fs-xs); line-height: 1.55; color: var(--text-secondary); }
.ve-ok code { font-size: var(--fs-micro); color: var(--text-primary); word-break: break-all; }

.ve-hist { margin-top: var(--s5); border-top: 1px solid var(--rule-strong); padding-top: var(--s3); }
.hist-title { font-family: var(--font-mono); font-size: var(--fs-micro); color: var(--text-muted);
  text-transform: uppercase; letter-spacing: var(--track-caps); margin-bottom: var(--s2); }
.hist-scope { text-transform: none; letter-spacing: 0; margin-left: 4px; }
.hist-row { font-family: var(--font-mono); font-size: var(--fs-micro); padding: 5px 0;
  border-bottom: 1px solid var(--rule); color: var(--text-primary); }
.hist-row:last-child { border-bottom: none; }
.hc { color: var(--text-secondary); }
.hr { font-family: var(--font-sans); font-size: var(--fs-xs); color: var(--text-secondary); margin-top: 2px; }
</style>
