import { createMemo, createSignal, For, Show } from "solid-js"
import type { ChatMessage } from "../session"
import type { ToolCallRecord, ToolResultRecord, ToolCallStatus } from "../session"
import { theme } from "../theme"
import { CONTEXT_FORM_LABELS } from "../harness/fold"
import {
  editPair,
  questionItems,
  todoItems,
  toolRowModel,
  writeText,
  type ToolRowModel,
} from "../harness/tool-card"
import { MarkdownText } from "./markdown"

/** While a message is streaming, only render its tail so layout stays cheap. */
const STREAMING_CONTENT_TAIL = 4000
/** Bound on a finalized message's rendered text (head+tail, with a note). */
const MAX_RENDERED_CONTENT = 32_000
const INJECT_PREVIEW_LINES = 8
const MAX_OUTPUT_LINES = 20

function statusColor(status: ToolCallStatus) {
  switch (status) {
    case "running":
      return theme.info
    case "ok":
      return theme.success
    case "error":
      return theme.error
    case "denied":
      return theme.warning
  }
}

function ToolIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case "running":
      return <text fg={theme.info}>●</text>
    case "ok":
      return <text fg={theme.success}>✓</text>
    case "error":
      return <text fg={theme.error}>✗</text>
    case "denied":
      return <text fg={theme.warning}>⊘</text>
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function OutputLines({ text }: { text: string }) {
  const lines = createMemo(() => text.split("\n"))
  return (
    <box paddingLeft={2} flexDirection="column">
      <For each={lines().slice(0, MAX_OUTPUT_LINES)}>
        {(line) => (
          <text fg={theme.textMuted} wrapMode="char">
            {line || " "}
          </text>
        )}
      </For>
      <Show when={lines().length > MAX_OUTPUT_LINES}>
        <text fg={theme.textMuted}>… ({lines().length - MAX_OUTPUT_LINES} more lines)</text>
      </Show>
    </box>
  )
}

function BashCard({ model }: { model: ToolRowModel }) {
  const markers = model.markers
  return (
    <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
      <Show when={model.body}>
        <text fg={theme.text} wrapMode="char">
          <b>❯ </b>
          {model.body}
        </text>
      </Show>
      <Show when={markers.text}>
        <OutputLines text={markers.text} />
      </Show>
      <Show when={markers.sandbox}>
        <text fg={theme.warning}>⚠ {markers.sandbox}</text>
      </Show>
      <Show when={markers.exitCode !== undefined}>
        <text fg={markers.exitCode === 0 ? theme.textMuted : theme.error}>
          {markers.exitCode === 0 ? "✓ 退出码 0" : `✗ 退出码 ${markers.exitCode}`}
        </text>
      </Show>
    </box>
  )
}

function ReadCard({ model }: { model: ToolRowModel }) {
  return (
    <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
      <Show when={model.output}>
        <OutputLines text={model.output as string} />
      </Show>
    </box>
  )
}

function EditCard({ args, newOnly }: { args: Record<string, unknown>; newOnly?: boolean }) {
  const lines = createMemo(() => {
    const out: Array<{ sign: "+" | "-"; text: string }> = []
    const pair = editPair(args)
    if (!newOnly && pair.oldText) {
      for (const line of pair.oldText.split("\n")) out.push({ sign: "-", text: line })
    }
    const newText = newOnly ? writeText(args) : pair.newText
    if (newText) {
      for (const line of newText.split("\n")) out.push({ sign: "+", text: line })
    }
    return out
  })
  return (
    <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
      <For each={lines().slice(0, MAX_OUTPUT_LINES)}>
        {(item) => (
          <text fg={item.sign === "+" ? theme.success : theme.error} wrapMode="char">
            {item.sign} {item.text || " "}
          </text>
        )}
      </For>
      <Show when={lines().length > MAX_OUTPUT_LINES}>
        <text fg={theme.textMuted}>… ({lines().length - MAX_OUTPUT_LINES} more lines)</text>
      </Show>
    </box>
  )
}

function TodoCard({ args }: { args: Record<string, unknown> }) {
  const items = todoItems(args)
  return (
    <box flexDirection="column" paddingLeft={2}>
      <For each={items}>
        {(item) => (
          <text
            fg={
              item.status === "completed"
                ? theme.success
                : item.status === "in_progress"
                  ? theme.info
                  : theme.textMuted
            }
          >
            {item.status === "completed" ? "☑ " : item.status === "in_progress" ? "◐ " : "○ "}
            {item.content}
          </text>
        )}
      </For>
    </box>
  )
}

