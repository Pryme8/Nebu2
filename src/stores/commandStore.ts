import { defineStore }          from 'pinia'
import { ref, computed }        from 'vue'
import type { ICommand }        from '@/types/command'
import { useNotificationStore } from '@/stores/notificationStore'

/**
 * commandStore — undo / redo stack for the editor.
 *
 * All destructive or reversible editor actions should be routed through
 * `commandStore.execute()` rather than called directly on sceneStore / other
 * stores.  This gives a single, auditable path for every mutation and keeps
 * the undo/redo history automatically in sync.
 *
 * Consecutive commands that share a `mergeKey` (e.g. continuous numeric
 * scrubbing) are coalesced into a single undo step via `ICommand.tryMerge`.
 */
export const useCommandStore = defineStore('command', () => {
  const _undo = ref<ICommand[]>([])
  const _redo = ref<ICommand[]>([])

  const canUndo   = computed(() => _undo.value.length > 0)
  const canRedo   = computed(() => _redo.value.length > 0)
  const undoLabel = computed(() => _undo.value[_undo.value.length - 1]?.description ?? null)
  const redoLabel = computed(() => _redo.value[_redo.value.length - 1]?.description ?? null)

  function execute(command: ICommand): void {
    command.execute()

    // Try to merge consecutive commands with the same key (e.g. scrubbing)
    const last = _undo.value[_undo.value.length - 1]
    if (last?.mergeKey && last.mergeKey === command.mergeKey && last.tryMerge) {
      const merged = last.tryMerge(command)
      if (merged) {
        _undo.value = [..._undo.value.slice(0, -1), merged]
        _redo.value = []
        return
      }
    }

    _undo.value = [..._undo.value, command]
    _redo.value = [] // new action invalidates redo history

    if (!command.silent) {
      useNotificationStore().info(command.description)
    }
  }

  function undo(): void {
    const cmd = _undo.value[_undo.value.length - 1]
    if (!cmd) return
    cmd.undo()
    _undo.value = _undo.value.slice(0, -1)
    _redo.value = [..._redo.value, cmd]
    useNotificationStore().info(`↩ Undo: ${cmd.description}`)
  }

  function redo(): void {
    const cmd = _redo.value[_redo.value.length - 1]
    if (!cmd) return
    cmd.execute()
    _redo.value = _redo.value.slice(0, -1)
    _undo.value = [..._undo.value, cmd]
    useNotificationStore().info(`↪ Redo: ${cmd.description}`)
  }

  /** Clear both stacks — call when switching scenes to avoid stale references. */
  function clear(): void {
    _undo.value = []
    _redo.value = []
  }

  return { canUndo, canRedo, undoLabel, redoLabel, execute, undo, redo, clear }
})
