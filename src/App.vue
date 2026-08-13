<template>
  <transition name="fade">
    <div v-if="!isReady" class="splash">
      <div class="splash-card" :class="{ 'is-error': !!startupError }">
        <svg class="splash-mark" viewBox="0 0 30 22" aria-hidden="true">
          <rect x="0.5" y="15.5" width="29" height="1.3" rx="0.65" class="splash-axis" />
          <g class="splash-ticks">
            <rect x="2.4"  y="7.2"  width="1.8" height="11.2" rx="0.6" />
            <rect x="7.2"  y="2.6"  width="1.8" height="15.8" rx="0.6" />
            <rect x="12.0" y="10.6" width="1.8" height="7.8"  rx="0.6" />
            <rect x="16.8" y="5.0"  width="1.8" height="13.4" rx="0.6" />
            <rect x="21.6" y="9.0"  width="1.8" height="9.4"  rx="0.6" />
            <rect x="26.4" y="6.2"  width="1.8" height="12.2" rx="0.6" />
          </g>
        </svg>
        <div class="brand-logo">{{ appName }}</div>
        <div class="brand-tag">Evidence cards for called TAD boundaries</div>

        <!-- Success / loading: no port, no step list, no log -->
        <template v-if="!startupError">
          <div class="splash-status">
            <span class="spinner" aria-hidden="true"></span>
            <span>{{ statusLine }}</span>
          </div>
          <div class="splash-bar">
            <div class="splash-bar-fill" :style="{ width: progress + '%' }"></div>
          </div>
        </template>

        <!-- Failure only: short message + actions + optional details -->
        <template v-else>
          <div class="splash-error-title">{{ startupError }}</div>
          <div class="splash-error-actions">
            <button class="splash-button" :disabled="isRetrying" @click="retryStartup">
              {{ isRetrying ? 'Retrying…' : 'Retry' }}
            </button>
            <button class="splash-button secondary" @click="showDetails = !showDetails">
              {{ showDetails ? 'Hide details' : 'Details' }}
            </button>
            <button class="splash-button secondary" @click="copyDiagnostics">Copy log</button>
          </div>
          <pre v-if="showDetails" class="splash-details">{{ detailsText }}</pre>
        </template>
      </div>
    </div>
  </transition>

  <div v-if="isReady">
    <Sidebar />
    <main class="main-content">
      <Header />
      <div
        class="scrollbar page-container"
        :class="{ 'is-flush': page === 'visualization' }"
        id="pageContainer"
      >
        <HomePage v-if="page === 'home'" />
        <ImportPage v-if="page === 'import'" />
        <VisualizationPage v-if="page === 'visualization'" />
        <LabelsPage v-if="page === 'labels'" />
        <DataManagerPage v-if="page === 'datamanager'" />
      </div>
    </main>
    <GuideModal />
    <Tooltip />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import Sidebar from './components/Sidebar.vue'
import Header from './components/Header.vue'
import HomePage from './components/HomePage.vue'
import ImportPage from './components/ImportPage.vue'
import VisualizationPage from './components/VisualizationPage.vue'
import LabelsPage from './components/LabelsPage.vue'
import DataManagerPage from './components/DataManagerPage.vue'
import GuideModal from './components/GuideModal.vue'
import Tooltip from './components/Tooltip.vue'
import { useAppState } from './composables/useAppState'

const { page, appName } = useAppState()

const STARTUP_TIMEOUT_MS = 180_000

// Backend emits these step ids; keep for diagnostics only (not shown on success path).
const STEP_IDS = ['env', 'deps', 'db', 'bigwig', 'port', 'listen', 'ready']

const isReady = ref(false)
const progress = ref(8)
const startupError = ref('')
const isRetrying = ref(false)
const showDetails = ref(false)
const startupPhase = ref('starting')

const eventState = reactive(
  Object.fromEntries(STEP_IDS.map((id) => [id, { state: 'pending', detail: '', elapsed: 0 }])),
)
const backendLogLines = reactive([])
const systemInfo = ref({})

let animationTimer = null
let retryTimer = null
let removeServerReadyListener = null
let removeServerFailedListener = null
let removeServerLogListener = null
let removeStartupListener = null

const statusLine = computed(() => {
  if (startupPhase.value === 'ready') return 'Opening…'
  if (startupPhase.value === 'restarting') return 'Restarting…'
  return 'Starting…'
})

