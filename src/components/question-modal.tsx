import { For, Show, createEffect, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { isDown, isEnter, isUp } from "./key-match"
import type { HarnessQuestion } from "../session"
import { theme } from "../theme"

function truncateBody(body: string, maxChars = 1200, maxLines = 14): string {
  let b = body
  if (b.length > maxChars) b = b.slice(0, maxChars) + "\n… (truncated)"
  const lines = b.split("\n")
  if (lines.length > maxLines) {
    b = lines.slice(0, maxLines).join("\n") + `\n… (${lines.length - maxLines} more lines)`
  }
  return b
}

export function QuestionModal(props: {
  question: () => HarnessQuestion | null
  onAnswer: (choice: string) => void
  /** Multi-select answer for permission questions with `requests` rows. */
  onAnswerMany?: (ids: string[]) => void
  /** Decide a pending sandbox-escalation approval. */
  onApproval?: (outcome: "allowed-once" | "rejected") => void
  /** Approve the pending escalation and allow for the rest of the session. */
  onApprovalAllowSession?: () => void
}) {
  const [sel, setSel] = createSignal(0)
  const [checked, setChecked] = createSignal<string[]>([])

  createEffect(() => {
    const q = props.question()
    if (!q) return
    setSel(0)
    // Default selection follows the harness's suggestion (all requests).
    setChecked(q.requests?.filter((r) => r.suggested !== false).map((r) => r.id) ?? [])
  })

  const isMulti = () => {
    const q = props.question()
    return q?.kind === "permission" && !!q.requests?.length
  }

  useKeyboard((key) => {
    const q = props.question()
    if (!q) return
    if (isMulti()) {
      const requests = q.requests as NonNullable<HarnessQuestion["requests"]>
      const toggle = (id: string) =>
        setChecked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
      if (isUp(key)) setSel((s) => Math.max(0, s - 1))
      else if (isDown(key)) setSel((s) => Math.min(requests.length - 1, s + 1))
      else if (key.name === "space") toggle(requests[sel()]?.id as string)
      else if (key.name === "a") setChecked(requests.map((r) => r.id))
      else if (key.name === "n") setChecked([])
      else if (key.name === "i") {
        const active = new Set(checked())
        setChecked(requests.filter((r) => !active.has(r.id)).map((r) => r.id))
      } else if (key.name === "l") {
        const latest = requests[requests.length - 1]
        setChecked(latest ? [latest.id] : [])
      } else if (isEnter(key)) {
        props.onAnswerMany?.(checked())
        key.preventDefault?.()
      } else if (key.name === "escape") {
        props.onAnswerMany?.([])
        key.preventDefault?.()
      }
      return
    }
    if (q.approval) {
      if (isEnter(key)) {
        if (sel() === 0) props.onApproval?.("allowed-once")
        else if (sel() === 1) props.onApprovalAllowSession?.()
        else props.onApproval?.("rejected")
      } else if (key.name === "escape") props.onApproval?.("rejected")
      else if (isUp(key)) setSel((s) => Math.max(0, s - 1))
      else if (isDown(key)) setSel((s) => Math.min(q.options.length - 1, s + 1))
      return
    }
    if (isUp(key)) setSel((s) => Math.max(0, s - 1))
    else if (isDown(key)) setSel((s) => Math.min(q.options.length - 1, s + 1))
    else if (isEnter(key)) props.onAnswer(q.options[sel()] as string)
    else if (key.name === "escape") props.onAnswer(q.options[q.options.length - 1] as string)
  })

  const q = props.question()
  if (!q) return null
  const kindColor =
    q.approval
      ? theme.accent
      : q.kind === "permission"
        ? theme.warning
        : q.kind === "plan-approval"
          ? theme.accent
          : theme.info
  const multi = isMulti()
  const title =
    q.approval
      ? "🔒 权限确认"
      : q.kind === "permission"
        ? multi
          ? `🔒 Permission · ${q.requests?.length ?? 0} 个请求`
          : "🔒 Permission"
        : q.kind === "plan-approval"
          ? "📋 Plan review"
          : "❓ Question"
  const hint = multi
    ? "Space 切换 · Enter 确认 · a 全选 · n 全不选 · i 反选 · l 只选最新 · Esc 拒绝"
    : "↑↓ 选择 · Enter 确认 · Esc 拒绝"

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={8000}
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.background}
    >
      <box
        width={72}
        border
        borderColor={kindColor}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <text fg={kindColor}>
          <b>{title}</b>
        </text>
        <Show when={!q.approval}>
          <text fg={theme.text} wrapMode="char">
            {q.title}
          </text>
        </Show>
        <Show when={q.detail}>
          <box flexDirection="column" marginTop={1} marginBottom={1}>
            <For each={truncateBody(q.detail as string).split("\n")}>
              {(line) => (
                <text fg={theme.textMuted} wrapMode="char">
                  {line}
                </text>
              )}
            </For>
          </box>
        </Show>
        <Show
          when={multi}
          fallback={
            <box flexDirection="column" marginTop={1}>
              <For each={q.options}>
                {(option, i) => (
                  // Same untrack caveat as the result panel: keep i()/sel() inline
                  // in the props so the highlight follows arrow-key selection.
                  <box backgroundColor={i() === sel() ? kindColor : undefined}>
                    <text fg={i() === sel() ? theme.background : theme.text} wrapMode="char">
                      {i() === sel() ? "› " : "  "}
                      {option}
                    </text>
                  </box>
                )}
              </For>
            </box>
          }
        >
          <box flexDirection="column" marginTop={1}>
            <For each={q.requests}>
              {(request, i) => {
                const isChecked = () => checked().includes(request.id)
                return (
                  <box flexDirection="column" backgroundColor={i() === sel() ? kindColor : undefined}>
                    <text fg={i() === sel() ? theme.background : theme.text} wrapMode="char">
                      {isChecked() ? "[x]" : "[ ]"} {request.label}
                    </text>
                    <Show when={request.detail}>
                      <text fg={i() === sel() ? theme.background : theme.textMuted} wrapMode="char">
                        {truncateBody(request.detail as string)
                          .split("\n")
                          .map((line) => `   ${line}`)
                          .join("\n")}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
        <text fg={theme.textMuted}>{hint}</text>
      </box>
    </box>
  )
}
