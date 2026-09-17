<template>
  <div class="relative h-full" @mouseleave="closeIfNotChild">
    <!-- Trigger button -->
    <button
      :class="[
        'flex items-center h-full px-2.5 text-xs transition-colors',
        isOpen
          ? 'bg-[var(--color-accent)] text-white'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]',
      ]"
      @mousedown.prevent="toggle"
      @mouseenter="openOnHover"
    >
      {{ label }}
    </button>

    <!-- Dropdown -->
    <Transition name="menu-drop">
      <div
        v-if="isOpen"
        ref="dropdownRef"
        class="absolute top-full left-0 z-[10000] min-w-[220px] rounded-b rounded-r border border-[var(--color-border)] shadow-2xl py-0.5"
        style="background: var(--color-bg-elevated)"
      >
        <template v-for="(item, i) in items" :key="i">
          <!-- Separator -->
          <div
            v-if="'separator' in item && item.separator"
            class="my-0.5 border-t border-[var(--color-border)]"
          />
          <!-- Menu item (with optional submenu flyout) -->
          <div v-else class="relative group/item">
            <button
              class="flex items-center w-full px-3 py-1 text-xs text-left gap-4
                     text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white
                     transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isDisabled(item)"
              @click="execute(item)"
            >
              <span class="flex-1">{{ (item as MenuItem).label }}</span>
              <span
                v-if="(item as MenuItem).shortcut"
                class="text-[10px] opacity-60 shrink-0"
              >{{ (item as MenuItem).shortcut }}</span>
              <span
                v-else-if="(item as MenuItem).items"
                class="text-[10px] opacity-60 shrink-0"
              >&#9656;</span>
            </button>

            <!-- Submenu -->
            <div
              v-if="(item as MenuItem).items"
              class="absolute left-full top-0 -mt-0.5 ml-px z-[10001] min-w-[180px] rounded border
                     border-[var(--color-border)] shadow-2xl py-0.5 hidden group-hover/item:block"
              style="background: var(--color-bg-elevated)"
            >
              <button
                v-for="(sub, j) in ((item as MenuItem).items as MenuItem[])"
                :key="j"
                class="flex items-center w-full px-3 py-1 text-xs text-left gap-4
                       text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white
                       transition-colors disabled:opacity-40 disabled:pointer-events-none"
                :disabled="isDisabled(sub)"
                @click="execute(sub)"
              >
                <span class="flex-1">{{ sub.label }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

export interface MenuItem {
  label:     string
  shortcut?: string
  /** Omitted for items that only open a submenu. */
  action?:   () => void
  /** Evaluated on every open so items can grey out with editor state. */
  disabled?: () => boolean
  /** Nested entries — renders a flyout instead of firing an action. */
  items?:    MenuEntry[]
}
export interface MenuSeparator { separator: true }
export type MenuEntry = MenuItem | MenuSeparator

const props = defineProps<{
  label: string
  items: MenuEntry[]
}>()

const isOpen      = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

// Track whether any menu is open (shared via a custom event so sibling menus can close)
function toggle()  { isOpen.value ? close() : open() }
function open()    { isOpen.value = true;  document.dispatchEvent(new CustomEvent('menu-open', { detail: props.label })) }
function close() {
  isOpen.value = false
  // Clear the shared "a menu is open" flag we set in open(), otherwise
  // openOnHover keeps firing after every menu has been dismissed and merely
  // hovering the menu bar re-opens the last menu.
  if (document.__nebuMenuOpen === props.label) document.__nebuMenuOpen = undefined
}

function openOnHover() {
  // Only switch menus if another is already open
  if (document.__nebuMenuOpen && document.__nebuMenuOpen !== props.label) open()
}

function isDisabled(item: MenuEntry): boolean {
  if ('separator' in item) return false
  return item.disabled?.() ?? false
}

function execute(item: MenuEntry) {
  if ('separator' in item) return
  if (isDisabled(item)) return
  // Parent of a submenu — hovering opens it, clicking should do nothing.
  if (!item.action) return
  item.action()
  close()
}

function closeIfNotChild(e: MouseEvent) {
  if (!dropdownRef.value?.contains(e.relatedTarget as Node)) close()
}

function onMenuOpen(e: Event) {
  const ev = e as CustomEvent<string>
  document.__nebuMenuOpen = ev.detail
  if (ev.detail !== props.label) close()
}

function onDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('[data-menu-bar]')) close()
}

onMounted(() => {
  document.addEventListener('menu-open', onMenuOpen)
  document.addEventListener('mousedown', onDocClick)
})
onUnmounted(() => {
  document.removeEventListener('menu-open', onMenuOpen)
  document.removeEventListener('mousedown', onDocClick)
})
</script>

<script lang="ts">
// Extend Document type for the shared open-state tracker
declare global {
  interface Document { __nebuMenuOpen?: string }
}
export default {}
</script>

<style scoped>
.menu-drop-enter-active { transition: opacity 0.08s ease, transform 0.08s ease; }
.menu-drop-leave-active { transition: opacity 0.06s ease; }
.menu-drop-enter-from   { opacity: 0; transform: translateY(-4px); }
.menu-drop-leave-to     { opacity: 0; }
</style>
