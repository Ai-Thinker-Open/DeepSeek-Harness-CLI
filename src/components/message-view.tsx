import { For, Show } from "solid-js"
import type { ChatMessage } from "../session"
import type { ToolCallRecord, ToolResultRecord, ToolCallStatus } from "../session"
import { theme } from "../theme"

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
  const outputLines = () => (result && result.output.trim() ? result.output.split("\n") : [])
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
        </box>
      </Show>
    </box>
  )
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split("\n")
  const preview = lines.length > 12 ? [...lines.slice(0, 12), `… (${lines.length - 12} more lines)`] : lines
  return (
    <box flexDirection="column" paddingLeft={2} marginTop={1}>
      <box flexDirection="row">
        <text fg={theme.info}>💭</text>
        <text fg={theme.text}>
          <b> thinking</b>
        </text>
        <Show when={streaming}>
          <text fg={theme.textMuted}> …</text>
        </Show>
      </box>
      <For each={preview}>
        {(line) => (
          <text fg={theme.textMuted} wrapMode="char">
            {line}
          </text>
        )}
      </For>
    </box>
  )
}

export function MessageView(props: { message: ChatMessage }) {
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
          <text fg={theme.text} wrapMode="char">
            {props.message.content}
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
