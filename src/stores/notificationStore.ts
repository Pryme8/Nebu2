import { defineStore }                   from 'pinia'
import { ref }                           from 'vue'
import { generateGuid }                  from '@/lib/guid'
import type { Notification, NotificationKind } from '@/types/notification'

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([])

  function push(
    message:  string,
    kind:     NotificationKind = 'info',
    duration: number = 3000,
  ): void {
    const id = generateGuid()
    notifications.value = [...notifications.value, { id, message, kind, duration }]

    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
  }

  function dismiss(id: string): void {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }

  /** Convenience wrappers */
  function info(message: string, duration?: number):    void { push(message, 'info',    duration) }
  function success(message: string, duration?: number): void { push(message, 'success', duration) }
  function warning(message: string, duration?: number): void { push(message, 'warning', duration) }
  function error(message: string, duration?: number):   void { push(message, 'error',   duration) }

  return { notifications, push, dismiss, info, success, warning, error }
})
