import type { Component } from './Component'
import { TransformComponent }       from './components/TransformComponent'
import { NameComponent }            from './components/NameComponent'
import { TagComponent }             from './components/TagComponent'
import { ActiveComponent }          from './components/ActiveComponent'
import { LightComponent }           from './components/LightComponent'
import { CameraComponent }          from './components/CameraComponent'
import { MeshComponent }            from './components/MeshComponent'
import { ScriptComponent }          from './components/ScriptComponent'
import { PrefabInstanceComponent }  from './components/PrefabInstanceComponent'
import { AnimationComponent }       from './components/AnimationComponent'

export type ComponentFactory = (data: Record<string, unknown>) => Component

/**
 * Default registry mapping component type-strings to deserializer factories.
 * Extend this map when adding custom component types.
 */
export const defaultComponentRegistry = new Map<string, ComponentFactory>([
  ['Transform',      d => TransformComponent.deserialize(d)],
  ['Name',           d => NameComponent.deserialize(d)],
  ['Tag',            d => TagComponent.deserialize(d)],
  ['Active',         d => ActiveComponent.deserialize(d)],
  ['Light',          d => LightComponent.deserialize(d)],
  ['Camera',         d => CameraComponent.deserialize(d)],
  ['Mesh',           d => MeshComponent.deserialize(d)],
  ['PrefabInstance', d => PrefabInstanceComponent.deserialize(d)],
  ['Animation',      d => AnimationComponent.deserialize(d)],
])

/**
 * Look up a component factory by type string.
 * Handles the dynamic `Script:${guid}` type keys that cannot be pre-registered.
 */
export function getComponentFactory(type: string): ComponentFactory | undefined {
  if (defaultComponentRegistry.has(type)) return defaultComponentRegistry.get(type)
  if (type.startsWith('Script:')) return (d) => ScriptComponent.deserialize(d)
  return undefined
}
