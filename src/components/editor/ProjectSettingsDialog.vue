<template>
  <!-- Modal backdrop -->
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[9000] flex items-center justify-center"
      style="background: rgba(0,0,0,0.6)"
      @mousedown.self="close"
    >
      <!-- Dialog panel -->
      <div
        class="flex flex-col w-[520px] max-h-[80vh] rounded-lg border border-[var(--color-border)] shadow-2xl overflow-hidden"
        style="background: var(--color-bg-surface)"
      >
        <!-- Title bar -->
        <div
          class="flex items-center h-10 px-4 gap-2 shrink-0 border-b border-[var(--color-border)]"
          style="background: var(--color-bg-elevated)"
        >
          <BaseIcon name="settings" :size="14" class="text-[var(--color-accent)]" />
          <span class="flex-1 text-sm font-semibold text-[var(--color-text-primary)]">Project Settings</span>
          <BaseButton variant="ghost" size="xs" @click="close">
            <BaseIcon name="close" :size="12" />
          </BaseButton>
        </div>

        <!-- Tab strip -->
        <div
          class="flex items-center gap-0 shrink-0 border-b border-[var(--color-border)] px-2"
          style="background: var(--color-bg-elevated)"
        >
          <button
            v-for="tab in TABS"
            :key="tab.id"
            class="px-3 py-2 text-xs transition-colors select-none"
            :class="activeTab === tab.id
              ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] -mb-px'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'"
            @click="activeTab = tab.id"
          >{{ tab.label }}</button>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto">

          <!-- ── General tab ──────────────────────────────────────── -->
          <template v-if="activeTab === 'general'">

          <BaseSection title="General" :default-open="true">
            <div class="flex flex-col gap-2 py-1">
              <BaseInput v-model="form.name" label="Project Name" placeholder="My Project" />
              <!-- Description textarea -->
              <div class="flex flex-col gap-0.5">
                <label class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide select-none">
                  Description
                </label>
                <textarea
                  v-model="form.description"
                  rows="3"
                  placeholder="Project description…"
                  class="w-full px-2 py-1.5 text-xs rounded resize-none
                         bg-[var(--color-bg-base)] border border-[var(--color-border)]
                         text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]
                         focus:outline-none focus:border-[var(--color-accent)] transition-colors"
                />
              </div>
              <BaseInput v-model="form.author" label="Author" placeholder="Your name…" />
              <!-- Read-only metadata -->
              <div class="grid grid-cols-2 gap-2 pt-1">
                <div class="flex flex-col gap-0.5">
                  <span class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">Created</span>
                  <span class="text-xs text-[var(--color-text-secondary)]">{{ createdFormatted }}</span>
                </div>
                <div class="flex flex-col gap-0.5">
                  <span class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">Last Modified</span>
                  <span class="text-xs text-[var(--color-text-secondary)]">{{ modifiedFormatted }}</span>
                </div>
              </div>
            </div>
          </BaseSection>

          <!-- ── Compatibility tab ─────────────────────────────────── -->
          </template>
          <template v-if="activeTab === 'compatibility'">

          <BaseSection title="Compatibility" :default-open="true">
            <div class="flex flex-col gap-1 py-1">
              <p class="text-[11px] text-[var(--color-text-muted)] pb-1">
                Select which rendering back-ends this project targets.
                At runtime, the best available engine is selected automatically.
              </p>

              <!-- WebGPU -->
              <EngineRow
                engine="webgpu"
                label="WebGPU"
                description="Modern GPU API — best performance and feature set"
                :checked="form.engineTargets.includes('webgpu')"
                :available="supported.includes('webgpu')"
                :disabled="isLastChecked('webgpu')"
                @toggle="toggleEngine('webgpu')"
              />
              <!-- WebGL 2.0 -->
              <EngineRow
                engine="webgl2"
                label="WebGL 2.0"
                description="Widely supported — recommended baseline"
                :checked="form.engineTargets.includes('webgl2')"
                :available="supported.includes('webgl2')"
                :disabled="isLastChecked('webgl2')"
                @toggle="toggleEngine('webgl2')"
              />
              <!-- WebGL 1.0 -->
              <EngineRow
                engine="webgl1"
                label="WebGL 1.0"
                description="Legacy fallback — broadest device coverage"
                :checked="form.engineTargets.includes('webgl1')"
                :available="supported.includes('webgl1')"
                :disabled="isLastChecked('webgl1')"
                @toggle="toggleEngine('webgl1')"
              />

              <!-- Active engine status -->
              <div class="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--color-border)]">
                <span class="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wide">Active engine</span>
                <span
                  class="px-1.5 py-0.5 rounded text-[11px] font-medium"
                  :class="activeEngine
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                    : 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'"
                >
                  {{ activeEngine ? ENGINE_LABELS[activeEngine] : 'None — check compatibility settings' }}
                </span>
              </div>
            </div>
          </BaseSection>

          <!-- ── Plugins tab ──────────────────────────────────────── -->
          </template>
          <template v-if="activeTab === 'plugins'">
            <BaseSection title="Active Plugins" :default-open="true">
              <div class="flex flex-col gap-1 py-1">
                <p class="text-[11px] text-[var(--color-text-muted)] pb-2">
                  Enable plugins to extend the editor with new components and systems.
                  Built-in plugins are always available. External plugins must be
                  installed as npm packages before they can be activated.
                </p>

                <!-- No plugins registered at all -->
                <p
                  v-if="pluginStore.registeredPlugins.length === 0"
                  class="text-[11px] text-[var(--color-text-muted)] italic py-1"
                >No plugins registered.</p>

                <!-- Plugin rows -->
                <div
                  v-for="plugin in pluginStore.registeredPlugins"
                  :key="plugin.id"
                  class="flex items-start gap-3 px-2 py-2 rounded
                         border border-[var(--color-border)]
                         bg-[var(--color-bg-base)]"
                >
                  <input
                    type="checkbox"
                    :checked="form.activePlugins.includes(plugin.id)"
                    class="mt-0.5 shrink-0 accent-[var(--color-accent)]"
                    @change="togglePlugin(plugin.id)"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-medium text-[var(--color-text-primary)] truncate">
                        {{ plugin.displayName }}
                      </span>
                      <span
                        class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
                        :class="plugin.builtin
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                          : 'bg-[var(--color-text-muted)]/15 text-[var(--color-text-muted)]'"
                      >{{ plugin.builtin ? 'Built-in' : 'External' }}</span>
                      <span class="shrink-0 text-[10px] text-[var(--color-text-muted)] font-mono">
                        v{{ plugin.version }}
                      </span>
                    </div>
                    <p class="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                      {{ plugin.description }}
                    </p>
                    <p
                      v-if="!plugin.builtin"
                      class="text-[10px] text-[var(--color-text-muted)] mt-1 italic"
                    >Install via: <code class="font-mono">npm install {{ plugin.id }}</code></p>
                  </div>
                </div>
              </div>
            </BaseSection>
          </template>

        </div>

        <!-- Footer -->
        <div
          class="flex items-center justify-end gap-2 px-4 py-3 shrink-0 border-t border-[var(--color-border)]"
          style="background: var(--color-bg-elevated)"
        >
          <BaseButton variant="outline" size="sm" @click="close">Cancel</BaseButton>
          <BaseButton variant="solid" size="sm" :disabled="!canSave" @click="save">Apply</BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, computed, ref, watch } from 'vue'
