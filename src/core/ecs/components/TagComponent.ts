import { Component } from '../Component'

export class TagComponent extends Component {
  readonly type = 'Tag'
  tags: string[] = []

  override serialize(): Record<string, unknown> {
    return { tags: [...this.tags] }
  }

  static deserialize(data: Record<string, unknown>): TagComponent {
    const c = new TagComponent()
    c.tags = Array.isArray(data.tags) ? [...(data.tags as string[])] : []
    return c
  }
}