const detailsText = computed(() => {
  const lines = [
    ...STEP_IDS.map((id) => {
      const s = eventState[id]
      return `${id}: ${s.state}${s.detail ? ` — ${s.detail}` : ''}`
    }),
    '',
    ...backendLogLines.slice(-40),
  ]
  return lines.join('\n') || '(no details yet)'
})

const applyStartupEvent = (evt) => {
  if (!evt || !eventState[evt.step]) return
  const target = eventState[evt.step]
  target.state = evt.status === 'info' ? target.state || 'pending' : evt.status
  if (evt.message) target.detail = evt.message
  if (typeof evt.elapsed === 'number') target.elapsed = evt.elapsed

  const completed = STEP_IDS.filter((id) => eventState[id].state === 'done').length
  const active = STEP_IDS.filter((id) => eventState[id].state === 'active').length
  progress.value = Math.min(96, 8 + (completed / STEP_IDS.length) * 88 + active * 2)

  if (evt.step === 'ready' && evt.status === 'done') progress.value = 99
  if (evt.status === 'error') {
    startupError.value = evt.message || 'Backend startup failed.'
    startupPhase.value = 'failed'
  }
}

const recordLogText = (text) => {
  if (!text) return
  for (const raw of String(text).split(/\r?\n/g)) {
    const trimmed = raw.replace(/\s+$/, '')
    if (!trimmed) continue
    backendLogLines.push(trimmed)
  }
  if (backendLogLines.length > 200) {
    backendLogLines.splice(0, backendLogLines.length - 200)
  }
}

const startProgressDrift = () => {
  clearInterval(animationTimer)
  animationTimer = setInterval(() => {
    if (!startupError.value && progress.value < 90) {
      progress.value += Math.random() * 0.8
    }
  }, 400)
}

const enterSystem = () => {
  if (isReady.value) return
  clearInterval(animationTimer)
  clearTimeout(retryTimer)
  startupPhase.value = 'ready'
  startupError.value = ''
  isRetrying.value = false
  progress.value = 100
  // Brief beat so the bar can finish; keep short — this is not a reading screen.
  setTimeout(() => {
    isReady.value = true
  }, 180)
}

const markStartupFailed = (message) => {
  clearInterval(animationTimer)
  clearTimeout(retryTimer)
  isRetrying.value = false
  startupPhase.value = 'failed'
  startupError.value = message
  progress.value = Math.max(progress.value, 90)
}

const verifyBackend = async (deadline) => {
  if (isReady.value) return
  if (startupPhase.value !== 'restarting') startupPhase.value = 'checking'

  try {
    const isReadyFromMain = await window.electronAPI?.checkServerStatus()
    let isReadyFromFetch = false
    try {
      // Dev: vite proxy /api → backend. Packaged: electron hits loopback health.
      const url = window.electronAPI ? 'http://127.0.0.1:5001/api/health' : '/api/health'
      const resp = await fetch(url)
      if (resp.ok) isReadyFromFetch = true
    } catch {
      /* still starting */
    }
    if (isReadyFromMain || isReadyFromFetch) {
      enterSystem()
      return
    }
  } catch (error) {
    console.error('Backend verification failed:', error)
  }

  if (Date.now() >= deadline) {
    const startupMessage = await window.electronAPI?.getStartupError()
    markStartupFailed(
      startupMessage ||
        'Backend did not become ready in time. Use Details / Retry, or check Data Manager after a successful start.',
    )
    return
  }
  retryTimer = setTimeout(() => {
    void verifyBackend(deadline)
  }, 800)
}

const beginStartupCheck = async () => {
  startupPhase.value = 'starting'
  startupError.value = ''
  showDetails.value = false
  progress.value = 8
  startProgressDrift()
  try {
    systemInfo.value = (await window.electronAPI?.getSystemInfo()) || {}
  } catch {
    systemInfo.value = {}
  }
  try {
    const replay = (await window.electronAPI?.getStartupEvents()) || []
    for (const evt of replay) applyStartupEvent(evt)
  } catch {
    /* ignore */
  }
  try {
    const tail = (await window.electronAPI?.getBackendLogTail(40)) || []
    for (const line of tail) recordLogText(line)
  } catch {
    /* ignore */
  }
  await verifyBackend(Date.now() + STARTUP_TIMEOUT_MS)
}

