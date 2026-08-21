import { createSignal, Show } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { TOOL_ICON_PNG } from "../assets-icons"
import { theme } from "../theme"

/**
 * Leading glyph for tool rows / thinking blocks. Terminals with Kitty or
 * Sixel graphics render the baked SVG icon as a 2x1 image; everywhere else
 * (tmux, plain SSH, tests) the Unicode stand-in glyph is used instead.
 */
function graphicsSupported(): boolean {
  const caps = useRenderer().capabilities
  if (!caps) return false
  return (
    caps.kitty_graphics ||
    caps.sixel ||
    caps.image_protocol === "kitty" ||
    caps.image_protocol === "sixel"
  )
}

export function ToolIcon(props: {
  glyph: string
  pngKey: string
  expanded: boolean
  hovered: boolean
  expandable: boolean
}) {
  const [failed, setFailed] = createSignal(false)
  const png = TOOL_ICON_PNG[props.pngKey]
  const showImage = () => graphicsSupported() && png !== undefined && !failed()
  return (
    <Show
      when={props.expandable && props.hovered}
      fallback={
        <Show
          when={showImage()}
          fallback={
            <text fg={theme.textMuted}>
              <span>{props.glyph}</span>
            </text>
          }
        >
          <image
            source={png}
            style={{ width: 2, height: 1 }}
            fit="fit"
            protocol="auto"
            onError={() => setFailed(true)}
          />
        </Show>
      }
    >
      <text fg={theme.textMuted}>
        <span>{props.expanded ? "▾" : "▸"}</span>
      </text>
    </Show>
  )
}
