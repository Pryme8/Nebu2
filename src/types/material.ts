// ─────────────────────────────────────────────
// Material Types
// ─────────────────────────────────────────────

import type { Color3Like } from './inspector'

/** All Babylon-backed material variants that Nebu2 supports. */
export type MaterialType = 'Standard' | 'PBR' | 'Shader' | 'Custom' | 'PBRCustom'

// ── Per-type property bags ───────────────────────────────────────

export interface StandardMatProps {
  diffuseColor:       Color3Like
  specularColor:      Color3Like
  emissiveColor:      Color3Like
  ambientColor:       Color3Like
  specularPower:      number
  alpha:              number
  wireframe:          boolean
  backFaceCulling:    boolean
  // ── Texture channel GUIDs (null = no texture assigned) ─────────
  diffuseTextureId:    string | null
  ambientTextureId:    string | null
  opacityTextureId:    string | null
  emissiveTextureId:   string | null
  specularTextureId:   string | null
  bumpTextureId:       string | null
  reflectionTextureId: string | null
  lightmapTextureId:   string | null
}

export interface PBRMatProps {
  albedoColor:       Color3Like
  reflectivityColor: Color3Like
  emissiveColor:     Color3Like
  metallic:          number
  roughness:         number
  alpha:             number
  wireframe:         boolean
  backFaceCulling:   boolean
  // ── Texture channel GUIDs (null = no texture assigned) ─────────
  albedoTextureId:          string | null
  bumpTextureId:            string | null
  metallicTextureId:        string | null
  emissiveTextureId:        string | null
  ambientTextureId:         string | null
  opacityTextureId:         string | null
  reflectionTextureId:      string | null
  lightmapTextureId:        string | null
  reflectivityTextureId:    string | null
  microSurfaceTextureId:    string | null
}

/** ShaderMaterial — raw GLSL source strings, no sampler support yet. */
export interface ShaderMatProps {
  vertexSource:   string
  fragmentSource: string
}

/** CustomMaterial extends StandardMaterial with shader injection snippets. */
export interface CustomMatProps extends StandardMatProps {
  customVertex:   string
  customFragment: string
}

/** PBRCustomMaterial extends PBRMaterial with shader injection snippets. */
export interface PBRCustomMatProps extends PBRMatProps {
  customVertex:   string
  customFragment: string
}

export type MaterialProps =
  | StandardMatProps
  | PBRMatProps
  | ShaderMatProps
  | CustomMatProps
  | PBRCustomMatProps

// ── Serialised form ──────────────────────────────────────────────

export interface SerializedMaterial {
  id:             string
  name:           string
  matType:        MaterialType
  isDefault:      boolean
  standardProps:  StandardMatProps
  pbrProps:       PBRMatProps
  shaderProps:    ShaderMatProps
  customProps:    CustomMatProps
  pbrCustomProps: PBRCustomMatProps
}
