<template>
  <template v-for="(section, sIdx) in schema" :key="section.title">
    <BaseSection :title="section.title" :defaultOpen="true">

      <!-- Remove button in the first section's header -->
      <template v-if="sIdx === 0 && removable" #header-actions>
        <button
          class="ml-auto mr-1 opacity-60 hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
          title="Remove component"
          @click.stop="emit('remove')"
        >
          <BaseIcon name="close" :size="9" />
        </button>
      </template>

      <template v-for="field in section.fields" :key="field.key">

        <!-- ── number ──────────────────────────────────────────── -->
        <div v-if="field.type === 'number'" class="flex items-center gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)] w-20 shrink-0 select-none">{{ field.label }}</span>
          <BaseNumericInput
            :modelValue="getNum(field.key)"
            :step="(field as NumberField).step"
            :min="(field as NumberField).min"
            :max="(field as NumberField).max"
            class="flex-1"
            @update:modelValue="v => write(field.key, v)"
          />
        </div>

        <!-- ── boolean ─────────────────────────────────────────── -->
        <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            :checked="getBool(field.key)"
            class="accent-[var(--color-accent)]"
            @change="e => write(field.key, (e.target as HTMLInputElement).checked)"
          />
          <span class="text-xs text-[var(--color-text-secondary)] select-none">{{ field.label }}</span>
        </label>

        <!-- ── string ──────────────────────────────────────────── -->
        <div v-else-if="field.type === 'string'" class="flex items-center gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)] w-20 shrink-0 select-none">{{ field.label }}</span>
          <BaseInput
            :modelValue="getStr(field.key)"
            class="flex-1"
            @update:modelValue="v => write(field.key, v)"
          />
        </div>

        <!-- ── vec3 ────────────────────────────────────────────── -->
        <div v-else-if="field.type === 'vec3'">
          <span class="block text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5 select-none">
            {{ field.label }}
          </span>
          <div class="grid grid-cols-3 gap-1">
            <BaseNumericInput
              :modelValue="getNum(field.key + '.x')" label="X"
              :step="(field as Vec3Field).step ?? 0.1"
              @update:modelValue="v => write(field.key + '.x', v)"
            />
            <BaseNumericInput
              :modelValue="getNum(field.key + '.y')" label="Y"
              :step="(field as Vec3Field).step ?? 0.1"
              @update:modelValue="v => write(field.key + '.y', v)"
            />
            <BaseNumericInput
              :modelValue="getNum(field.key + '.z')" label="Z"
              :step="(field as Vec3Field).step ?? 0.1"
              @update:modelValue="v => write(field.key + '.z', v)"
            />
          </div>
        </div>

        <!-- ── color3 ──────────────────────────────────────────── -->
        <div v-else-if="field.type === 'color3'">
          <span class="block text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5 select-none">
            {{ field.label }}
          </span>
          <div class="flex items-center gap-2">
            <!-- Colour swatch / native picker -->
            <input
              type="color"
              :value="color3ToHex(getColor3(field.key))"
              class="h-6 w-8 rounded border border-[var(--color-border)] bg-transparent cursor-pointer p-0.5 shrink-0"
              @input="e => setColor3FromHex(field.key, (e.target as HTMLInputElement).value)"
            />
            <!-- RGB fine-tune inputs -->
            <div class="grid grid-cols-3 gap-1 flex-1">
              <BaseNumericInput
                :modelValue="getNum(field.key + '.r')" label="R"
                :min="0" :max="1" :step="0.01"
                @update:modelValue="v => write(field.key + '.r', v)"
              />
              <BaseNumericInput
                :modelValue="getNum(field.key + '.g')" label="G"
                :min="0" :max="1" :step="0.01"
                @update:modelValue="v => write(field.key + '.g', v)"
              />
              <BaseNumericInput
                :modelValue="getNum(field.key + '.b')" label="B"
                :min="0" :max="1" :step="0.01"
                @update:modelValue="v => write(field.key + '.b', v)"
              />
            </div>
          </div>
        </div>

        <!-- ── color4 ──────────────────────────────────────────── -->
        <div v-else-if="field.type === 'color4'">
          <span class="block text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5 select-none">
            {{ field.label }}
          </span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              :value="color3ToHex(getColor4(field.key))"
              class="h-6 w-8 rounded border border-[var(--color-border)] bg-transparent cursor-pointer p-0.5 shrink-0"
              @input="e => setColor4FromHex(field.key, (e.target as HTMLInputElement).value)"
            />
            <div class="grid grid-cols-4 gap-1 flex-1">
              <BaseNumericInput
                :modelValue="getNum(field.key + '.r')" label="R"
                :min="0" :max="1" :step="0.01"
                @update:modelValue="v => write(field.key + '.r', v)"
              />
              <BaseNumericInput
                :modelValue="getNum(field.key + '.g')" label="G"
                :min="0" :max="1" :step="0.01"
                @update:modelValue="v => write(field.key + '.g', v)"
              />
              <BaseNumericInput
                :modelValue="getNum(field.key + '.b')" label="B"
                :min="0" :max="1" :step="0.01"
                @update:modelValue="v => write(field.key + '.b', v)"
              />
              <BaseNumericInput
                :modelValue="getNum(field.key + '.a')" label="A"
                :min="0" :max="1" :step="0.01"
                @update:modelValue="v => write(field.key + '.a', v)"
              />
            </div>
          </div>
        </div>

        <!-- ── enum ────────────────────────────────────────────── -->
        <div v-else-if="field.type === 'enum'" class="flex items-center gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)] w-20 shrink-0 select-none">{{ field.label }}</span>
          <select
            :value="get(field.key)"
            class="flex-1 h-6 px-1 text-xs rounded
                   bg-[var(--color-bg-base)] border border-[var(--color-border)]
                   text-[var(--color-text-primary)]
                   focus:outline-none focus:border-[var(--color-accent)]"
            @change="e => writeEnum(field as EnumField, field.key, (e.target as HTMLSelectElement).value)"
          >
            <option
              v-for="opt in (field as EnumField).options"
              :key="opt.value"
              :value="opt.value"
            >{{ opt.label }}</option>
          </select>
        </div>
        <!-- ── entity-ref ───────────────────────────────────────── -->
        <div v-else-if="field.type === 'entity-ref'" class="flex items-center gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)] w-20 shrink-0 select-none">{{ field.label }}</span>
          <div
            class="flex-1 h-6 flex items-center justify-between px-2 rounded border text-xs select-none transition-colors cursor-default"
            :class="[
              entityRefDragKey === field.key
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : getEntityRef(field.key)
                  ? 'border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
                  : 'border-dashed border-[var(--color-border)] text-[var(--color-text-muted)]',
            ]"
            @dragover="e => onEntityRefDragOver(e, field.key)"
            @dragleave="onEntityRefDragLeave"
            @drop.prevent="e => onEntityRefDrop(e, field.key)"
          >
            <span class="truncate">{{ entityRefLabel(field.key) }}</span>
            <button
              v-if="getEntityRef(field.key)"
              class="ml-1 shrink-0 opacity-60 hover:opacity-100 hover:text-[var(--color-danger)]"
              title="Clear"
              @click.stop="write(field.key, null)"
            >
              <BaseIcon name="close" :size="8" />
            </button>
          </div>
        </div>
        <!-- ── material-ref ─────────────────────────────────────── -->
        <div v-else-if="field.type === 'material-ref'" class="flex items-center gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)] w-20 shrink-0 select-none">{{ field.label }}</span>
          <div
            class="flex-1 flex flex-col gap-0.5"
          >
            <!-- Missing material indicator — shown when a GUID is stored but the material is not in the project -->
            <div
              v-if="hasMissingMaterial(field.key)"
              class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30"
            >
              <BaseIcon name="warning" :size="9" />
              <span class="truncate">Missing — {{ getStr(field.key).slice(0, 8) }}…</span>
            </div>
          <div
            class="flex items-center gap-1 rounded transition-shadow"
            :class="materialRefDragKey === field.key ? 'ring-1 ring-[var(--color-accent)]' : ''"
            @dragover="e => onMaterialRefDragOver(e, field.key)"
            @dragleave="onMaterialRefDragLeave"
            @drop.prevent="e => onMaterialRefDrop(e, field.key)"
          >
            <select
              :value="getStr(field.key) || ''"
              class="flex-1 h-6 px-1 text-xs rounded
                     bg-[var(--color-bg-base)] border border-[var(--color-border)]
                     text-[var(--color-text-primary)]
                     focus:outline-none focus:border-[var(--color-accent)]"
              @change="e => write(field.key, (e.target as HTMLSelectElement).value || null)"
            >
              <option value="">None (Default)</option>
              <option
                v-for="mat in materialStore.materialList"
                :key="mat.id"
                :value="mat.id"
              >{{ mat.name }}</option>
            </select>
            <!-- Clear button — only when a material is assigned -->
            <button
              v-if="getStr(field.key)"
              class="shrink-0 h-6 w-6 flex items-center justify-center rounded
                     text-[var(--color-text-muted)] hover:text-[var(--color-danger)]
                     border border-[var(--color-border)] hover:border-[var(--color-danger)]
                     transition-colors"
              title="Clear material (use default)"
              @click.stop="write(field.key, null)"
            >
              <BaseIcon name="close" :size="9" />
            </button>
            <!-- Create new material button -->
            <button
              class="shrink-0 h-6 w-6 flex items-center justify-center rounded
                     text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                     border border-[var(--color-border)] hover:border-[var(--color-accent)]
                     transition-colors"
              title="Create new material"
              @click.stop="createAndAssignMaterial(field.key)"
            >
              <BaseIcon name="add" :size="10" />
            </button>
          </div>
          </div>
        </div>
        <!-- ── texture-ref ──────────────────────────────────────── -->
        <div v-else-if="field.type === 'texture-ref'" class="flex items-start gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)] w-20 shrink-0 pt-3 select-none">{{ field.label }}</span>
          <BaseTextureInput
            :modelValue="getStr(field.key) || null"
            class="flex-1"
            @update:modelValue="v => write(field.key, v)"
          />
        </div>

        <!-- ── model-ref ────────────────────────────────────────── -->
        <div v-else-if="field.type === 'model-ref'" class="flex items-center gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)] w-20 shrink-0 select-none">{{ field.label }}</span>
          <div class="flex-1 flex items-center gap-1">
            <div
              class="flex-1 flex items-center gap-1 h-6 px-1.5 rounded text-xs border transition-shadow cursor-default select-none truncate"
              :class="[
                modelRefDragKey === field.key
                  ? 'ring-1 ring-[var(--color-accent)] border-[var(--color-accent)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-primary)]',
                !getStr(field.key) && 'text-[var(--color-text-muted)] italic',
              ]"
              @dragover="e => onModelRefDragOver(e, field.key)"
              @dragleave="onModelRefDragLeave"
              @drop.prevent="e => onModelRefDrop(e, field.key)"
            >
              <BaseIcon name="model" :size="10" class="shrink-0 text-[var(--color-accent)]/75" />
              <span class="truncate">{{ modelRefLabel(field.key) }}</span>
            </div>
            <!-- Clear button -->
            <button
              v-if="getStr(field.key)"
              class="shrink-0 h-6 w-6 flex items-center justify-center rounded
                     text-[var(--color-text-muted)] hover:text-[var(--color-danger)]
                     border border-[var(--color-border)] hover:border-[var(--color-danger)]
                     transition-colors"
              title="Clear model"
              @click.stop="write(field.key, null)"
            >
              <BaseIcon name="close" :size="9" />
            </button>
          </div>
        </div>

        <!-- ── animation-clip-list ──────────────────────────────── -->
        <div v-else-if="field.type === 'animation-clip-list'" class="flex flex-col gap-1">
          <!-- Clip rows -->
          <div
            v-for="clip in getClips()"
            :key="clip.id"
            class="flex items-center gap-1.5 px-1.5 py-1 rounded
                   bg-[var(--color-bg-base)] border border-[var(--color-border)]"
          >
            <BaseIcon name="animation" :size="10" class="shrink-0 text-[var(--color-accent)]" />
            <span class="flex-1 text-[11px] text-[var(--color-text-primary)] truncate select-none">{{ clip.name }}</span>
            <span class="text-[10px] text-[var(--color-text-muted)] shrink-0 select-none">{{ clip.frameCount }}f</span>
            <button
              class="h-5 px-2 text-[10px] rounded border border-[var(--color-accent)]/50
                     text-[var(--color-accent)] hover:bg-[var(--color-accent)]/15 transition-colors"
              title="Edit in Timeline"
              @click.stop="openClipInTimeline(clip.id)"
            >Edit</button>
            <button
              class="shrink-0 h-5 w-5 flex items-center justify-center rounded
                     text-[var(--color-text-muted)] hover:text-[var(--color-danger)]
                     border border-transparent hover:border-[var(--color-danger)]/40
                     transition-colors"
              title="Delete clip"
              @click.stop="onDeleteClip(clip.id)"
            >
              <BaseIcon name="close" :size="8" />
            </button>
          </div>
          <!-- Empty state -->
          <p
            v-if="getClips().length === 0"
            class="text-[10px] text-[var(--color-text-muted)] italic px-1 py-0.5 select-none"
          >No clips — add one below</p>
          <!-- Add clip button -->
          <button
            class="h-6 w-full flex items-center justify-center gap-1 rounded
                   border border-dashed border-[var(--color-border)]
                   text-[10px] text-[var(--color-text-muted)]
                   hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]
                   transition-colors"
            @click.stop="onAddClip()"
          >
            <BaseIcon name="add" :size="9" />
            <span>Add Clip</span>
          </button>
        </div>

      </template>
    </BaseSection>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useCommandStore }       from '@/stores/commandStore'
