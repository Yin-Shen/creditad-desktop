import type { OpenDialogOptions } from 'electron'

export type ElectronListenerChannel =
  | 'server-ready'
  | 'server-log'
  | 'server-failed'
  | 'startup-event'
  | 'main-process-message'
  | 'tad-finished'
  | 'update-available'
  | 'update-not-available'
  | 'update-progress'
  | 'update-downloaded'
  | 'update-error'

export type ElectronSendChannel = 'check-for-updates' | 'download-update'

export interface StartupEvent {
  step: string
  status: 'info' | 'active' | 'done' | 'warn' | 'error'
  message: string
  elapsed: number
}

export interface SystemInfo {
  appVersion: string
  nodeVersion: string
  electronVersion: string
  chromeVersion: string
  platform: string
  osRelease: string
  backendDir: string
  backendExe: string
  runtimePython: string
  healthUrl: string
  autoUpdate: string
}

export interface ElectronAPI {
  on(
    channel: ElectronListenerChannel,
    callback: (...args: unknown[]) => void,
  ): (() => void) | undefined
  send(channel: ElectronSendChannel, data?: unknown): void
  getAppVersion(): Promise<string>
  isAutoUpdateEnabled(): Promise<boolean>
  getStartupError(): Promise<string>
  getStartupEvents(): Promise<StartupEvent[]>
  getSystemInfo(): Promise<SystemInfo>
  getBackendLogTail(lines?: number): Promise<string[]>
  runTadDetection(
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; message?: string; data?: unknown }>
  checkServerStatus(): Promise<boolean>
  restartBackend(): Promise<{ success: boolean; message?: string }>
  openFile(options: OpenDialogOptions): Promise<string[] | null>
  registerWithPS(
    filePath: string,
  ): Promise<{ success: boolean; message?: string; data?: unknown }>
  getTadStatus(
    token: string,
  ): Promise<{ success: boolean; message?: string; data?: unknown }>
  removeListener(channel: ElectronListenerChannel): void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
