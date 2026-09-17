<template>
  <Teleport to="body">
    <div
      class="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      <TransitionGroup name="toast" tag="div" class="flex flex-col gap-2 items-center">
        <div
          v-for="n in notificationStore.notifications"
          :key="n.id"
          :class="[
            'pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg',
            'border shadow-lg min-w-[220px] max-w-[360px] cursor-pointer select-none',
            'bg-[var(--color-bg-elevated)] border-[var(--color-border)]',
            'text-sm text-[var(--color-text-primary)]',
          ]"
          @click="notificationStore.dismiss(n.id)"
        >
          <!-- Kind indicator (left accent bar) -->
          <span :class="['shrink-0 w-0.5 self-stretch rounded-full', kindBarClass(n.kind)]" />

          <!-- Icon -->
          <span :class="['shrink-0 mt-px', kindIconClass(n.kind)]">
            <BaseIcon :name="kindIcon(n.kind)" :size="13" />
          </span>

          <!-- Message -->
          <span class="flex-1 leading-snug">{{ n.message }}</span>

          <!-- Dismiss X -->
          <button
            class="shrink-0 opacity-40 hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] mt-px"
            @click.stop="notificationStore.dismiss(n.id)"
          >
            <BaseIcon name="close" :size="10" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useNotificationStore }    from '@/stores/notificationStore'
import type { NotificationKind }   from '@/types/notification'
import BaseIcon from '@/components/base/BaseIcon.vue'

const notificationStore = useNotificationStore()

function kindIcon(kind: NotificationKind): string {
  switch (kind) {
    case 'success': return 'check'
    case 'warning': return 'warning'
    case 'error':   return 'close'
    default:        return 'info'
  }
}

function kindBarClass(kind: NotificationKind): string {
  switch (kind) {
    case 'success': return 'bg-[var(--color-success)]'
    case 'warning': return 'bg-[var(--color-warning)]'
    case 'error':   return 'bg-[var(--color-danger)]'
    default:        return 'bg-[var(--color-accent)]'
  }
}

function kindIconClass(kind: NotificationKind): string {
  switch (kind) {
    case 'success': return 'text-[var(--color-success)]'
    case 'warning': return 'text-[var(--color-warning)]'
    case 'error':   return 'text-[var(--color-danger)]'
    default:        return 'text-[var(--color-accent)]'
  }
}
</script>

<style scoped>
.toast-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
  position: absolute; /* allow remaining items to close the gap smoothly */
}
.toast-move {
  transition: transform 0.2s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
