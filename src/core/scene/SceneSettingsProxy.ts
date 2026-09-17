import type { InspectorTarget, InspectorSchema, Color3Like, Color4Like, Vec3Like } from '@/types/inspector'
import type { Scene as BabylonScene } from '@babylonjs/core'

// ── Serialisation shape ───────────────────────────────────────────

export interface SerializedSceneSettings {
  clearColor:           Color4Like
  ambientColor:         Color3Like
  shadowsEnabled:       boolean
  lightsEnabled:        boolean
  texturesEnabled:      boolean
  particlesEnabled:     boolean
  skeletonsEnabled:     boolean
  animationsEnabled:    boolean
  fogEnabled:           boolean
  fogMode:              number     // 0=None 1=Exp 2=Exp2 3=Linear
  fogColor:             Color3Like
  fogDensity:           number
  fogStart:             number
  fogEnd:               number
  gravity:              Vec3Like
  collisionsEnabled:    boolean
  useRightHandedSystem: boolean
}

// ── Proxy class ───────────────────────────────────────────────────

/**
 * SceneSettingsProxy — holds all serialisable Babylon.Scene properties
 * and implements InspectorTarget so ComponentInspector.vue can render
 * and drive them with zero extra code.
 *
 * Defaults match the Babylon / BabylonViewport baseline so that a
 * newly-created scene does not visually change when syncToBabylon() runs.
 */
export class SceneSettingsProxy implements InspectorTarget {

  // ── Rendering ─────────────────────────────────────────────────
  clearColor:           Color4Like = { r: 0.09, g: 0.09, b: 0.12, a: 1 }
  ambientColor:         Color3Like = { r: 0,    g: 0,    b: 0 }
  shadowsEnabled:       boolean    = true
  lightsEnabled:        boolean    = true
  texturesEnabled:      boolean    = true
  particlesEnabled:     boolean    = true
  skeletonsEnabled:     boolean    = true
  animationsEnabled:    boolean    = true

  // ── Fog ───────────────────────────────────────────────────────
  fogEnabled:  boolean    = false
  fogMode:     number     = 0
  fogColor:    Color3Like = { r: 0.2, g: 0.2, b: 0.3 }
  fogDensity:  number     = 0.1
  fogStart:    number     = 0
  fogEnd:      number     = 1000

  // ── World ─────────────────────────────────────────────────────
  gravity:             Vec3Like = { x: 0, y: -9.81, z: 0 }
  collisionsEnabled:   boolean  = false
  useRightHandedSystem: boolean = false

  /** Live Babylon scene — set by sceneStore, never serialised. */
  babylonScene: BabylonScene | null = null

  // ── Inspector schema ──────────────────────────────────────────

  onInspectorDraw(): InspectorSchema {
    return [
      {
        title: 'Rendering',
        fields: [
          { key: 'clearColor',        label: 'Clear Color',     type: 'color4' },
          { key: 'ambientColor',      label: 'Ambient Color',   type: 'color3' },
          { key: 'shadowsEnabled',    label: 'Shadows',         type: 'boolean' },
          { key: 'lightsEnabled',     label: 'Lights',          type: 'boolean' },
          { key: 'texturesEnabled',   label: 'Textures',        type: 'boolean' },
          { key: 'particlesEnabled',  label: 'Particles',       type: 'boolean' },
          { key: 'skeletonsEnabled',  label: 'Skeletons',       type: 'boolean' },
          { key: 'animationsEnabled', label: 'Animations',      type: 'boolean' },
        ],
      },
      {
        title: 'Fog',
        fields: [
          { key: 'fogEnabled', label: 'Enabled', type: 'boolean' },
          {
            key: 'fogMode', label: 'Mode', type: 'enum',
            options: [
              { label: 'None',   value: 0 },
              { label: 'Exp',    value: 1 },
              { label: 'Exp2',   value: 2 },
              { label: 'Linear', value: 3 },
            ],
          },
          { key: 'fogColor',   label: 'Color',   type: 'color3' },
          { key: 'fogDensity', label: 'Density', type: 'number', min: 0, max: 1,    step: 0.001 },
          { key: 'fogStart',   label: 'Start',   type: 'number', min: 0,            step: 1 },
          { key: 'fogEnd',     label: 'End',     type: 'number', min: 0,            step: 1 },
        ],
      },
      {
        title: 'World',
        fields: [
          { key: 'gravity',              label: 'Gravity',             type: 'vec3',    step: 0.1 },
          { key: 'collisionsEnabled',    label: 'Collisions',          type: 'boolean' },
          { key: 'useRightHandedSystem', label: 'Right-Handed System', type: 'boolean' },
        ],
      },
    ]
  }

