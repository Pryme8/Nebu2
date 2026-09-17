// ─────────────────────────────────────────────
// MeshComponent — ECS component for Babylon.js meshes
// Supports both procedural MeshBuilder shapes and imported model assets.
// ─────────────────────────────────────────────

import { Component }           from '../Component'
import type { InspectorSchema } from '@/types/inspector'
import type { Mesh as BabylonMesh, AbstractMesh } from '@babylonjs/core'

// ── Mesh type union ────────────────────────────────────────────────────────

/**
 * Whether this component renders a procedural shape or an imported model asset.
 * Switching to 'model' activates the modelGuid / instanceMode fields.
 */
export type MeshSource = 'procedural' | 'model'

/**
 * How a model asset is placed in the scene.
 * Only relevant when `source === 'model'`.
 *   'base'         — load the full container mesh hierarchy (unique copy per entity).
 *   'instance'     — create a Babylon InstancedMesh from a shared base mesh.
 *   'thinInstance' — write a matrix into the shared base mesh's thinInstanceBuffer.
 */
export type MeshInstanceMode = 'base' | 'instance' | 'thinInstance'

export type MeshType =
  | 'Box'
  | 'Sphere'
  | 'Cylinder'
  | 'Capsule'
  | 'Torus'
  | 'TorusKnot'
  | 'Ground'
  | 'Plane'
  | 'Disc'
  | 'IcoSphere'
  | 'Polyhedron'
  | 'TiledPlane'
  | 'TiledBox'
  | 'TiledGround'

// ── Per-type option interfaces ─────────────────────────────────────────────

export interface BoxOptions {
  width:  number
  height: number
  depth:  number
  /** 0 = FRONTSIDE, 1 = BACKSIDE, 2 = DOUBLESIDE */
  sideOrientation: number
}

export interface SphereOptions {
  diameter:  number
  segments:  number
  /** 0 = FRONTSIDE, 1 = BACKSIDE, 2 = DOUBLESIDE */
  sideOrientation: number
}

export interface CylinderOptions {
  height:        number
  diameterTop:   number
  diameterBottom: number
  tessellation:  number
  /** 0 = FRONTSIDE, 1 = BACKSIDE, 2 = DOUBLESIDE */
  sideOrientation: number
}

export interface CapsuleOptions {
  height:      number
  radius:      number
  tessellation: number
  subdivisions: number
}

export interface TorusOptions {
  diameter:    number
  thickness:   number
  tessellation: number
  /** 0 = FRONTSIDE, 1 = BACKSIDE, 2 = DOUBLESIDE */
  sideOrientation: number
}

export interface TorusKnotOptions {
  radius:         number
  tube:           number
  radialSegments: number
  tubularSegments: number
  p: number
  q: number
}

export interface GroundOptions {
  width:        number
  height:       number
  subdivisions: number
}

export interface PlaneOptions {
  width:  number
  height: number
  /** 0 = FRONTSIDE, 1 = BACKSIDE, 2 = DOUBLESIDE */
  sideOrientation: number
}

export interface DiscOptions {
  radius:      number
  tessellation: number
  /** 0 = FRONTSIDE, 1 = BACKSIDE, 2 = DOUBLESIDE */
  sideOrientation: number
}

export interface IcoSphereOptions {
  radius:       number
  subdivisions: number
  flat:         boolean
}

export interface PolyhedronOptions {
  /** 0–14 — Babylon's built-in polyhedron types. */
  type: number
  size: number
}

export interface TiledPlaneOptions {
  tileWidth:  number
  tileHeight: number
  width:      number
  height:     number
  /** 0 = FRONTSIDE, 1 = BACKSIDE, 2 = DOUBLESIDE */
  sideOrientation: number
}

export interface TiledBoxOptions {
  width:      number
  height:     number
  depth:      number
  tileWidth:  number
  tileHeight: number
}

export interface TiledGroundOptions {
  xmin:  number
  zmin:  number
  xmax:  number
  zmax:  number
  subdivisions: { w: number; h: number }
  precision:    { w: number; h: number }
}

// ── Side orientation options (shared by several mesh types) ───────────────

const SIDE_OPTIONS = [
  { label: 'Front',   value: 0 },
  { label: 'Back',    value: 1 },
  { label: 'Double',  value: 2 },
]

