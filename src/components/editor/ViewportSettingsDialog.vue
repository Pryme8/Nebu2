<template>
  <!-- Viewport Settings Dialog — teleports to body so it renders above all panels -->
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[9000] flex items-center justify-center"
      style="background: rgba(0,0,0,0.6)"
      @mousedown.self="close"
    >
      <div
        class="flex flex-col w-[380px] rounded-lg border border-[var(--color-border)] shadow-2xl overflow-hidden"
        style="background: var(--color-bg-surface)"
      >
        <!-- Title bar -->
        <div
          class="flex items-center h-10 px-4 gap-2 shrink-0 border-b border-[var(--color-border)]"
          style="background: var(--color-bg-elevated)"
        >
          <BaseIcon name="settings" :size="14" class="text-[var(--color-accent)]" />
          <span class="flex-1 text-sm font-semibold text-[var(--color-text-primary)]">Viewport Settings</span>
          <BaseButton variant="ghost" size="xs" @click="close">
            <BaseIcon name="close" :size="12" />
          </BaseButton>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto">

          <!-- ── Camera ──────────────────────────────────────────── -->
          <BaseSection title="Camera" :default-open="true">
            <div class="flex flex-col gap-2 py-1">
              <BaseNumericInput
                v-model="vp.cameraNearClip"
                label="Near Clip"
                :min="0.0001"
                :step="0.01"
              />
              <BaseNumericInput
                v-model="vp.cameraFarClip"
                label="Far Clip"
                :min="1"
                :step="100"
              />
              <BaseNumericInput
                v-model="vp.flySpeed"
                label="Fly Speed"
                :min="0.1"
                :max="20"
                :step="0.1"
              />
              <p class="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                Hover the viewport and use <kbd class="px-1 rounded bg-[var(--color-bg-base)] border border-[var(--color-border)] text-[10px]">WASD</kbd>
                to pan the camera. Hold
                <kbd class="px-1 rounded bg-[var(--color-bg-base)] border border-[var(--color-border)] text-[10px]">Shift</kbd>
                for 4× speed.
              </p>
            </div>
          </BaseSection>

          <!-- ── Editor Light ────────────────────────────────────── -->
          <BaseSection title="Editor Light" :default-open="true">
            <div class="flex flex-col gap-2 py-1">
              <BaseNumericInput
                v-model="vp.lightIntensity"
                label="Intensity"
                :min="0"
                :max="5"
                :step="0.1"
              />
              <div class="flex flex-col gap-0.5">
                <span class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide select-none">
                  Direction
                </span>
                <div class="grid grid-cols-3 gap-1">
                  <BaseNumericInput v-model="vp.lightDirX" label="X" :step="0.1" />
                  <BaseNumericInput v-model="vp.lightDirY" label="Y" :step="0.1" />
                  <BaseNumericInput v-model="vp.lightDirZ" label="Z" :step="0.1" />
                </div>
              </div>
            </div>
          </BaseSection>

        </div>

        <!-- Footer -->
        <div
          class="flex items-center justify-end px-4 py-3 shrink-0 border-t border-[var(--color-border)]"
          style="background: var(--color-bg-elevated)"
        >
          <BaseButton variant="solid" size="sm" @click="close">Close</BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useEditorStore }  from '@/stores/editorStore'
import BaseButton          from '@/components/base/BaseButton.vue'
import BaseIcon            from '@/components/base/BaseIcon.vue'
import BaseSection         from '@/components/base/BaseSection.vue'
import BaseNumericInput    from '@/components/base/BaseNumericInput.vue'

const editorStore = useEditorStore()

// Bind directly to the reactive object so changes take effect live in the viewport.
const vp = editorStore.viewportPrefs

function close(): void {
  editorStore.closeViewportSettings()
}
</script>