  // ── Babylon sync ─────────────────────────────────────────────

  /** No-op — SceneSettingsProxy has no widget subscribers. */
  notifyChanged(): void {}

  syncToBabylon(): void {
    const s = this.babylonScene
    if (!s) return

    // Rendering
    s.clearColor.r        = this.clearColor.r
    s.clearColor.g        = this.clearColor.g
    s.clearColor.b        = this.clearColor.b
    s.clearColor.a        = this.clearColor.a
    s.ambientColor.r      = this.ambientColor.r
    s.ambientColor.g      = this.ambientColor.g
    s.ambientColor.b      = this.ambientColor.b
    s.shadowsEnabled      = this.shadowsEnabled
    s.lightsEnabled       = this.lightsEnabled
    s.texturesEnabled     = this.texturesEnabled
    s.particlesEnabled    = this.particlesEnabled
    s.skeletonsEnabled    = this.skeletonsEnabled
    s.animationsEnabled   = this.animationsEnabled

    // Fog
    s.fogEnabled  = this.fogEnabled
    s.fogMode     = this.fogMode
    s.fogColor.r  = this.fogColor.r
    s.fogColor.g  = this.fogColor.g
    s.fogColor.b  = this.fogColor.b
    s.fogDensity  = this.fogDensity
    s.fogStart    = this.fogStart
    s.fogEnd      = this.fogEnd

    // World
    s.gravity.x            = this.gravity.x
    s.gravity.y            = this.gravity.y
    s.gravity.z            = this.gravity.z
    s.collisionsEnabled    = this.collisionsEnabled
    s.useRightHandedSystem = this.useRightHandedSystem
  }

  // ── Serialisation ─────────────────────────────────────────────

  serialize(): SerializedSceneSettings {
    return {
      clearColor:           { ...this.clearColor },
      ambientColor:         { ...this.ambientColor },
      shadowsEnabled:       this.shadowsEnabled,
      lightsEnabled:        this.lightsEnabled,
      texturesEnabled:      this.texturesEnabled,
      particlesEnabled:     this.particlesEnabled,
      skeletonsEnabled:     this.skeletonsEnabled,
      animationsEnabled:    this.animationsEnabled,
      fogEnabled:           this.fogEnabled,
      fogMode:              this.fogMode,
      fogColor:             { ...this.fogColor },
      fogDensity:           this.fogDensity,
      fogStart:             this.fogStart,
      fogEnd:               this.fogEnd,
      gravity:              { ...this.gravity },
      collisionsEnabled:    this.collisionsEnabled,
      useRightHandedSystem: this.useRightHandedSystem,
    }
  }

  static deserialize(data: Partial<SerializedSceneSettings>): SceneSettingsProxy {
    const s = new SceneSettingsProxy()
    if (data.clearColor)                         s.clearColor           = data.clearColor
    if (data.ambientColor)                        s.ambientColor         = data.ambientColor
    if (data.shadowsEnabled      !== undefined)   s.shadowsEnabled       = data.shadowsEnabled
    if (data.lightsEnabled       !== undefined)   s.lightsEnabled        = data.lightsEnabled
    if (data.texturesEnabled     !== undefined)   s.texturesEnabled      = data.texturesEnabled
    if (data.particlesEnabled    !== undefined)   s.particlesEnabled     = data.particlesEnabled
    if (data.skeletonsEnabled    !== undefined)   s.skeletonsEnabled     = data.skeletonsEnabled
    if (data.animationsEnabled   !== undefined)   s.animationsEnabled    = data.animationsEnabled
    if (data.fogEnabled          !== undefined)   s.fogEnabled           = data.fogEnabled
    if (data.fogMode             !== undefined)   s.fogMode              = data.fogMode
    if (data.fogColor)                            s.fogColor             = data.fogColor
    if (data.fogDensity          !== undefined)   s.fogDensity           = data.fogDensity
    if (data.fogStart            !== undefined)   s.fogStart             = data.fogStart
    if (data.fogEnd              !== undefined)   s.fogEnd               = data.fogEnd
    if (data.gravity)                             s.gravity              = data.gravity
    if (data.collisionsEnabled   !== undefined)   s.collisionsEnabled    = data.collisionsEnabled
    if (data.useRightHandedSystem !== undefined)  s.useRightHandedSystem = data.useRightHandedSystem
    return s
  }
}
