import type { ExportTemplate } from '@/types/export'

// ─────────────────────────────────────────────────────────────────────────────
// Nebu2 Runtime — inline JavaScript embedded in every exported page.
//
// Reads window.__NEBU_MANIFEST and reconstructs the scene(s) using the
// Babylon.js global loaded from CDN just above this script block.
//
// Support matrix:
//  ✔  Scene settings (clearColor, fog, gravity, etc.)
//  ✔  TransformNode hierarchy (position / rotation / scale)
//  ✔  Procedural meshes (Box, Sphere, Cylinder, Capsule, Torus, TorusKnot,
//      Ground, Plane, Disc, IcoSphere, Polyhedron)
//  ✔  Lights (Hemispheric, Directional, Point, Spot) + shadows
//  ✔  Cameras (UniversalCamera, ArcRotateCamera) with auto-attach controls
//  ✔  Multi-scene dropdown switching
//  ✔  Materials (Standard, PBR) with textures
//  ✔  User scripts (NebuScript lifecycle: onAwake → onStart → onUpdate …)
//  ✔  Havok physics (RigidBody, Collider, PhysicsWorld, PhysicsConstraint)
//  ✗  Imported mesh assets (GLB/GLTF) — future
//  ✗  Shader / Custom / PBRCustom materials — future
//
// Extension guide:
//   New ECS component types are automatically included in the scene JSON by
//   the ExportBuilder — no builder changes needed.  To reconstruct a new
//   component at runtime, either:
//     • Add a branch in the entity-creation loop (Pass 1) if it creates a
//       new Babylon node type, OR
//     • Add a post-creation function (like setupShadows / setupPhysics) for
//       anything that runs after all nodes exist.
//   New asset *categories* (e.g. animation clips stored as separate files)
//   require adding collection logic to ExportBuilder + a runtime loader.
// ─────────────────────────────────────────────────────────────────────────────
const NEBU_RUNTIME_JS = /* js */`
(function () {
  'use strict';
  var manifest = window.__NEBU_MANIFEST;
  var canvas   = document.getElementById('nebu-canvas');
  var loading  = document.getElementById('nebu-loading');
  var DEG2RAD  = Math.PI / 180;
  var engine, currentScene;
  var scriptSlots = [];        /* { instance, comp, hooks } */
  var scriptUpdateSlots = [];
  var scriptLateUpdateSlots = [];

  /* ── Minimal NebuScript base class for user scripts ────────────────────── */
  var _entityMap, _entityList;

  function NebuScript() {}
  NebuScript.exposedProps = [];
  NebuScript.prototype.onAwake        = function () {};
  NebuScript.prototype.onStart        = function () {};
  NebuScript.prototype.onEnable       = function () {};
  NebuScript.prototype.onDisable      = function () {};
  NebuScript.prototype.onUpdate       = function (_dt) {};
  NebuScript.prototype.onLateUpdate   = function (_dt) {};
  NebuScript.prototype.onFixedUpdate  = function (_dt) {};
  NebuScript.prototype.onDestroy      = function () {};
  NebuScript.prototype.onEditorAwake  = function () {};
  NebuScript.prototype.onEditorUpdate = function (_dt) {};
  NebuScript.prototype.onEditorDestroy= function () {};
  Object.defineProperty(NebuScript.prototype, 'transform', {
    get: function () {
      if (!this.entity || !this.entity.node) return null;
      if (this.entity._txProxy) return this.entity._txProxy;
      var n = this.entity.node;
      var p = {};
      Object.defineProperty(p, 'position', { get: function () { return n.position; }, set: function (v) { n.position = v; } });
      Object.defineProperty(p, 'rotation', { get: function () { return n.rotation; }, set: function (v) { n.rotation = v; } });
      Object.defineProperty(p, 'scale',    { get: function () { return n.scaling;  }, set: function (v) { n.scaling = v;  } });
      this.entity._txProxy = p;
      return p;
    }
  });
  NebuScript.prototype.getComponent = function (type) {
    return this.entity ? this.entity._comps[type] || null : null;
  };
  NebuScript.prototype.findEntity = function (name) {
    if (!_entityList) return null;
    for (var i = 0; i < _entityList.length; i++) {
      if (_entityList[i].name === name) return _entityList[i];
    }
    return null;
  };
  NebuScript.prototype.findEntitiesWithTag = function (tag) {
    if (!_entityList) return [];
    return _entityList.filter(function (e) { return e.tags && e.tags.indexOf(tag) >= 0; });
  };
  NebuScript.prototype.resolveRef = function (propKey) {
    var id = this[propKey];
    if (typeof id !== 'string' || !_entityMap) return null;
    return _entityMap.get(id) || null;
  };

  /* Expose for script modules */
  globalThis.__NEBU_SCRIPT__  = NebuScript;
  globalThis.__NEBU_BABYLON__ = typeof BABYLON !== 'undefined' ? BABYLON : {};

  /* ── Lightweight runtime Entity shim ───────────────────────────────────── */
  function RuntimeEntity(raw, node) {
    this.id       = raw.id;
    this.name     = raw.name;
    this.parentId = raw.parentId;
    this.tags     = raw.tags || [];
    this.active   = raw.active !== false;
    this.node     = node;
    this._comps   = {};   /* type string → component data object */
    this._scripts = [];   /* ScriptComponent data objects */
  }
  RuntimeEntity.prototype.getComponent = function (type) {
    return this._comps[type] || null;
  };

  /* ── Engine init ───────────────────────────────────────────────────────── */
  async function init() {
    var useWebGPU = manifest.engineTarget === 'webgpu';
    if (useWebGPU && typeof BABYLON.WebGPUEngine !== 'undefined') {
      try {
        var supported = await BABYLON.WebGPUEngine.IsSupportedAsync;
        if (supported) {
          engine = new BABYLON.WebGPUEngine(canvas);
          await engine.initAsync();
        }
      } catch (_) {}
    }
    if (!engine) {
      engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    }

    window.addEventListener('resize', function () { engine.resize(); });

    /* Pre-compile all scripts before first scene load */
    await compileAllScripts();

    var sceneSelect = document.getElementById('nebu-scene-select');
    if (sceneSelect) {
      sceneSelect.addEventListener('change', function (e) {
        loadScene(parseInt(e.target.value, 10));
      });
    }

    await loadScene(0);
    if (loading) loading.classList.add('hidden');
    engine.runRenderLoop(function () {
      if (!currentScene) return;
      var dt = engine.getDeltaTime() / 1000;
      runScriptUpdate(dt);
      currentScene.render();
      runScriptLateUpdate(dt);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SCENE LOADING
     ═══════════════════════════════════════════════════════════════════════ */

  async function loadScene(index) {
    /* Tear down previous scene and scripts */
    shutdownScripts();
    if (currentScene) { currentScene.dispose(); currentScene = null; }

    var sceneRef = manifest.scenes[index];
    var data;
    if (sceneRef.data != null) {
      data = sceneRef.data;
    } else {
      var r = await fetch(sceneRef.file);
      data  = await r.json();
    }
    var bScene = new BABYLON.Scene(engine);

    applySettings(bScene, data.settings);

    /* Build materials first so meshes can reference them */
    var matMap = buildMaterials(bScene);

    var nodeMap    = new Map(); /* entityId → { node, parentId } */
    _entityMap     = new Map(); /* entityId → RuntimeEntity */
    _entityList    = [];
    var lightNodes = [];        /* { light, data, node } for shadow setup */

    /* Pass 1 — create all nodes */
    var entities = (data.world && data.world.entities) ? data.world.entities : [];
    for (var i = 0; i < entities.length; i++) {
      var rawEntity = entities[i];
      var comps = {};
      var scripts = [];
      var cList = rawEntity.components || [];
      for (var j = 0; j < cList.length; j++) {
        var c = cList[j];
        if (c.type.startsWith('Script:')) {
          scripts.push(c.data);
        } else {
          comps[c.type] = c.data;
        }
      }

      var node = null;
      if (comps.Camera) {
        node = buildCamera(rawEntity.name, comps.Camera, bScene);
      } else if (comps.Light) {
        var lightResult = buildLight(rawEntity.name, comps.Light, bScene);
        node = lightResult.node;
        if (lightResult.light) lightNodes.push({ light: lightResult.light, data: comps.Light, node: lightResult.node });
      } else if (comps.Mesh) {
        node = buildMesh(rawEntity.name, comps.Mesh, bScene);
        /* Assign material */
        if (node && comps.Mesh.materialId && matMap[comps.Mesh.materialId]) {
          node.material = matMap[comps.Mesh.materialId];
        }
        if (node && comps.Mesh.receiveShadows) node.receiveShadows = true;
      } else {
        node = new BABYLON.TransformNode(rawEntity.name, bScene);
      }

      if (node && comps.Transform) applyTransform(node, comps.Transform);
      nodeMap.set(rawEntity.id, { node: node, parentId: rawEntity.parentId });

      /* Build RuntimeEntity */
      var rtEntity = new RuntimeEntity(rawEntity, node);
      rtEntity._comps   = comps;
      rtEntity._scripts = scripts;
      _entityMap.set(rawEntity.id, rtEntity);
      _entityList.push(rtEntity);
    }

    /* Pass 2 — wire parent-child hierarchy */
    nodeMap.forEach(function (entry) {
      if (entry.parentId && entry.node && nodeMap.has(entry.parentId)) {
        var parentEntry = nodeMap.get(entry.parentId);
        if (parentEntry && parentEntry.node) {
          entry.node.parent = parentEntry.node;
        }
      }
    });

    /* Pass 3 — set up shadows */
    setupShadows(bScene, lightNodes, nodeMap);

    /* Pass 4 — physics */
    await setupPhysics(bScene, _entityMap);

    /* Pass 5 — scripts */
    await initScripts(bScene);

    currentScene = bScene;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SCENE SETTINGS
     ═══════════════════════════════════════════════════════════════════════ */

  function applySettings(scene, s) {
    if (!s) return;
    if (s.clearColor)   scene.clearColor   = new BABYLON.Color4(s.clearColor.r, s.clearColor.g, s.clearColor.b, s.clearColor.a != null ? s.clearColor.a : 1);
    if (s.ambientColor) scene.ambientColor = new BABYLON.Color3(s.ambientColor.r, s.ambientColor.g, s.ambientColor.b);
    if (s.fogEnabled  != null) scene.fogEnabled  = s.fogEnabled;
    if (s.fogMode     != null) scene.fogMode     = s.fogMode;
    if (s.fogColor)            scene.fogColor    = new BABYLON.Color3(s.fogColor.r, s.fogColor.g, s.fogColor.b);
    if (s.fogDensity  != null) scene.fogDensity  = s.fogDensity;
    if (s.fogStart    != null) scene.fogStart    = s.fogStart;
    if (s.fogEnd      != null) scene.fogEnd      = s.fogEnd;
    if (s.gravity)             scene.gravity     = new BABYLON.Vector3(s.gravity.x, s.gravity.y, s.gravity.z);
    if (s.collisionsEnabled    != null) scene.collisionsEnabled    = s.collisionsEnabled;
    if (s.useRightHandedSystem != null) scene.useRightHandedSystem = s.useRightHandedSystem;
    if (s.shadowsEnabled    != null) scene.shadowsEnabled    = s.shadowsEnabled;
    if (s.lightsEnabled     != null) scene.lightsEnabled     = s.lightsEnabled;
    if (s.texturesEnabled   != null) scene.texturesEnabled   = s.texturesEnabled;
    if (s.particlesEnabled  != null) scene.particlesEnabled  = s.particlesEnabled;
    if (s.skeletonsEnabled  != null) scene.skeletonsEnabled  = s.skeletonsEnabled;
    if (s.animationsEnabled != null) scene.animationsEnabled = s.animationsEnabled;
  }

  function applyTransform(node, t) {
    if (!node || !t) return;
    if (t.position && node.position) {
      node.position.x = t.position.x;
      node.position.y = t.position.y;
      node.position.z = t.position.z;
    }
    if (t.rotation && node.rotation) {
      node.rotation.x = t.rotation.x * DEG2RAD;
      node.rotation.y = t.rotation.y * DEG2RAD;
      node.rotation.z = t.rotation.z * DEG2RAD;
    }
    if (t.scale && node.scaling) {
      node.scaling.x = t.scale.x;
      node.scaling.y = t.scale.y;
      node.scaling.z = t.scale.z;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MATERIALS & TEXTURES
     ═══════════════════════════════════════════════════════════════════════ */

  function loadTexture(guid, scene) {
    if (!guid) return null;
    var asset = manifest.assets[guid];
    if (!asset) return null;
    var url = asset.dataUrl || asset.file;
    if (!url) return null;
    return new BABYLON.Texture(url, scene);
  }

  function col3(c) { return c ? new BABYLON.Color3(c.r, c.g, c.b) : null; }

  function buildMaterials(scene) {
    var matMap = {};
    for (var matId in manifest.materials) {
      var def = manifest.materials[matId];
      /* file-based mode might store path strings for materials — skip */
      if (typeof def === 'string' || !def || !def.matType) continue;
      var mat = null;
      switch (def.matType) {
        case 'PBR':        mat = buildPBRMat(def, scene); break;
        case 'Standard':
        default:           mat = buildStandardMat(def, scene); break;
      }
      if (mat) matMap[matId] = mat;
    }
    return matMap;
  }

  function buildStandardMat(def, scene) {
    var p   = def.standardProps || {};
    var mat = new BABYLON.StandardMaterial(def.name || 'StandardMat', scene);
    if (p.diffuseColor)  mat.diffuseColor  = col3(p.diffuseColor);
    if (p.specularColor) mat.specularColor = col3(p.specularColor);
    if (p.emissiveColor) mat.emissiveColor = col3(p.emissiveColor);
    if (p.ambientColor)  mat.ambientColor  = col3(p.ambientColor);
    if (p.specularPower != null) mat.specularPower = p.specularPower;
    if (p.alpha         != null) mat.alpha         = p.alpha;
    if (p.wireframe     != null) mat.wireframe     = p.wireframe;
    if (p.backFaceCulling != null) mat.backFaceCulling = p.backFaceCulling;
    /* Texture channels */
    if (p.diffuseTextureId)     mat.diffuseTexture     = loadTexture(p.diffuseTextureId, scene);
    if (p.ambientTextureId)     mat.ambientTexture     = loadTexture(p.ambientTextureId, scene);
    if (p.opacityTextureId)     mat.opacityTexture     = loadTexture(p.opacityTextureId, scene);
    if (p.emissiveTextureId)    mat.emissiveTexture    = loadTexture(p.emissiveTextureId, scene);
    if (p.specularTextureId)    mat.specularTexture    = loadTexture(p.specularTextureId, scene);
    if (p.bumpTextureId)        mat.bumpTexture        = loadTexture(p.bumpTextureId, scene);
    if (p.reflectionTextureId)  mat.reflectionTexture  = loadTexture(p.reflectionTextureId, scene);
    if (p.lightmapTextureId)    mat.lightmapTexture    = loadTexture(p.lightmapTextureId, scene);
    return mat;
  }

  function buildPBRMat(def, scene) {
    var p   = def.pbrProps || {};
    var mat = new BABYLON.PBRMaterial(def.name || 'PBRMat', scene);
    if (p.albedoColor)       mat.albedoColor       = col3(p.albedoColor);
    if (p.reflectivityColor) mat.reflectivityColor = col3(p.reflectivityColor);
    if (p.emissiveColor)     mat.emissiveColor     = col3(p.emissiveColor);
    if (p.metallic   != null) mat.metallic   = p.metallic;
    if (p.roughness  != null) mat.roughness  = p.roughness;
    if (p.alpha      != null) mat.alpha      = p.alpha;
    if (p.wireframe  != null) mat.wireframe  = p.wireframe;
    if (p.backFaceCulling != null) mat.backFaceCulling = p.backFaceCulling;
    return mat;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MESHES
     ═══════════════════════════════════════════════════════════════════════ */

  function buildMesh(name, d, scene) {
    switch (d.meshType) {
      case 'Sphere':    return BABYLON.MeshBuilder.CreateSphere(name,    d.sphereOptions    || {}, scene);
      case 'Cylinder':  return BABYLON.MeshBuilder.CreateCylinder(name,  d.cylinderOptions  || {}, scene);
      case 'Capsule':   return BABYLON.MeshBuilder.CreateCapsule(name,   d.capsuleOptions   || {}, scene);
      case 'Torus':     return BABYLON.MeshBuilder.CreateTorus(name,     d.torusOptions     || {}, scene);
      case 'TorusKnot': return BABYLON.MeshBuilder.CreateTorusKnot(name, d.torusKnotOptions || {}, scene);
      case 'Ground':    return BABYLON.MeshBuilder.CreateGround(name,    d.groundOptions    || {}, scene);
      case 'Plane':     return BABYLON.MeshBuilder.CreatePlane(name,     d.planeOptions     || {}, scene);
      case 'Disc':      return BABYLON.MeshBuilder.CreateDisc(name,      d.discOptions      || {}, scene);
      case 'IcoSphere': return BABYLON.MeshBuilder.CreateIcoSphere(name, d.icoSphereOptions || {}, scene);
      case 'Polyhedron':return BABYLON.MeshBuilder.CreatePolyhedron(name,d.polyhedronOptions|| {}, scene);
      case 'Box':
      default:          return BABYLON.MeshBuilder.CreateBox(name, d.boxOptions || {}, scene);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LIGHTS & SHADOWS
     ═══════════════════════════════════════════════════════════════════════ */

  function buildLight(name, d, scene) {
    var dir = d.direction ? new BABYLON.Vector3(d.direction.x, d.direction.y, d.direction.z) : new BABYLON.Vector3(0, -1, 0);
    var pos = d.position  ? new BABYLON.Vector3(d.position.x,  d.position.y,  d.position.z)  : BABYLON.Vector3.Zero();
    var light;
    switch (d.lightType) {
      case 'Directional':
        light = new BABYLON.DirectionalLight(name, dir, scene);
        break;
      case 'Point':
        light = new BABYLON.PointLight(name, pos, scene);
        break;
      case 'Spot':
        light = new BABYLON.SpotLight(name, pos, dir, d.angle != null ? d.angle : 0.8, d.exponent != null ? d.exponent : 2, scene);
        break;
      default:
        light = new BABYLON.HemisphericLight(name, dir, scene);
        if (d.groundColor) light.groundColor = col3(d.groundColor);
        break;
    }
    if (d.intensity != null) light.intensity = d.intensity;
    if (d.diffuse)  light.diffuse  = col3(d.diffuse);
    if (d.specular) light.specular = col3(d.specular);
    /* Use a TransformNode anchor for hierarchy; return both light + node */
    var tf = new BABYLON.TransformNode(name + '_tf', scene);
    return { light: light, node: tf };
  }

  function setupShadows(scene, lightNodes, nodeMap) {
    for (var li = 0; li < lightNodes.length; li++) {
      var ln = lightNodes[li];
      var d  = ln.data;
      if (!d.castShadows) continue;
      var light   = ln.light;
      var mapSize = d.shadowMapSize || 1024;
      var sg;
      try {
        if (d.useCascadedShadows && BABYLON.CascadedShadowGenerator && (d.lightType === 'Directional')) {
          sg = new BABYLON.CascadedShadowGenerator(mapSize, light);
          if (d.numCascades != null) sg.numCascades = d.numCascades;
          if (d.csmLambda   != null) sg.lambda      = d.csmLambda;
          if (d.csmCascadeBlendPercentage != null) sg.cascadeBlendPercentage = d.csmCascadeBlendPercentage;
          if (d.csmDepthClamp != null) sg.depthClamp = d.csmDepthClamp;
          if (d.csmAutoCalcDepthBounds != null) sg.autoCalcDepthBounds = d.csmAutoCalcDepthBounds;
        } else {
          sg = new BABYLON.ShadowGenerator(mapSize, light);
        }
      } catch (e) {
        console.warn('[Nebu2] Shadow generator failed:', e);
        continue;
      }
      if (d.shadowBias       != null) sg.bias       = d.shadowBias;
      if (d.shadowNormalBias  != null) sg.normalBias = d.shadowNormalBias;
      if (d.shadowDarkness    != null) sg.darkness   = d.shadowDarkness;
      if (d.shadowBlurKernel  != null) sg.blurKernel = d.shadowBlurKernel;
      if (d.shadowBlurScale   != null) sg.blurScale  = d.shadowBlurScale;
      if (d.shadowTransparency)        sg.transparencyShadow = true;
      if (d.shadowContactHardeningLightSize != null) sg.contactHardeningLightSizeUVRatio = d.shadowContactHardeningLightSize;
      /* Filter modes: 0=None, 1=PCF, 2=PCSS, 3=Close ESM, 4=Blur ESM, 5=CSSM */
      if (d.shadowFilter != null) {
        var F = BABYLON.ShadowGenerator;
        var filters = [F.FILTER_NONE, F.FILTER_PCF, F.FILTER_PCSS,
                       F.FILTER_CLOSEEXPONENTIALSHADOWMAP, F.FILTER_BLUREXPONENTIALSHADOWMAP,
                       F.FILTER_BLURCLOSEEXPONENTIALSHADOWMAP];
        if (filters[d.shadowFilter] != null) sg.filter = filters[d.shadowFilter];
      }
      /* Add shadow casters */
      nodeMap.forEach(function (entry) {
        if (entry.node && entry.node.getVerticesData) {
          sg.addShadowCaster(entry.node);
        }
      });
    }
  }

  function buildCamera(name, d, scene) {
    var cam;
    if (d.cameraType === 'ArcRotateCamera') {
      var target = d.target ? new BABYLON.Vector3(d.target.x, d.target.y, d.target.z) : BABYLON.Vector3.Zero();
      cam = new BABYLON.ArcRotateCamera(name, d.alpha != null ? d.alpha : Math.PI / 4, d.beta != null ? d.beta : Math.PI / 4, d.radius != null ? d.radius : 10, target, scene);
    } else {
      cam = new BABYLON.UniversalCamera(name, new BABYLON.Vector3(0, 1, -10), scene);
      if (d.speed != null) cam.speed = d.speed;
    }
    if (d.fov  != null) cam.fov  = d.fov;
    if (d.minZ != null) cam.minZ = d.minZ;
    if (d.maxZ != null) cam.maxZ = d.maxZ;
    if (d.isMainCamera) {
      scene.activeCamera = cam;
      if (d.attachControls) cam.attachControl(canvas, true);
    }
    return cam;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PHYSICS (Havok)
     ═══════════════════════════════════════════════════════════════════════ */

  async function setupPhysics(scene, entityMap) {
    /* Check if any entity has physics components */
    var hasPhysics = false;
    var physicsWorldData = null;
    entityMap.forEach(function (ent) {
      if (ent._comps.RigidBody || ent._comps.Collider) hasPhysics = true;
      if (ent._comps.PhysicsWorld) physicsWorldData = ent._comps.PhysicsWorld;
    });
    if (!hasPhysics) return;

    /* Load Havok WASM */
    var havokInstance;
    try {
      if (typeof HavokPhysics === 'undefined') {
        await new Promise(function (resolve, reject) {
          var s = document.createElement('script');
          s.src = 'https://cdn.babylonjs.com/havok/HavokPhysics_umd.js';
          s.onload = resolve;
          s.onerror = function () { reject(new Error('Failed to load Havok WASM')); };
          document.head.appendChild(s);
        });
      }
      havokInstance = await HavokPhysics();
    } catch (e) {
      console.warn('[Nebu2] Physics disabled — could not load Havok:', e);
      return;
    }

    /* Enable physics */
    var gravity = physicsWorldData && physicsWorldData.gravity
      ? new BABYLON.Vector3(physicsWorldData.gravity.x, physicsWorldData.gravity.y, physicsWorldData.gravity.z)
      : new BABYLON.Vector3(0, -9.81, 0);
    var plugin = new BABYLON.HavokPlugin(true, havokInstance);
    scene.enablePhysics(gravity, plugin);

    /* Build parent→children map for compound shapes */
    var childMap = {};
    entityMap.forEach(function (ent) { childMap[ent.id] = []; });
    entityMap.forEach(function (ent) {
      if (ent.parentId && childMap[ent.parentId]) childMap[ent.parentId].push(ent.id);
    });

    /* Create physics bodies for entities with RigidBody */
    entityMap.forEach(function (ent) {
      var rb = ent._comps.RigidBody;
      if (!rb || !ent.node) return;

      var motionType;
      switch (rb.motionType) {
        case 'Static':   motionType = BABYLON.PhysicsMotionType.STATIC; break;
        case 'Animated': motionType = BABYLON.PhysicsMotionType.ANIMATED; break;
        default:         motionType = BABYLON.PhysicsMotionType.DYNAMIC; break;
      }

      /* Collect colliders from this entity and descendants (stop at child RBs) */
      var colliders = [];
      function gatherColliders(id) {
        var e = entityMap.get(id);
        if (!e) return;
        if (e.id !== ent.id && e._comps.RigidBody) return; /* child RB = separate body */
        if (e._comps.Collider) colliders.push({ ent: e, col: e._comps.Collider });
        var kids = childMap[id] || [];
        for (var k = 0; k < kids.length; k++) gatherColliders(kids[k]);
      }
      gatherColliders(ent.id);

      if (colliders.length === 0) return;

      /* Build compound shape container */
      var container = new BABYLON.PhysicsShapeContainer(scene);
      for (var ci = 0; ci < colliders.length; ci++) {
        var col  = colliders[ci].col;
        var cEnt = colliders[ci].ent;
        var shape = buildPhysicsShape(col, cEnt, scene);
        if (!shape) continue;
        if (col.isTrigger) shape.isTrigger = true;
        if (cEnt.id === ent.id) {
          container.addChild(shape);
        } else if (cEnt.node) {
          container.addChildFromParent(ent.node, shape, cEnt.node);
        }
      }

      /* Create the body */
      var body = new BABYLON.PhysicsBody(ent.node, motionType, false, scene);
      body.shape = container;
      body.setMassProperties({ mass: rb.mass != null ? rb.mass : 1 });
      if (rb.friction    != null) container.material = Object.assign(container.material || {}, { friction: rb.friction });
      if (rb.restitution != null) container.material = Object.assign(container.material || {}, { restitution: rb.restitution });
      if (rb.linearDamping  != null) body.setLinearDamping(rb.linearDamping);
      if (rb.angularDamping != null) body.setAngularDamping(rb.angularDamping);
      if (rb.gravityFactor  != null) body.setGravityFactor(rb.gravityFactor);
      if (rb.startSleeping) body.setMotionType(motionType); /* re-set to apply sleep */
      if (rb.disablePreStep != null) body.disablePreStep = rb.disablePreStep;

      ent._physicsBody = body;
    });

    /* Constraints */
    entityMap.forEach(function (ent) {
      var pc = ent._comps.PhysicsConstraint;
      if (!pc || !ent._physicsBody) return;
      var linked = pc.linkedEntityId ? entityMap.get(pc.linkedEntityId) : null;
      if (!linked || !linked._physicsBody) return;

      var pivotA = pc.pivotA ? new BABYLON.Vector3(pc.pivotA.x, pc.pivotA.y, pc.pivotA.z) : BABYLON.Vector3.Zero();
      var pivotB = pc.pivotB ? new BABYLON.Vector3(pc.pivotB.x, pc.pivotB.y, pc.pivotB.z) : BABYLON.Vector3.Zero();
      var axisA  = pc.axisA  ? new BABYLON.Vector3(pc.axisA.x,  pc.axisA.y,  pc.axisA.z)  : new BABYLON.Vector3(0,1,0);
      var axisB  = pc.axisB  ? new BABYLON.Vector3(pc.axisB.x,  pc.axisB.y,  pc.axisB.z)  : new BABYLON.Vector3(0,1,0);

      try {
        var constraint;
        switch (pc.constraintType) {
          case 'Distance':
            constraint = new BABYLON.DistanceConstraint(pc.maxDistance || 0, scene);
            break;
          case 'Hinge':
            constraint = new BABYLON.HingeConstraint(pivotA, pivotB, axisA, axisB, scene);
            break;
          case 'Slider':
            constraint = new BABYLON.SliderConstraint(pivotA, pivotB, axisA, axisB, scene);
            break;
          case 'Lock':
            constraint = new BABYLON.LockConstraint(pivotA, pivotB, axisA, axisB, scene);
            break;
          case 'Prismatic':
            constraint = new BABYLON.PrismaticConstraint(pivotA, pivotB, axisA, axisB, scene);
            break;
          case 'BallAndSocket':
          default:
            constraint = new BABYLON.BallAndSocketConstraint(pivotA, pivotB, axisA, axisB, scene);
            break;
        }
        ent._physicsBody.addConstraint(linked._physicsBody, constraint);
      } catch (e) {
        console.warn('[Nebu2] Constraint creation failed:', e);
      }
    });
  }

  function buildPhysicsShape(col, ent, scene) {
    var shape = col.shape || 'Box';
    switch (shape) {
      case 'Sphere':
        return new BABYLON.PhysicsShapeSphere(
          new BABYLON.Vector3(col.offsetX || 0, col.offsetY || 0, col.offsetZ || 0),
          col.radius || 0.5, scene);
      case 'Capsule':
        return new BABYLON.PhysicsShapeCapsule(
          new BABYLON.Vector3(col.offsetX || 0, (col.offsetY || 0) - (col.height || 1) / 2, col.offsetZ || 0),
          new BABYLON.Vector3(col.offsetX || 0, (col.offsetY || 0) + (col.height || 1) / 2, col.offsetZ || 0),
          col.radius || 0.5, scene);
      case 'Cylinder':
        return new BABYLON.PhysicsShapeCylinder(
          new BABYLON.Vector3(col.offsetX || 0, (col.offsetY || 0) - (col.height || 1) / 2, col.offsetZ || 0),
          new BABYLON.Vector3(col.offsetX || 0, (col.offsetY || 0) + (col.height || 1) / 2, col.offsetZ || 0),
          col.radius || 0.5, scene);
      case 'ConvexHull':
        if (ent.node && ent.node.getVerticesData) {
          var positions = ent.node.getVerticesData(BABYLON.VertexBuffer.PositionKind);
          if (positions) return new BABYLON.PhysicsShapeConvexHull(ent.node, scene);
        }
        return null;
      case 'Mesh':
        if (ent.node && ent.node.getVerticesData) {
          return new BABYLON.PhysicsShapeMesh(ent.node, scene);
        }
        return null;
      case 'Box':
      default:
        return new BABYLON.PhysicsShapeBox(
          new BABYLON.Vector3(col.offsetX || 0, col.offsetY || 0, col.offsetZ || 0),
          BABYLON.Quaternion.Identity(),
          new BABYLON.Vector3((col.sizeX || 0.5) * 2, (col.sizeY || 0.5) * 2, (col.sizeZ || 0.5) * 2),
          scene);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SCRIPTS
     ═══════════════════════════════════════════════════════════════════════ */

  var compiledScripts = {}; /* scriptGuid → { cls, hooks } */

  async function compileAllScripts() {
    for (var guid in manifest.scripts) {
      var entry = manifest.scripts[guid];
      var code = entry.code;
      if (!code) {
        /* file-based mode: fetch the JS file */
        if (entry.file) {
          try { var resp = await fetch(entry.file); code = await resp.text(); } catch (e) { continue; }
        } else continue;
      }
      try {
        /* Code is already fully transpiled by ExportBuilder (TS → JS,
           @babylonjs/core imports → globalThis, NebuScript banner prepended).
           Load it directly as an ESM module via Blob URL. */
        var blob = new Blob([code], { type: 'text/javascript' });
        var url  = URL.createObjectURL(blob);
        var mod  = await import(url);
        URL.revokeObjectURL(url);
        var cls  = mod.default;
        if (typeof cls !== 'function') continue;

        /* Detect which hooks are overridden */
        var hookNames = ['onAwake','onStart','onEnable','onDisable','onUpdate','onLateUpdate','onFixedUpdate','onDestroy'];
        var hooks = {};
        for (var h = 0; h < hookNames.length; h++) {
          hooks[hookNames[h]] = cls.prototype[hookNames[h]] !== NebuScript.prototype[hookNames[h]];
        }
        compiledScripts[guid] = { cls: cls, hooks: hooks };
      } catch (e) {
        console.warn('[Nebu2] Script compile failed: ' + entry.name, e);
      }
    }
  }

  async function initScripts(scene) {
    scriptSlots = [];
    scriptUpdateSlots = [];
    scriptLateUpdateSlots = [];

    if (!_entityList) return;

    /* Collect all script components, sorted by executionOrder desc, then entity index asc */
    var entries = [];
    for (var i = 0; i < _entityList.length; i++) {
      var ent = _entityList[i];
      if (!ent.active) continue;
      for (var s = 0; s < ent._scripts.length; s++) {
        var sc = ent._scripts[s];
        var compiled = compiledScripts[sc.scriptGuid];
        if (!compiled) continue;
        entries.push({ ent: ent, sc: sc, compiled: compiled, idx: i });
      }
    }
    entries.sort(function (a, b) {
      var od = (b.sc.executionOrder || 0) - (a.sc.executionOrder || 0);
      return od !== 0 ? od : a.idx - b.idx;
    });

    /* Instantiate */
    for (var e = 0; e < entries.length; e++) {
      var en = entries[e];
      try {
        var inst = new en.compiled.cls();
        inst.entity = en.ent;
        inst.world  = { entities: _entityMap, getEntity: function (id) { return _entityMap.get(id) || null; } };
        inst.scene  = scene;
        /* Apply saved propValues */
        if (en.sc.propValues) {
          for (var key in en.sc.propValues) {
            inst[key] = en.sc.propValues[key];
          }
        }
        var slot = { instance: inst, comp: en.sc, hooks: en.compiled.hooks };
        scriptSlots.push(slot);
        if (en.compiled.hooks.onUpdate)     scriptUpdateSlots.push(slot);
        if (en.compiled.hooks.onLateUpdate) scriptLateUpdateSlots.push(slot);
      } catch (err) {
        console.error('[Nebu2] Script instantiation failed: ' + (en.sc.scriptGuid), err);
      }
    }

    /* onAwake → onEnable → onStart */
    for (var a = 0; a < scriptSlots.length; a++) {
      if (scriptSlots[a].hooks.onAwake) safeCall(scriptSlots[a], 'onAwake');
    }
    for (var b = 0; b < scriptSlots.length; b++) {
      if (scriptSlots[b].hooks.onEnable) safeCall(scriptSlots[b], 'onEnable');
    }
    for (var c = 0; c < scriptSlots.length; c++) {
      if (scriptSlots[c].hooks.onStart) safeCall(scriptSlots[c], 'onStart');
    }
  }

  function runScriptUpdate(dt) {
    for (var i = 0; i < scriptUpdateSlots.length; i++) {
      safeCall(scriptUpdateSlots[i], 'onUpdate', dt);
    }
  }

  function runScriptLateUpdate(dt) {
    for (var i = 0; i < scriptLateUpdateSlots.length; i++) {
      safeCall(scriptLateUpdateSlots[i], 'onLateUpdate', dt);
    }
  }

  function shutdownScripts() {
    for (var i = 0; i < scriptSlots.length; i++) {
      safeCall(scriptSlots[i], 'onDisable');
      safeCall(scriptSlots[i], 'onDestroy');
    }
    scriptSlots = [];
    scriptUpdateSlots = [];
    scriptLateUpdateSlots = [];
  }

  function safeCall(slot, method, arg) {
    try {
      var fn = slot.instance[method];
      if (typeof fn === 'function') fn.call(slot.instance, arg);
    } catch (e) {
      console.error('[Nebu2] Script error in ' + method + '():', e);
      slot._disabled = true;
    }
  }

  init().catch(function (err) { console.error('[Nebu2 Runtime]', err); });
})();
`

