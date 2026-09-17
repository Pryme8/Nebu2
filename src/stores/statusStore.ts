import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useStatusStore = defineStore('status', () => {
  const message = ref('')
  const hint    = ref('')

  function set(msg: string, keyHint = ''): void {
    message.value = msg
    hint.value    = keyHint
  }

  function clear(): void {
    message.value = ''
    hint.value    = ''
  }

  return { message, hint, set, clear }
})
