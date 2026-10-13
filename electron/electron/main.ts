import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import type {
  IpcMainInvokeEvent,
  MessageBoxOptions,
  OpenDialogOptions,
  WebContents,
} from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { exec, spawn, type ChildProcess } from 'node:child_process'
import { autoUpdater } from 'electron-updater'
import kill from 'tree-kill'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

const SERVER_HEALTH_URL = 'http://127.0.0.1:5001/api/health'
const SERVER_MAX_RETRIES = 120
const SERVER_RETRY_DELAY_MS = 1000
const SERVER_STARTUP_TIMEOUT_SECONDS =
  (SERVER_MAX_RETRIES * SERVER_RETRY_DELAY_MS) / 1000
const AUTO_UPDATE_ENABLED = process.env.TAD_ENABLE_AUTO_UPDATE === '1'
const APP_DISPLAY_NAME = 'CrediTAD'
const pkg = require('../package.json') as { version: string }

type ServerLaunchResult = {
  success: boolean
  message?: string
}

let win: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
let isBackendReady = false
let isQuitting = false
let startupErrorMessage = ''

const sanitizePath = (inputPath: string): string => {
  if (!inputPath) return ''
  return inputPath.replace(/[^\x20-\x7E]/g, '').replace(/\\/g, '/').trim()
}

const sendToRenderer = (channel: string, data?: unknown): void => {
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, data)
}

interface StartupEvent {
  step: string
  status: 'info' | 'active' | 'done' | 'warn' | 'error'
  message: string
  elapsed: number
}

const STARTUP_EVENT_PATTERN = /\[STARTUP\|([^|]+)\|([^|]+)\|([^|]*)\|([0-9.]+)\]/g
const collectedStartupEvents: StartupEvent[] = []
const collectedBackendLog: string[] = []
let cachedSystemInfo: Record<string, string> = {}

const collectSystemInfo = (): Record<string, string> => {
  const info: Record<string, string> = {
    appVersion: pkg.version,
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    platform: `${process.platform} (${process.arch})`,
    osRelease: '',
    backendDir: getServerDir(),
    backendExe: getServerExecutablePath(),
    runtimePython: getEmbeddedPythonPath() ?? '(bundled main.exe)',
    healthUrl: SERVER_HEALTH_URL,
    autoUpdate: AUTO_UPDATE_ENABLED ? 'enabled' : 'disabled',
  }
  try {
    info.osRelease = require('node:os').release()
  } catch {
    info.osRelease = 'unknown'
  }
  return info
}

const parseAndForwardStartupEvents = (raw: string): void => {
  const text = String(raw ?? '')
  STARTUP_EVENT_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STARTUP_EVENT_PATTERN.exec(text)) !== null) {
    const event: StartupEvent = {
      step: match[1] ?? 'unknown',
      status: ((match[2] as StartupEvent['status']) ?? 'info'),
      message: match[3] ?? '',
      elapsed: Number.parseFloat(match[4] ?? '0'),
    }
    collectedStartupEvents.push(event)
    if (collectedStartupEvents.length > 400) {
      collectedStartupEvents.splice(0, collectedStartupEvents.length - 400)
    }
    sendToRenderer('startup-event', event)
  }
}

const recordBackendLogChunk = (raw: Buffer | string): void => {
  const text = typeof raw === 'string' ? raw : raw.toString('utf-8')
  if (!text) return
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    collectedBackendLog.push(trimmed)
  }
  if (collectedBackendLog.length > 400) {
    collectedBackendLog.splice(0, collectedBackendLog.length - 400)
  }
  sendToRenderer('server-log', text)
  parseAndForwardStartupEvents(text)
}

const setBackendReady = (): void => {
  isBackendReady = true
  startupErrorMessage = ''
  sendToRenderer('server-ready')
}

const setBackendFailed = (message: string): void => {
  isBackendReady = false
  startupErrorMessage = message
  sendToRenderer('server-failed', { message })
}

const getServerDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(process.cwd(), 'backend')

const getServerExecutableName = (): string => {
  switch (process.platform) {
    case 'win32':
      return 'main.exe'
    case 'darwin':
    case 'linux':
      return 'main'
    default:
      return 'main'
  }
}

const getServerExecutablePath = (): string =>
  path.join(getServerDir(), getServerExecutableName())

const getEmbeddedRuntimeDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.join(process.cwd(), 'runtime')

const getEmbeddedPythonPath = (): string | null => {
  const runtimeDir = getEmbeddedRuntimeDir()
  // A conda environment keeps its interpreter at bin/python on Linux and macOS and at
  // python.exe in the environment root on Windows.
  const candidates =
    process.platform === 'win32'
      ? [path.join(runtimeDir, 'python.exe')]
      : [path.join(runtimeDir, 'bin', 'python'), path.join(runtimeDir, 'python')]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

interface ResolvedBackendLauncher {
  command: string
  args: string[]
  description: string
}

const resolveBackendLauncher = (): ResolvedBackendLauncher | null => {
  const embeddedPython = getEmbeddedPythonPath()
  const mainPy = path.join(getServerDir(), 'main.py')

  if (embeddedPython && fs.existsSync(mainPy)) {
    return {
      command: embeddedPython,
      args: ['-u', mainPy],
      description: `embedded Python: ${embeddedPython}`,
    }
  }

  const exePath = getServerExecutablePath()
  if (fs.existsSync(exePath)) {
    return {
      command: exePath,
      args: [],
      description: `bundled binary: ${exePath}`,
    }
  }

  return null
}

async function waitForServer(
  url: string,
  maxRetries = SERVER_MAX_RETRIES,
  retryDelayMs = SERVER_RETRY_DELAY_MS,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return true
      }
    } catch {
      // Backend is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }

  return false
}

function stopPackagedServer(): void {
  isBackendReady = false

  if (serverProcess?.pid) {
    kill(serverProcess.pid, 'SIGKILL')
    serverProcess = null
  }

  const killCommands =
    process.platform === 'win32'
      ? [
          'taskkill /F /T /IM main.exe >nul 2>nul',
          'taskkill /F /T /IM python.exe /FI "WINDOWTITLE eq CrediTAD-backend" >nul 2>nul',
          'for /f "tokens=5" %a in (\'netstat -ano ^| findstr ":5001 " ^| findstr LISTENING\') do taskkill /F /PID %a >nul 2>nul',
        ]
      : ['lsof -ti:5001 | xargs kill -9 >/dev/null 2>&1']

  for (const cmd of killCommands) {
    exec(cmd, () => undefined)
  }
}