// ── MeshComponent ──────────────────────────────────────────────────────────

/**
 * MeshComponent — ECS representation of a Babylon.js procedural mesh.
 *
 * Selecting a `meshType` activates the corresponding options sub-section in
 * the inspector.  All other option objects are preserved when switching types.
 *
 * `materialId` references a material in the materialStore (null = Babylon default).
 *
 * `babylonMesh` is the live Babylon mesh; it is created and disposed by
 * sceneStore.  `onRebuildNeeded` is the callback sceneStore installs to
 * trigger a geometry rebuild whenever `syncToBabylon()` is called.
 */
export class MeshComponent extends Component {
  readonly type = 'Mesh'

  // ── Source selector ──────────────────────────────────────────
  /** 'procedural' = MeshBuilder shape; 'model' = imported asset from assetStore. */
  source: MeshSource = 'procedural'

  // ── Model asset binding ──────────────────────────────────────
  /** GUID of a model AssetEntry in the assetStore. null = none. */
  modelGuid: string | null = null

  /**
   * How the model is placed in the scene.
   * 'base': full mesh hierarchy per entity.
   * 'instance': InstancedMesh (shares geometry, independent transform).
   * 'thinInstance': thin-instance matrix entry (fastest, no per-mesh props).
   */
  instanceMode: MeshInstanceMode = 'base'

  /**
   * When set, _rebuildMesh clones only this specific mesh from the model
   * container instead of instantiating the full hierarchy.  Used by the
   * decomposed-model drop flow where each entity represents one submesh.
   */
  submeshName: string | null = null

  // ── Active mesh type ─────────────────────────────────────────
  meshType: MeshType = 'Box'

  // ── Material binding ─────────────────────────────────────────
  /** ID of a MaterialDef in the materialStore.  null = Babylon default. */
  materialId: string | null = null

  // ── Shadow flags ─────────────────────────────────────────────
  /** Whether this mesh is added to shadow generators as a shadow caster. */
  castShadows: boolean = true
  /** Whether this mesh receives shadows projected by shadow generators. */
  receiveShadows: boolean = true

  // ── Per-type options ─────────────────────────────────────────
  boxOptions: BoxOptions = {
    width: 1, height: 1, depth: 1, sideOrientation: 0,
  }

  sphereOptions: SphereOptions = {
    diameter: 1, segments: 16, sideOrientation: 0,
  }

  cylinderOptions: CylinderOptions = {
    height: 1, diameterTop: 1, diameterBottom: 1, tessellation: 24, sideOrientation: 0,
  }

  capsuleOptions: CapsuleOptions = {
    height: 2, radius: 0.5, tessellation: 16, subdivisions: 2,
  }

  torusOptions: TorusOptions = {
    diameter: 2, thickness: 0.5, tessellation: 16, sideOrientation: 0,
  }

  torusKnotOptions: TorusKnotOptions = {
    radius: 2, tube: 0.5, radialSegments: 128, tubularSegments: 8, p: 2, q: 3,
  }

  groundOptions: GroundOptions = {
    width: 10, height: 10, subdivisions: 1,
  }

  planeOptions: PlaneOptions = {
    width: 1, height: 1, sideOrientation: 2,
  }

  discOptions: DiscOptions = {
    radius: 0.5, tessellation: 64, sideOrientation: 0,
  }

  icoSphereOptions: IcoSphereOptions = {
    radius: 0.5, subdivisions: 4, flat: false,
  }

  polyhedronOptions: PolyhedronOptions = {
    type: 0, size: 1,
  }

  tiledPlaneOptions: TiledPlaneOptions = {
    tileWidth: 1, tileHeight: 1, width: 5, height: 5, sideOrientation: 2,
  }

  tiledBoxOptions: TiledBoxOptions = {
    width: 1, height: 1, depth: 1, tileWidth: 1, tileHeight: 1,
  }

  tiledGroundOptions: TiledGroundOptions = {
    xmin: -5, zmin: -5, xmax: 5, zmax: 5,
    subdivisions: { w: 2, h: 2 },
    precision:    { w: 1, h: 1 },
  }

  // ── Runtime refs — not serialised ─────────────────────────────
  babylonMesh: BabylonMesh | null = null

