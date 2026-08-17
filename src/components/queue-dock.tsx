import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import type { QueueAction, QueueItem } from "../harness/client"
import { theme } from "../theme"

/**
 * Pending-message dock shown above the composer while the harness queues or
 * steers user input: each row carries edit / remove / send actions.
 */
export function QueueDock(props: {
  queue: () => QueueItem[]
  onAction: (itemId: string, action: QueueAction) => void
}) {
  const [editing, setEditing] = createSignal<{ id: string; text: string } | null>(null)
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

  return (
    <box
      width="100%"
      backgroundColor={theme.backgroundElement}
      border={["left", "right", "top"]}
      borderColor={theme.border}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
    >
      <text fg={theme.textMuted}>待处理消息（{props.queue().length}）</text>
      <For each={props.queue()}>
        {(item) => (
          <box flexDirection="row" width="100%" marginTop={1}>
            <box flexGrow={1} minWidth={0}>
              <Show
                when={editing()?.id === item.id}
                fallback={
                  <text fg={theme.text} wrapMode="char">
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