function startPackagedServer(): ServerLaunchResult {
  const serverDir = getServerDir()
  collectedStartupEvents.length = 0
  collectedBackendLog.length = 0
  cachedSystemInfo = collectSystemInfo()

  const launcher = resolveBackendLauncher()
  if (!launcher) {
    return {
      success: false,
      message:
        process.platform === 'win32'
          ? 'Backend launcher not found. Expected either runtime/python.exe + backend/main.py or backend/main.exe.'
          : 'Backend launcher not found. Expected either runtime/bin/python (or runtime/python) + backend/main.py or backend/main.',
    }
  }

  recordBackendLogChunk(`Starting packaged backend (${launcher.description})\n`)

  if (process.platform !== 'win32' && launcher.command.endsWith('main')) {
    try {
      fs.chmodSync(launcher.command, 0o755)
    } catch {
      // Best effort on non-Windows platforms.
    }
  }

  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    LANG: 'en_US.UTF-8',
  }

  // Packaged layout: resources/{backend,runtime,example_data}. Point the Python
  // process at demo packages and optional user-downloaded raw tracks.
  if (app.isPackaged) {
    const resourcesRoot = process.resourcesPath
    const exampleData = path.join(resourcesRoot, 'example_data')
    const sharedRaw =
      process.env.CREDITAD_SHARED_RAW ||
      path.join(app.getPath('userData'), 'shared_raw')
    launchEnv.CREDITAD_DATA_ROOT = resourcesRoot
    // api_routes resolves example_data as parents[2] of tad_vci = resources/
    // when backend lives at resources/backend — keep example_data there.
    if (!launchEnv.CREDITAD_SHARED_RAW) {
      launchEnv.CREDITAD_SHARED_RAW = sharedRaw
    }
    // Ensure empty shared-raw dir exists so users know where to put 4DN files
    try {
      fs.mkdirSync(sharedRaw, { recursive: true })
    } catch {
      /* ignore */
    }
    void exampleData
  }

  const embeddedRuntime = getEmbeddedRuntimeDir()
  if (fs.existsSync(embeddedRuntime)) {
    delete launchEnv.PYTHONHOME
    // Conda win-64 trees may use Lib\site-packages and/or lib\python3.11\site-packages
    // (cross-build on Linux keeps both as separate dirs). Include all that exist.
    const siteCandidates = [
      path.join(embeddedRuntime, 'Lib', 'site-packages'),
      path.join(embeddedRuntime, 'lib', 'site-packages'),
      path.join(embeddedRuntime, 'lib', 'python3.11', 'site-packages'),
      path.join(embeddedRuntime, 'Lib', 'python3.11', 'site-packages'),
    ].filter((p) => fs.existsSync(p))
    launchEnv.PYTHONPATH = [serverDir, ...siteCandidates].join(path.delimiter)
    if (process.platform === 'win32') {
      launchEnv.PATH = `${embeddedRuntime};${path.join(embeddedRuntime, 'Scripts')};${path.join(embeddedRuntime, 'Library', 'bin')};${launchEnv.PATH ?? ''}`
    } else {
      // Without this the bundled interpreter also imports from the user's
      // ~/.local/lib/python3.11/site-packages, so the backend can depend on whatever
      // the host happens to have installed there.
      launchEnv.PYTHONNOUSERSITE = '1'
    }
  }

  let spawnedProcess: ChildProcess
  try {
    spawnedProcess = spawn(launcher.command, launcher.args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: serverDir,
      env: launchEnv,
    })
    serverProcess = spawnedProcess
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown backend spawn error'
    return {
      success: false,
      message: `Failed to spawn backend: ${message}`,
    }
  }

  spawnedProcess.stdout?.on('data', (data: Buffer) => {
    recordBackendLogChunk(data)
  })

  spawnedProcess.stderr?.on('data', (data: Buffer) => {
    recordBackendLogChunk(data)
  })

  spawnedProcess.on('error', (error: Error) => {
    const message = `Backend process error: ${error.message}`
    console.error(message)
    if (!isQuitting) {
      setBackendFailed(message)
    }
  })

  spawnedProcess.on('close', (code) => {
    const exitedDuringStartup = !isBackendReady && !isQuitting
    const message =
      code === 0
        ? 'Backend process exited unexpectedly.'
        : `Backend process exited with code ${code}.`

    serverProcess = null
    isBackendReady = false

    if (exitedDuringStartup || (!isQuitting && code !== 0)) {
      setBackendFailed(message)
    }
  })

  return { success: true }
}

async function launchAndVerifyBackend(): Promise<ServerLaunchResult> {
  const launch = startPackagedServer()
  if (!launch.success) {
    setBackendFailed(launch.message ?? 'Backend launch failed.')
    return launch
  }

  const backendReady = await waitForServer(SERVER_HEALTH_URL)
  if (backendReady) {
    setBackendReady()
    return { success: true }
  }

  const message = `Backend did not become healthy within ${SERVER_STARTUP_TIMEOUT_SECONDS}s.`
  setBackendFailed(message)
  return { success: false, message }
}