import { useProjectStore }           from '@/stores/projectStore'
import { useEditorStore }            from '@/stores/editorStore'
import { usePluginStore }            from '@/stores/pluginStore'
import { useEngineCapabilities }     from '@/composables/useEngineCapabilities'
import { resolveActiveEngine }       from '@/lib/resolveEngine'
import type { EngineTarget }         from '@/types/project'
import BaseButton  from '@/components/base/BaseButton.vue'
import BaseIcon    from '@/components/base/BaseIcon.vue'
import BaseInput   from '@/components/base/BaseInput.vue'
import BaseSection from '@/components/base/BaseSection.vue'
import EngineRow   from './ProjectSettingsEngineRow.vue'

const projectStore  = useProjectStore()
const editorStore   = useEditorStore()
const pluginStore   = usePluginStore()
const { supported } = useEngineCapabilities()

// ── Tabs ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'general',       label: 'General'       },
  { id: 'compatibility', label: 'Compatibility'  },
  { id: 'plugins',       label: 'Plugins'        },
] as const

type TabId = typeof TABS[number]['id']
const activeTab = ref<TabId>('general')

const ENGINE_LABELS: Record<EngineTarget, string> = {
  webgpu:  'WebGPU',
  webgl2:  'WebGL 2.0',
  webgl1:  'WebGL 1.0',
}

// ── Local form state (cloned from store on open) ───────────────────────────

interface Form {
  name:          string
  description:   string
  author:        string
  engineTargets: EngineTarget[]
  activePlugins: string[]
}

const form = reactive<Form>({
  name:          '',
  description:   '',
  author:        '',
  engineTargets: ['webgl1', 'webgl2', 'webgpu'],
  activePlugins: [],
})

// Sync from store whenever meta changes (or dialog opens)
watch(
  () => projectStore.meta,
  (m) => {
    if (!m) return
    form.name          = m.name
    form.description   = m.description
    form.author        = m.author
    form.engineTargets = [...m.engineTargets]
    form.activePlugins = [...(m.activePlugins ?? [])]
  },
  { immediate: true },
)

// ── Computed helpers ───────────────────────────────────────────────────────

const createdFormatted  = computed(() =>
  projectStore.meta ? new Date(projectStore.meta.created).toLocaleDateString() : '—')

const modifiedFormatted = computed(() =>
  projectStore.meta ? new Date(projectStore.meta.lastModified).toLocaleDateString() : '—')

const activeEngine = computed(() =>
  resolveActiveEngine(supported.value as EngineTarget[], form.engineTargets))

const canSave = computed(() => form.name.trim().length > 0 && form.engineTargets.length > 0)

// Prevent removing the last checked engine target
function isLastChecked(engine: EngineTarget): boolean {
  return form.engineTargets.includes(engine) && form.engineTargets.length === 1
}

function togglePlugin(id: string): void {
  const idx = form.activePlugins.indexOf(id)
  if (idx === -1) {
    form.activePlugins.push(id)
  } else {
    form.activePlugins.splice(idx, 1)
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

function toggleEngine(engine: EngineTarget): void {
  const idx = form.engineTargets.indexOf(engine)
  if (idx === -1) {
    form.engineTargets.push(engine)
  } else if (form.engineTargets.length > 1) {
    form.engineTargets.splice(idx, 1)
  }
}

async function save(): Promise<void> {
  await projectStore.updateSettings({
    name:          form.name.trim(),
    description:   form.description,
    author:        form.author,
    engineTargets: [...form.engineTargets],
    activePlugins: [...form.activePlugins],
  })
  editorStore.closeProjectSettings()
}

function close(): void {
  editorStore.closeProjectSettings()
}
</script>
