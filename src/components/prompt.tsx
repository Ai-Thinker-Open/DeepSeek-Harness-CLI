import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { RGBA } from "@opentui/core"
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { CommandItem, CommandResultView } from "../commands"
import { filterCommands } from "../commands"
import { modeLabel, type PermissionMode } from "../permission"
import { ACCENT_BORDER, theme } from "../theme"

const PROMPT_PLACEHOLDER = "给智能体发消息"
const MAX_MENU_ROWS = 10
const MAX_RESULT_ROWS = 12

/** Category label for a command item; group titles render muted above rows. */
function categoryOf(item: { kind: string }): string {
  if (item.kind === "skill") return "技能"
  if (item.kind === "mcp") return "MCP"
  return "快捷"
}

/** Terminal display width: CJK glyphs occupy two cells in a monospace font. */
function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1
  }
  return width
}

/** Right-pad `text` to `width` terminal cells. */
function padTo(text: string, width: number): string {
  const pad = width - displayWidth(text)
  return pad > 0 ? text + " ".repeat(pad) : text
}

/**
 * The composer. A draft starting with `/` shows an inline slash-command
 * menu above the input (Claude Code / dsh-cli style): ↑/↓ move the
 * selection (scrolling the visible window), Enter fills the selected command
 * into the input (`/name `) so arguments can be typed, Tab completes the
 * name the same way, Esc abandons the draft. Typing an argument closes the
 * menu and Enter then dispatches the full `/name args` line. Command results
 * render as a read-only panel above the input.
 */
