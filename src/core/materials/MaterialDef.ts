// ─────────────────────────────────────────────
// MaterialDef — runtime material definition
//
// Implements InspectorTarget so ComponentInspector.vue can render it
// directly without any component-type coupling.
// ─────────────────────────────────────────────

import type { InspectorSchema, InspectorTarget } from '@/types/inspector'
import type {
  MaterialType,
  StandardMatProps,
  PBRMatProps,
  ShaderMatProps,
  CustomMatProps,
  PBRCustomMatProps,
  SerializedMaterial,
} from '@/types/material'
import type {
  StandardMaterial  as BabylonStandardMaterial,
  PBRMaterial       as BabylonPBRMaterial,
  Material          as BabylonMaterial,
} from '@babylonjs/core'
import type {
  CustomMaterial    as BabylonCustomMaterial,
  PBRCustomMaterial as BabylonPBRCustomMaterial,
} from '@babylonjs/materials'

type ChangeListener = () => void

function _defaultStandard(): StandardMatProps {
  return {
    diffuseColor:    { r: 0.8, g: 0.8, b: 0.8 },
    specularColor:   { r: 1,   g: 1,   b: 1   },
    emissiveColor:   { r: 0,   g: 0,   b: 0   },
    ambientColor:    { r: 0,   g: 0,   b: 0   },
    specularPower:   64,
    alpha:           1.0,
    wireframe:       false,
    backFaceCulling: true,
    diffuseTextureId:    null,
    ambientTextureId:    null,
    opacityTextureId:    null,
    emissiveTextureId:   null,
    specularTextureId:   null,
    bumpTextureId:       null,
    reflectionTextureId: null,
    lightmapTextureId:   null,
  }
}

function _defaultPBR(): PBRMatProps {
  return {
    albedoColor:       { r: 1,   g: 1,   b: 1 },
    reflectivityColor: { r: 1,   g: 1,   b: 1 },
    emissiveColor:     { r: 0,   g: 0,   b: 0 },
    metallic:          0.0,
    roughness:         0.5,
    alpha:             1.0,
    wireframe:         false,
    backFaceCulling:   true,
    albedoTextureId:       null,
    bumpTextureId:         null,
    metallicTextureId:     null,
    emissiveTextureId:     null,
    ambientTextureId:      null,
    opacityTextureId:      null,
    reflectionTextureId:   null,
    lightmapTextureId:     null,
    reflectivityTextureId: null,
    microSurfaceTextureId: null,
  }
}

function _defaultShader(): ShaderMatProps {
  return { vertexSource: '', fragmentSource: '' }
}

/**
 * MaterialDef — holds all property bags for all supported material types
 * and exposes an `onInspectorDraw()` schema so ComponentInspector.vue can
 * render it without knowing anything about materials.
 *
 * `babylonMaterial` is the live Babylon.js material — provided by
 * materialStore and never serialised.
 *
 * `onRebuildNeeded` is set by materialStore; called when the material type
 * changes and the Babylon instance must be recreated.
 */
export class MaterialDef implements InspectorTarget {
  readonly id: string
  name:    string
  matType: MaterialType

  // ── Property bags (all persisted, only active type is used) ───
  standardProps:  StandardMatProps  = _defaultStandard()
  pbrProps:       PBRMatProps       = _defaultPBR()
  shaderProps:    ShaderMatProps    = _defaultShader()
  customProps:    CustomMatProps    = { ..._defaultStandard(), customVertex: '', customFragment: '' }
  pbrCustomProps: PBRCustomMatProps = { ..._defaultPBR(),     customVertex: '', customFragment: '' }

  /** True when this is Babylon's built-in default material — cannot be deleted. */
  isDefault: boolean = false

  /** Live Babylon material — provided by materialStore, never serialised. */
  babylonMaterial: BabylonMaterial | null = null

  /** Called by materialStore when the Babylon material must be (re)created. */
  onRebuildNeeded: (() => void) | null = null

