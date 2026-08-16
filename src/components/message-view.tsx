import { createMemo, For, Show } from "solid-js"
import type { ChatMessage } from "../session"
import type { ToolCallRecord, ToolResultRecord, ToolCallStatus } from "../session"
import { theme } from "../theme"
import { CONTEXT_FORM_LABELS } from "../harness/fold"

/** While a message is streaming, only render its tail so layout stays cheap. */
const STREAMING_CONTENT_TAIL = 4000
/** Bound on a finalized message's rendered text (head+tail, with a note). */
const MAX_RENDERED_CONTENT = 32_000
const INJECT_PREVIEW_LINES = 8

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

export function ToolCard({ call, result }: { call: ToolCallRecord; result?: ToolResultRecord }) {
  const dur =
    call.startedAt && call.finishedAt ? ` (${formatDuration(call.finishedAt - call.startedAt)})` : ""
  const outputLines = createMemo(() => (result && result.output.trim() ? result.output.split("\n") : []))
  return (
    <box flexDirection="column" paddingLeft={2} marginTop={1}>
      <box flexDirection="row">
        <ToolIcon status={call.status} />
        <text fg={theme.text}>
          <b> {call.name}</b>
        </text>
        <Show when={call.summary}>
          <text fg={theme.textMuted} wrapMode="char">
            {"  "}
            {call.summary}
          </text>
        </Show>
        <Show when={dur}>
          <text fg={theme.textMuted}>{dur}</text>
        </Show>
      </box>
      <Show when={call.status === "running"}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted}>运行中…</text>
        </box>
      </Show>
      <Show when={outputLines().length > 0 && call.status !== "running"}>
        <box paddingLeft={2} flexDirection="column">
          <For each={outputLines().slice(0, 4)}>
            {(line) => (
              <text fg={theme.textMuted} wrapMode="char">
                {line}
              </text>
            )}
          </For>
          <Show when={outputLines().length > 4}>
            <text fg={theme.textMuted}>… ({outputLines().length - 4} more lines)</text>
          </Show>
          <Show when={result?.truncated}>
            <text fg={theme.textMuted}>… 输出已截断</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  // Bounded slice first so huge reasoning dumps never split in full.
  const lines = createMemo(() => text.slice(0, 12_000).split("\n"))
  const preview = () => {
    const all = lines()
    return all.length > 12 ? [...all.slice(0, 12), `… (${all.length - 12} more lines)`] : all
  }
  return (
    <box flexDirection="column" paddingLeft={2} marginTop={1}>
      <box flexDirection="row">
        <text fg={theme.info}>💭</text>
        <text fg={theme.text}>
          <b> 思考</b>
        </text>
        <Show when={streaming}>
          <text fg={theme.textMuted}> …</text>
        </Show>
      </box>
      <For each={preview()}>
        {(line) => (
          <text fg={theme.textMuted} wrapMode="char">
            {line}
          </text>
        )}
      </For>
    </box>
  )
}

function ContextInjectionBlock({ message }: { message: ChatMessage }) {
  const inject = message.inject
  if (!inject) return null
  const lines = createMemo(() => message.content.split("\n"))
  const preview = () => {
    const all = lines()
    if (inject.summary) return [`${inject.summary}`]
    return all.length > INJECT_PREVIEW_LINES
      ? [...all.slice(0, INJECT_PREVIEW_LINES), `… (${all.length - INJECT_PREVIEW_LINES} more lines)`]
      : all
  }
  const formLabel = inject.form ? CONTEXT_FORM_LABELS[inject.form] ?? inject.form : ""
  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <box flexDirection="row" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
        <text fg={theme.info}>▸</text>
        <text fg={theme.text}>
          <b> {inject.source}</b>
        </text>
        <text fg={theme.textMuted}> · 上下文注入</text>
        <Show when={formLabel}>
          <text fg={theme.textMuted}> · {formLabel}</text>
        </Show>
      </box>
      <box paddingLeft={3} flexDirection="column" border={["left"]} borderColor={theme.borderSubtle}>
        <For each={preview()}>
          {(line) => (
            <text fg={theme.textMuted} wrapMode="char">
              {line}
            </text>
          )}
        </For>
      </box>
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
        <box paddingLeft={2}>
          <Show when={view.truncated}>
            <text fg={theme.textMuted}>…</text>
          </Show>
          <text fg={theme.text} wrapMode="char">
            {view.text}
            <Show when={props.message.streaming}>
              <span style={{ fg: theme.accent }}>▍</span>
            </Show>
          </text>
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
