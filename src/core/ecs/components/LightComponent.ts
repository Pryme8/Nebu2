import { Component }                      from '../Component'
import type { Vec3 }                      from './TransformComponent'
import type { Color3Like }                from '@/types/inspector'
import type { InspectorSchema }           from '@/types/inspector'
import type { WidgetSchema, WidgetPoint } from '@/types/widget'
import type {
  HemisphericLight as BabylonHemisphericLight,
  DirectionalLight as BabylonDirectionalLight,
  SpotLight        as BabylonSpotLight,
  PointLight       as BabylonPointLight,
  ShadowGenerator,
} from '@babylonjs/core'

// ── Widget geometry constants ─────────────────────────────────────────────
const LW_STEPS  = 17   // points per half-circle (16 arc segments)
const LW_RADIUS = 1.5

const SHADOW_MAP_SIZES = [
  { label: '256',  value: 256  },
  { label: '512',  value: 512  },
  { label: '1024', value: 1024 },
  { label: '2048', value: 2048 },
  { label: '4096', value: 4096 },
]

// Matches ShadowGenerator.FILTER_* integer constants
const SHADOW_FILTER_OPTIONS = [
  { label: 'None',             value: 0 },
  { label: 'Poisson Sampling', value: 2 },
  { label: 'ESM',              value: 1 },
  { label: 'ESM (Blur)',       value: 3 },
  { label: 'Close ESM',        value: 4 },
  { label: 'Close ESM (Blur)', value: 5 },
  { label: 'PCF',              value: 6 },
  { label: 'PCSS',             value: 7 },
]

const ESM_FILTERS  = new Set([1, 3, 4, 5])
const BLUR_FILTERS = new Set([3, 5])

/** All supported Babylon.js light types. */
export type LightType = 'Hemispheric' | 'Directional' | 'Spot' | 'Point'

type AnyBabylonLight =
  | BabylonHemisphericLight
  | BabylonDirectionalLight
  | BabylonSpotLight
  | BabylonPointLight

/**
 * LightComponent — ECS representation of a Babylon.js light.
 *
 * `lightType` controls which Babylon light subclass is created:
 *   - Hemispheric  — ambient sky/ground light (no shadow support)
 *   - Directional  — sun-like infinite light; supports ShadowGenerator / CascadedShadowGenerator
 *   - Spot         — cone light; supports ShadowGenerator
 *   - Point        — omnidirectional point light; supports ShadowGenerator
 *
 * `babylon*` fields are live runtime refs managed by sceneStore and never serialised.
 * Any inspector write calls `syncToBabylon()` which triggers a full light rebuild so
 * that structural changes (type switch, shadow toggle) are always applied correctly.
 */
export class LightComponent extends Component {
  readonly type = 'Light'

  // ── Light type ────────────────────────────────────────────────
  lightType: LightType = 'Hemispheric'

  // ── Shared serialisable data ──────────────────────────────────
  intensity: number     = 1.0
  diffuse:   Color3Like = { r: 1, g: 1, b: 1 }
  specular:  Color3Like = { r: 1, g: 1, b: 1 }

  /** Direction vector — Hemispheric, Directional, Spot. */
  direction:   Vec3       = { x: 0, y: -1, z: 0 }
  /** Ground hemisphere colour — Hemispheric only. */
  groundColor: Color3Like = { r: 0, g: 0, b: 0 }

  /** World-space position — Spot and Point lights. */
  position: Vec3   = { x: 0, y: 3, z: 0 }
  /** Half-angle of the spotlight cone in radians — Spot only. */
  angle:    number = Math.PI / 4
  /** Spotlight falloff exponent — Spot only. */
  exponent: number = 2