export function Prompt(props: {
  onSubmit?: (text: string) => void
  onCommand?: (line: string) => Promise<CommandResultView | null>
  commandItems?: () => CommandItem[]
  onPopupOpenChange?: (open: boolean) => void
  commandsLoading?: () => boolean
  resultOverride?: () => CommandResultView | null
  mode?: () => PermissionMode
  model?: () => string
  active?: () => boolean
  inputId?: string
} = {}) {
  const [value, setValue] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  const [scroll, setScroll] = createSignal(0)
  const [result, setResult] = createSignal<CommandResultView | null>(null)
  const [resultScroll, setResultScroll] = createSignal(0)
  const [resultSelected, setResultSelected] = createSignal(0)
  const mode = props.mode ?? (() => "workspace-write" as PermissionMode)
  const model = props.model ?? (() => "DeepSeek-V4-Flash")
  const active = props.active ?? (() => true)
  const terminal = useTerminalDimensions()
  let ref: TextareaRenderable | undefined

  createEffect(() => {
    if (active()) ref?.focus()
  })

  // An external refresh (e.g. the model picker re-rendering after a switch)
  // replaces the result panel without touching the input draft.
  createEffect(() => {
    const next = props.resultOverride?.()
    if (next) {
      setResult(next)
      setResultScroll(0)
    }
  })

  const items = () => props.commandItems?.() ?? []
  /** A bare "/name" draft (no args yet) opens the menu. */
  const menuOpen = createMemo(
    () => value().startsWith("/") && !value().includes(" ") && result() === null,
  )
  const matches = createMemo(() => (menuOpen() ? filterCommands(items(), value().slice(1)) : []))
  /** Fixed column width for `/name` (MiMo: longest display + 2 cells). */
  const nameColumn = createMemo(() => {
    let width = 0
    for (const item of matches()) {
      width = Math.max(width, displayWidth(`/${item.name}`))
    }
    return width + 20
  })

  type MenuRow = { type: "header"; text: string } | { type: "command"; index: number; item: CommandItem }
  /** Build the visible rows starting at command `start`, interleaving group
   *  headers (muted, not selectable) up to the panel height. */
  const buildRowsFrom = (start: number): MenuRow[] => {
    const rows: MenuRow[] = []
    let lastCat: string | null = null
    for (let i = start; i < matches().length && rows.length < MAX_MENU_ROWS; i++) {
      const item = matches()[i] as CommandItem
      const cat = categoryOf(item)
      if (cat !== lastCat) {
        rows.push({ type: "header", text: cat })
        lastCat = cat
      }
      rows.push({ type: "command", index: i, item })
    }
    return rows
  }
  const visibleRows = createMemo(() => buildRowsFrom(scroll()))
  /** How many commands fit in the panel when it starts at `start`. */
  const visibleCommandCount = (start: number): number =>
    buildRowsFrom(start).filter((r) => r.type === "command").length
  const resultRows = () => result()?.rows ?? []
  const visibleResultRows = () => resultRows().slice(resultScroll(), resultScroll() + MAX_RESULT_ROWS)
  /** Interactive rows (carrying onClick) with their real row index. */
  const interactiveRows = () =>
    resultRows()
      .map((r, i) => ({ r, i }))
      .filter((x): x is { r: { text: string; onClick: () => void }; i: number } =>
        typeof x.r !== "string" && x.r.onClick !== undefined)
  /** Select an interactive row and keep it inside the visible window. */
  const selectResultRow = (sel: number) => {
    setResultSelected(sel)
    const real = interactiveRows()[sel]?.i
    if (real === undefined) return
    if (real < resultScroll()) setResultScroll(real)
    else if (real >= resultScroll() + MAX_RESULT_ROWS) setResultScroll(real - MAX_RESULT_ROWS + 1)
  }

  /**
   * Screens use this to keep Esc/keys local while a slash draft is live.
   * Report only on transitions so hosts refresh the command directory once
   * per draft instead of on every keystroke.
   */
  let lastCommandOpen = false
  createEffect(() => {
    const open = value().startsWith("/") || result() !== null
    if (open !== lastCommandOpen) {
      lastCommandOpen = open
      props.onPopupOpenChange?.(open)
    }
  })

  // OpenTUI's textarea in this version does not reliably emit content-change
  // events, so poll the plain text to track the draft.
  onMount(() => {
    const timer = setInterval(() => {
      const text = ref?.plainText ?? ""
      if (text !== value()) {
        setValue(text)
        if (result() !== null) setResult(null)
        setSelected(0)
        setScroll(0)
      }
    }, 60)
    onCleanup(() => clearInterval(timer))
  })

  const setDraft = (text: string) => {
    ref?.editBuffer.setText(text)
    if (ref) ref.cursorOffset = text.length
    setValue(text)
    setSelected(0)
  }

  const runCommandLine = async (line: string) => {
    if (!props.onCommand) {
      setDraft("")
      return
    }
    const view = await props.onCommand(line)
    setDraft("")
    if (view) {
      setResult(view)
      setResultScroll(0)
    }
  }

  const submitDraft = () => {
    const text = (ref?.plainText ?? value()).trim()
    setDraft("")
    if (!text) return
    if (text.startsWith("/")) {
      void runCommandLine(text)
      return
    }
    props.onSubmit?.(text)
  }

  /** Select `index` and keep it inside the visible window. */
  const selectAt = (index: number) => {
    setSelected(index)
    let s = scroll()
    for (;;) {
      const count = visibleCommandCount(s)
      if (index < s) {
        s = index
      } else if (index >= s + count) {
        s = index - count + 1
      } else {
        break
      }
    }
    if (s !== scroll()) setScroll(s)
  }

  /** Move the selection by `delta`, clamping to the match list. */
  const moveSelection = (delta: number) => {
    const len = matches().length
    if (len === 0) return
    // Wrap around like MiMo Code's command palette.
    let next = (selected() + delta) % len
    if (next < 0) next += len
    selectAt(next)
  }

  /** Enter on the menu fills the picked command into the input for arguments. */
  const chooseSelected = () => {
    const pick = matches()[selected()] ?? matches()[0]
    if (pick?.behavior === "fill") completeSelected()
    else if (pick) void runCommandLine(`/${pick.name}`)
    else submitDraft()
  }

  const completeSelected = () => {
    const pick = matches()[selected()] ?? matches()[0]
    if (pick) setDraft(`/${pick.name} `)
  }

  useKeyboard((key) => {
    if (!active()) return
    if (process.env.DSH_DEBUG) console.error(`[dsh-cli] key=${key.name} menuOpen=${menuOpen()} selected=${selected()}`)
    if (result()) {
      if (key.name === "up") {
        const interactive = interactiveRows()
        if (interactive.length > 0) {
          selectResultRow(Math.max(0, resultSelected() - 1))
          key.preventDefault()
        } else {
          setResultScroll((s) => Math.max(0, s - 1))
          key.preventDefault()
        }
      } else if (key.name === "down") {
        const interactive = interactiveRows()
        if (interactive.length > 0) {
          selectResultRow(Math.min(interactive.length - 1, resultSelected() + 1))
          key.preventDefault()
        } else {
          setResultScroll((s) => Math.min(Math.max(0, resultRows().length - MAX_RESULT_ROWS), s + 1))
          key.preventDefault()
        }
      } else if (key.name === "return" || key.name === "linefeed") {
        const interactive = interactiveRows()
        const pick = interactive.length > 0
          ? interactive[Math.max(0, Math.min(resultSelected(), interactive.length - 1))]
          : undefined
        if (pick) {
          pick.r.onClick()
          // Confirming an action (e.g. switching the model) closes the panel.
          setResult(null)
          key.preventDefault()
        } else {
          setResult(null)
          key.preventDefault()
        }
      } else if (key.name === "escape") {
        setResult(null)
        key.preventDefault()
      }
      return
    }
    if (!menuOpen()) return
    if (key.name === "up") {
      moveSelection(-1)
      key.preventDefault()
    } else if (key.name === "down") {
      moveSelection(1)
      key.preventDefault()
    } else if (key.name === "pageup") {
      moveSelection(-MAX_MENU_ROWS)
      key.preventDefault()
    } else if (key.name === "pagedown") {
      moveSelection(MAX_MENU_ROWS)
      key.preventDefault()
    } else if (key.name === "home") {
      selectAt(0)
      key.preventDefault()
    } else if (key.name === "end") {
      selectAt(matches().length - 1)
      key.preventDefault()
    } else if (key.name === "tab") {
      completeSelected()
      key.preventDefault()
    } else if (key.name === "return") {
      chooseSelected()
      key.preventDefault()
    } else if (key.name === "escape") {
      setDraft("")
      key.preventDefault()
    }
  })

  return (
    <box flexDirection="column" width="100%">
      <Show when={result() !== null}>
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
          alignItems="stretch"
        >
          <text fg={theme.primary}>
            <b>{result()?.title}</b>
          </text>
          <For each={visibleResultRows()}>
            {(row) => {
              const interactive = typeof row !== "string" && row.onClick !== undefined
              const realIndex = resultRows().indexOf(row)
              const selected = interactive && interactiveRows()[resultSelected()]?.i === realIndex
              const label = typeof row === "string" ? row : row.text
              return interactive ? (
                <box
                  width="100%"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selected ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                  onMouse={(evt) => {
                    if (evt.type === "over" && typeof row !== "string") {
                      const idx = interactiveRows().findIndex((x) => x.i === realIndex)
                      if (idx >= 0) selectResultRow(idx)
                    }
                    if (evt.type === "down" && evt.button === 0 && typeof row !== "string") {
                      row.onClick?.()
                      setResult(null)
                      evt.preventDefault()
                    }
                  }}
                >
                  <text fg={selected ? theme.text : theme.text} wrapMode="char">
                    {label}
                  </text>
                </box>
              ) : (
                <text fg={theme.text} wrapMode="char">
                  {label}
                </text>
              )
            }}
          </For>
          <Show when={resultRows().length > MAX_RESULT_ROWS}>
            <text fg={theme.textMuted}>
              … ↑/↓ 选择 · Enter 确认 · esc 关闭
            </text>
          </Show>
        </box>
      </Show>
      <Show when={menuOpen() && (visibleRows().length > 0 || props.commandsLoading?.())}>
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
          onMouse={(evt) => {
            // Mouse wheel scrolls the selection through the command list.
            if (evt.type === "scroll") {
              if (evt.scroll?.direction === "down") moveSelection(1)
              else if (evt.scroll?.direction === "up") moveSelection(-1)
              evt.preventDefault()
            }
          }}
        >
          <Show when={visibleRows().length === 0}>
            <text fg={theme.textMuted}>加载命令…</text>
          </Show>
          <For each={visibleRows()}>
            {(row) => {
              if (row.type === "header") {
                return <text fg={theme.textMuted}>{row.text}</text>
              }
              return (
                <box
                  flexDirection="row"
                  width="100%"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selected() === row.index ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                  onMouse={(evt) => {
                    // Hover follows the pointer (MiMo style); a click behaves
                    // exactly like Enter on the selected row.
                    if (evt.type === "over") selectAt(row.index)
                    if (evt.type === "down" && evt.button === 0) {
                      selectAt(row.index)
                      chooseSelected()
                      evt.preventDefault()
                    }
                  }}
                >
                  <text fg={theme.text} wrapMode="none" truncate>
                    <Show
                      when={selected() === row.index}
                      fallback={<span>{padTo(`/${row.item.name}`, nameColumn())}</span>}
                    >
                      <b>{padTo(`/${row.item.name}`, nameColumn())}</b>
                    </Show>
                    <span style={{ fg: selected() === row.index ? theme.text : theme.textMuted }}>
                      {row.item.description}
                    </span>
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={matches().length > MAX_MENU_ROWS}>
            <text fg={theme.textMuted}>
              … ↑/↓ 滚动 · Enter 填入 · 还有 {matches().length - MAX_MENU_ROWS} 项
            </text>
          </Show>
        </box>
      </Show>
      <box
        backgroundColor={theme.backgroundPanel}
        flexDirection="row"
        border={["left"]}
        borderColor={theme.primary}
        customBorderChars={ACCENT_BORDER}
      >
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexGrow={1} minWidth={0}>
          <textarea
            id={props.inputId ?? "prompt-input"}
            ref={(el) => (ref = el)}
            initialValue=""
            placeholder={PROMPT_PLACEHOLDER}
            minHeight={1}
            maxHeight={5}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "linefeed", action: "submit" },
              { name: "return", meta: true, action: "newline" },
            ]}
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            cursorColor={theme.primary}
            onSubmit={submitDraft}
          />
          <box flexDirection="row" justifyContent="space-between" marginTop={1}>
            <text>
              <span style={{ fg: theme.primary }}>{modeLabel(mode())}</span>
            </text>
            <text fg={theme.text}>{model()}</text>
          </box>
        </box>
      </box>
    </box>
  )
}
