import { Component } from '../Component'

export class ActiveComponent extends Component {
  readonly type = 'Active'
  enabled = true

  override serialize(): Record<string, unknown> {
    return { enabled: this.enabled }
  }

  static deserialize(data: Record<string, unknown>): ActiveComponent {
    const c = new ActiveComponent()
    c.enabled = (data.enabled as boolean) ?? true
    return c
  }
}