function initUpdater(targetWin: BrowserWindow): void {
  if (!AUTO_UPDATE_ENABLED) {
    return
  }

  autoUpdater.autoDownload = false

  const sendStatus = (channel: string, data?: unknown): void => {
    if (!targetWin.isDestroyed()) {
      targetWin.webContents.send(channel, data)
    }
  }

  autoUpdater.on('update-available', (info) => sendStatus('update-available', info))
  autoUpdater.on('update-not-available', () => sendStatus('update-not-available'))
  autoUpdater.on('download-progress', (progress) =>
    sendStatus('update-progress', progress.percent),
  )
  autoUpdater.on('update-downloaded', () => sendStatus('update-downloaded'))
  autoUpdater.on('error', (error) => sendStatus('update-error', error.message))

  autoUpdater.on('update-downloaded', async (info) => {
    const dialogOptions: MessageBoxOptions = {
      type: 'info',
      buttons: ['Restart And Install', 'Later'],
      title: 'Application Update',
      message: `Version ${info.version} is ready to install.`,
      detail: 'Restart the app to finish installing the update.',
      noLink: true,
    }

    const { response } = await dialog.showMessageBox(targetWin, dialogOptions)
    if (response === 0) {
      stopPackagedServer()
      autoUpdater.quitAndInstall()
    }
  })
}

function resolveAppIcon(): string {
  // Prefer CrediTAD brand icon; fall back to legacy TAD-TAG.ico if missing.
  const publicDir = process.env.VITE_PUBLIC || RENDERER_DIST
  for (const name of ['CrediTAD.ico', 'TAD-TAG.ico', 'CrediTAD-256.png']) {
    const p = path.join(publicDir, name)
    if (fs.existsSync(p)) return p
  }
  return path.join(publicDir, 'TAD-TAG.ico')
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1500,
    height: 1200,
    // Do not append package version to the title bar (Electron default can surface it).
    title: APP_DISPLAY_NAME,
    icon: resolveAppIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Keep window title as product name only (never "CrediTAD <version>").
  win.on('page-title-updated', (event) => {
    event.preventDefault()
    if (!win || win.isDestroyed()) return
    if (win.getTitle() !== APP_DISPLAY_NAME) {
      win.setTitle(APP_DISPLAY_NAME)
    }
  })

  initUpdater(win)

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
    // DevTools only in dev; open without leaving File/Edit menus visible.
    win.webContents.openDevTools({ mode: 'detach' })
    return
  }

  void win.loadFile(path.join(RENDERER_DIST, 'index.html'))
}

app.whenReady().then(async () => {
  app.setName(APP_DISPLAY_NAME)
  // Remove the stock File / Edit / View / Window / Help menu — it is unused and
  // conflicts with in-app chrome (shortcuts / focus). Use an empty menu instead.
  Menu.setApplicationMenu(null)
  createWindow()
  const result = await launchAndVerifyBackend()
  if (!result.success) {
    console.error(result.message ?? 'Backend startup failed.')
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  stopPackagedServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  isQuitting = true
  stopPackagedServer()
})

ipcMain.on('check-for-updates', () => {
  if (!AUTO_UPDATE_ENABLED) {
    sendToRenderer('update-error', 'Updates are disabled in this build.')
    return
  }

  void autoUpdater.checkForUpdatesAndNotify()
})

ipcMain.on('download-update', () => {
  if (!AUTO_UPDATE_ENABLED) {
    sendToRenderer('update-error', 'Updates are disabled in this build.')
    return
  }

  void autoUpdater.downloadUpdate()
})

ipcMain.handle('api:check-server-status', () => isBackendReady)
ipcMain.handle('api:get-app-version', () => pkg.version)
ipcMain.handle('api:is-auto-update-enabled', () => AUTO_UPDATE_ENABLED)
ipcMain.handle('api:get-startup-error', () => startupErrorMessage)
ipcMain.handle('api:get-startup-events', () => collectedStartupEvents.slice())
ipcMain.handle('api:get-system-info', () => cachedSystemInfo)
ipcMain.handle('api:get-backend-log-tail', (_event, lines: number = 80) =>
  collectedBackendLog.slice(-Math.max(1, Math.min(lines, 400))),
)

ipcMain.handle('api:restart-backend', async () => {
  stopPackagedServer()
  return launchAndVerifyBackend()
})

ipcMain.handle(
  'dialog:openFile',
  async (_event: IpcMainInvokeEvent, options: OpenDialogOptions) => {
    const targetWindow = win ?? BrowserWindow.getFocusedWindow()
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, options)
      : await dialog.showOpenDialog(options)
    const { canceled, filePaths } = result
    if (canceled) {
      return null
    }

    return filePaths.map((filePath) => sanitizePath(filePath))
  },
)