  // ── Shadow properties ─────────────────────────────────────────
  /** Cast shadows from this light. Not supported on Hemispheric lights. */
  castShadows: boolean = false
  /** Shadow map texture resolution (px). Powers of two recommended. */
  shadowMapSize: number = 1024
  /** Filter mode — maps to ShadowGenerator.FILTER_* (0–7). */
  shadowFilter: number = 0
  /** Depth bias to prevent shadow acne. */
  shadowBias: number = 0.00005
  /** Normal-based bias for more accurate self-shadowing on curved surfaces. */
  shadowNormalBias: number = 0
  /** 0 = fully opaque shadows, 1 = no darkness (transparent shadows). */
  shadowDarkness: number = 0
  /** Allow transparent meshes to cast shadows. */
  shadowTransparency: boolean = false
  /** Depth scale for ESM filters (higher = harder shadow edge). */
  shadowDepthScale: number = 50
  /** Kernel size for kernel-based blur (Blur ESM filters). */
  shadowBlurKernel: number = 1
  /** Render target scale for blur (Blur ESM filters). */
  shadowBlurScale: number = 2
  /** Perceived size of the light source for PCSS contact-hardening shadows. */
  shadowContactHardeningLightSize: number = 0.1
  /** Use CascadedShadowGenerator for Directional lights (falls back to ShadowGenerator). */
  useCascadedShadows: boolean = true
  /** Number of CSM cascades (2–4). */
  numCascades: number = 4
  /** Blend factor between practical (0) and logarithmic (1) cascade splits. */
  csmLambda: number = 0.5
  /** Percentage of each cascade range used for blending into the next. */
  csmCascadeBlendPercentage: number = 0.1
  /** Clamp shadow receiver depth into the shadow map range to reduce artifacts. */
  csmDepthClamp: boolean = false
  /** Automatically calculate near/far depth bounds from the scene each frame. */
  csmAutoCalcDepthBounds: boolean = false

  // ── Runtime refs — never serialised ──────────────────────────
  babylonLight:           AnyBabylonLight | null = null
  babylonShadowGenerator: ShadowGenerator | null = null
  /** Installed by sceneStore; triggers a full Babylon light + shadow-gen rebuild. */
  onRebuildNeeded: (() => void) | null = null

  // ── Lifecycle ─────────────────────────────────────────────────

  onCreate(_babylonScene: unknown, _world: unknown): void {
    this.babylonShadowGenerator?.dispose()
    this.babylonShadowGenerator = null
    this.babylonLight?.dispose()
    this.babylonLight    = null
    this.onRebuildNeeded = null
  }

  onDispose(): void {
    this.babylonShadowGenerator?.dispose()
    this.babylonShadowGenerator = null
    this.babylonLight?.dispose()
    this.babylonLight    = null
    this.onRebuildNeeded = null
  }

  // ── Babylon sync ──────────────────────────────────────────────

  /**
   * Every inspector write calls syncToBabylon().
   * We always do a full rebuild so that type switches, shadow-gen creation/
   * destruction, and CSM-vs-standard changes are handled correctly.
   */
  override syncToBabylon(): void {
    this.onRebuildNeeded?.()
  }

