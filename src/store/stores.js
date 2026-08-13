import { defineStore } from 'pinia'

// One store, one piece of state: the loaded project view. (The store id stays
// 'counter' — it is persisted under that key and renaming it buys nothing.)
export const useCounterStore = defineStore('counter', {
  state: () => ({
    // restore the project view across a browser refresh (tokens stay valid while the
    // backend session is alive; if the backend restarted, tracks degrade gracefully).
    file_view_obj: (() => {
      try { return JSON.parse(localStorage.getItem('creditad_fvo')) || {} }
      catch { return {} }
    })(),
  }),
})
