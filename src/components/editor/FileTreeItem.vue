<template>
  <div>
    <!-- Row -->
    <div
      :style="{ paddingLeft: `${depth * 14 + 6}px` }"
      :class="[
        'flex items-center h-6 gap-1.5 cursor-pointer select-none group text-xs rounded mx-1',
        'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]',
      ]"
      @click="handleClick"
    >
      <!-- Expand arrow (directories only) -->
      <span class="shrink-0 w-3 h-3 flex items-center justify-center">
        <BaseIcon
          v-if="node.kind === 'directory'"
          :name="open ? 'chevronDown' : 'chevronRight'"
          :size="9"
        />
      </span>

      <!-- Icon -->
      <BaseIcon :name="iconName" :size="12" class="shrink-0" />

      <!-- Name -->
      <span class="flex-1 truncate">{{ node.name }}</span>
    </div>

    <!-- Children (recursive) -->
    <template v-if="open && node.kind === 'directory'">
      <FileTreeItem
        v-for="child in node.children"
        :key="child.name"
        :node="child"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FileTreeNode } from '@/stores/projectStore'
import BaseIcon from '@/components/base/BaseIcon.vue'
import FileTreeItem from './FileTreeItem.vue'  // self-reference for recursion

defineOptions({ name: 'FileTreeItem' })

const props = defineProps<{
  node:  FileTreeNode
  depth: number
}>()

const open = ref(props.node.kind === 'directory')

function handleClick(): void {
  if (props.node.kind === 'directory') open.value = !open.value
}

const iconName = computed((): string => {
  if (props.node.kind === 'directory') return open.value ? 'folderOpen' : 'folder'
  const ext = props.node.name.split('.').pop()?.toLowerCase() ?? ''
  if (['glb', 'gltf', 'obj', 'fbx', 'babylon'].includes(ext)) return 'mesh'
  if (['png', 'jpg', 'jpeg', 'webp', 'ktx', 'ktx2'].includes(ext))  return 'texture'
  if (ext === 'scene') return 'scene'
  return 'file'
})
</script>