ipcMain.handle(
  'api:registerWithPS',
  async (_event: IpcMainInvokeEvent, filePath: string) =>
    new Promise((resolve) => {
      const cleanPath = sanitizePath(filePath)
      const command = `powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:5001/api/register' -Method Post -ContentType 'application/json; charset=utf-8' -Body '{\\\"path\\\": \\\"${cleanPath}\\\", \\\"type\\\": \\\"hic\\\"}'"`

      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, message: stderr || error.message })
          return
        }

        try {
          resolve({ success: true, data: JSON.parse(stdout) })
        } catch {
          resolve({
            success: false,
            message: 'Failed to parse backend response.',
            raw: stdout,
          })
        }
      })
    }),
)

async function monitorTadStatus(
  sender: WebContents,
  token: string,
): Promise<void> {
  const poll = async (): Promise<void> => {
    if (sender.isDestroyed()) {
      return
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:5001/api/tad/status/${token}`,
      )
      const statusData = (await response.json()) as {
        status?: string
        error_msg?: string
      }

      if (statusData.status === 'done') {
        sender.send('tad-finished', { success: true, token })
        return
      }

      if (statusData.status === 'failed') {
        sender.send('tad-finished', {
          success: false,
          error: statusData.error_msg ?? 'TAD task failed.',
        })
        return
      }

      setTimeout(() => {
        void poll()
      }, 10_000)
    } catch (error) {
      console.error('TAD status polling failed:', error)
      setTimeout(() => {
        void poll()
      }, 20_000)
    }
  }

  await poll()
}

ipcMain.handle(
  'api:runTadDetection',
  async (
    event: IpcMainInvokeEvent,
    tadParams: Record<string, unknown>,
  ): Promise<{ success: boolean; message?: string; data?: unknown }> => {
    try {
      const payload = { ...tadParams }
      if (typeof payload.path === 'string') {
        payload.path = sanitizePath(payload.path)
      }

      const token = typeof payload.token === 'string' ? payload.token : ''
      if (!token) {
        throw new Error('Missing TAD task token.')
      }

      const response = await fetch('http://127.0.0.1:5001/api/tad/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const startData = (await response.json()) as { error?: string }

      if (!response.ok) {
        throw new Error(startData.error ?? 'Failed to start TAD task.')
      }

      void monitorTadStatus(event.sender, token)

      return {
        success: true,
        message: 'Task started in background.',
        data: startData,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown TAD launch error.'
      return { success: false, message: `Launch Error: ${message}` }
    }
  },
)

ipcMain.handle(
  'api:getTadStatus',
  async (
    _event: IpcMainInvokeEvent,
    token: string,
  ): Promise<{ success: boolean; message?: string; data?: unknown }> => {
    try {
      const response = await fetch(
        `http://127.0.0.1:5001/api/tad/status/${token}`,
      )
      const data = await response.json()
      return { success: response.ok, data }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown status error.'
      return { success: false, message }
    }
  },
)
