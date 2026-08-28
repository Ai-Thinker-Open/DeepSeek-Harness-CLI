import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { appendFileSync } from "node:fs"
import { RGBA } from "@opentui/core"
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { CommandItem, CommandResultView } from "../commands"
import { filterCommands } from "../commands"
import { isDown, isEnter, isUp } from "./key-match"
import { modeLabel, type PermissionMode } from "../permission"
import { ACCENT_BORDER, theme } from "../theme"

const PROMPT_PLACEHOLDER = "给智能体发消息"
const MAX_MENU_ROWS = 10
const MAX_RESULT_ROWS = 12
const HISTORY_LIMIT = 100

/** Sent plain-text messages, for ↑/↓ recall like a shell history. */
const SEND_HISTORY: string[] = []

/**
 * Reject edit-buffer pollution that is not real typing. On Windows some
 * terminals send unsolicited OSC/CSI sequences (focus queries, shell
 * integration, color probes) whose fragments can land in the focused input;
 * real drafts are plain printable text plus ordinary whitespace. C0/C1
 * control ranges cover ESC and friends (tab/newline/CR are kept).
 */
/** Git Bash subprocess stderr (e.g. `ssh (pid) C:\Program Files\Git\usr\bin\
 *  ssh.exe: *** fatal error - couldn't create signal pipe…`) leaking into the
 *  terminal. These markers are specific enough that real drafts never match. */
