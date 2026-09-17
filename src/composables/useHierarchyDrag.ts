import { ref } from 'vue'

/**
 * Module-level drag state shared across all HierarchyNode instances.
 * Exported as a single object so consumers destructure the same refs.
 */
export const hierarchyDragState = {
  draggingId:   ref<string | null>(null),
  dragIsCopy:   ref(false),
  dropTargetId: ref<string | null>(null),
}