const retryStartup = async () => {
  startupPhase.value = 'restarting'
  startupError.value = ''
  showDetails.value = false
  isRetrying.value = true
  for (const id of STEP_IDS) {
    eventState[id].state = 'pending'
    eventState[id].detail = ''
    eventState[id].elapsed = 0
  }
  progress.value = 12
  startProgressDrift()
  try {
    const result = await window.electronAPI?.restartBackend()
    if (!result?.success) {
      markStartupFailed(result?.message || 'Backend restart failed.')
      return
    }
    await verifyBackend(Date.now() + STARTUP_TIMEOUT_MS)
  } catch (error) {
    console.error('Backend restart failed:', error)
    markStartupFailed('Backend restart failed.')
  } finally {
    isRetrying.value = false
  }
}

const copyDiagnostics = async () => {
  const blob = [
    `${appName.value} diagnostics`,
    `Platform: ${systemInfo.value.platform || '?'} ${systemInfo.value.osRelease || ''}`,
    `Backend: ${systemInfo.value.runtimePython || systemInfo.value.backendExe || '?'}`,
    '',
    detailsText.value,
  ].join('\n')
  try {
    await navigator.clipboard.writeText(blob)
  } catch {
    /* clipboard may be blocked */
  }
}

onMounted(() => {
  removeServerReadyListener = window.electronAPI?.on('server-ready', enterSystem) || null
  removeServerLogListener =
    window.electronAPI?.on('server-log', (payload) => {
      recordLogText(payload)
    }) || null
  removeServerFailedListener =
    window.electronAPI?.on('server-failed', (payload) => {
      markStartupFailed(payload?.message || 'Backend startup failed.')
    }) || null
  removeStartupListener =
    window.electronAPI?.on('startup-event', (payload) => {
      applyStartupEvent(payload)
    }) || null
  void beginStartupCheck()
})

onUnmounted(() => {
  clearInterval(animationTimer)
  clearTimeout(retryTimer)
  removeServerReadyListener?.()
  removeServerLogListener?.()
  removeServerFailedListener?.()
  removeStartupListener?.()
})
</script>

<style>
/* The splash is the first thing a packaged build shows, so it uses the same paper
   and ink as the application rather than the neon-on-navy card it used to be. */
.splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
}

.splash-card {
  width: min(340px, 88vw);
  text-align: left;
}

.splash-card.is-error {
  width: min(440px, 92vw);
}

.splash-mark {
  width: 40px;
  height: 30px;
  display: block;
}
.splash-mark .splash-ticks { fill: var(--brand); }
.splash-mark .splash-axis { fill: var(--rule-strong); }

.brand-logo {
  margin-top: 14px;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--ink);
}

.brand-tag {
  margin-top: 4px;
  font-size: 13px;
  color: var(--ink-3);
  line-height: 1.45;
}

.splash-status {
  margin-top: 26px;
  display: flex;
  align-items: center;
  gap: 9px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.splash-bar {
  margin-top: 10px;
  height: 2px;
  background: var(--rule);
  overflow: hidden;
}

.splash-bar-fill {
  height: 100%;
  background: var(--ink);
  transition: width 0.25s ease;
}

.spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.5px solid var(--rule-strong);
  border-top-color: var(--ink);
  animation: spinner 0.75s linear infinite;
  flex-shrink: 0;
}

@keyframes spinner {
  to { transform: rotate(360deg); }
}

.splash-error-title {
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
  font-size: 14px;
  line-height: 1.55;
  color: var(--danger-text);
  word-break: break-word;
}

.splash-error-actions {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.splash-button {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--ink);
  border-radius: 5px;
  background: var(--ink);
  /* --paper, not --on-ink: --on-ink is white in both themes because it pairs with
     --primary, and white on the dark theme's near-white --ink is unreadable. */
  color: var(--paper);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.splash-button.secondary {
  background: transparent;
  border-color: var(--rule-strong);
  color: var(--ink-2);
}
.splash-button.secondary:hover { border-color: var(--ink); color: var(--ink); }

.splash-button:disabled {
  opacity: 0.45;
  cursor: wait;
}

.splash-details {
  margin: 14px 0 0;
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 5px;
  background: var(--surface-2);
  border: 1px solid var(--rule);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-word;
}

.fade-leave-active {
  transition: opacity 0.35s ease;
}
.fade-leave-to {
  opacity: 0;
}

.main-content {
  margin-left: 212px;
  min-height: 100vh;
  background: var(--bg-main);
  transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.page-container {
  padding: 24px;
}

/* The browser view is an instrument surface: it runs edge to edge and owns its
   own chrome, so the shell must not frame it. */
.page-container.is-flush {
  padding: 0;
}

@media (max-width: 768px) {
  .main-content { margin-left: 152px; }
}
</style>
