<template>
  <div ref="containerRef" class="w-full h-full" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, shallowRef } from 'vue'
import * as monaco from 'monaco-editor'

// ── Monaco worker setup ────────────────────────────────────────────────────
// Tell Monaco to use its built-in module-worker URIs. Vite 7 serves these
// directly from node_modules via ?worker&url so no extra plugins are needed.
import editorWorkerUrl      from 'monaco-editor/esm/vs/editor/editor.worker?worker&url'
import tsWorkerUrl          from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker&url'

// Monaco resolves workers by calling the MonacoEnvironment.getWorker factory.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(tsWorkerUrl, { type: 'module' })
    }
    return new Worker(editorWorkerUrl, { type: 'module' })
  },
}

// ── Ambient Nebu types ──────────────────────────────────────────────────────
import { getNebuAmbientTypes }  from '@/lib/nebuScriptTypes'
import { usePluginStore }       from '@/stores/pluginStore'
import packageTypes             from 'virtual:package-types'

// Place the ambient lib inside file:///nebu-project/ so TypeScript's node_modules
// resolution walks up to file:///node_modules/@babylonjs/core (which IS registered)
// when it encounters `import("@babylonjs/core")` inside the declarations.
const NEBU_LIB_URI        = 'file:///nebu-project/nebu-globals.d.ts'
const NEBU_PLUGIN_LIB_URI = 'file:///nebu-project/nebu-plugin-globals.d.ts'

let _libRegistered = false
function ensureNebuTypes(): void {
  if (_libRegistered) return
  _libRegistered = true

  // 1. Nebu ambient globals — NebuScript, Entity, built-in components, etc.
  //    Available in user scripts without any import statement.
  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    getNebuAmbientTypes(),
    NEBU_LIB_URI,
  )

  // 2. Third-party package types bundled at build time by the Vite plugin.
  //    Each key is a virtual node_modules path, e.g.
  //    'file:///node_modules/@babylonjs/core/index.d.ts'.
  //    Monaco's TS resolver walks up from the open file's URI and finds these,
  //    making `import { Vector3 } from "@babylonjs/core"` fully typed.
  for (const [path, content] of Object.entries(packageTypes)) {
    monaco.languages.typescript.typescriptDefaults.addExtraLib(content, path)
  }

  // 3. Compiler options
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target:               monaco.languages.typescript.ScriptTarget.ES2022,
    module:               monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution:     monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    strict:               true,
    noImplicitAny:        true,
    noUnusedLocals:       false,
    esModuleInterop:      true,
    allowNonTsExtensions: true,
    // Do NOT set `lib` — letting Monaco derive it from `target` ensures all
    // built-in globals (Math, Array, console, Promise, etc.) are included.
  })

  // 4. Diagnostics
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation:   false,
  })
}

// Plugin ambient types are registered separately so they can be refreshed
// without invalidating the one-shot _libRegistered guard above.
let _pluginLibHandle: import('monaco-editor').IDisposable | null = null
let _registeredPluginContent = ''
function ensurePluginTypes(content: string): void {
  if (content === _registeredPluginContent) return
  _registeredPluginContent = content
  _pluginLibHandle?.dispose()
  _pluginLibHandle = content
    ? monaco.languages.typescript.typescriptDefaults.addExtraLib(content, NEBU_PLUGIN_LIB_URI)
    : null
}

// ── Props / emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  modelValue: string
  /** Filename shown to Monaco (e.g. "PlayerController.ts") — drives TS context. */
  filename?:  string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'save'): void
}>()

// ── DOM + editor refs ────────────────────────────────────────────────────────

const containerRef = ref<HTMLDivElement | null>(null)
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)

let _suppressUpdate = false  // prevents modelValue watcher from fighting the editor

// ── Plugin store (for ambient type injection) ────────────────────────────────
const pluginStore = usePluginStore()

// Keep plugin ambient types in sync whenever a new plugin is registered.
// `pluginStore.allAmbientTypes` is a Pinia-unwrapped string — no .value needed.
watch(() => pluginStore.allAmbientTypes, (types) => ensurePluginTypes(types))

// ── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  if (!containerRef.value) return
  ensureNebuTypes()
  ensurePluginTypes(pluginStore.allAmbientTypes)

  const filename  = props.filename ?? 'script.ts'
  const modelUri  = monaco.Uri.parse(`file:///nebu-project/${filename}`)
  const existing  = monaco.editor.getModel(modelUri)
  const model     = existing ?? monaco.editor.createModel(props.modelValue, 'typescript', modelUri)

  editor.value = monaco.editor.create(containerRef.value, {
    model,
    language:         'typescript',
    theme:            'vs-dark',
    fontSize:         13,
    lineHeight:       20,
    fontFamily:       '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
    fontLigatures:    true,
    tabSize:          2,
    insertSpaces:     true,
    wordWrap:         'on',
    minimap:          { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight:  'gutter',
    smoothScrolling:  true,
    cursorBlinking:   'smooth',
    cursorSmoothCaretAnimation: 'on',
    formatOnPaste:    true,
    automaticLayout:  true,   // responds to container resize
  })

  // Push edits back to the parent via v-model
  editor.value.onDidChangeModelContent(() => {
    _suppressUpdate = true
    emit('update:modelValue', editor.value!.getValue())
    _suppressUpdate = false
  })

  // Ctrl+S / Cmd+S → emit 'save'
  editor.value.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    () => emit('save'),
  )
})

onUnmounted(() => {
  editor.value?.getModel()?.dispose()
  editor.value?.dispose()
  editor.value = null
})

// ── Watchers ─────────────────────────────────────────────────────────────────

// Sync external model-value changes into the editor (e.g. file reload)
watch(() => props.modelValue, (newVal) => {
  if (_suppressUpdate) return
  const ed = editor.value
  if (!ed) return
  if (ed.getValue() !== newVal) {
    ed.setValue(newVal)
  }
})

// When the filename changes (different file opened) swap the Monaco model
watch(() => props.filename, (newFilename) => {
  const ed = editor.value
  if (!ed || !newFilename) return
  const uri      = monaco.Uri.parse(`file:///nebu-project/${newFilename}`)
  const existing = monaco.editor.getModel(uri)
  const model    = existing ?? monaco.editor.createModel(props.modelValue, 'typescript', uri)
  const old      = ed.getModel()
  ed.setModel(model)
  if (old && old !== model) old.dispose()
})

// ── Expose focus so parent can call monacoRef.value?.focus() ─────────────────
defineExpose({
  focus: () => editor.value?.focus(),
})
</script>
