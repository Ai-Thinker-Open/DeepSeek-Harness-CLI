import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import type { QueueAction, QueueItem } from "../harness/client"
import { theme } from "../theme"

/**
 * Compact pending-message rows shown above the composer while the harness
 * queues or steers user input. Each row is a single truncated line by default;
 * clicking the preview expands the full content. Rows carry edit / remove /
 * send actions.
 */
export function QueueDock(props: {
  queue: () => QueueItem[]
  onAction: (itemId: string, action: QueueAction) => void
}) {
  const [editing, setEditing] = createSignal<{ id: string; text: string } | null>(null)
  const [expandedId, setExpandedId] = createSignal<string | null>(null)
  let editRef: InputRenderable | undefined

  createEffect(() => {
    if (editing() !== null) {
      const timer = setTimeout(() => editRef?.focus(), 10)
      onCleanup(() => clearTimeout(timer))
    }
  })

  const saveEdit = () => {
    const current = editing()
    if (!current || current.text.trim() === "") return
    props.onAction(current.id, { kind: "edit", content: [{ type: "text", text: current.text }] })
    setEditing(null)
  }

  const toggleExpanded = (itemId: string) => setExpandedId((current) => (current === itemId ? null : itemId))

  return (
    <box width="100%" flexDirection="column">
      <For each={props.queue()}>
        {(item) => (
          <box flexDirection="row" width="100%" marginTop={1} alignItems="center">
            <text
              fg={theme.textMuted}
              onMouse={(evt) => {
                if (evt.type === "down" && evt.button === 0) toggleExpanded(item.id)
              }}
            >
              {expandedId() === item.id ? "▾" : "▸"} 
            </text>
            <box flexGrow={1} minWidth={0}>
              <Show
                when={editing()?.id === item.id}
                fallback={
                  <text
                    fg={theme.text}
                    wrapMode={expandedId() === item.id ? "char" : "none"}
                    truncate={expandedId() !== item.id}
                    onMouse={(evt) => {
                      if (evt.type === "down" && evt.button === 0) toggleExpanded(item.id)
                    }}
                  >
                    {item.preview}
                  </text>
                }
              >
                <input
                  id={`queue-edit-${item.id}`}
                  ref={(el) => (editRef = el)}
                  value={editing()?.text ?? ""}
                  textColor={theme.text}
                  placeholderColor={theme.textMuted}
                  cursorColor={theme.primary}
                  onInput={(value) => {
                    const current = editing()
                    if (current) setEditing({ ...current, text: String(value ?? "") })
                  }}
                  onSubmit={() => saveEdit()}
                />
              </Show>
            </box>
            <box flexDirection="row" flexShrink={0} gap={1}>
              <Show when={editing()?.id === item.id}>
                <text fg={theme.success} onMouse={(evt) => { if (evt.type === "down" && evt.button === 0) saveEdit() }}>
                  {" "}✓
                </text>
                <text fg={theme.textMuted} onMouse={(evt) => { if (evt.type === "down" && evt.button === 0) setEditing(null) }}>
                  {" "}✕
                </text>
              </Show>
              <Show when={editing()?.id !== item.id}>
                <text
                  fg={theme.textMuted}
                  onMouse={(evt) => {
                    if (evt.type === "down" && evt.button === 0 && item.text !== null) {
                      setEditing({ id: item.id, text: item.text })
                    }
                  }}
                >
                  {" "}✎
                </text>
                <text
                  fg={theme.textMuted}
                  onMouse={(evt) => {
                    if (evt.type === "down" && evt.button === 0) props.onAction(item.id, { kind: "remove" })
                  }}
                >
                  {" "}✕
                </text>
                <text fg={theme.primary} onMouse={(evt) => { if (evt.type === "down" && evt.button === 0) props.onAction(item.id, { kind: "steer" }) }}>
                  {" "}➤
                </text>
              </Show>
            </box>
          </box>
        )}
      </For>
    </box>
  )
}
