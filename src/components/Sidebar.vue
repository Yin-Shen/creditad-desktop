<template>
  <aside class="sidebar">
    <div class="brand">
      <!-- The application mark: boundary ticks of unequal height crossing a
           coordinate axis. Same geometry as the app icon (scripts/make_brand_icon.py),
           so the identity is one drawing everywhere it appears. -->
      <svg class="brand-mark" viewBox="0 0 30 22" aria-hidden="true">
        <rect x="0.5" y="15.5" width="29" height="1.3" rx="0.65" class="brand-axis" />
        <g class="brand-ticks">
          <rect x="2.4"  y="7.2"  width="1.8" height="11.2" rx="0.6" />
          <rect x="7.2"  y="2.6"  width="1.8" height="15.8" rx="0.6" />
          <rect x="12.0" y="10.6" width="1.8" height="7.8"  rx="0.6" />
          <rect x="16.8" y="5.0"  width="1.8" height="13.4" rx="0.6" />
          <rect x="21.6" y="9.0"  width="1.8" height="9.4"  rx="0.6" />
          <rect x="26.4" y="6.2"  width="1.8" height="12.2" rx="0.6" />
        </g>
      </svg>
      <div class="brand-text">
        <div class="brand-name">{{ appName }}</div>
        <div class="brand-tag">Boundary evidence</div>
      </div>
    </div>

    <nav class="nav scrollbar" aria-label="Primary">
      <div class="nav-heading eyebrow">Navigate</div>

      <button
        v-for="item in navItems"
        :key="item.key"
        type="button"
        class="nav-item"
        :class="{ active: page === item.key }"
        :aria-current="page === item.key ? 'page' : undefined"
        @click="setPage(item.key)"
      >
        <i :class="['fas', item.icon]" aria-hidden="true"></i>{{ item.label }}
      </button>
    </nav>

    <div class="sidebar-foot">
      <button
        type="button"
        class="theme-switch"
        role="switch"
        :aria-checked="isDark"
        :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
        @click="toggleTheme"
        @keydown.space.prevent="toggleTheme"
      >
        <span class="theme-switch-track"></span>
        <span class="theme-switch-label">{{ isDark ? 'Dark' : 'Light' }}</span>
      </button>
      <button class="btn btn-ghost btn-sm" @click="showGuideModal = true">
        <i class="fas fa-circle-question" aria-hidden="true"></i>Help
      </button>
    </div>
  </aside>
</template>

<script setup>
import { useAppState } from '../composables/useAppState'

const { page, setPage, toggleTheme, isDark, showGuideModal, appName } = useAppState()

// One accent for the whole navigation: the destination that is active is marked
// in the brand colour, rather than each destination owning a hue of its own.
const navItems = [
  { key: 'home',          label: 'Home',          icon: 'fa-house' },
  { key: 'import',        label: 'Import Files',  icon: 'fa-file-import' },
  { key: 'visualization', label: 'Visualization', icon: 'fa-layer-group' },
  { key: 'labels',        label: 'Local Reviews', icon: 'fa-clipboard-check' },
  { key: 'datamanager',   label: 'Data Manager',  icon: 'fa-download' },
]
</script>

<style scoped>
.sidebar {
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  width: 212px;
  height: 100vh;
  position: fixed;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 18px 16px;
  border-bottom: 1px solid var(--border);
}
.brand-mark {
  width: 30px;
  height: 22px;
  flex: none;
}
.brand-mark .brand-ticks { fill: var(--brand); }
.brand-mark .brand-axis { fill: var(--rule-strong); }
.brand-name {
  font-family: var(--font-display);
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.1;
  color: var(--text-primary);
}
.brand-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-top: 3px;
}

.nav {
  flex: 1;
  padding: 18px 0 10px;
  overflow-y: auto;
}
.nav-heading { padding: 0 18px 10px; }

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 18px;
  font-family: var(--font-sans);
  font-size: var(--fs-sm);
  font-weight: 450;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.nav-item i {
  width: 15px;
  margin-right: 10px;
  font-size: 12px;
  color: var(--ink-faint);
  transition: color var(--dur) var(--ease);
}
.nav-item:hover { background: var(--bg-secondary); color: var(--text-primary); }
.nav-item:hover i { color: var(--text-secondary); }

/* Active is marked by a tick in the margin — the same gesture as a boundary on
   the coordinate axis — over a tint of the brand colour. */
.nav-item.active {
  background: var(--brand-tint);
  color: var(--primary-text);
  font-weight: 600;
}
.nav-item.active i { color: var(--primary-text); }
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--brand);
}
.nav-item:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 0; }

.sidebar-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s2);
  padding: 12px 14px 12px 18px;
  border-top: 1px solid var(--border);
}

.theme-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-family: var(--font-sans);
}
.theme-switch-track {
  position: relative;
  width: 30px;
  height: 17px;
  border-radius: 99px;
  background: var(--surface-3);
  border: 1px solid var(--rule-strong);
  transition: background var(--dur) var(--ease);
}
.theme-switch-track::after {
  content: '';
  position: absolute;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--ink-3);
  top: 2px;
  left: 2px;
  transition: left var(--dur) var(--ease), background var(--dur) var(--ease);
}
.theme-switch-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dark .theme-switch-track { background: var(--surface-3); }
.dark .theme-switch-track::after { left: 15px; background: var(--ink); }
.theme-switch:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }

@media (max-width: 768px) {
  .sidebar { width: 152px; }
  .brand-tag { display: none; }
  .nav-item { padding: 8px 12px; font-size: var(--fs-xs); }
  .nav-heading { padding-left: 12px; }
  .sidebar-foot { padding-left: 12px; flex-wrap: wrap; }
}
</style>