function QuestionCard({ args }: { args: Record<string, unknown> }) {
  const items = questionItems(args)
  return (
    <box flexDirection="column" paddingLeft={2}>
      <For each={items}>
        {(item) => (
          <box flexDirection="column">
            <text fg={theme.text} wrapMode="char">
              ? {item.question}
            </text>
            <For each={item.options}>
              {(option) => (
                <text fg={theme.textMuted} wrapMode="char">
                  {"  "}· {option}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

function ToolBody({ model, args }: { model: ToolRowModel; args: Record<string, unknown> }) {
  switch (model.variant) {
    case "bash":
      return <BashCard model={model} />
    case "read":
      return <ReadCard model={model} />
    case "edit":
      return <EditCard args={args} />
    case "write":
      return <EditCard args={args} newOnly />
    case "search":
      return (
        <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
          <Show when={model.output}>
            <OutputLines text={model.output as string} />
          </Show>
        </box>
      )
    case "todo":
      return <TodoCard args={args} />
    case "question":
      return <QuestionCard args={args} />
    default:
      return (
        <box flexDirection="column" paddingLeft={2}>
          <Show when={model.body}>
            <text fg={theme.textMuted} wrapMode="char">
              {model.body}
            </text>
          </Show>
          <Show when={model.output}>
            <OutputLines text={model.output as string} />
          </Show>
        </box>
      )
  }
}

export function ToolCard({ call, result }: { call: ToolCallRecord; result?: ToolResultRecord }) {
  const model = createMemo(() => toolRowModel(call, result))
  const [expanded, setExpanded] = createSignal(false)
  const dur =
    call.startedAt && call.finishedAt ? ` (${formatDuration(call.finishedAt - call.startedAt)})` : ""
  const errorLine = createMemo(() => {
    if (call.status !== "error") return null
    const output = model().output
    if (!output) return null
    const nl = output.indexOf("\n")
    return nl === -1 ? output : output.slice(0, nl)
  })
  const expandable = createMemo(
    () =>
      model().body !== null ||
      model().output !== null ||
      model().variant === "todo" ||
      model().variant === "question",
  )
  const toggle = () => setExpanded((v) => !v)
  return (
    <box flexDirection="column" paddingLeft={2} marginTop={1}>
      <box
        flexDirection="row"
        onMouse={(evt) => {
          if (evt.type === "down" && evt.button === 0 && expandable()) toggle()
        }}
      >
        <ToolIcon status={call.status} />
        <text fg={theme.text}>
          <b>
            {" "}
            {model().icon} {model().title}
          </b>
        </text>
        <Show when={model().summary || errorLine()}>
          <text fg={call.status === "error" && errorLine() ? theme.error : theme.textMuted} wrapMode="char">
            {" · "}
            {errorLine() ?? model().summary}
          </text>
        </Show>
        <Show when={dur}>
          <text fg={theme.textMuted}>{dur}</text>
        </Show>
        <Show when={expandable()}>
          <text fg={theme.textMuted}>{expanded() ? " ▾" : " ▸"}</text>
        </Show>
      </box>
      <Show when={call.status === "running"}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>运行中…</text>
        </box>
      </Show>
      <Show when={expanded() && call.status !== "running"}>
        <ToolBody model={model()} args={(call.args ?? {}) as Record<string, unknown>} />
        <Show when={result?.truncated}>
          <text fg={theme.textMuted}>… 输出已截断</text>
        </Show>
      </Show>
    </box>
  )
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [expanded, setExpanded] = createSignal(false)
  // Bounded slice first so huge reasoning dumps never split in full.
  const lines = createMemo(() => text.slice(0, 12_000).split("\n"))
  const preview = () => {
    const all = lines()
    return all.length > 12 ? [...all.slice(0, 12), `… (${all.length - 12} more lines)`] : all
  }
  return (
    <box flexDirection="column" paddingLeft={2}>
      <box
        flexDirection="row"
        onMouse={(evt) => {
          if (evt.type === "down" && evt.button === 0) setExpanded((v) => !v)
        }}
      >
        <text fg={theme.textMuted}>
          {expanded() ? "▾" : "▸"} ✦
        </text>
        <text fg={theme.textMuted}>
          <b> Think</b>
        </text>
        <Show when={streaming}>
          <text fg={theme.textMuted}> …</text>
        </Show>
      </box>
      <Show when={expanded()}>
        <For each={preview()}>
          {(line) => (
            <text fg={theme.textMuted} wrapMode="char">
              {line}
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}

function ContextInjectionBlock({ message }: { message: ChatMessage }) {
  const inject = message.inject
  if (!inject) return null
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => message.content.split("\n"))
  const preview = () => {
    const all = lines()
    return all.length > INJECT_PREVIEW_LINES
      ? [...all.slice(0, INJECT_PREVIEW_LINES), `… (${all.length - INJECT_PREVIEW_LINES} more lines)`]
      : all
  }
  const formLabel =
    inject.form && inject.form !== "snapshot" ? CONTEXT_FORM_LABELS[inject.form] ?? inject.form : ""
  const toggle = () => setExpanded((v) => !v)
  return (
    <box flexDirection="column" marginBottom={1}>
      <box
        flexDirection="row"
        border={["left"]}
        borderColor={theme.borderSubtle}
        paddingLeft={1}
        onMouse={(evt) => {
          if (evt.type === "down" && evt.button === 0) toggle()
        }}
      >
        <text fg={theme.textMuted}>{expanded() ? "▾" : "▸"} ❐</text>
        <text fg={theme.textMuted}>
          <b> 上下文注入</b>
        </text>
        <text fg={theme.textMuted}> · {inject.source}</text>
        <Show when={formLabel}>
          <text fg={theme.textMuted}> · {formLabel}</text>
        </Show>
        <Show when={inject.form === "notice" && inject.summary}>
          <text fg={theme.textMuted}> · {inject.summary}</text>
        </Show>
      </box>
      <Show when={expanded()}>
        <box paddingLeft={3} flexDirection="column" border={["left"]} borderColor={theme.borderSubtle}>
          <For each={preview()}>
            {(line) => (
              <text fg={theme.textMuted} wrapMode="char">
                {line}
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function renderableContent(message: ChatMessage): { text: string; truncated: boolean } {
  const content = message.content
  if (message.streaming) {
    if (content.length <= STREAMING_CONTENT_TAIL) return { text: content, truncated: false }
    return { text: content.slice(-STREAMING_CONTENT_TAIL), truncated: true }
  }
  if (content.length <= MAX_RENDERED_CONTENT) return { text: content, truncated: false }
  const half = Math.floor(MAX_RENDERED_CONTENT / 2)
  return {
    text: `${content.slice(0, half)}\n… (中间 ${content.length - MAX_RENDERED_CONTENT} 字符已省略)\n${content.slice(-half)}`,
    truncated: true,
  }
}

export function MessageView(props: { message: ChatMessage }) {
  const view = renderableContent(props.message)
  if (props.message.inject) {
    return <ContextInjectionBlock message={props.message} />
  }
  if (props.message.role === "user") {
    return (
      <box backgroundColor={theme.backgroundPanel} flexDirection="row" marginBottom={1}>
        <box width={1} backgroundColor={theme.primary} flexShrink={0} />
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexGrow={1} minWidth={0}>
          <text fg={theme.text} wrapMode="char">
            {props.message.content}
          </text>
        </box>
      </box>
    )
  }

  return (
    <box flexDirection="column" paddingBottom={1} width="100%">
      <Show when={props.message.thinking}>
        <ThinkingBlock text={props.message.thinking as string} streaming={props.message.streaming} />
      </Show>
      <Show when={props.message.content}>
        <box paddingLeft={2} flexDirection="column">
          <Show when={view.truncated}>
            <text fg={theme.textMuted}>…</text>
          </Show>
          <MarkdownText text={props.message.streaming ? `${view.text}▍` : view.text} />
        </box>
      </Show>
      <Show when={!props.message.content && !props.message.thinking && props.message.streaming}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>…</text>
        </box>
      </Show>
      <Show when={props.message.toolCalls?.length}>
        <For each={props.message.toolCalls ?? []}>
          {(call) => (
            <ToolCard
              call={call}
              result={props.message.toolResults?.find((r) => r.toolCallId === call.id)}
            />
          )}
        </For>
      </Show>
      <Show when={props.message.error}>
        <text fg={theme.error}>⚠ {props.message.error}</text>
      </Show>
    </box>
  )
}
