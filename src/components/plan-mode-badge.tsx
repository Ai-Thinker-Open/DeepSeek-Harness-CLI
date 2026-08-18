import { Show } from "solid-js"
import { theme } from "../theme"

/**
 * Plain blue "Plan mode" status text shown to the right of the composer
 * while the harness session is in plan mode (`plan` projection active). A
 * pending transition (entering/leaving queued at the next accepted step)
 * renders in muted blue so the user knows the switch is on its way.
 */
export function PlanModeBadge(props: {
  active: () => boolean
  pending?: () => boolean
}) {
  const pending = props.pending ?? (() => false)
  return (
    <Show when={props.active() || pending()}>
      <text flexShrink={0} fg={props.active() ? theme.primary : theme.textMuted}>
        Plan mode{props.active() ? "" : "…"}
      </text>
    </Show>
  )
}
