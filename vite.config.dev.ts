import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev-only config: NO Electron plugin (runs on a headless Linux server, accessed
// through an SSH tunnel).  Port is locked to 5173 and strictPort so the
// address never drifts on reload.
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: {
      // Prefer polling on this host: inotify max_user_watches is often exhausted
      // (ENOSPC) after packaging trees (package_stage/runtime ~1.5G of files).
      usePolling: true,
      interval: 1000,
      ignored: [
        '**/runtime/**',
        '**/runtime_for_packaging/**',
        '**/package_stage/**',
        '**/release/**',
        '**/release_for_packaging/**',
        '**/backend_for_packaging/**',
        '**/dist/**',
        '**/dist-electron/**',
        '**/backend/extra_mode/**',
        '**/backend/tad_results/**',
        '**/node_modules/**',
      ],
    },
    proxy: {
      '/api':     'http://127.0.0.1:5001',
      '/outputs': 'http://127.0.0.1:5001',
    },
  },
})
