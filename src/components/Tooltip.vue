// ============================================
// src/components/Tooltip.vue
// ============================================
<template>
  <div id="tooltip" class="tooltip hidden"></div>
</template>

<style scoped>
.tooltip {
  position: fixed;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 11px;
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  pointer-events: none;
  max-width: 240px;
}

.hidden {
  display: none;
}
</style>