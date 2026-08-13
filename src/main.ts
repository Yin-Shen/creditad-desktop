// main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
// Bundled locally (latin subsets only) — no webfont CDN, so the offline desktop
// build renders in the intended faces instead of falling back to a system stack.
// One superfamily drawn for scholarly publishing: Source Serif for titles, Source
// Sans for the interface, Source Code for coordinates and other data.
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-600.css'
import '@fontsource/source-serif-4/latin-400-italic.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-500.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-code-pro/latin-400.css'
import '@fontsource/source-code-pro/latin-500.css'
import './assets/styles.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import App from './App.vue'

// 创建 Pinia 实例
const pinia = createPinia()

// 创建 Vue 应用实例
const app = createApp(App)

// 安装 Pinia 插件
app.use(pinia)

// persist the project view across browser refreshes
import { useCounterStore } from './store/stores'
const _store = useCounterStore()
_store.$subscribe((_m, state) => {
  try { localStorage.setItem('creditad_fvo', JSON.stringify(state.file_view_obj)) } catch {}
})

// 挂载应用
app.mount('#app')