  /**
   * Texture resolver — set by materialStore so syncToBabylon can apply
   * texture channels without coupling core to the Pinia store layer.
   */
  onGetTexture: ((guid: string) => import('@babylonjs/core').BaseTexture | null) | null = null

  private readonly _listeners = new Set<ChangeListener>()

  constructor(id: string, name: string, matType: MaterialType = 'Standard') {
    this.id      = id
    this.name    = name
    this.matType = matType
  }

  // ── Observable ────────────────────────────────────────────────

  onChange(fn: ChangeListener): () => void {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  notifyChanged(): void {
    this._listeners.forEach(fn => fn())
  }

  // ── InspectorTarget ────────────────────────────────────────────

  onInspectorDraw(): InspectorSchema {
    const sections: InspectorSchema = [
      {
        title: this.name,
        fields: [
          {
            key:     'matType',
            label:   'Type',
            type:    'enum',
            options: [
              { label: 'Standard',   value: 'Standard'  },
              { label: 'PBR',        value: 'PBR'       },
              { label: 'Shader',     value: 'Shader'    },
              { label: 'Custom',     value: 'Custom'    },
              { label: 'PBR Custom', value: 'PBRCustom' },
            ],
          },
        ],
      },
    ]

    const mainSection = sections[0]!

    if (this.matType === 'Standard') {
      mainSection.fields.push(
        { key: 'standardProps.diffuseColor',        label: 'Diffuse',          type: 'color3'                            },
        { key: 'standardProps.specularColor',       label: 'Specular',         type: 'color3'                            },
        { key: 'standardProps.emissiveColor',       label: 'Emissive',         type: 'color3'                            },
        { key: 'standardProps.ambientColor',        label: 'Ambient',          type: 'color3'                            },
        { key: 'standardProps.specularPower',       label: 'Spec Power',       type: 'number', min: 0, max: 512, step: 1 },
        { key: 'standardProps.alpha',               label: 'Alpha',            type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'standardProps.wireframe',           label: 'Wireframe',        type: 'boolean'                           },
        { key: 'standardProps.backFaceCulling',     label: 'Back-Face Culling',type: 'boolean'                           },
        { key: 'standardProps.diffuseTextureId',    label: 'Diffuse Map',      type: 'texture-ref' },
        { key: 'standardProps.ambientTextureId',    label: 'Ambient Map',      type: 'texture-ref' },
        { key: 'standardProps.emissiveTextureId',   label: 'Emissive Map',     type: 'texture-ref' },
        { key: 'standardProps.specularTextureId',   label: 'Specular Map',     type: 'texture-ref' },
        { key: 'standardProps.bumpTextureId',       label: 'Normal/Bump Map',  type: 'texture-ref' },
        { key: 'standardProps.opacityTextureId',    label: 'Opacity Map',      type: 'texture-ref' },
        { key: 'standardProps.reflectionTextureId', label: 'Reflection Map',   type: 'texture-ref' },
        { key: 'standardProps.lightmapTextureId',   label: 'Lightmap',         type: 'texture-ref' },
      )
    } else if (this.matType === 'PBR') {
      mainSection.fields.push(
        { key: 'pbrProps.albedoColor',       label: 'Albedo',           type: 'color3'                               },
        { key: 'pbrProps.reflectivityColor', label: 'Reflectivity',     type: 'color3'                               },
        { key: 'pbrProps.emissiveColor',     label: 'Emissive',         type: 'color3'                               },
        { key: 'pbrProps.metallic',          label: 'Metallic',         type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'pbrProps.roughness',         label: 'Roughness',        type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'pbrProps.alpha',             label: 'Alpha',            type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'pbrProps.wireframe',         label: 'Wireframe',        type: 'boolean'                              },
        { key: 'pbrProps.backFaceCulling',   label: 'Back-Face Culling',type: 'boolean'                              },
        { key: 'pbrProps.albedoTextureId',       label: 'Albedo Map',          type: 'texture-ref' },
        { key: 'pbrProps.bumpTextureId',         label: 'Normal/Bump Map',     type: 'texture-ref' },
        { key: 'pbrProps.metallicTextureId',     label: 'Metallic Map',        type: 'texture-ref' },
        { key: 'pbrProps.emissiveTextureId',     label: 'Emissive Map',        type: 'texture-ref' },
        { key: 'pbrProps.ambientTextureId',      label: 'Ambient Occ. Map',    type: 'texture-ref' },
        { key: 'pbrProps.opacityTextureId',      label: 'Opacity Map',         type: 'texture-ref' },
        { key: 'pbrProps.reflectionTextureId',   label: 'Reflection Map',      type: 'texture-ref' },
        { key: 'pbrProps.lightmapTextureId',     label: 'Lightmap',            type: 'texture-ref' },
        { key: 'pbrProps.reflectivityTextureId', label: 'Reflectivity Map',    type: 'texture-ref' },
        { key: 'pbrProps.microSurfaceTextureId', label: 'Micro Surface Map',   type: 'texture-ref' },
      )
    } else if (this.matType === 'Shader') {
      mainSection.fields.push(
        { key: 'shaderProps.vertexSource',   label: 'Vertex Source',   type: 'string' },
        { key: 'shaderProps.fragmentSource', label: 'Fragment Source', type: 'string' },
      )
    } else if (this.matType === 'Custom') {
      mainSection.fields.push(
        { key: 'customProps.diffuseColor',    label: 'Diffuse',          type: 'color3'                            },
        { key: 'customProps.specularColor',   label: 'Specular',         type: 'color3'                            },
        { key: 'customProps.emissiveColor',   label: 'Emissive',         type: 'color3'                            },
        { key: 'customProps.ambientColor',    label: 'Ambient',          type: 'color3'                            },
        { key: 'customProps.specularPower',   label: 'Spec Power',       type: 'number', min: 0, max: 512, step: 1 },
        { key: 'customProps.alpha',           label: 'Alpha',            type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'customProps.wireframe',       label: 'Wireframe',        type: 'boolean'                           },
        { key: 'customProps.backFaceCulling', label: 'Back-Face Culling',type: 'boolean'                           },
        { key: 'customProps.customVertex',    label: 'Custom Vertex',    type: 'string'                            },
        { key: 'customProps.customFragment',  label: 'Custom Fragment',  type: 'string'                            },
      )
    } else if (this.matType === 'PBRCustom') {
      mainSection.fields.push(
        { key: 'pbrCustomProps.albedoColor',       label: 'Albedo',           type: 'color3'                               },
        { key: 'pbrCustomProps.reflectivityColor', label: 'Reflectivity',     type: 'color3'                               },
        { key: 'pbrCustomProps.emissiveColor',     label: 'Emissive',         type: 'color3'                               },
        { key: 'pbrCustomProps.metallic',          label: 'Metallic',         type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'pbrCustomProps.roughness',         label: 'Roughness',        type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'pbrCustomProps.alpha',             label: 'Alpha',            type: 'number', min: 0, max: 1,   step: 0.01 },
        { key: 'pbrCustomProps.wireframe',         label: 'Wireframe',        type: 'boolean'                              },
        { key: 'pbrCustomProps.backFaceCulling',   label: 'Back-Face Culling',type: 'boolean'                              },
        { key: 'pbrCustomProps.customVertex',      label: 'Custom Vertex',    type: 'string'                               },
        { key: 'pbrCustomProps.customFragment',    label: 'Custom Fragment',  type: 'string'                               },
      )
    }

    return sections
  }

  // ── Babylon sync ──────────────────────────────────────────────

  /**
   * Push current property values to the live Babylon material.
   * If the active matType no longer matches the existing Babylon instance,
   * the `onRebuildNeeded` callback is invoked so materialStore can recreate
   * the Babylon object with the correct type.
   */
  syncToBabylon(): void {
    const mat = this.babylonMaterial
    const expectedClass = _babylonClassName(this.matType)
    if (!mat || mat.getClassName() !== expectedClass) {
      this.onRebuildNeeded?.()
      return
    }
    _pushProps(this, mat, this.onGetTexture ?? undefined)
  }

  // ── Serialisation ─────────────────────────────────────────────

  serialize(): SerializedMaterial {
    return {
      id:             this.id,
      name:           this.name,
      matType:        this.matType,
      isDefault:      this.isDefault,
      standardProps:  { ...this.standardProps },
      pbrProps:       { ...this.pbrProps },
      shaderProps:    { ...this.shaderProps },
      customProps:    { ...this.customProps },
      pbrCustomProps: { ...this.pbrCustomProps },
    }
  }

  static deserialize(data: SerializedMaterial): MaterialDef {
    const m = new MaterialDef(data.id, data.name, data.matType)
    m.isDefault = data.isDefault ?? false
    if (data.standardProps)  m.standardProps  = { ...m.standardProps,  ...data.standardProps  }
    if (data.pbrProps)       m.pbrProps       = { ...m.pbrProps,       ...data.pbrProps       }
    if (data.shaderProps)    m.shaderProps    = { ...m.shaderProps,    ...data.shaderProps    }
    if (data.customProps)    m.customProps    = { ...m.customProps,    ...data.customProps    }
    if (data.pbrCustomProps) m.pbrCustomProps = { ...m.pbrCustomProps, ...data.pbrCustomProps }
    return m
  }
}

// ── Helpers ────────────────────────────────────────────────────

function _babylonClassName(type: MaterialType): string {
  switch (type) {
    case 'Standard':  return 'StandardMaterial'
    case 'PBR':       return 'PBRMaterial'
    case 'Shader':    return 'ShaderMaterial'
    case 'Custom':    return 'CustomMaterial'
    case 'PBRCustom': return 'PBRCustomMaterial'
  }
}

/** Push all active-type properties to the existing Babylon material in-place. */
function _pushProps(
  def: MaterialDef,
  mat: BabylonMaterial,
  getTexture?: (guid: string) => import('@babylonjs/core').BaseTexture | null,
): void {
  if (def.matType === 'Standard') {
    const p = def.standardProps
    const m = mat as BabylonStandardMaterial
    m.diffuseColor.r  = p.diffuseColor.r;  m.diffuseColor.g  = p.diffuseColor.g;  m.diffuseColor.b  = p.diffuseColor.b
    m.specularColor.r = p.specularColor.r; m.specularColor.g = p.specularColor.g; m.specularColor.b = p.specularColor.b
    m.emissiveColor.r = p.emissiveColor.r; m.emissiveColor.g = p.emissiveColor.g; m.emissiveColor.b = p.emissiveColor.b
    m.ambientColor.r  = p.ambientColor.r;  m.ambientColor.g  = p.ambientColor.g;  m.ambientColor.b  = p.ambientColor.b
    m.specularPower   = p.specularPower
    m.alpha           = p.alpha
    m.wireframe       = p.wireframe
    m.backFaceCulling = p.backFaceCulling
    if (getTexture) {
      m.diffuseTexture    = p.diffuseTextureId    ? getTexture(p.diffuseTextureId)    : null
      m.ambientTexture    = p.ambientTextureId    ? getTexture(p.ambientTextureId)    : null
      m.opacityTexture    = p.opacityTextureId    ? getTexture(p.opacityTextureId)    : null
      m.emissiveTexture   = p.emissiveTextureId   ? getTexture(p.emissiveTextureId)   : null
      m.specularTexture   = p.specularTextureId   ? getTexture(p.specularTextureId)   : null
      m.bumpTexture       = p.bumpTextureId       ? getTexture(p.bumpTextureId)       : null
      m.reflectionTexture = p.reflectionTextureId ? getTexture(p.reflectionTextureId) : null
      m.lightmapTexture   = p.lightmapTextureId   ? getTexture(p.lightmapTextureId)   : null
    }

  } else if (def.matType === 'PBR') {
    const p = def.pbrProps
    const m = mat as BabylonPBRMaterial
    m.albedoColor.r       = p.albedoColor.r;       m.albedoColor.g       = p.albedoColor.g;       m.albedoColor.b       = p.albedoColor.b
    m.reflectivityColor.r = p.reflectivityColor.r; m.reflectivityColor.g = p.reflectivityColor.g; m.reflectivityColor.b = p.reflectivityColor.b
    m.emissiveColor.r     = p.emissiveColor.r;     m.emissiveColor.g     = p.emissiveColor.g;     m.emissiveColor.b     = p.emissiveColor.b
    m.metallic            = p.metallic
    m.roughness           = p.roughness
    m.alpha               = p.alpha
    m.wireframe           = p.wireframe
    m.backFaceCulling     = p.backFaceCulling
    if (getTexture) {
      m.albedoTexture       = p.albedoTextureId       ? getTexture(p.albedoTextureId)       : null
      m.bumpTexture         = p.bumpTextureId         ? getTexture(p.bumpTextureId)         : null
      m.metallicTexture     = p.metallicTextureId     ? getTexture(p.metallicTextureId)     : null
      m.emissiveTexture     = p.emissiveTextureId     ? getTexture(p.emissiveTextureId)     : null
      m.ambientTexture      = p.ambientTextureId      ? getTexture(p.ambientTextureId)      : null
      m.opacityTexture      = p.opacityTextureId      ? getTexture(p.opacityTextureId)      : null
      m.reflectionTexture   = p.reflectionTextureId   ? getTexture(p.reflectionTextureId)   : null
      m.lightmapTexture     = p.lightmapTextureId     ? getTexture(p.lightmapTextureId)     : null
      m.reflectivityTexture = p.reflectivityTextureId ? getTexture(p.reflectivityTextureId) : null
      m.microSurfaceTexture = p.microSurfaceTextureId ? getTexture(p.microSurfaceTextureId) : null
    }

  } else if (def.matType === 'Shader') {
    // ShaderMaterial requires full source rebuild — handled by onRebuildNeeded.

  } else if (def.matType === 'Custom') {
    const p = def.customProps
    const m = mat as unknown as BabylonCustomMaterial
    m.diffuseColor.r  = p.diffuseColor.r;  m.diffuseColor.g  = p.diffuseColor.g;  m.diffuseColor.b  = p.diffuseColor.b
    m.specularColor.r = p.specularColor.r; m.specularColor.g = p.specularColor.g; m.specularColor.b = p.specularColor.b
    m.emissiveColor.r = p.emissiveColor.r; m.emissiveColor.g = p.emissiveColor.g; m.emissiveColor.b = p.emissiveColor.b
    m.ambientColor.r  = p.ambientColor.r;  m.ambientColor.g  = p.ambientColor.g;  m.ambientColor.b  = p.ambientColor.b
    m.specularPower   = p.specularPower
    m.alpha           = p.alpha
    m.wireframe       = p.wireframe
    m.backFaceCulling = p.backFaceCulling

  } else if (def.matType === 'PBRCustom') {
    const p = def.pbrCustomProps
    const m = mat as unknown as BabylonPBRCustomMaterial
    m.albedoColor.r       = p.albedoColor.r;       m.albedoColor.g       = p.albedoColor.g;       m.albedoColor.b       = p.albedoColor.b
    m.reflectivityColor.r = p.reflectivityColor.r; m.reflectivityColor.g = p.reflectivityColor.g; m.reflectivityColor.b = p.reflectivityColor.b
    m.emissiveColor.r     = p.emissiveColor.r;     m.emissiveColor.g     = p.emissiveColor.g;     m.emissiveColor.b     = p.emissiveColor.b
    m.metallic            = p.metallic
    m.roughness           = p.roughness
    m.alpha               = p.alpha
    m.wireframe           = p.wireframe
    m.backFaceCulling     = p.backFaceCulling
  }
}