  // ── Inspector schema ──────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    const typeOptions: Array<{ label: string; value: string }> = [
      { label: 'Hemispheric', value: 'Hemispheric' },
      { label: 'Directional', value: 'Directional' },
      { label: 'Spot',        value: 'Spot'        },
      { label: 'Point',       value: 'Point'       },
    ]

    const lightSection: InspectorSchema[0] = {
      title: `${this.lightType} Light`,
      fields: [
        { key: 'showWidget', label: 'Show Widget', type: 'boolean' },
        { key: 'lightType',  label: 'Type',        type: 'enum',   options: typeOptions },
        { key: 'intensity',  label: 'Intensity',   type: 'number', min: 0, max: 10, step: 0.01 },
        { key: 'diffuse',    label: 'Diffuse',     type: 'color3' },
        { key: 'specular',   label: 'Specular',    type: 'color3' },
      ],
    }

    switch (this.lightType) {
      case 'Hemispheric':
        lightSection.fields.push(
          { key: 'direction',   label: 'Direction',    type: 'vec3',   step: 0.1 },
          { key: 'groundColor', label: 'Ground Color', type: 'color3' },
        )
        break
      case 'Directional':
        lightSection.fields.push(
          { key: 'direction', label: 'Direction', type: 'vec3', step: 0.1 },
        )
        break
      case 'Spot':
        lightSection.fields.push(
          { key: 'position',  label: 'Position',    type: 'vec3',   step: 0.1 },
          { key: 'direction', label: 'Direction',   type: 'vec3',   step: 0.1 },
          { key: 'angle',     label: 'Angle (rad)', type: 'number', min: 0.01, max: Math.PI, step: 0.01 },
          { key: 'exponent',  label: 'Exponent',    type: 'number', min: 0, max: 128, step: 0.1 },
        )
        break
      case 'Point':
        lightSection.fields.push(
          { key: 'position', label: 'Position', type: 'vec3', step: 0.1 },
        )
        break
    }

    const sections: InspectorSchema = [lightSection]

    // Shadow section — only for shadow-capable light types
    if (this.lightType !== 'Hemispheric') {
      const sf: InspectorSchema[0]['fields'] = [
        { key: 'castShadows', label: 'Cast Shadows', type: 'boolean' },
      ]
      if (this.castShadows) {
        sf.push(
          { key: 'shadowMapSize',   label: 'Map Size', type: 'enum',   options: SHADOW_MAP_SIZES },
          { key: 'shadowFilter',    label: 'Filter',   type: 'enum',   options: SHADOW_FILTER_OPTIONS },
          { key: 'shadowBias',      label: 'Bias',     type: 'number', min: 0,     max: 0.1, step: 0.00001 },
          { key: 'shadowNormalBias',label: 'Normal Bias', type: 'number', min: 0, max: 0.1, step: 0.00001 },
          { key: 'shadowDarkness',  label: 'Darkness', type: 'number', min: 0,     max: 1,   step: 0.01 },
          { key: 'shadowTransparency', label: 'Transparent Shadows', type: 'boolean' },
        )
        if (ESM_FILTERS.has(this.shadowFilter)) {
          sf.push({ key: 'shadowDepthScale', label: 'Depth Scale', type: 'number', min: 1, max: 200, step: 1 })
        }
        if (BLUR_FILTERS.has(this.shadowFilter)) {
          sf.push(
            { key: 'shadowBlurKernel', label: 'Blur Kernel', type: 'number', min: 1, max: 64, step: 1 },
            { key: 'shadowBlurScale',  label: 'Blur Scale',  type: 'number', min: 1, max: 8,  step: 0.1 },
          )
        }
        if (this.shadowFilter === 7) {
          sf.push({ key: 'shadowContactHardeningLightSize', label: 'Light Size UV', type: 'number', min: 0.001, max: 1, step: 0.001 })
        }
        if (this.lightType === 'Directional') {
          sf.push({ key: 'useCascadedShadows', label: 'Cascaded (CSM)', type: 'boolean' })
          if (this.useCascadedShadows) {
            sf.push(
              { key: 'numCascades',              label: 'Cascades',          type: 'number',  min: 2, max: 4, step: 1 },
              { key: 'csmLambda',                label: 'Lambda',            type: 'number',  min: 0, max: 1,   step: 0.01 },
              { key: 'csmCascadeBlendPercentage',label: 'Cascade Blend',     type: 'number',  min: 0, max: 1,   step: 0.01 },
              { key: 'csmDepthClamp',            label: 'Depth Clamp',       type: 'boolean' },
              { key: 'csmAutoCalcDepthBounds',   label: 'Auto Depth Bounds', type: 'boolean' },
            )
          }
        }
      }
      sections.push({ title: 'Shadows', fields: sf })
    }

    return sections
  }

  // ── Viewport widget ────────────────────────────────────────────

  override onWidgetDraw(): WidgetSchema {
    if (this.lightType === 'Hemispheric') return this._hemisphereWidget()

    const dir = this.direction
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len

    if (this.lightType === 'Directional') {
      // Three parallel rays to suggest infinite directional light
      const arrowLen = LW_RADIUS * 1.5
      const offset   = LW_RADIUS * 0.5
      const [[ux, uy, uz]] = [this._twoPerps(dx, dy, dz)[0]]
      return {
        groups: [{
          lines: [
            [{ x: 0,          y: 0,          z: 0          }, { x: dx * arrowLen,             y: dy * arrowLen,             z: dz * arrowLen             }],
            [{ x: ux * offset, y: uy * offset, z: uz * offset }, { x: ux * offset + dx * arrowLen, y: uy * offset + dy * arrowLen, z: uz * offset + dz * arrowLen }],
            [{ x: -ux * offset, y: -uy * offset, z: -uz * offset }, { x: -ux * offset + dx * arrowLen, y: -uy * offset + dy * arrowLen, z: -uz * offset + dz * arrowLen }],
          ],
          color: this.diffuse,
        }],
      }
    }

    if (this.lightType === 'Spot') {
      const px = this.position.x, py = this.position.y, pz = this.position.z
      const coneLen = LW_RADIUS * 2
      const coneR   = Math.tan(this.angle) * coneLen
      const [ux, uy, uz] = this._twoPerps(dx, dy, dz)[0]
      const [vx, vy, vz] = this._twoPerps(dx, dy, dz)[1]
      const STEPS = 16
      const ring: WidgetPoint[] = Array.from({ length: STEPS + 1 }, (_, i) => {
        const a = (i / STEPS) * Math.PI * 2
        const rx = (Math.cos(a) * ux + Math.sin(a) * vx) * coneR
        const ry = (Math.cos(a) * uy + Math.sin(a) * vy) * coneR
        const rz = (Math.cos(a) * uz + Math.sin(a) * vz) * coneR
        return { x: px + dx * coneLen + rx, y: py + dy * coneLen + ry, z: pz + dz * coneLen + rz }
      })
      const tip: WidgetPoint = { x: px, y: py, z: pz }
      const q = STEPS / 4 | 0
      return {
        groups: [{
          lines: [ring, [tip, ring[0]], [tip, ring[q]], [tip, ring[q * 2]], [tip, ring[q * 3]]],
          color: this.diffuse,
        }],
      }
    }

    // Point — three-axis cross at position
    const d = 0.5
    const px = this.position.x, py = this.position.y, pz = this.position.z
    return {
      groups: [{
        lines: [
          [{ x: px - d, y: py,     z: pz     }, { x: px + d, y: py,     z: pz     }],
          [{ x: px,     y: py - d, z: pz     }, { x: px,     y: py + d, z: pz     }],
          [{ x: px,     y: py,     z: pz - d }, { x: px,     y: py,     z: pz + d }],
        ],
        color: this.diffuse,
      }],
    }
  }

  /** Hemisphere widget (two half-circle arcs + direction arrow). */
  private _hemisphereWidget(): WidgetSchema {
    const dir = this.direction
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len
    const [[ux, uy, uz], [vx, vy, vz]] = this._twoPerps(dx, dy, dz)

    const half = (ax: number, ay: number, az: number, pole: number): WidgetPoint[] =>
      Array.from({ length: LW_STEPS }, (_, i) => {
        const φ = (i / (LW_STEPS - 1)) * Math.PI
        const c = Math.cos(φ) * LW_RADIUS
        const s = Math.sin(φ) * LW_RADIUS * pole
        return { x: ax * c + dx * s, y: ay * c + dy * s, z: az * c + dz * s }
      })

    return {
      groups: [
        {
          lines: [
            half(ux, uy, uz, +1),
            half(vx, vy, vz, +1),
            [{ x: 0, y: 0, z: 0 }, { x: dx * LW_RADIUS * 1.5, y: dy * LW_RADIUS * 1.5, z: dz * LW_RADIUS * 1.5 }],
          ],
          color: this.diffuse,
        },
        {
          lines: [half(ux, uy, uz, -1), half(vx, vy, vz, -1)],
          color: this.groundColor,
        },
      ],
    }
  }

  /** Returns two unit vectors perpendicular to (dx, dy, dz) and each other. */
  private _twoPerps(dx: number, dy: number, dz: number): [[number, number, number], [number, number, number]] {
    const useY = Math.abs(dy) < 0.99
    const rx = useY ? 0 : 1, ry = useY ? 1 : 0, rz = 0
    let ux = dy * rz - dz * ry, uy = dz * rx - dx * rz, uz = dx * ry - dy * rx
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1
    ux /= ul; uy /= ul; uz /= ul
    let vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1
    vx /= vl; vy /= vl; vz /= vl
    return [[ux, uy, uz], [vx, vy, vz]]
  }

  // ── Serialisation ─────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return {
      lightType:          this.lightType,
      showWidget:         this.showWidget,
      intensity:          this.intensity,
      diffuse:            { ...this.diffuse },
      specular:           { ...this.specular },
      direction:          { ...this.direction },
      groundColor:        { ...this.groundColor },
      position:           { ...this.position },
      angle:              this.angle,
      exponent:           this.exponent,
      castShadows:                   this.castShadows,
      shadowMapSize:                 this.shadowMapSize,
      shadowFilter:                  this.shadowFilter,
      shadowBias:                    this.shadowBias,
      shadowNormalBias:              this.shadowNormalBias,
      shadowDarkness:                this.shadowDarkness,
      shadowTransparency:            this.shadowTransparency,
      shadowDepthScale:              this.shadowDepthScale,
      shadowBlurKernel:              this.shadowBlurKernel,
      shadowBlurScale:               this.shadowBlurScale,
      shadowContactHardeningLightSize: this.shadowContactHardeningLightSize,
      useCascadedShadows:            this.useCascadedShadows,
      numCascades:                   this.numCascades,
      csmLambda:                     this.csmLambda,
      csmCascadeBlendPercentage:     this.csmCascadeBlendPercentage,
      csmDepthClamp:                 this.csmDepthClamp,
      csmAutoCalcDepthBounds:        this.csmAutoCalcDepthBounds,
    }
  }

  static deserialize(data: Record<string, unknown>): LightComponent {
    const c = new LightComponent()
    if (typeof data.lightType          === 'string')  c.lightType          = data.lightType          as LightType
    if (typeof data.showWidget         === 'boolean') c.showWidget         = data.showWidget
    if (typeof data.intensity          === 'number')  c.intensity          = data.intensity
    if (data.diffuse)                                 c.diffuse            = data.diffuse            as Color3Like
    if (data.specular)                                c.specular           = data.specular           as Color3Like
    if (data.direction)                               c.direction          = data.direction          as Vec3
    if (data.groundColor)                             c.groundColor        = data.groundColor        as Color3Like
    if (data.position)                                c.position           = data.position           as Vec3
    if (typeof data.angle              === 'number')  c.angle              = data.angle
    if (typeof data.exponent           === 'number')  c.exponent           = data.exponent
    if (typeof data.castShadows                    === 'boolean') c.castShadows                    = data.castShadows
    if (typeof data.shadowMapSize                   === 'number')  c.shadowMapSize                   = data.shadowMapSize
    if (typeof data.shadowFilter                    === 'number')  c.shadowFilter                    = data.shadowFilter
    if (typeof data.shadowBias                      === 'number')  c.shadowBias                      = data.shadowBias
    if (typeof data.shadowNormalBias                === 'number')  c.shadowNormalBias                = data.shadowNormalBias
    if (typeof data.shadowDarkness                  === 'number')  c.shadowDarkness                  = data.shadowDarkness
    if (typeof data.shadowTransparency              === 'boolean') c.shadowTransparency              = data.shadowTransparency
    if (typeof data.shadowDepthScale                === 'number')  c.shadowDepthScale                = data.shadowDepthScale
    if (typeof data.shadowBlurKernel                === 'number')  c.shadowBlurKernel                = data.shadowBlurKernel
    if (typeof data.shadowBlurScale                 === 'number')  c.shadowBlurScale                 = data.shadowBlurScale
    if (typeof data.shadowContactHardeningLightSize === 'number')  c.shadowContactHardeningLightSize = data.shadowContactHardeningLightSize
    if (typeof data.useCascadedShadows              === 'boolean') c.useCascadedShadows              = data.useCascadedShadows
    if (typeof data.numCascades                     === 'number')  c.numCascades                     = data.numCascades
    if (typeof data.csmLambda                       === 'number')  c.csmLambda                       = data.csmLambda
    if (typeof data.csmCascadeBlendPercentage       === 'number')  c.csmCascadeBlendPercentage       = data.csmCascadeBlendPercentage
    if (typeof data.csmDepthClamp                   === 'boolean') c.csmDepthClamp                   = data.csmDepthClamp
    if (typeof data.csmAutoCalcDepthBounds          === 'boolean') c.csmAutoCalcDepthBounds          = data.csmAutoCalcDepthBounds
    return c
  }
}
