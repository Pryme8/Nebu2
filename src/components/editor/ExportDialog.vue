<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[9000] flex items-center justify-center"
      style="background: rgba(0,0,0,0.65)"
      @mousedown.self="cancel"
    >
      <!-- Dialog panel -->
      <div
        class="flex flex-col w-[560px] max-h-[85vh] rounded-lg border border-[var(--color-border)] shadow-2xl overflow-hidden"
        style="background: var(--color-bg-surface)"
      >
        <!-- Title bar -->
        <div
          class="flex items-center h-10 px-4 gap-2 shrink-0 border-b border-[var(--color-border)]"
          style="background: var(--color-bg-elevated)"
        >
          <BaseIcon name="export" :size="14" class="text-[var(--color-accent)]" />
          <span class="flex-1 text-sm font-semibold text-[var(--color-text-primary)]">Export Project</span>
          <BaseButton variant="ghost" size="xs" :disabled="exportStore.isExporting" @click="cancel">
            <BaseIcon name="close" :size="12" />
          </BaseButton>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto">

          <!-- ── Output settings ───────────────────────────────────── -->
          <BaseSection title="Output" :default-open="true">
            <div class="flex flex-col gap-2 py-1">
              <BaseInput v-model="form.outputName" label="Output Name" placeholder="MyGame" />
              <BaseInput v-model="form.title"      label="Page Title"  placeholder="My Game" />

              <div class="flex flex-col gap-0.5">
                <label class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide select-none">
                  Engine Target
                </label>
                <div class="flex gap-2">
                  <label
                    v-for="target in ENGINE_TARGETS"
                    :key="target"
                    class="flex items-center gap-1.5 cursor-pointer select-none text-xs text-[var(--color-text-secondary)]"
                  >
                    <input
                      type="radio"
                      :value="target"
                      v-model="form.engineTarget"
                      class="accent-[var(--color-accent)]"
                    />
                    {{ target }}
                  </label>
                </div>
              </div>

              <!-- Export Mode -->
              <div class="flex flex-col gap-0.5">
                <label class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide select-none">
                  Export Mode
                </label>
                <div class="flex gap-2">
                  <label
                    class="flex items-center gap-1.5 cursor-pointer select-none text-xs text-[var(--color-text-secondary)]"
                  >
                    <input
                      type="radio"
                      value="inline"
                      v-model="form.exportMode"
                      class="accent-[var(--color-accent)]"
                    />
                    Self-Contained
                  </label>
                  <label
                    class="flex items-center gap-1.5 cursor-pointer select-none text-xs text-[var(--color-text-secondary)]"
                  >
                    <input
                      type="radio"
                      value="file-based"
                      v-model="form.exportMode"
                      class="accent-[var(--color-accent)]"
                    />
                    File-Based
                  </label>
                </div>
                <p class="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                  <template v-if="form.exportMode === 'inline'">
                    All data embedded in a single <code class="text-[var(--color-accent)]">index.html</code>.
                    Works directly from file:// — no server needed.
                  </template>
                  <template v-else>
                    Separate scene / asset files alongside <code class="text-[var(--color-accent)]">index.html</code>.
                    Smaller HTML for large projects.
                  </template>
                </p>
                <div
                  v-if="form.exportMode === 'file-based'"
                  class="mt-1 px-2 py-1.5 rounded text-[11px] text-yellow-300
                         border border-yellow-500/40 bg-yellow-500/10"
                >
                  ⚠ Requires a web server — won't work from
                  <code>file://</code>. Run
                  <code class="text-yellow-200">npx serve {{ form.outputName || 'MyGame' }}</code>
                  after unzipping.
                </div>
              </div>
            </div>
          </BaseSection>

          <!-- ── Scene selection ───────────────────────────────────── -->
          <BaseSection title="Scenes" :default-open="true">
            <div class="flex flex-col gap-1 py-1">
              <template v-if="exportStore.availableScenes.length === 0">
                <span class="text-xs text-[var(--color-text-muted)] italic py-1">
                  No scenes found in this project.
                </span>
              </template>
              <label
                v-for="scene in exportStore.availableScenes"
                :key="scene.guid"
                class="flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer select-none
                       hover:bg-[var(--color-bg-highlight)] transition-colors"
              >
                <input
                  type="checkbox"
                  :value="scene"
                  v-model="form.selectedScenes"
                  class="accent-[var(--color-accent)]"
                />
                <span class="text-xs text-[var(--color-text-primary)]">{{ scene.name }}</span>
                <span class="text-[11px] text-[var(--color-text-muted)] ml-auto truncate max-w-[160px]">
                  {{ scene.relPath }}
                </span>
              </label>
            </div>
            <p v-if="form.selectedScenes.length > 1" class="text-[11px] text-[var(--color-text-muted)] mt-1 italic">
              Multiple scenes: a scene-selector dropdown will be included in the page.
            </p>
          </BaseSection>

          <!-- ── Template ──────────────────────────────────────────── -->
          <BaseSection title="Page Template" :default-open="true">
            <div class="flex flex-col gap-2 py-1">
              <!-- Template cards -->
              <div class="flex flex-col gap-1.5">
                <label
                  v-for="tpl in exportStore.availableTemplates"
                  :key="tpl.id"
                  class="flex items-start gap-2.5 px-2.5 py-2 rounded border cursor-pointer select-none transition-colors"
                  :class="form.templateId === tpl.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'"
                >
                  <input
                    type="radio"
                    :value="tpl.id"
                    v-model="form.templateId"
                    class="mt-0.5 accent-[var(--color-accent)]"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs font-medium text-[var(--color-text-primary)]">{{ tpl.name }}</span>
                    <span class="text-[11px] text-[var(--color-text-muted)]">{{ tpl.description }}</span>
                  </div>
                </label>
              </div>

              <!-- Custom HTML textarea (only when 'custom' is selected) -->
              <template v-if="form.templateId === 'custom'">
                <div class="flex flex-col gap-0.5 mt-1">
                  <label class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide select-none">
                    Custom HTML
                    <span class="normal-case ml-1 text-[var(--color-text-muted)]">
                      — use <code class="text-[var(--color-accent)]">&#123;&#123;TITLE&#125;&#125;</code>,
                      <code class="text-[var(--color-accent)]">&#123;&#123;SCENE_SELECT_HTML&#125;&#125;</code>,
                      <code class="text-[var(--color-accent)]">&#123;&#123;MANIFEST_JSON&#125;&#125;</code>
                    </span>
                  </label>
                  <textarea
                    v-model="form.customHtml"
                    rows="10"
                    placeholder="<!DOCTYPE html>…"
                    spellcheck="false"
                    class="w-full px-2 py-1.5 text-xs rounded resize-y font-mono
                           bg-[var(--color-bg-base)] border border-[var(--color-border)]
                           text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]
                           focus:outline-none focus:border-[var(--color-accent)] transition-colors"
                  />
                </div>
              </template>
            </div>
          </BaseSection>

          <!-- ── What's included note ───────────────────────────────── -->
          <BaseSection title="What's Included" :default-open="false">
            <ul class="flex flex-col gap-1 py-1 text-[11px] text-[var(--color-text-secondary)]">
              <li class="flex gap-1.5 items-start"><span class="text-green-400 mt-0.5">✔</span> Scene data (entities, hierarchy, settings)</li>
              <li class="flex gap-1.5 items-start"><span class="text-green-400 mt-0.5">✔</span> All binary assets (meshes, textures, audio)</li>
              <li class="flex gap-1.5 items-start"><span class="text-green-400 mt-0.5">✔</span> Materials (Standard, PBR) with textures</li>
              <li class="flex gap-1.5 items-start"><span class="text-green-400 mt-0.5">✔</span> Scripts (TypeScript → JavaScript), full NebuScript lifecycle</li>
              <li class="flex gap-1.5 items-start"><span class="text-green-400 mt-0.5">✔</span> Lights &amp; shadows, cameras, Havok physics</li>
              <li class="flex gap-1.5 items-start"><span class="text-[var(--color-text-muted)] mt-0.5">◦</span> Runtime uses Babylon.js from CDN (internet required)</li>
              <li class="flex gap-1.5 items-start"><span class="text-yellow-400 mt-0.5">⚠</span> Imported mesh assets (GLB/GLTF) are not reconstructed yet</li>
              <li class="flex gap-1.5 items-start"><span class="text-yellow-400 mt-0.5">⚠</span> Shader / Custom / PBRCustom materials are not supported yet</li>
            </ul>
          </BaseSection>

        </div>

        <!-- Error bar -->
        <div
          v-if="exportStore.errorMessage"
          class="shrink-0 px-4 py-2 text-xs text-red-400 border-t border-[var(--color-border)]"
          style="background: var(--color-bg-elevated)"
        >
          {{ exportStore.errorMessage }}
        </div>

        <!-- Progress bar (visible while exporting) -->
        <div
          v-if="exportStore.isExporting"
          class="shrink-0 mx-4 mb-2 mt-1 rounded-full overflow-hidden h-1"
          style="background: var(--color-bg-base)"
        >
          <div
            class="h-full rounded-full transition-all duration-150"
            style="background: var(--color-accent)"
            :style="{ width: `${(exportStore.progress * 100).toFixed(0)}%` }"
          />
        </div>

        <!-- Footer buttons -->
        <div
          class="flex items-center justify-end gap-2 px-4 py-3 shrink-0 border-t border-[var(--color-border)]"
          style="background: var(--color-bg-elevated)"
        >
          <BaseButton variant="ghost" size="sm" :disabled="exportStore.isExporting" @click="cancel">
            Cancel
          </BaseButton>
          <BaseButton
            variant="solid"
            size="sm"
            :disabled="exportStore.isExporting || form.selectedScenes.length === 0"
            @click="doExport"
          >
            <span v-if="exportStore.isExporting">Exporting…</span>
            <span v-else>Export ZIP</span>
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, watch }       from 'vue'
import BaseButton                from '@/components/base/BaseButton.vue'
import BaseIcon                  from '@/components/base/BaseIcon.vue'
import BaseInput                 from '@/components/base/BaseInput.vue'
import BaseSection               from '@/components/base/BaseSection.vue'
import { useExportStore }        from '@/stores/exportStore'
import { useEditorStore }        from '@/stores/editorStore'
import { useProjectStore }       from '@/stores/projectStore'
import type { ExportSceneEntry, ExportMode } from '@/types/export'
import type { EngineTarget }                 from '@/types/project'

