<template>
  <!-- Inspector Panel — shows components of selected entity/entities -->
  <div class="flex flex-col h-full" @click="showAddMenu = false">
    <!-- No selection -->
    <div v-if="selected.length === 0 && !selectedScene && !selectedMaterial && !selectedTexture && !selectedScript && !selectedModel" class="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
      Select an entity or scene to inspect.
    </div>

    <!-- Scene selected -->
    <template v-else-if="selectedScene">
      <div class="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <BaseIcon name="scene" :size="13" class="shrink-0 text-[var(--color-accent)]" />
        <span class="flex-1 text-sm font-medium text-[var(--color-text-primary)] truncate">
          {{ selectedScene.name }}
        </span>
      </div>
      <div class="flex-1 overflow-y-auto">
        <ComponentInspector :component="selectedScene.settings" />
      </div>
    </template>

    <!-- Material selected -->
    <template v-else-if="selectedMaterial">
      <div class="flex-1 overflow-y-auto">
        <MaterialPreviewCanvas
          :material="selectedMaterial"
          @preview="onMaterialPreview"
        />
        <ComponentInspector
          :component="selectedMaterial"
          :removable="false"
        />
      </div>
    </template>

    <!-- Texture selected -->
    <template v-else-if="selectedTexture">
      <div class="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <BaseIcon name="texture" :size="13" class="shrink-0 text-[var(--color-text-secondary)]" />
        <span class="flex-1 text-sm font-medium text-[var(--color-text-primary)] truncate">
          {{ selectedTexture.name }}
        </span>
      </div>
      <div class="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-3">
        <!-- Thumbnail -->
        <div class="flex justify-center">
          <div class="rounded border border-[var(--color-border)] overflow-hidden" style="width:128px;height:128px;">
            <img
              v-if="selectedTexture.meta.thumbnail"
              :src="selectedTexture.meta.thumbnail"
              class="w-full h-full object-cover"
              draggable="false"
            />
            <div
              v-else
              class="w-full h-full"
              style="background: repeating-conic-gradient(#888 0% 25%, #444 0% 50%) 0 0 / 16px 16px;"
            />
          </div>
        </div>
        <!-- Info rows -->
        <div class="flex flex-col gap-1 text-xs">
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">Type</span>
            <span class="text-[var(--color-text-secondary)] capitalize">{{ selectedTexture.meta.type }}</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">Source</span>
            <span class="text-[var(--color-text-secondary)] break-all">{{ selectedTexture.meta.originalPath }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">GUID</span>
            <span class="text-[var(--color-text-muted)] font-mono text-[10px] break-all">{{ selectedTexture.meta.guid }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Script selected for editing ─────────────────────────────────── -->
    <template v-else-if="selectedScript">
      <div class="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <BaseIcon name="script" :size="13" class="shrink-0 text-[var(--color-accent)]/70" />
        <span class="flex-1 text-sm font-medium text-[var(--color-text-primary)] truncate">
          {{ selectedScript.split(/[/\\]/).pop()?.replace(/\.ts$/, '') ?? selectedScript }}
          <span class="text-[var(--color-text-muted)] font-normal text-xs">.ts</span>
        </span>
        <button
          class="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          title="Close"
          @click="editorStore.selectScript(null)"
        >
          <BaseIcon name="close" :size="10" />
        </button>
      </div>
      <div class="flex-1 flex flex-col min-h-0 px-2 py-2 gap-1.5">
        <div class="text-[10px] text-[var(--color-text-muted)]">
          Editing in <strong>Script Editor</strong> panel below. Double-click the file in Files to open it there.
        </div>
        <BaseButton variant="outline" size="sm" class="w-full justify-center" @click="editorStore.selectScript(null)">
          Done
        </BaseButton>
      </div>
    </template>

    <!-- Model asset selected -->
    <template v-else-if="selectedModel">
      <div class="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <BaseIcon name="model" :size="13" class="shrink-0 text-[var(--color-accent)]/75" />
        <span class="flex-1 text-sm font-medium text-[var(--color-text-primary)] truncate">
          {{ selectedModel.name }}
        </span>
      </div>
      <div class="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-3">
        <!-- Model info -->
        <div class="flex flex-col gap-1 text-xs" v-if="selectedModel.meta.modelInfo">
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">Triangles</span>
            <span class="text-[var(--color-text-secondary)]">{{ selectedModel.meta.modelInfo.triangleCount.toLocaleString() }}</span>
          </div>
          <div class="flex items-start gap-2">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">Meshes</span>
            <span class="text-[var(--color-text-secondary)]">{{ selectedModel.meta.modelInfo.meshNames.length }}</span>
          </div>
          <template v-if="selectedModel.meta.modelInfo.meshNames.length > 0">
            <div class="ml-[88px] flex flex-col gap-0.5">
              <span
                v-for="name in selectedModel.meta.modelInfo.meshNames" :key="name"
                class="text-[10px] text-[var(--color-text-muted)] font-mono truncate"
              >{{ name }}</span>
            </div>
          </template>
          <div class="flex items-start gap-2 mt-1">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">Materials</span>
            <span class="text-[var(--color-text-secondary)]">{{ selectedModel.meta.modelInfo.materialNames.length }}</span>
          </div>
          <template v-if="selectedModel.meta.modelInfo.materialNames.length > 0">
            <div class="ml-[88px] flex flex-col gap-0.5">
              <span
                v-for="name in selectedModel.meta.modelInfo.materialNames" :key="name"
                class="text-[10px] text-[var(--color-text-muted)] font-mono truncate"
              >{{ name }}</span>
            </div>
          </template>
          <div class="flex items-start gap-2 mt-1">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">Textures</span>
            <span class="text-[var(--color-text-secondary)]">{{ selectedModel.meta.modelInfo.textureNames.length }}</span>
          </div>
          <template v-if="selectedModel.meta.modelInfo.textureNames.length > 0">
            <div class="ml-[88px] flex flex-col gap-0.5">
              <span
                v-for="name in selectedModel.meta.modelInfo.textureNames" :key="name"
                class="text-[10px] text-[var(--color-text-muted)] font-mono truncate"
              >{{ name }}</span>
            </div>
          </template>
        </div>
        <div v-else class="text-xs text-[var(--color-text-muted)] italic">
          Model info not available — try re-importing.
        </div>
        <!-- Source / GUID -->
        <div class="flex flex-col gap-1 text-xs border-t border-[var(--color-border)] pt-2">
          <div class="flex items-start gap-2">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">Source</span>
            <span class="text-[var(--color-text-secondary)] break-all">{{ selectedModel.meta.originalPath }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-[var(--color-text-muted)]">GUID</span>
            <span class="text-[var(--color-text-muted)] font-mono text-[10px] break-all">{{ selectedModel.meta.guid }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Entity / entities selected -->
    <template v-else>
      <!-- Entity header -->
      <div class="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <!-- Editable name (single selection only) -->
        <input
          v-if="selected.length === 1"
          :value="primary!.name"
          class="flex-1 text-sm font-medium bg-transparent border-b border-transparent
                 focus:border-[var(--color-accent)] focus:outline-none text-[var(--color-text-primary)] px-0"
          @change="rename(($event.target as HTMLInputElement).value)"
        />
        <span v-else class="flex-1 text-sm font-medium text-[var(--color-text-muted)] truncate">
          {{ selected.length }} Entities
        </span>
        <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] select-none shrink-0">
          <input
            ref="activeCheckboxRef"
            type="checkbox"
            :checked="allActive"
            @change="toggleActive"
            class="accent-[var(--color-accent)]"
          />
          Active
        </label>
      </div>

      <!-- Tags (single selection only) -->
      <div v-if="selected.length === 1" class="px-2 py-1 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        <span
          v-for="tag in primary!.tags" :key="tag"
          class="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-bg-overlay)] text-[var(--color-text-muted)]"
        >{{ tag }}</span>
        <span class="text-[10px] text-[var(--color-text-muted)] italic" v-if="!primary!.tags.length">No tags</span>
      </div>

      <!-- Transform component (all selected entities must have it) -->
      <div class="flex-1 overflow-y-auto">

        <!-- ── Prefab instance banner ──────────────────────────── -->
        <div
          v-if="prefabInstance && selected.length === 1"
          class="mx-2 mt-2 mb-1 rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/8"
        >
          <!-- Header -->
          <div class="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-accent)]/20">
            <BaseIcon name="prefab" :size="11" class="shrink-0 text-[var(--color-accent)]" />
            <span class="flex-1 text-[11px] font-medium text-[var(--color-accent)] truncate">
              {{ prefabInstance.prefabName }}
            </span>
            <span class="text-[9px] text-[var(--color-text-muted)] font-mono">prefab</span>
          </div>
          <!-- Actions -->
          <div class="flex flex-col gap-1 px-2 py-1.5">
            <!-- Transform axis toggles for apply-to-all -->
            <div class="flex items-center gap-2 pb-0.5">
              <span class="text-[9px] text-[var(--color-text-muted)] shrink-0">Apply transform:</span>
              <label class="flex items-center gap-0.5 cursor-pointer" title="Include position in apply">
                <input type="checkbox" v-model="applyPos" class="accent-[var(--color-accent)] w-2.5 h-2.5" />
                <span class="text-[9px] text-[var(--color-text-secondary)]">Pos</span>
              </label>
              <label class="flex items-center gap-0.5 cursor-pointer" title="Include rotation in apply">
                <input type="checkbox" v-model="applyRot" class="accent-[var(--color-accent)] w-2.5 h-2.5" />
                <span class="text-[9px] text-[var(--color-text-secondary)]">Rot</span>
              </label>
              <label class="flex items-center gap-0.5 cursor-pointer" title="Include scale in apply">
                <input type="checkbox" v-model="applyScale" class="accent-[var(--color-accent)] w-2.5 h-2.5" />
                <span class="text-[9px] text-[var(--color-text-secondary)]">Scale</span>
              </label>
            </div>
            <BaseButton
              variant="outline" size="xs" class="w-full justify-center text-[10px]"
              title="Overwrite the source prefab file with the current state of this instance, then update all other instances in the scene"
              @click="applyToAll"
            >
              Apply changes to all
            </BaseButton>
            <BaseButton
              variant="outline" size="xs" class="w-full justify-center text-[10px]"
              title="Save this instance as a new, independent prefab file (breaks link to original)"
              @click="saveAsUnique"
            >
              Save as unique prefab
            </BaseButton>
            <BaseButton
              variant="ghost" size="xs" class="w-full justify-center text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              title="Discard local changes and restore the original prefab state"
              @click="revertInstance"
            >
              Revert to original
            </BaseButton>
          </div>
        </div>
        <BaseSection v-if="hasTransform" title="Transform">
          <div class="grid grid-cols-3 gap-1">
            <span class="col-span-3 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">Position</span>
            <BaseNumericInput v-model="tx" label="X" :step="0.1" />
            <BaseNumericInput v-model="ty" label="Y" :step="0.1" />
            <BaseNumericInput v-model="tz" label="Z" :step="0.1" />

            <span class="col-span-3 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mt-1">Rotation</span>
            <BaseNumericInput v-model="rx" label="X" :step="1" />
            <BaseNumericInput v-model="ry" label="Y" :step="1" />
            <BaseNumericInput v-model="rz" label="Z" :step="1" />

            <span class="col-span-3 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mt-1">Scale</span>
            <BaseNumericInput v-model="sx" label="X" :step="0.01" />
            <BaseNumericInput v-model="sy" label="Y" :step="0.01" />
            <BaseNumericInput v-model="sz" label="Z" :step="0.01" />
          </div>
        </BaseSection>

        <!-- Dynamic components (Light, Camera, Mesh, etc.) — single selection only -->
        <template v-if="selected.length === 1">
          <template v-for="comp in dynamicComponents" :key="comp.type">
            <!-- Script component: show picker when unbound, edit button when bound -->
            <template v-if="comp.type.startsWith('Script:')">
              <!-- Control row: edit + remove buttons -->
              <div class="flex items-center gap-1 px-2 pt-1.5 pb-0 border-t border-[var(--color-border)] first:border-t-0">
                <span class="flex-1 text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide truncate">
                  {{ scriptSectionTitle(comp as unknown as ScriptComponent) }}
                </span>
                <button
                  v-if="(comp as unknown as ScriptComponent).scriptGuid"
                  class="opacity-60 hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] rounded"
                  title="Edit script in Script Editor"
                  @click.stop="openScriptEditor(comp as unknown as ScriptComponent)"
                >
                  <BaseIcon name="script" :size="10" />
                </button>
                <button
                  class="opacity-60 hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] rounded"
                  title="Remove component"
                  @click.stop="removeComponent(comp.type)"
                >
                  <BaseIcon name="close" :size="9" />
                </button>
              </div>

              <!-- Script picker (when unbound) -->
              <div
                v-if="!(comp as unknown as ScriptComponent).scriptGuid"
                class="px-2 pb-2"
                @dragover.prevent="(e: DragEvent) => { if (e.dataTransfer?.types.includes('application/nebu-script')) e.dataTransfer!.dropEffect = 'copy' }"
                @drop.prevent="(e: DragEvent) => { const guid = e.dataTransfer?.getData('application/nebu-script'); if (guid) assignScript(comp as unknown as ScriptComponent, guid) }"
              >
                <select
                  class="w-full h-6 px-1 text-xs rounded
                         bg-[var(--color-bg-base)] border border-[var(--color-border)]
                         text-[var(--color-text-primary)]
                         focus:outline-none focus:border-[var(--color-accent)]"
                  @change="e => assignScript(comp as unknown as ScriptComponent, (e.target as HTMLSelectElement).value)"
                >
                  <option value="">— Select script —</option>
                  <option
                    v-for="guid in scriptStore.scriptGuids"
                    :key="guid"
                    :value="guid"
                  >{{ scriptStore.getEntry(guid)?.name ?? guid.slice(0, 8) }}</option>
                </select>
                <div class="mt-1 text-[10px] text-[var(--color-text-muted)] italic">
                  <template v-if="scriptStore.scriptGuids.length === 0">No scripts yet — create one in the Files panel.</template>
                  <template v-else>Or drag a script file here from the Files panel.</template>
                </div>
              </div>

              <!-- Bound: delegate to ComponentInspector for exposed props (schema driven) -->
              <ComponentInspector
                v-if="(comp as unknown as ScriptComponent).scriptGuid"
                :component="comp"
                :removable="false"
              />

              <!-- Error badge -->
              <div
                v-if="(comp as unknown as ScriptComponent)._error"
                class="mx-2 mb-2 text-[10px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 rounded px-2 py-1"
              >
                {{ (comp as unknown as ScriptComponent)._error }}
              </div>
            </template>

            <!-- All other components -->
            <ComponentInspector
              v-else
              :component="comp"
              :removable="true"
              @remove="removeComponent(comp.type)"
            />
          </template>
          <!-- Material inspector — shown below the Mesh component when a material is bound -->
          <ComponentInspector
            v-if="boundMaterial"
            :component="boundMaterial"
            :removable="false"
          />
        </template>

        <!-- Add Component -->
        <div class="relative px-3 py-2" @click.stop>
          <BaseButton variant="outline" size="sm" class="w-full justify-center" @click="showAddMenu = !showAddMenu">
            <BaseIcon name="add" :size="11" />
            Add Component
          </BaseButton>
          <div
            v-if="showAddMenu"
            class="absolute bottom-full left-3 right-3 mb-0.5 z-50 rounded
                   border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-lg py-0.5"
          >
            <button
              v-for="item in addableComponents"
              :key="item.componentType"
              class="w-full text-left px-3 py-1 text-xs text-[var(--color-text-secondary)]
                     hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]
                     disabled:opacity-40 disabled:pointer-events-none"
              :disabled="primary?.hasComponent(item.componentType)"
              @click="addComponent(item)"
            >
              {{ item.label }}
            </button>

            <!-- Scripts section: single generic 'Script' slot ──────────── -->
            <div class="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide border-t border-[var(--color-border)] mt-0.5">
              Scripting
            </div>
            <button
              class="w-full text-left px-3 py-1 text-xs text-[var(--color-text-secondary)]
                     hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]"
              @click="addScriptSlot"
            >
              <BaseIcon name="script" :size="10" class="inline mr-1 -mt-0.5" />
              Script
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'
import { useEditorStore }             from '@/stores/editorStore'
import { useSceneStore }              from '@/stores/sceneStore'
import { useCommandStore }            from '@/stores/commandStore'
import { useLayerStore }              from '@/stores/layerStore'
import { useMaterialStore }           from '@/stores/materialStore'
import { useAssetStore }              from '@/stores/assetStore'
import { useProjectStore }            from '@/stores/projectStore'
import { usePluginStore }             from '@/stores/pluginStore'
import { useScriptStore }             from '@/stores/scriptStore'
import { RenameEntityCommand, SetEntityActiveCommand } from '@/core/commands/entity'
import { AddComponentCommand, RemoveComponentCommand } from '@/core/commands/component'
import { TransformComponent }         from '@/core/ecs/components/TransformComponent'
import { LightComponent }             from '@/core/ecs/components/LightComponent'
import { CameraComponent }            from '@/core/ecs/components/CameraComponent'
import { MeshComponent }              from '@/core/ecs/components/MeshComponent'
import { AnimationComponent }         from '@/core/ecs/components/AnimationComponent'
import { ScriptComponent }            from '@/core/ecs/components/ScriptComponent'
import { TransformChangedEvent }      from '@/core/layers/events'
import type { Component }             from '@/core/ecs/Component'
import type { MaterialDef }           from '@/core/materials/MaterialDef'
import BaseSection        from '@/components/base/BaseSection.vue'
import BaseNumericInput   from '@/components/base/BaseNumericInput.vue'
import BaseButton         from '@/components/base/BaseButton.vue'
import BaseIcon           from '@/components/base/BaseIcon.vue'
import ComponentInspector from './ComponentInspector.vue'
import MaterialPreviewCanvas from './MaterialPreviewCanvas.vue'

import { PrefabInstanceComponent } from '@/core/ecs/components/PrefabInstanceComponent'

const editorStore    = useEditorStore()
const sceneStore     = useSceneStore()
const commandStore   = useCommandStore()
const layerStore     = useLayerStore()
const materialStore  = useMaterialStore()
const assetStore     = useAssetStore()
const projectStore   = useProjectStore()
const pluginStore    = usePluginStore()
const scriptStore    = useScriptStore()

// ── Selection ────────────────────────────────────────────────────
/** All currently selected entities (reactive via entityList → worldRevision). */
const selected = computed(() => {
  const ids = editorStore.selectedIds
  return sceneStore.entityList.filter(e => ids.has(e.id))
})

const primary = computed(() => selected.value[0] ?? null)

// ── Scene selection ────────────────────────────────────────────────
const selectedScene = computed(() => {
  const guid = editorStore.selectedSceneGuid
  if (!guid) return null
  return sceneStore.activeScene?.guid === guid ? sceneStore.activeScene : null
})

// ── Material selection ─────────────────────────────────────────────
const selectedMaterial = computed<MaterialDef | null>(() => {
  const id = editorStore.selectedMaterialId
  if (!id) return null
  return materialStore.getMaterial(id) ?? null
})

// ── Texture selection ──────────────────────────────────────────────
const selectedTexture = computed(() => {
  const guid = editorStore.selectedTextureGuid
  if (!guid) return null
  return assetStore.assetList.find(e => e.meta.guid === guid) ?? null
})

// ── Script selection ───────────────────────────────────────────────
const selectedScript = computed(() => editorStore.selectedScriptRelPath)

// ── Model selection ────────────────────────────────────────────────
const selectedModel = computed(() => {
  const guid = editorStore.selectedModelGuid
  if (!guid) return null
  return assetStore.assetList.find(e => e.meta.guid === guid) ?? null
})

let _saveTimer:  ReturnType<typeof setTimeout> | null = null
let _matUnsub:   (() => void) | null = null

// When the selected material changes, subscribe to its onChange for debounced auto-save.
watch(selectedMaterial, mat => {
  _matUnsub?.()
  _matUnsub = null
  if (!mat) return
  _matUnsub = mat.onChange(() => {
    if (_saveTimer !== null) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(async () => {
      _saveTimer = null
      await projectStore.saveMaterialAsset(mat.id)
    }, 500)
  })
}, { immediate: true })

async function onMaterialPreview(dataUrl: string): Promise<void> {
  const id = editorStore.selectedMaterialId
  if (id) await projectStore.saveMaterialPreview(id, dataUrl)
}

/** PrefabInstance component on the primary entity, if present. */
const prefabInstance = computed(() => {
  sceneStore.entityList
  return primary.value?.getComponent<PrefabInstanceComponent>('PrefabInstance') ?? null
})

// Transform axis toggles for "apply to all" (default: all off so positions are preserved)
const applyPos   = ref(false)
const applyRot   = ref(false)
const applyScale = ref(false)

function applyToAll(): void {
  if (!primary.value) return
  projectStore.applyPrefabToSource(primary.value.id, {
    position: applyPos.value,
    rotation: applyRot.value,
    scale:    applyScale.value,
  })
}

function saveAsUnique(): void {
  if (!primary.value) return
  projectStore.saveInstanceAsUniquePrefab(primary.value.id)
}

function revertInstance(): void {
  if (!primary.value) return
  projectStore.revertPrefabInstance(primary.value.id)
}

// ── Dynamic (non-system) components ─────────────────────────────
const SYSTEM_TYPES = new Set(['Name', 'Tag', 'Active', 'Transform', 'PrefabInstance'])

/** Non-system components on the primary entity shown via ComponentInspector. */
const dynamicComponents = computed<Component[]>(() => {
  // Explicitly depend on entityList so this recomputes whenever worldRevision
  // bumps (e.g. when a component is added or removed).
  sceneStore.entityList
  if (!primary.value) return []
  return [...primary.value.components].filter(c => !SYSTEM_TYPES.has(c.type))
})

// ── Add Component ────────────────────────────────────────────────
 const showAddMenu = ref(false)

interface AddableItem { label: string; componentType: string; factory: () => Component }

/** Core components always available regardless of plugins. */
const _coreComponents: AddableItem[] = [
  { label: 'Light (Hemispheric)', componentType: 'Light',     factory: () => new LightComponent()     },
  { label: 'Camera',              componentType: 'Camera',    factory: () => new CameraComponent()    },
  { label: 'Mesh',                componentType: 'Mesh',      factory: () => new MeshComponent()      },
  { label: 'Animation',           componentType: 'Animation', factory: () => new AnimationComponent() },
]

/**
 * Full addable component list: core components + script components +
 * anything contributed by currently active plugins.
 * Stays reactive — updates automatically when plugins are activated /
 * deactivated or when new scripts are compiled.
 */
const addableComponents = computed<AddableItem[]>(() => [
  ..._coreComponents,
  ...pluginStore.pluginComponentDefs.map(def => ({
    label:         def.label,
    componentType: def.type,
    factory:       def.factory,
  })),
])

// ── Bound material (for Mesh component inspector) ─────────────────
/** When the primary entity's Mesh component has a materialId set, render
 *  that MaterialDef as a second inspector section below the mesh. */
const boundMaterial = computed<MaterialDef | null>(() => {
  sceneStore.entityList  // track worldRevision so this reacts to component changes
  const mesh = primary.value?.getComponent<MeshComponent>('Mesh')
  if (!mesh?.materialId) return null
  return materialStore.getMaterial(mesh.materialId) ?? null
})

function addComponent(item: AddableItem): void {
  showAddMenu.value = false
  if (!primary.value) return
  commandStore.execute(new AddComponentCommand(primary.value.id, item.componentType, item.factory))
}

/** Add an unbound script slot to the primary entity. */
function addScriptSlot(): void {
  showAddMenu.value = false
  if (!primary.value) return
  commandStore.execute(new AddComponentCommand(
    primary.value.id,
    'Script:__slot__',  // placeholder — AddComponentCommand uses the factory's .type
    () => ScriptComponent.createEmpty(),
  ))
}

/** Assign a compiled script to an existing unbound slot. */
function assignScript(comp: ScriptComponent, guid: string): void {
  if (!guid) return
  const entry = scriptStore.getEntry(guid)
  comp.scriptGuid = guid
  comp.scriptPath = entry?.relPath ?? ''
  // Wire the entry if already compiled
  if (entry) {
    comp._entry = entry
    comp._error = null
    comp._disabled = false
    for (const def of (entry.cls.exposedProps ?? [])) {
      if (!(def.key in comp.propValues)) comp.propValues[def.key] = def.default ?? null
    }
  }
  comp.notifyChanged()
  // Activate editor instance
  const scene = sceneStore.activeScene
  const bScene = sceneStore.babylonScene
  if (scene && bScene && entry && primary.value) {
    const entity = scene.world.getEntity(primary.value.id)
    if (entity) {
      import('@/core/scripting/ScriptEditorSystem').then(({ scriptEditorSystem }) => {
        scriptEditorSystem.activateComponent(comp, entry, entity, scene.world, bScene)
      })
    }
  }
}

/** Open the Script Editor panel for the script attached to this component. */
function openScriptEditor(comp: ScriptComponent): void {
  const relPath = comp._entry?.relPath ?? comp.scriptPath
  if (relPath) editorStore.selectScript(relPath)
}

/** Return the title for a script component's inspector section. */
function scriptSectionTitle(comp: ScriptComponent): string {
  if (comp._entry?.name) return comp._entry.name
  if (!comp.scriptGuid)  return 'Script (Unassigned)'
  const parts = comp.scriptPath.split(/[/\\]/)
  const file  = parts[parts.length - 1] ?? comp.scriptPath
  return file.replace(/\.ts$/, '') || 'Script'
}

/** Return the exposed prop fields for a bound script component (for future use). */
function scriptExposedFields(comp: ScriptComponent): Array<{ key: string; label: string }> {
  if (!comp._entry) return []
  return (comp._entry.cls.exposedProps ?? []).map(p => ({
    key:   `propValues.${p.key}`,
    label: p.label,
  }))
}

function removeComponent(componentType: string): void {
  if (!primary.value) return
  commandStore.execute(new RemoveComponentCommand(primary.value.id, componentType))
}

/** Transforms for every selected entity that has one. */
const transforms = computed(() =>
  selected.value
    .map(e => e.getComponent<TransformComponent>('Transform'))
    .filter((t): t is TransformComponent => t !== null)
)

/** Only show the Transform section when ALL selected entities have it. */
const hasTransform = computed(() =>
  selected.value.length > 0 && transforms.value.length === selected.value.length
)

// ── Active state ─────────────────────────────────────────────────
const allActive   = computed(() => selected.value.length > 0 && selected.value.every(e => e.active))
const mixedActive = computed(() =>
  selected.value.length > 1 &&
  selected.value.some(e => e.active) &&
  selected.value.some(e => !e.active)
)

const activeCheckboxRef = ref<HTMLInputElement | null>(null)
watch(activeCheckboxRef, el => { if (el) el.indeterminate = mixedActive.value })
watch(mixedActive, v => { if (activeCheckboxRef.value) activeCheckboxRef.value.indeterminate = v })

// ── Transform refs ────────────────────────────────────────────────
const tx = ref<number | null>(null), ty = ref<number | null>(null), tz = ref<number | null>(null)
const rx = ref<number | null>(null), ry = ref<number | null>(null), rz = ref<number | null>(null)
const sx = ref<number | null>(null), sy = ref<number | null>(null), sz = ref<number | null>(null)

/** Returns the single shared value when all entries are equal, otherwise null (mixed). */
function mixedOrValue(values: number[]): number | null {
  if (values.length === 0) return null
  const first = values[0] as number
  return values.every(v => v === first) ? first : null
}

/**
 * Guard flag: true while we're synchronising the refs FROM the transforms computed.
 * Prevents the write-back watchers from applying the just-read values back to the ECS.
 */
let syncing = false

/**
 * Revision counter bumped whenever a selected TransformComponent fires notifyChanged
 * (e.g. from gizmo drag).  The sync watcher below depends on this so it re-reads
 * the display values without waiting for a selection change.
 */
const transformRev = ref(0)
let _txUnsubs: Array<() => void> = []

// Subscribe to onChange on the active transforms so external mutations (gizmos)
// propagate into the display refs.
watch(transforms, ts => {
  _txUnsubs.forEach(u => u())
  _txUnsubs = ts.map(t => t.onChange(() => { transformRev.value++ }))
}, { immediate: true })

onUnmounted(() => { _txUnsubs.forEach(u => u()) })

watch([transforms, transformRev] as const, ([ts]) => {
  syncing = true
  if (ts.length === 0) {
    tx.value = null; ty.value = null; tz.value = null
    rx.value = null; ry.value = null; rz.value = null
    sx.value = null; sy.value = null; sz.value = null
  } else {
    tx.value = mixedOrValue(ts.map(t => t.position.x))
    ty.value = mixedOrValue(ts.map(t => t.position.y))
    tz.value = mixedOrValue(ts.map(t => t.position.z))
    rx.value = mixedOrValue(ts.map(t => t.rotation.x))
    ry.value = mixedOrValue(ts.map(t => t.rotation.y))
    rz.value = mixedOrValue(ts.map(t => t.rotation.z))
    sx.value = mixedOrValue(ts.map(t => t.scale.x))
    sy.value = mixedOrValue(ts.map(t => t.scale.y))
    sz.value = mixedOrValue(ts.map(t => t.scale.z))
  }
  nextTick(() => { syncing = false })
}, { immediate: true })

// ── Write-back: apply input changes to ALL selected transforms ───

watch(tx, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.position.x = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(ty, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.position.y = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(tz, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.position.z = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(rx, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.rotation.x = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(ry, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.rotation.y = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(rz, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.rotation.z = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(sx, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.scale.x = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(sy, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.scale.y = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })
watch(sz, v => { if (syncing || v === null) return; transforms.value.forEach(t => { t.scale.z = v; t.syncToBabylon(); t.notifyChanged(); layerStore.dispatchEvent(new TransformChangedEvent(t.entityId)) }) })

function rename(name: string): void {
  if (primary.value && name.trim() && selected.value.length === 1 && name.trim() !== primary.value.name) {
    commandStore.execute(new RenameEntityCommand(primary.value.id, primary.value.name, name.trim()))
  }
}

function toggleActive(): void {
  const target = !allActive.value
  for (const e of selected.value) {
    commandStore.execute(new SetEntityActiveCommand(e.id, e.active, target))
  }
}
</script>