// ─────────────────────────────────────────────────────────────────────────────
// Minimal Canvas template — plain black page, auto-loads the first scene.
// ─────────────────────────────────────────────────────────────────────────────
const MINIMAL_HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{TITLE}}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    #nebu-canvas { width: 100%; height: 100%; touch-action: none; display: block; }
    #nebu-ui {
      position: absolute; top: 8px; left: 0; right: 0;
      display: flex; justify-content: center; pointer-events: none; z-index: 10;
    }
    #nebu-scene-select {
      pointer-events: all; background: rgba(0,0,0,0.65); color: #e0e0e0;
      border: 1px solid rgba(255,255,255,0.25); border-radius: 4px;
      padding: 4px 10px; font-size: 13px; cursor: pointer; outline: none;
    }
    #nebu-loading {
      position: absolute; inset: 0; background: #000;
      display: flex; align-items: center; justify-content: center;
      color: #ccc; font: 14px/1.4 sans-serif; z-index: 100;
    }
    #nebu-loading.hidden { display: none; }
  </style>
</head>
<body>
  <div id="nebu-loading">Loading…</div>
  <div id="nebu-ui">{{SCENE_SELECT_HTML}}</div>
  <canvas id="nebu-canvas"></canvas>
  <script src="https://cdn.babylonjs.com/babylon.js"></script>
  <script>window.__NEBU_MANIFEST = {{MANIFEST_JSON}};</script>
  <script>${NEBU_RUNTIME_JS}</script>