const ENGINE_TARGETS: EngineTarget[] = ['webgpu', 'webgl2', 'webgl1']

const exportStore  = useExportStore()
const editorStore  = useEditorStore()
const projectStore = useProjectStore()

// Form state — initialised from the project meta and available scenes.
const form = reactive<{
  outputName:     string
  title:          string
  engineTarget:   EngineTarget
  exportMode:     ExportMode
  templateId:     string
  customHtml:     string
  selectedScenes: ExportSceneEntry[]
}>({
  outputName:     sanitizeName(projectStore.projectName ?? 'MyGame'),
  title:          projectStore.projectName ?? 'My Game',
  engineTarget:   projectStore.meta?.engineTargets?.[0] ?? 'webgpu',
  exportMode:     'inline',
  templateId:     'game-page',
  customHtml:     '',
  selectedScenes: [],
})

// Pre-select all scenes when the store has them loaded
watch(
  () => exportStore.availableScenes,
  (scenes) => {
    if (form.selectedScenes.length === 0 && scenes.length > 0) {
      form.selectedScenes = [...scenes]
    }
  },
  { immediate: true },
)

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'MyGame'
}

function cancel(): void {
  if (!exportStore.isExporting) editorStore.closeExportDialog()
}

async function doExport(): Promise<void> {
  await exportStore.exportProject({
    outputName:   sanitizeName(form.outputName) || 'MyGame',
    title:        form.title || 'My Game',
    engineTarget: form.engineTarget,
    exportMode:   form.exportMode,
    templateId:   form.templateId,
    customHtml:   form.customHtml || undefined,
    scenes:       form.selectedScenes,
  })
  if (!exportStore.errorMessage) editorStore.closeExportDialog()
}
</script>