export const SUBPROCESS_NOISE_RE = /(?:couldn't create signal pipe|\*\*\* fatal error|Program Files[\\/]Git[\\/]usr[\\/]bin)/i

export function isUsableDraft(text: string): boolean {
  return (
    text.length === 0 ||
    (!/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(text) && !SUBPROCESS_NOISE_RE.test(text))
  )
}

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
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const mode = props.mode ?? (() => "workspace-write" as PermissionMode)
  const model = props.model ?? (() => "DeepSeek-V4-Flash")
  const active = props.active ?? (() => true)
  const terminal = useTerminalDimensions()
  let ref: TextareaRenderable | undefined
  /** Draft captured before ↑ started walking the history, restored on ↓ end. */
  let historyDraft = ""
  /** Draft captured before an interruption (question modal), restored after. */
  let savedDraft: string | null = null
  let restoreTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (active()) {
      ref?.focus()
      // The interruption is over: put the draft back. The modal teardown can
      // rebuild the native editor view a frame later, so retry once after the
      // renderer settles instead of restoring into a buffer that is about to
      // be cleared again.
      if (savedDraft !== null) {
        const draft = savedDraft
        const restore = () => {
          if (draft === "") return
          if (ref && (ref.plainText ?? "") === "") {
            // TextareaRenderable has no `value` setter (that is InputRenderable
            // only); write through setText so the native buffer actually fills.
            ref.setText(draft)
          }
          if (ref && (ref.plainText ?? "") === draft) savedDraft = null
        }
        restore()
        if (restoreTimer) clearTimeout(restoreTimer)
        restoreTimer = setTimeout(() => {
          restoreTimer = undefined
          restore()
        }, 200)
      }
    } else {
      // Deactivated (question modal open): snapshot before anything clears it.
      savedDraft = (ref?.plainText ?? value()) || null
      ref?.blur()
    }
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
   *  headers (muted, not selectable). Headers consume the row budget so the
   *  panel is always exactly MAX_MENU_ROWS rows tall — a mid-window header
   *  appearing or disappearing would otherwise change the panel height and
   *  make scrolling look jumpy. */
  const buildRowsFrom = (start: number): MenuRow[] => {
    const rows: MenuRow[] = []
    let rowCount = 0
    for (let i = start; i < matches().length && rowCount < MAX_MENU_ROWS; i++) {
      const item = matches()[i] as CommandItem
      const cat = categoryOf(item)
      const isCategoryStart = i === 0 || categoryOf(matches()[i - 1] as CommandItem) !== cat
      if (isCategoryStart) {
        // A header + its first command need two slots; if only one slot
        // remains, stop before the boundary instead of overflowing.
        if (rowCount + 1 >= MAX_MENU_ROWS) break
        rows.push({ type: "header", text: cat })
        rowCount++
      }
      rows.push({ type: "command", index: i, item })
      rowCount++
    }
    return rows
  }
  const visibleRows = createMemo(() => buildRowsFrom(scroll()))
  /** How many commands fit in the panel when it starts at `start`. */
  const visibleCommandCount = (start: number): number =>
    buildRowsFrom(start).filter((r) => r.type === "command").length
  const resultRows = () => result()?.rows ?? []
  const visibleResultRows = () => resultRows().slice(resultScroll(), resultScroll() + MAX_RESULT_ROWS)
  /**
   * Result-panel interactive rows (carrying onClick) with their real row
   * index. Exposed in the same shape as the slash menu's `matches()` so the
   * selection/movement/confirm logic below reuses the exact menu code path.
   */
  const resultMatches = () =>
    resultRows()
      .map((r, i) => ({ r, i }))
      .filter((x): x is { r: { text: string; onClick: () => void }; i: number } =>
        typeof x.r !== "string" && x.r.onClick !== undefined)
  /**
   * Move the result selection by `delta`, wrapping around like the slash
   * menu's moveSelection, and keep the picked row inside the visible window.
   */
  const moveResultSelection = (delta: number) => {
    const len = resultMatches().length
    if (len === 0) return
    let next = (resultSelected() + delta) % len
    if (next < 0) next += len
    setResultSelected(next)
    const real = resultMatches()[next]?.i
    if (real === undefined) return
    if (real < resultScroll()) setResultScroll(real)
    else if (real >= resultScroll() + MAX_RESULT_ROWS) setResultScroll(real - MAX_RESULT_ROWS + 1)
  }

  /** Enter on the result panel confirms the picked row, then closes it. */
  const confirmResultSelection = () => {
    const pick = resultMatches()[resultSelected()] ?? resultMatches()[0]
    if (pick) pick.r.onClick()
    setResult(null)
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
      // Git Bash subprocess errors (ssh etc.) can be surfaced in the focused
      // input on Windows. They are never real typing: drop them from the
      // buffer instead of letting them become part of the draft.
      if (text && SUBPROCESS_NOISE_RE.test(text)) {
        ref?.setText("")
        return
      }
      // A pending restore (question modal closed) may race the native editor
      // rebuild; the poll catches the frame where the buffer is empty again.
      if (savedDraft !== null && ref && text === "" && savedDraft !== "") {
        ref.setText(savedDraft)
        savedDraft = null
      }
      if (text !== value() && isUsableDraft(text)) {
        setValue(text)
        // The user typed something: leave history navigation.
        if (historyIndex() !== -1) setHistoryIndex(-1)
        if (result() !== null) setResult(null)
        setSelected(0)
        setScroll(0)
      }
    }, 60)
    onCleanup(() => clearInterval(timer))
  })

  const setDraft = (text: string) => {
    ref?.setText(text)
    // Native cursor move: `cursorOffset` uses visual offsets and lands wrong
    // for CJK text; gotoBufferEnd puts the caret at the true end of the draft.
    ref?.gotoBufferEnd()
    setValue(text)
    setSelected(0)
  }

  const runCommandLine = async (line: string) => {
    // Clear the draft and close the slash menu as soon as the command is
    // dispatched. If we waited for the harness round-trip, the menu would
    // stay open (single "/model" entry) and swallow arrow keys pressed while
    // the command panel is loading — the "arrows do nothing on the model
    // picker" symptom.
    setDraft("")
    if (!props.onCommand) return
    const view = await props.onCommand(line)
    if (view) {
      setResult(view)
      setResultScroll(0)
    }
  }

  const submitDraft = () => {
    // While a question modal is open the composer is deactivated: the
    // textarea still receives Enter through OpenTUI's key routing, but it
    // must neither send the draft nor clear it (the draft survives the
    // plan-review interruption).
    if (!active()) return
    const text = (ref?.plainText ?? value()).trim()
    setDraft("")
    if (!text) return
    setHistoryIndex(-1)
    if (text.startsWith("/")) {
      void runCommandLine(text)
      return
    }
    if (SEND_HISTORY[SEND_HISTORY.length - 1] !== text) {
      SEND_HISTORY.push(text)
      if (SEND_HISTORY.length > HISTORY_LIMIT) SEND_HISTORY.shift()
    }
    props.onSubmit?.(text)
  }

  /** Shell-style history recall: ↑ older, ↓ newer, ending at the draft. */
  const recallHistory = (delta: -1 | 1) => {
    if (SEND_HISTORY.length === 0) return
    const current = historyIndex()
    if (current === -1) {
      historyDraft = ref?.plainText ?? value()
      const next = SEND_HISTORY.length - 1
      setHistoryIndex(next)
      setDraft(SEND_HISTORY[next] as string)
      return
    }
    const next = current + delta
    if (next < 0 || next >= SEND_HISTORY.length) {
      setHistoryIndex(-1)
      setDraft(historyDraft)
    } else {
      setHistoryIndex(next)
      setDraft(SEND_HISTORY[next] as string)
    }
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
    // Always record key events to /tmp/dsh-cli-keys.log (cheap, diagnostic
    // only). DSH_DEBUG additionally echoes them to the console overlay.
    const debugLine = `[dsh-cli] key=${key.name} raw=${JSON.stringify(key.raw ?? "")} source=${key.source ?? ""} menuOpen=${menuOpen()} selected=${selected()} result=${result() !== null} resultSelected=${resultSelected()} resultRows=${resultRows().length}\n`
    if (process.env.DSH_DEBUG) {
      console.error(debugLine.trim())
    }
    try {
      appendFileSync("/tmp/dsh-cli-keys.log", debugLine)
    } catch {
      // debug aid only; never fail on logging
    }
    if (result()) {
      if (isUp(key)) {
        if (resultMatches().length > 0) moveResultSelection(-1)
        else setResultScroll((s) => Math.max(0, s - 1))
        key.preventDefault()
      } else if (isDown(key)) {
        if (resultMatches().length > 0) moveResultSelection(1)
        else setResultScroll((s) => Math.min(Math.max(0, resultRows().length - MAX_RESULT_ROWS), s + 1))
        key.preventDefault()
      } else if (isEnter(key)) {
        confirmResultSelection()
        key.preventDefault()
      } else if (key.name === "escape") {
        setResult(null)
        key.preventDefault()
      }
      return
    }
    if (!menuOpen()) {
      // Plain draft: ↑/↓ walk the sent-message history (terminal style).
      if (isUp(key)) {
        recallHistory(-1)
        key.preventDefault()
      } else if (isDown(key)) {
        recallHistory(1)
        key.preventDefault()
      }
      return
    }
    if (isUp(key)) {
      moveSelection(-1)
      key.preventDefault()
    } else if (isDown(key)) {
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
    } else if (isEnter(key)) {
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
              const label = typeof row === "string" ? row : row.text
              return interactive ? (
                <box
                  width="100%"
                  paddingLeft={1}
                  paddingRight={1}
                  // Keep the signal access inline in the prop: Solid's <For>
                  // evaluates row renderers inside untrack(), so a const
                  // computed here would never re-run when resultSelected
                  // changes and the highlight would freeze.
                  backgroundColor={
                    interactive && resultMatches()[resultSelected()]?.i === realIndex
                      ? theme.primary
                      : RGBA.fromInts(0, 0, 0, 0)
                  }
                  onMouse={(evt) => {
                    if (evt.type === "over" && typeof row !== "string") {
                      const idx = resultMatches().findIndex((x) => x.i === realIndex)
                      if (idx >= 0) {
                        setResultSelected(idx)
                        const real = resultMatches()[idx]?.i
                        if (real !== undefined && real < resultScroll()) setResultScroll(real)
                      }
                    }
                    if (evt.type === "down" && evt.button === 0 && typeof row !== "string") {
                      row.onClick?.()
                      setResult(null)
                      evt.preventDefault()
                    }
                  }}
                >
                  <text fg={theme.text} wrapMode="char">
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
          <box flexDirection="column" minHeight={MAX_MENU_ROWS}>
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
          </box>
          <Show when={scroll() + visibleCommandCount(scroll()) < matches().length}>
            <text fg={theme.textMuted}>
              … ↑/↓ 滚动 · Enter 填入 · 还有 {matches().length - scroll() - visibleCommandCount(scroll())} 项
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
              { name: "return", meta: true, action: "newline" },
              { name: "return", ctrl: true, action: "newline" },
              { name: "linefeed", action: "newline" },
              { name: "linefeed", ctrl: true, action: "newline" },
              { name: "kpenter", ctrl: true, action: "newline" },
            ]}
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            cursorColor={theme.text}
            cursorStyle={{ style: "default" }}
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