</body>
</html>`

// ─────────────────────────────────────────────────────────────────────────────
// Game Page template — polished loading screen, spinner, title header.
// ─────────────────────────────────────────────────────────────────────────────
const GAME_PAGE_HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{TITLE}}</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #0d0d0f; color: #e8e8e8; font-family: system-ui, sans-serif; }

    /* Canvas */
    #nebu-canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }

    /* HUD — scene selector */
    #nebu-ui {
      position: absolute; top: 12px; left: 0; right: 0;
      display: flex; justify-content: center; gap: 8px; pointer-events: none; z-index: 20;
    }
    #nebu-scene-select {
      pointer-events: all; background: rgba(10,10,15,0.75); color: #d8d8d8;
      border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
      padding: 5px 12px; font-size: 13px; cursor: pointer; outline: none;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      transition: border-color 0.15s;
    }
    #nebu-scene-select:hover { border-color: rgba(255,255,255,0.4); }

    /* Loading screen */
    #nebu-loading {
      position: absolute; inset: 0; background: #0d0d0f;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 20px; z-index: 200; transition: opacity 0.4s;
    }
    #nebu-loading.hidden { opacity: 0; pointer-events: none; }
    .nebu-title { font-size: clamp(1.5rem, 4vw, 3rem); font-weight: 700; letter-spacing: 0.05em; color: #fff; }
    .nebu-subtitle { font-size: 0.8rem; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.35); }
    .nebu-spinner {
      width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.1);
      border-top-color: rgba(255,255,255,0.7); border-radius: 50%;
      animation: nebu-spin 0.7s linear infinite;
    }
    @keyframes nebu-spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <canvas id="nebu-canvas"></canvas>
  <div id="nebu-ui">{{SCENE_SELECT_HTML}}</div>
  <div id="nebu-loading">
    <span class="nebu-title">{{TITLE}}</span>
    <div class="nebu-spinner"></div>
    <span class="nebu-subtitle">Loading…</span>
  </div>
  <script src="https://cdn.babylonjs.com/babylon.js"></script>
  <script>window.__NEBU_MANIFEST = {{MANIFEST_JSON}};</script>
  <script>${NEBU_RUNTIME_JS}</script>
</body>
</html>`

// ─────────────────────────────────────────────────────────────────────────────
// Public registry
// ─────────────────────────────────────────────────────────────────────────────
export const BUILT_IN_TEMPLATES: ExportTemplate[] = [
  {
    id:          'game-page',
    name:        'Game Page',
    description: 'Polished loading screen with title header and spinner.',
    html:        GAME_PAGE_HTML,
    isBuiltIn:   true,
  },
  {
    id:          'minimal',
    name:        'Minimal Canvas',
    description: 'Plain black page — just the canvas, no chrome.',
    html:        MINIMAL_HTML,
    isBuiltIn:   true,
  },
  {
    id:          'custom',
    name:        'Custom',
    description: 'Provide your own HTML with {{TITLE}}, {{SCENE_SELECT_HTML}}, and {{MANIFEST_JSON}} placeholders.',
    html:        '',
    isBuiltIn:   false,
  },
]
