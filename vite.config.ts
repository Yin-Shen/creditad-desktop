import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
const isWebOnly = !!process.env.VITE_WEB_ONLY

export default defineConfig({
  plugins: [
    vue(),
    ...(!isWebOnly ? [electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    })] : []),
  ],
  server: isWebOnly ? {
    host: '127.0.0.1',
    port: 5173,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' },
  } : undefined,
})
