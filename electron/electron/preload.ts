import { contextBridge, ipcRenderer } from 'electron'
import type {
  ElectronAPI,
  ElectronListenerChannel,
  ElectronSendChannel,
} from '../../src/electron-api'

const listenerChannels = new Set<ElectronListenerChannel>([
  'server-ready',
  'server-log',
  'server-failed',
  'startup-event',
  'main-process-message',
  'tad-finished',
  'update-available',
  'update-not-available',
  'update-progress',
  'update-downloaded',
  'update-error',
])

const sendChannels = new Set<ElectronSendChannel>([
  'check-for-updates',
  'download-update',
])

const electronAPI: ElectronAPI = {
  on: (channel, callback) => {
    if (!listenerChannels.has(channel)) {
      return undefined
    }

    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args)

    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },

  send: (channel, data) => {
    if (sendChannels.has(channel)) {
      ipcRenderer.send(channel, data)
    }
  },

  getAppVersion: () => ipcRenderer.invoke('api:get-app-version'),
  isAutoUpdateEnabled: () => ipcRenderer.invoke('api:is-auto-update-enabled'),
  getStartupError: () => ipcRenderer.invoke('api:get-startup-error'),
  getStartupEvents: () => ipcRenderer.invoke('api:get-startup-events'),
  getSystemInfo: () => ipcRenderer.invoke('api:get-system-info'),
  getBackendLogTail: (lines) => ipcRenderer.invoke('api:get-backend-log-tail', lines),
  runTadDetection: (params) => ipcRenderer.invoke('api:runTadDetection', params),
  checkServerStatus: () => ipcRenderer.invoke('api:check-server-status'),
  restartBackend: () => ipcRenderer.invoke('api:restart-backend'),
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  registerWithPS: (filePath) => ipcRenderer.invoke('api:registerWithPS', filePath),
  getTadStatus: (token) => ipcRenderer.invoke('api:getTadStatus', token),

  removeListener: (channel) => {
    if (listenerChannels.has(channel)) {
      ipcRenderer.removeAllListeners(channel)
    }
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
