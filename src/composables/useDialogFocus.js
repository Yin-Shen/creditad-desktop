import { nextTick, watch } from 'vue'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function focusablesIn(root) {
  return Array.from(root?.querySelectorAll(FOCUSABLE) || [])
    .filter((el) => !el.disabled && el.getClientRects().length > 0)
}

/**
 * Make a dialog behave the way `aria-modal="true"` promises: focus moves inside
 * when it opens, Tab cycles within it, and focus returns to whatever opened it.
 * Every overlay in this app announced aria-modal while doing none of that, so a
 * keyboard user kept tabbing through the page behind the scrim — and, with the
 * scrim swallowing clicks, had no way to reach anything at all.
 *
 * @param {import('vue').Ref<unknown>} isOpen truthy while the dialog is shown
 * @param {import('vue').Ref<HTMLElement|null>} dialogRef the dialog element
 */
export function useDialogFocus(isOpen, dialogRef) {
  let opener = null

  watch(isOpen, async (open) => {
    if (open) {
      opener = document.activeElement
      await nextTick()
      const target = focusablesIn(dialogRef.value)[0] || dialogRef.value
      target?.focus?.()
    } else {
      opener?.focus?.()
      opener = null
    }
  })

  /** Bind to the dialog's `@keydown.tab`. */
  const onTabKeydown = (event) => {
    const items = focusablesIn(dialogRef.value)
    if (!items.length) {
      event.preventDefault()
      dialogRef.value?.focus?.()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialogRef.value)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { onTabKeydown }
}
