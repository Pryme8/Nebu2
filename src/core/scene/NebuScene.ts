import { World }                    from '@/core/ecs/World'
import type { SerializedWorld }     from '@/core/ecs/World'
import { getComponentFactory }      from '@/core/ecs/componentRegistry'
import { generateGuid }             from '@/lib/guid'
import { SceneSettingsProxy }       from './SceneSettingsProxy'
import type { SerializedSceneSettings } from './SceneSettingsProxy'

export interface SerializedScene {
  version:      '1.0.0'
  guid:         string
  name:         string
  created:      number
  lastModified: number
  world:        SerializedWorld
  /** Scene-level Babylon settings. Optional for backwards compatibility. */
  settings?:    SerializedSceneSettings
}

/**
 * NebuScene — owns the ECS World for one scene.
 * Serializes/deserializes to `.scene` JSON via the project's FileSystemService.
 */
export class NebuScene {
  readonly guid:    string
  name:             string
  readonly created: number
  readonly world:   World
  readonly settings: SceneSettingsProxy

  constructor(name: string, guid?: string) {
    this.guid     = guid ?? generateGuid()
    this.name     = name
    this.created  = Date.now()
    this.world    = new World()
    this.settings = new SceneSettingsProxy()
  }

  serialize(): SerializedScene {
    return {
      version:      '1.0.0',
      guid:         this.guid,
      name:         this.name,
      created:      this.created,
      lastModified: Date.now(),
      world:        this.world.serialize(),
      settings:     this.settings.serialize(),
    }
  }

  static deserialize(data: SerializedScene): NebuScene {
    const scene = new NebuScene(data.name, data.guid)
    scene.world.deserialize(data.world, getComponentFactory)
    if (data.settings) {
      const s = SceneSettingsProxy.deserialize(data.settings)
      Object.assign(scene.settings, s)
    }
    return scene
  }
}
