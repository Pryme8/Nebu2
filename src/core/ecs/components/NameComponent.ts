import { Component } from '../Component'

export class NameComponent extends Component {
  readonly type = 'Name'
  value: string

  constructor(name = 'Entity') {
    super()
    this.value = name
  }

  override serialize(): Record<string, unknown> {
    return { value: this.value }
  }

  static deserialize(data: Record<string, unknown>): NameComponent {
    return new NameComponent((data.value as string) ?? 'Entity')
  }
}