  /**
   * For model source: the root abstract mesh that was added/cloned from the
   * AssetContainer.  For 'instance' mode this is the InstancedMesh; for 'base'
   * mode it is the container's root mesh after being added to the scene.
   * Separate from babylonMesh so procedural + model code-paths stay clean.
   */
  babylonModelMesh: AbstractMesh | null = null

  /**
   * Called by sceneStore when any syncToBabylon() is triggered.
   * Disposes the old Babylon mesh and creates a fresh one.
   */
  onRebuildNeeded: (() => void) | null = null

  /** Called when the component is activated in runtime. */
  onCreate(_babylonScene: unknown, _world: unknown): void {
    this.babylonMesh?.dispose()
    this.babylonMesh = null
    // Babylon mesh creation is handled by sceneStore._createBabylonMesh via onRebuildNeeded
  }

  /** Called when the component is deactivated/disposed in runtime. */
  onDispose(): void {
    this.babylonMesh?.dispose()
    this.babylonMesh = null
    this.babylonModelMesh?.dispose()
    this.babylonModelMesh = null
    this.onRebuildNeeded = null
  }

  // ── Babylon sync ──────────────────────────────────────────────

  /**
   * Every inspector write ultimately calls syncToBabylon().
   * For meshes, the geometry always requires a full rebuild on any change,
   * so we delegate entirely to sceneStore via the onRebuildNeeded callback.
   */
  override syncToBabylon(): void {
    this.onRebuildNeeded?.()
  }

  // ── Inspector schema ──────────────────────────────────────────