import { useSceneStore }         from '@/stores/sceneStore'
import { useAssetStore }         from '@/stores/assetStore'
import { useMaterialStore }      from '@/stores/materialStore'
import { useAnimationStore }     from '@/stores/animationStore'
import { SetPropertyCommand }    from '@/core/commands/component'
import { AddAnimationClipCommand, DeleteAnimationClipCommand } from '@/core/commands/animation'
import type { InspectorTarget } from '@/types/inspector'
import type {
  InspectorSchema, Color3Like, Color4Like,
  NumberField, Vec3Field, EnumField,
} from '@/types/inspector'
import type { AnimationClipDef } from '@/types/animation'
import BaseSection      from '@/components/base/BaseSection.vue'
import BaseNumericInput from '@/components/base/BaseNumericInput.vue'
import BaseInput        from '@/components/base/BaseInput.vue'
import BaseIcon         from '@/components/base/BaseIcon.vue'
import BaseTextureInput from '@/components/base/BaseTextureInput.vue'

const materialStore  = useMaterialStore()
const assetStore     = useAssetStore()
const animationStore = useAnimationStore()

const props = defineProps<{
  component: InspectorTarget
  /** Show a × button in the first section header that emits `remove`. */
  removable?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const sceneStore = useSceneStore()

// ── Reactive schema ───────────────────────────────────────────────
// Component instances are plain class objects — Vue can't track property
// mutations on them directly.  Subscribe to the component's onChange so that
// every notifyChanged() call (inspector writes, undo/redo) bumps `rev` and
// forces the schema computed to re-evaluate.  This is fully generic: works
// for any Component subclass without any coupling.

const rev  = ref(0)
let _unsub: (() => void) | null = null

function _subscribe(comp: typeof props.component): void {
  _unsub?.()
  _unsub = null
  const c = comp as unknown as { onChange?: (fn: () => void) => () => void }
  if (typeof c.onChange === 'function') {
    _unsub = c.onChange(() => { rev.value++ })
  }
}

watch(() => props.component, comp => _subscribe(comp), { immediate: true })
onUnmounted(() => { _unsub?.() })

const schema = computed<InspectorSchema>(() => {
  rev.value   // establish reactive dependency — re-runs whenever notifyChanged() fires
  return props.component.onInspectorDraw()
})

// ── Deep read (supports dot-paths like "direction.x") ────────────

function get(key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = props.component
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function getNum(key: string):    number | null { const v = get(key); return typeof v === 'number' ? v : null }
function getBool(key: string):   boolean       { return Boolean(get(key)) }
function getStr(key: string):    string        { const v = get(key); return typeof v === 'string' ? v : '' }
function getEntityRef(key: string): string | null { const v = get(key); return typeof v === 'string' ? v : null }
function getColor3(key: string): Color3Like    {
  const v = get(key)
  return (v && typeof v === 'object') ? v as Color3Like : { r: 0, g: 0, b: 0 }
}
function getColor4(key: string): Color4Like    {
  const v = get(key)
  return (v && typeof v === 'object') ? v as Color4Like : { r: 0, g: 0, b: 0, a: 1 }
}

// ── Deep write + Babylon sync ─────────────────────────────────────

/** Derive a stable context id for mergeKey: entityId for components, 'scene' for proxy. */
const contextId = computed(() =>
  'entityId' in props.component
    ? (props.component as { entityId: string }).entityId
    : 'scene'
)

function write(key: string, value: unknown): void {
  useCommandStore().execute(
    SetPropertyCommand.capture(props.component, key, value, contextId.value),
  )
}

// ── Color3 helpers ────────────────────────────────────────────────

function color3ToHex(c: Color3Like | Color4Like): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

function setColor3FromHex(key: string, hex: string): void {
  write(key, {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  })
}

function setColor4FromHex(key: string, hex: string): void {
  write(key, {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
    a: getColor4(key).a,  // preserve existing alpha
  })
}

// Preserves the original value type (number | string) from the option definition.
function writeEnum(field: EnumField, key: string, rawValue: string): void {
  const opt = field.options.find(o => String(o.value) === rawValue)
  write(key, opt !== undefined ? opt.value : rawValue)
}

// ── Material-ref helpers ────────────────────────────────────

/** Create a new StandardMaterial in the store and immediately assign it. */
function createAndAssignMaterial(key: string): void {
  const entry = materialStore.createMaterial('New Material', 'Standard')
  write(key, entry.id)
}

/**
 * Returns true when a material GUID is stored for `key` but no matching
 * material exists in the project.  Used to show the "missing link" indicator.
 */
function hasMissingMaterial(key: string): boolean {
  const id = getStr(key)
  if (!id) return false
  return !materialStore.materialList.some(m => m.id === id)
}

const materialRefDragKey = ref<string | null>(null)

function onMaterialRefDragOver(e: DragEvent, key: string): void {
  if (e.dataTransfer?.types.includes('application/nebu-material')) {
    e.preventDefault()
    materialRefDragKey.value = key
  }
}

function onMaterialRefDragLeave(): void {
  materialRefDragKey.value = null
}

function onMaterialRefDrop(e: DragEvent, key: string): void {
  materialRefDragKey.value = null
  const matId = e.dataTransfer?.getData('application/nebu-material')
  if (matId) write(key, matId)
}

// ── Entity-ref helpers ─────────────────────────────────────

const entityRefDragKey = ref<string | null>(null)

function entityRefLabel(key: string): string {
  const id = getEntityRef(key)
  if (!id) return 'None — drag from hierarchy'
  return sceneStore.activeScene?.world.getEntity(id)?.name ?? id
}

function onEntityRefDragOver(e: DragEvent, key: string): void {
  if (e.dataTransfer?.types.includes('application/nebu-entity')) {
    e.preventDefault()
    entityRefDragKey.value = key
  }
}

function onEntityRefDragLeave(): void {
  entityRefDragKey.value = null
}

function onEntityRefDrop(e: DragEvent, key: string): void {
  entityRefDragKey.value = null
  const entityId = e.dataTransfer?.getData('application/nebu-entity')
  if (entityId) write(key, entityId)
}

// ── Model-ref helpers ──────────────────────────────────────

const modelRefDragKey = ref<string | null>(null)

function modelRefLabel(key: string): string {
  const guid = getStr(key)
  if (!guid) return 'None — drag from assets'
  return assetStore.getAsset(guid)?.name ?? guid.slice(0, 8) + '…'
}

function onModelRefDragOver(e: DragEvent, key: string): void {
  if (e.dataTransfer?.types.includes('application/nebu-model')) {
    e.preventDefault()
    modelRefDragKey.value = key
  }
}

function onModelRefDragLeave(): void {
  modelRefDragKey.value = null
}

function onModelRefDrop(e: DragEvent, key: string): void {
  modelRefDragKey.value = null
  const guid = e.dataTransfer?.getData('application/nebu-model')
  if (guid) write(key, guid)
}

// ── Animation-clip-list helpers ────────────────────────────

function getClips(): AnimationClipDef[] {
  const v = get('clips')
  return Array.isArray(v) ? (v as AnimationClipDef[]) : []
}

function openClipInTimeline(clipId: string): void {
  const eid = contextId.value
  if (eid === 'scene') return
  animationStore.editClip(eid, clipId)
}

function onAddClip(): void {
  const eid = contextId.value
  if (eid === 'scene') return
  useCommandStore().execute(new AddAnimationClipCommand(eid))
}

function onDeleteClip(clipId: string): void {
  const eid = contextId.value
  if (eid === 'scene') return
  useCommandStore().execute(new DeleteAnimationClipCommand(eid, clipId))
}
</script>
