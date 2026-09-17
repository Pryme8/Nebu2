<template>
  <!-- Assets Panel — file/asset browser placeholder -->
  <div class="flex flex-col h-full">
    <div class="flex items-center h-7 px-2 gap-1 border-b border-[var(--color-border)] panel-elevated shrink-0">
      <BaseInput v-model="search" placeholder="Search assets…" style="height:20px;font-size:11px;" class="flex-1" />
      <BaseButton variant="ghost" size="xs" title="Import">
        <BaseIcon name="add" :size="12" />
      </BaseButton>
    </div>

    <!-- Breadcrumb -->
    <div class="flex items-center h-6 px-2 gap-1 text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]/50 shrink-0 select-none">
      <span class="cursor-pointer hover:text-[var(--color-text-primary)]">Assets</span>
    </div>

    <!-- Grid view -->
    <div class="flex-1 overflow-y-auto p-2">
      <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(64px, 1fr))">
        <div
          v-for="asset in filteredAssets"
          :key="asset.meta.guid"
          :class="[
            'flex flex-col items-center gap-1 p-1.5 rounded cursor-pointer select-none group',
            'hover:bg-[var(--color-bg-overlay)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
          ]"
        >
          <div class="w-10 h-10 rounded flex items-center justify-center bg-[var(--color-bg-base)] border border-[var(--color-border)]">
            <BaseIcon :name="assetIconMap[asset.meta.type] ?? 'placeholder'" :size="20" />
          </div>
          <span class="text-[10px] text-center leading-tight line-clamp-2 w-full text-center">{{ asset.name }}</span>
        </div>
      </div>
      <div v-if="filteredAssets.length === 0" class="py-8 text-center text-xs text-[var(--color-text-muted)]">
        No assets imported yet.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAssetStore } from '@/stores/assetStore'
import type { AssetType } from '@/types/asset'
import BaseInput  from '@/components/base/BaseInput.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon   from '@/components/base/BaseIcon.vue'

const assetStore = useAssetStore()
const search     = ref('')

const assetIconMap: Record<AssetType, string> = {
  mesh:     'mesh',
  texture:  'texture',
  audio:    'placeholder',
  material: 'placeholder',
  script:   'file',
  unknown:  'file',
}

const filteredAssets = computed(() =>
  !search.value
    ? assetStore.assetList
    : assetStore.assetList.filter(a =>
        a.name.toLowerCase().includes(search.value.toLowerCase()),
      ),
)
</script>