  override onInspectorDraw(): InspectorSchema {
    const sourceOptions = [
      { label: 'Procedural', value: 'procedural' },
      { label: 'Model Asset', value: 'model' },
    ]

    const instanceModeOptions = [
      { label: 'Base (unique)',     value: 'base' },
      { label: 'Instance',         value: 'instance' },
      { label: 'Thin Instance',    value: 'thinInstance' },
    ]

    const meshTypeOptions = (
      [
        'Box', 'Sphere', 'Cylinder', 'Capsule', 'Torus', 'TorusKnot',
        'Ground', 'Plane', 'Disc', 'IcoSphere', 'Polyhedron',
        'TiledPlane', 'TiledBox', 'TiledGround',
      ] as MeshType[]
    ).map(v => ({ label: v, value: v }))

    const meshSection: InspectorSchema[0] = {
      title: 'Mesh',
      fields: [
        { key: 'source',         label: 'Source',          type: 'enum',         options: sourceOptions },
        { key: 'castShadows',    label: 'Cast Shadows',    type: 'boolean' },
        { key: 'receiveShadows', label: 'Receive Shadows', type: 'boolean' },
      ],
    }

    if (this.source === 'model') {
      // Model Asset mode — show model picker + instance mode selector
      meshSection.fields.push(
        { key: 'modelGuid',    label: 'Model',         type: 'model-ref' },
        { key: 'instanceMode', label: 'Instance Mode', type: 'enum', options: instanceModeOptions },
        { key: 'materialId',   label: 'Material',      type: 'material-ref' },
      )
      if (this.submeshName) {
        meshSection.fields.push(
          { key: 'submeshName', label: 'Submesh', type: 'string' },
        )
      }
      return [meshSection]
    }

    // Procedural mode — existing type selector + per-type options
    meshSection.fields.push(
      { key: 'meshType',   label: 'Type',     type: 'enum',         options: meshTypeOptions },
      { key: 'materialId', label: 'Material', type: 'material-ref' },
    )

    switch (this.meshType) {
      case 'Box':
        meshSection.fields.push(
          { key: 'boxOptions.width',           label: 'Width',       type: 'number', min: 0.001, step: 0.1 },
          { key: 'boxOptions.height',          label: 'Height',      type: 'number', min: 0.001, step: 0.1 },
          { key: 'boxOptions.depth',           label: 'Depth',       type: 'number', min: 0.001, step: 0.1 },
          { key: 'boxOptions.sideOrientation', label: 'Side',        type: 'enum',   options: SIDE_OPTIONS },
        )
        break

      case 'Sphere':
        meshSection.fields.push(
          { key: 'sphereOptions.diameter',        label: 'Diameter',  type: 'number', min: 0.001, step: 0.1 },
          { key: 'sphereOptions.segments',        label: 'Segments',  type: 'number', min: 3, max: 128, step: 1 },
          { key: 'sphereOptions.sideOrientation', label: 'Side',      type: 'enum',   options: SIDE_OPTIONS },
        )
        break

      case 'Cylinder':
        meshSection.fields.push(
          { key: 'cylinderOptions.height',          label: 'Height',        type: 'number', min: 0.001, step: 0.1 },
          { key: 'cylinderOptions.diameterTop',     label: 'Diameter Top',  type: 'number', min: 0,     step: 0.1 },
          { key: 'cylinderOptions.diameterBottom',  label: 'Diameter Bot',  type: 'number', min: 0,     step: 0.1 },
          { key: 'cylinderOptions.tessellation',    label: 'Tessellation',  type: 'number', min: 3, max: 128, step: 1 },
          { key: 'cylinderOptions.sideOrientation', label: 'Side',          type: 'enum',   options: SIDE_OPTIONS },
        )
        break

      case 'Capsule':
        meshSection.fields.push(
          { key: 'capsuleOptions.height',       label: 'Height',      type: 'number', min: 0.001, step: 0.1 },
          { key: 'capsuleOptions.radius',       label: 'Radius',      type: 'number', min: 0.001, step: 0.1 },
          { key: 'capsuleOptions.tessellation', label: 'Tessellation',type: 'number', min: 3, max: 128, step: 1 },
          { key: 'capsuleOptions.subdivisions', label: 'Subdivisions',type: 'number', min: 1, max: 64,  step: 1 },
        )
        break

      case 'Torus':
        meshSection.fields.push(
          { key: 'torusOptions.diameter',        label: 'Diameter',    type: 'number', min: 0.001, step: 0.1 },
          { key: 'torusOptions.thickness',       label: 'Thickness',   type: 'number', min: 0.001, step: 0.1 },
          { key: 'torusOptions.tessellation',    label: 'Tessellation',type: 'number', min: 3, max: 128, step: 1 },
          { key: 'torusOptions.sideOrientation', label: 'Side',        type: 'enum',   options: SIDE_OPTIONS },
        )
        break

      case 'TorusKnot':
        meshSection.fields.push(
          { key: 'torusKnotOptions.radius',          label: 'Radius',   type: 'number', min: 0.001, step: 0.1  },
          { key: 'torusKnotOptions.tube',            label: 'Tube',     type: 'number', min: 0.001, step: 0.1  },
          { key: 'torusKnotOptions.radialSegments',  label: 'Radial',   type: 'number', min: 3, max: 512, step: 1 },
          { key: 'torusKnotOptions.tubularSegments', label: 'Tubular',  type: 'number', min: 3, max: 64,  step: 1 },
          { key: 'torusKnotOptions.p',               label: 'P',        type: 'number', min: 1, max: 20,  step: 1 },
          { key: 'torusKnotOptions.q',               label: 'Q',        type: 'number', min: 1, max: 20,  step: 1 },
        )
        break

      case 'Ground':
        meshSection.fields.push(
          { key: 'groundOptions.width',        label: 'Width',       type: 'number', min: 0.001, step: 1 },
          { key: 'groundOptions.height',       label: 'Height',      type: 'number', min: 0.001, step: 1 },
          { key: 'groundOptions.subdivisions', label: 'Subdivisions',type: 'number', min: 1, max: 256, step: 1 },
        )
        break

      case 'Plane':
        meshSection.fields.push(
          { key: 'planeOptions.width',           label: 'Width',  type: 'number', min: 0.001, step: 0.1 },
          { key: 'planeOptions.height',          label: 'Height', type: 'number', min: 0.001, step: 0.1 },
          { key: 'planeOptions.sideOrientation', label: 'Side',   type: 'enum',   options: SIDE_OPTIONS },
        )
        break

      case 'Disc':
        meshSection.fields.push(
          { key: 'discOptions.radius',          label: 'Radius',      type: 'number', min: 0.001, step: 0.1 },
          { key: 'discOptions.tessellation',    label: 'Tessellation',type: 'number', min: 3, max: 256, step: 1 },
          { key: 'discOptions.sideOrientation', label: 'Side',        type: 'enum',   options: SIDE_OPTIONS },
        )
        break

      case 'IcoSphere':
        meshSection.fields.push(
          { key: 'icoSphereOptions.radius',       label: 'Radius',      type: 'number', min: 0.001, step: 0.1 },
          { key: 'icoSphereOptions.subdivisions', label: 'Subdivisions',type: 'number', min: 1, max: 8, step: 1 },
          { key: 'icoSphereOptions.flat',         label: 'Flat Shaded', type: 'boolean'                       },
        )
        break

      case 'Polyhedron': {
        const polyTypes = [
          { label: 'Tetrahedron',           value: 0  },
          { label: 'Octahedron',            value: 1  },
          { label: 'Dodecahedron',          value: 2  },
          { label: 'Icosahedron',           value: 3  },
          { label: 'Rhombicuboctahedron',   value: 4  },
          { label: 'Triangular Prism',      value: 5  },
          { label: 'Pentagonal Prism',      value: 6  },
          { label: 'Hexagonal Prism',       value: 7  },
          { label: 'Square Pyramid',        value: 8  },
          { label: 'Pentag. Pyramid',       value: 9  },
          { label: 'Triangular Dipyramid',  value: 10 },
          { label: 'Pentag. Dipyramid',     value: 11 },
          { label: 'Elongated Sq. Dipyr.',  value: 12 },
          { label: 'Elongated Pent. Dipy',  value: 13 },
          { label: 'Augmented Dodecahedron',value: 14 },
        ]
        meshSection.fields.push(
          { key: 'polyhedronOptions.type', label: 'Polyhedron', type: 'enum',   options: polyTypes },
          { key: 'polyhedronOptions.size', label: 'Size',       type: 'number', min: 0.001, step: 0.1 },
        )
        break
      }

      case 'TiledPlane':
        meshSection.fields.push(
          { key: 'tiledPlaneOptions.width',           label: 'Width',  type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledPlaneOptions.height',          label: 'Height', type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledPlaneOptions.tileWidth',       label: 'Tile W', type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledPlaneOptions.tileHeight',      label: 'Tile H', type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledPlaneOptions.sideOrientation', label: 'Side',   type: 'enum',   options: SIDE_OPTIONS },
        )
        break

      case 'TiledBox':
        meshSection.fields.push(
          { key: 'tiledBoxOptions.width',      label: 'Width',  type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledBoxOptions.height',     label: 'Height', type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledBoxOptions.depth',      label: 'Depth',  type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledBoxOptions.tileWidth',  label: 'Tile W', type: 'number', min: 0.001, step: 0.1 },
          { key: 'tiledBoxOptions.tileHeight', label: 'Tile H', type: 'number', min: 0.001, step: 0.1 },
        )
        break

      case 'TiledGround':
        meshSection.fields.push(
          { key: 'tiledGroundOptions.xmin',           label: 'X Min',      type: 'number', step: 1 },
          { key: 'tiledGroundOptions.zmin',           label: 'Z Min',      type: 'number', step: 1 },
          { key: 'tiledGroundOptions.xmax',           label: 'X Max',      type: 'number', step: 1 },
          { key: 'tiledGroundOptions.zmax',           label: 'Z Max',      type: 'number', step: 1 },
          { key: 'tiledGroundOptions.subdivisions.w', label: 'Sub W',      type: 'number', min: 1, max: 256, step: 1 },
          { key: 'tiledGroundOptions.subdivisions.h', label: 'Sub H',      type: 'number', min: 1, max: 256, step: 1 },
          { key: 'tiledGroundOptions.precision.w',    label: 'Precision W',type: 'number', min: 1, max: 64,  step: 1 },
          { key: 'tiledGroundOptions.precision.h',    label: 'Precision H',type: 'number', min: 1, max: 64,  step: 1 },
        )
        break
    }

    return [meshSection]
  }

  // ── Serialisation ─────────────────────────────────────────────

  override serialize(): Record<string, unknown> {
    return {
      source:            this.source,
      modelGuid:         this.modelGuid,
      instanceMode:      this.instanceMode,
      submeshName:       this.submeshName,
      meshType:          this.meshType,
      materialId:        this.materialId,
      castShadows:       this.castShadows,
      receiveShadows:    this.receiveShadows,
      boxOptions:        { ...this.boxOptions },
      sphereOptions:     { ...this.sphereOptions },
      cylinderOptions:   { ...this.cylinderOptions },
      capsuleOptions:    { ...this.capsuleOptions },
      torusOptions:      { ...this.torusOptions },
      torusKnotOptions:  { ...this.torusKnotOptions },
      groundOptions:     { ...this.groundOptions },
      planeOptions:      { ...this.planeOptions },
      discOptions:       { ...this.discOptions },
      icoSphereOptions:  { ...this.icoSphereOptions },
      polyhedronOptions: { ...this.polyhedronOptions },
      tiledPlaneOptions: { ...this.tiledPlaneOptions },
      tiledBoxOptions:   { ...this.tiledBoxOptions },
      tiledGroundOptions: {
        xmin: this.tiledGroundOptions.xmin,
        zmin: this.tiledGroundOptions.zmin,
        xmax: this.tiledGroundOptions.xmax,
        zmax: this.tiledGroundOptions.zmax,
        subdivisions: { ...this.tiledGroundOptions.subdivisions },
        precision:    { ...this.tiledGroundOptions.precision },
      },
    }
  }

  static deserialize(data: Record<string, unknown>): MeshComponent {
    const c = new MeshComponent()
    if (data.source       !== undefined) c.source       = data.source       as MeshSource
    if (data.modelGuid    !== undefined) c.modelGuid    = data.modelGuid    as string | null
    if (data.instanceMode !== undefined) c.instanceMode = data.instanceMode as MeshInstanceMode
    if (data.submeshName  !== undefined) c.submeshName  = data.submeshName  as string | null
    if (data.meshType      !== undefined) c.meshType      = data.meshType      as MeshComponent['meshType']
    if (data.materialId     !== undefined) c.materialId     = data.materialId     as string | null
    if (typeof data.castShadows    === 'boolean') c.castShadows    = data.castShadows
    if (typeof data.receiveShadows === 'boolean') c.receiveShadows = data.receiveShadows
    if (data.boxOptions)        c.boxOptions        = { ...c.boxOptions,        ...(data.boxOptions        as object) }
    if (data.sphereOptions)     c.sphereOptions     = { ...c.sphereOptions,     ...(data.sphereOptions     as object) }
    if (data.cylinderOptions)   c.cylinderOptions   = { ...c.cylinderOptions,   ...(data.cylinderOptions   as object) }
    if (data.capsuleOptions)    c.capsuleOptions    = { ...c.capsuleOptions,    ...(data.capsuleOptions    as object) }
    if (data.torusOptions)      c.torusOptions      = { ...c.torusOptions,      ...(data.torusOptions      as object) }
    if (data.torusKnotOptions)  c.torusKnotOptions  = { ...c.torusKnotOptions,  ...(data.torusKnotOptions  as object) }
    if (data.groundOptions)     c.groundOptions     = { ...c.groundOptions,     ...(data.groundOptions     as object) }
    if (data.planeOptions)      c.planeOptions      = { ...c.planeOptions,      ...(data.planeOptions      as object) }
    if (data.discOptions)       c.discOptions       = { ...c.discOptions,       ...(data.discOptions       as object) }
    if (data.icoSphereOptions)  c.icoSphereOptions  = { ...c.icoSphereOptions,  ...(data.icoSphereOptions  as object) }
    if (data.polyhedronOptions) c.polyhedronOptions = { ...c.polyhedronOptions, ...(data.polyhedronOptions as object) }
    if (data.tiledPlaneOptions) c.tiledPlaneOptions = { ...c.tiledPlaneOptions, ...(data.tiledPlaneOptions as object) }
    if (data.tiledBoxOptions)   c.tiledBoxOptions   = { ...c.tiledBoxOptions,   ...(data.tiledBoxOptions   as object) }
    if (data.tiledGroundOptions) {
      const tgo = data.tiledGroundOptions as Record<string, unknown>
      c.tiledGroundOptions = {
        ...c.tiledGroundOptions,
        ...tgo,
        subdivisions: tgo.subdivisions
          ? { ...c.tiledGroundOptions.subdivisions, ...(tgo.subdivisions as object) }
          : c.tiledGroundOptions.subdivisions,
        precision: tgo.precision
          ? { ...c.tiledGroundOptions.precision, ...(tgo.precision as object) }
          : c.tiledGroundOptions.precision,
      }
    }
    return c
  }
}
