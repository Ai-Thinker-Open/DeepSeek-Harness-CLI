import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { InputRenderable } from "@opentui/core"
import { bareCommandName, filterCommands, type CommandItem } from "../commands"
import { theme } from "../theme"

export interface CommandResultView {
  title: string
  rows: string[]
}

const MAX_ROWS = 12

/**
 * The slash-command popup (mimo/opencode style): a small window above the
 * prompt with its own input. Typing filters the command list, ↑/↓ move the
 * selection, Enter runs (or enters argument mode for input-taking commands),
 * and Escape closes. A non-null `result` swaps the menu for a read-only list.
 */
export function CommandPopup(props: {
  items: () => CommandItem[]
  loading?: boolean
  initialLine: string
  result: CommandResultView | null
  onRun: (line: string) => void
  onClose: () => void
}) {
  const [line, setLine] = createSignal(props.initialLine)
  const [selected, setSelected] = createSignal(0)
  const [resultScroll, setResultScroll] = createSignal(0)
  let ref: InputRenderable | undefined
  let argsRef: InputRenderable | undefined
  let argsSettled = false

  onMount(() => ref?.focus())

  const filtered = createMemo(() => filterCommands(props.items(), line().slice(1)))
  const resultRows = () => props.result?.rows ?? []
  const visibleResultRows = () => resultRows().slice(resultScroll(), resultScroll() + MAX_ROWS)
  /**
   * Argument (leading-input) mode: the line is "/name args…". The command
   * prefix renders emphasized (orange) with the typed args in a separate
   * input, matching the web's plan-mode composition.
   */
  const argMode = createMemo(() => {
    const match = /^(\/[a-z][a-z0-9_-]*)(?: (.*))?$/.exec(line())
    if (!match || match[2] === undefined) return null
    return { prefix: match[1], args: match[2] }
  })

  // Reopening the popup with a different initial line (e.g. after a result
  // view) resets the input and selection without remounting the component.
  createEffect(() => {
    setLine(props.initialLine)
    setSelected(0)
  })
  // Keep typing focus on the args input while composing a leading-input command.
  createEffect(() => {
    if (argMode() !== null) {
      const timer = setTimeout(() => {
        if (argsRef) argsRef.value = argMode()?.args ?? ""
        argsRef?.focus()
      }, 15)
      onCleanup(() => clearTimeout(timer))
    }
  })

  useKeyboard((key) => {
    if (props.result !== null && resultRows().length > MAX_ROWS) {
      if (key.name === "up") {
        setResultScroll((s) => Math.max(0, s - 1))
        return
      }
      if (key.name === "down") {
        setResultScroll((s) => Math.min(Math.max(0, resultRows().length - MAX_ROWS), s + 1))
        return
      }
    }
    if (key.name === "up") {
      setSelected((s) => Math.max(0, s - 1))
      return
    }
    if (key.name === "down") {
      setSelected((s) => Math.min(Math.max(0, filtered().length - 1), s + 1))
      return
    }
    if (key.name === "escape") {
      props.onClose()
    }
  })

  const submit = (text: string) => {
    const raw = String(text ?? "")
    const value = raw.trim()
    const pick = filtered()[selected()]
    if (!value || value === "/") {
      if (pick) props.onRun(`/${pick.name}`)
      return
    }
    // A trailing space (argument mode) means the user already confirmed the
    // name — Enter now submits the full line instead of re-entering arg mode.
    const bare = bareCommandName(raw)
    if (bare !== undefined) {
      const item = props.items().find((i) => i.name === bare)
      if (item?.input?.hint) {
        // Argument phase: keep the popup open and let the user type the rest.
        const next = `/${bare} `
        setLine(next)
        if (ref) ref.value = next
        setSelected(0)
        ref?.focus()
        return
      }
      if (item) {
        props.onRun(`/${bare}`)
        return
      }
      // Partial command name: run the highlighted match.
      if (pick) {
        props.onRun(`/${pick.name}`)
        return
      }
      props.onRun(`/${bare}`)
      return
    }
    props.onRun(value)
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
      <Show when={props.result === null}>
        <Show
          when={argMode() === null}
          fallback={
            <box flexDirection="row">
              <text fg={theme.warning}>
                <b>{argMode()?.prefix}</b>
              </text>
              <input
                id="command-popup-args-input"
                ref={(el) => {
                  ref = el
                  argsRef = el
                  argsSettled = false
                  setTimeout(() => {
                    argsSettled = true
                  }, 0)
                }}
                value={argMode()?.args ?? ""}
                textColor={theme.text}
                placeholderColor={theme.textMuted}
                cursorColor={theme.primary}
                onInput={(value) => {
                  // Ignore the mount-time input event that echoes the reused
                  // buffer; only accept real typing.
                  if (!argsSettled) return
                  const next = String(value ?? "")
                  setLine(`${argMode()?.prefix ?? ""} ${next}`)
                  setSelected(0)
                }}
                onSubmit={(value) => submit(`${argMode()?.prefix ?? ""} ${typeof value === "string" ? value : ""}`)}
              />
            </box>
          }
        >
          <input
            id="command-popup-input"
            ref={(el) => {
              ref = el
              argsRef = undefined
            }}
            value={props.initialLine}
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            cursorColor={theme.primary}
            onInput={(value) => {
              const next = String(value ?? "")
              setLine(next)
              setSelected(0)
              if (next === "") props.onClose()
            }}
            onSubmit={(value) => submit(typeof value === "string" ? value : "")}
          />
        </Show>
        <Show when={argMode() === null}>
          <box flexDirection="column" marginTop={1}>
            <Show when={props.loading && filtered().length === 0}>
              <text fg={theme.textMuted}>加载命令中…</text>
            </Show>
            <For each={filtered().slice(0, MAX_ROWS)}>
              {(item, index) => (
                <box flexDirection="row" backgroundColor={index() === selected() ? theme.backgroundPanel : undefined}>
                  <text fg={index() === selected() ? theme.primary : theme.textMuted} wrapMode="char">
                    /{item.name}  {item.description}
                  </text>
                </box>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <text fg={theme.textMuted}>没有匹配的命令</text>
            </Show>
          </box>
        </Show>
      </Show>
      <Show when={props.result !== null}>
        <box flexDirection="column">
          <box flexShrink={0}>
            <text fg={theme.primary}>{props.result?.title}</text>
          </box>
          <For each={visibleResultRows()}>
            {(row) => (
              <box flexShrink={0}>
                <text fg={theme.textMuted} wrapMode="char">
                  {row}
                </text>
              </box>
            )}
          </For>
          <Show when={resultRows().length > MAX_ROWS}>
            <text fg={theme.textMuted}>
              … 共 {resultRows().length} 行（↑/↓ 滚动，Esc 关闭）
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
