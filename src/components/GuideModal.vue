<template>
  <div v-if="showGuideModal" class="modal-bg" @click.self="showGuideModal = false">
    <div
      class="modal guide"
      ref="guideRef"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      @keydown.esc.stop="showGuideModal = false"
      @keydown.tab="onTabKeydown"
    >
      <header class="guide-head">
        <span id="guide-title" class="guide-title">Help</span>
        <button type="button" class="btn btn-ghost btn-sm guide-close" @click="showGuideModal = false" aria-label="Close help">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </header>

      <div class="guide-body scrollbar">
        <section class="guide-sec">
          <div class="guide-sec-h">
            <span class="guide-n">1</span>
            <h3>What this tool grades — and what it does not claim</h3>
          </div>
          <p class="measure">
            Graded evidence (BD1–BD4 → D5–D1) for <b>already-called</b> boundaries.
            Does not call TADs or claim ground truth.
          </p>
        </section>
        <section class="guide-sec">
          <div class="guide-sec-h">
            <span class="guide-n">2</span>
            <h3>Home: open a shipped package, or bring your own boundaries</h3>
          </div>
          <p class="measure">
            <b>Import</b> your own BED, or open one of the six shipped packages
            (3 cell lines × 2 resolutions). Their evidence tables are genome-wide;
            the bundled Hi-C map and ChIP tracks cover <b>chr7</b> only until you add
            full-genome files from Data Manager.
          </p>
        </section>
        <section class="guide-sec">
          <div class="guide-sec-h">
            <span class="guide-n">3</span>
            <h3>Import: which files are required, and what happens without them</h3>
          </div>
          <p class="measure">
            Primary BED required. Optional multi-caller panel, mcool, CTCF/RAD21, loops.
            Missing assays are <b>not_assessable</b>, not negative.
          </p>
        </section>
        <section class="guide-sec">
          <div class="guide-sec-h">
            <span class="guide-n">4</span>
            <h3>Visualization: read a boundary's evidence card</h3>
          </div>
          <p class="measure">
            Click the evidence-tier track for the card. Local reviews: sidebar → Local Reviews.
          </p>
        </section>
        <section class="guide-sec">
          <div class="guide-sec-h">
            <span class="guide-n">5</span>
            <h3>Data files: what ships with the app, what you add yourself</h3>
          </div>
          <p class="measure">
            Data Manager: shipped <code>_chr7</code> demo tracks vs full-genome downloads under
            <code>CREDITAD_SHARED_RAW</code>.
          </p>
        </section>
      </div>

      <footer class="guide-foot">
        <button type="button" class="btn btn-outline" @click="goDataManager">Data Manager</button>
        <button type="button" class="btn btn-primary" @click="showGuideModal = false">Close</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAppState } from '../composables/useAppState'
import { useDialogFocus } from '../composables/useDialogFocus'
const { showGuideModal, setPage } = useAppState()

const guideRef = ref(null)
const { onTabKeydown } = useDialogFocus(showGuideModal, guideRef)

function goDataManager() {
  showGuideModal.value = false
  setPage('datamanager')
}
</script>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  width: 520px;
  max-width: 92vw;
  max-height: 84vh;
  border-radius: var(--r-lg);
  overflow: hidden;
}

.guide-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s3);
  padding: var(--s3) var(--s3) var(--s3) var(--s5);
  border-bottom: 1px solid var(--border);
}
.guide-title {
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0.008em;
  color: var(--text-primary);
}
.guide-close { padding: 0 8px; }

.guide-body {
  flex: 1;
  min-height: 0;
  padding: 0 var(--s5);
  overflow-y: auto;
}

/* One hairline-separated entry per step; the number is a mono margin mark, not a
   coloured chip — colour on this screen belongs to data. */
.guide-sec {
  padding: var(--s3) 0;
  border-bottom: 1px solid var(--rule);
}
.guide-sec:last-child { border-bottom: none; }
.guide-sec-h {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 3px;
}
.guide-n {
  flex: none;
  width: 14px;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.guide-sec h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-base);
  font-weight: 600;
  letter-spacing: 0.008em;
  color: var(--text-primary);
}
.guide-sec p {
  margin: 0 0 0 24px;
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--text-secondary);
}
.guide-sec code {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  background: var(--bg-secondary);
  border: 1px solid var(--rule);
  padding: 0 4px;
  border-radius: var(--r-xs);
  color: var(--text-primary);
}
.guide-sec b {
  font-weight: 600;
  color: var(--text-primary);
}

.guide-foot {
  display: flex;
  justify-content: space-between;
  gap: var(--s2);
  padding: var(--s3) var(--s5);
  border-top: 1px solid var(--border);
}
</style>
