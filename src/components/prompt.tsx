import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { Show } from "solid-js"
import type { CommandItem } from "../commands"
import { modeLabel, type PermissionMode } from "../permission"
import { ACCENT_BORDER, theme } from "../theme"
import { CommandPopup, type CommandResultView } from "./command-popup"

const PROMPT_PLACEHOLDER = "给智能体发消息"

export function Prompt(props: {
  onSubmit?: (text: string) => void
  onCommand?: (line: string) => Promise<CommandResultView | null>
  commandItems?: () => CommandItem[]
  onPopupOpenChange?: (open: boolean) => void
  commandsLoading?: () => boolean
  mode?: () => PermissionMode
  model?: () => string
  active?: () => boolean
  inputId?: string
} = {}) {
  const [value, setValue] = createSignal("")
  const [popupOpen, setPopupOpen] = createSignal(false)
  const [popupLine, setPopupLine] = createSignal("")
  const [popupResult, setPopupResult] = createSignal<CommandResultView | null>(null)
  const mode = props.mode ?? (() => "workspace-write" as PermissionMode)
  const model = props.model ?? (() => "DeepSeek-V4-Flash")
  const active = props.active ?? (() => true)
  let ref: TextareaRenderable | undefined

  createEffect(() => {
    if (active()) ref?.focus()
  })

  const submit = () => {
    const text = (ref?.plainText ?? value()).trim()
    ref?.clear()
    setValue("")
    if (text) props.onSubmit?.(text)
  }

  const closePopup = () => {
    setPopupOpen(false)
    setPopupResult(null)
    setPopupLine("")
    props.onPopupOpenChange?.(false)
    ref?.focus()
  }

  const runCommandLine = async (line: string) => {
    if (!props.onCommand) {
      closePopup()
      return
    }
    const result = await props.onCommand(line)
    if (result) {
      setPopupResult(result)
      // Keep the result visible; give typing focus back to the main input.
      ref?.focus()
    } else {
      closePopup()
    }
  }

  const handleContentChange = (next: unknown) => {
    const text = String(next ?? "")
    setValue(text)
  }

  // OpenTUI's textarea in this version does not reliably emit content-change
  // events, so poll the plain text to detect a "/" command start.
  onMount(() => {
    const timer = setInterval(() => {
      const text = ref?.plainText ?? ""
      if (text.startsWith("/") && (!popupOpen() || popupResult() !== null)) {
        setPopupLine(text)
        setPopupResult(null)
        setPopupOpen(true)
        props.onPopupOpenChange?.(true)
        ref?.clear()
      }
    }, 60)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box
      position="relative"
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
          onContentChange={handleContentChange}
          onSubmit={submit}
        />
        <box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <text>
            <span style={{ fg: theme.primary }}>{modeLabel(mode())}</span>
          </text>
          <text fg={theme.text}>{model()}</text>
        </box>
      </box>
      <Show when={popupOpen()}>
        <CommandPopup
          items={props.commandItems ?? (() => [])}
          loading={props.commandsLoading?.() ?? false}
          initialLine={popupLine()}
          result={popupResult()}
          onRun={(line) => void runCommandLine(line)}
          onClose={closePopup}
        />
      </Show>
    </box>
  )
}
