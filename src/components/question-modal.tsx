import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { isDown, isEnter, isSpace, isUp } from "./key-match"
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

/**
 * Web-Harness-style confirmation card, rendered as a full-bleed masked overlay
 * (OpenTUI repaints in-place updates reliably when the dialog is full-screen
 * rather than a bottom-partial absolute panel). A multi-question ask-user /
 * plan-review batch is paged one question at a time: ↑/↓ move the option
 * highlight, ←/→ page between questions, Enter records the highlighted option
 * (it never auto-advances or auto-submits), Tab focuses the footer action row
 * and Enter activates its focused chip. The final page exposes an explicit
 * "确认全部" that submits every answer in a single respond; Esc rejects the
 * whole batch. Permission (multi-select) and sandbox-approval keep their
 * existing keyboard behavior.
 */
export function QuestionModal(props: {
  question: () => HarnessQuestion | null
  /** The full ask-user / plan-review batch (empty for permission / approval). */
  askQuestions?: () => HarnessQuestion[]
  onAnswer: (choice: string) => void
  /** Submit all answers of a multi-question batch in one respond. */
  onAnswerBatch?: (answers: Array<{ id: string; selected: string[] }>) => void
  /** Multi-select answer for permission questions with `requests` rows. */
  onAnswerMany?: (ids: string[]) => void
  /** Decide a pending sandbox-escalation approval. */
  onApproval?: (outcome: "allowed-once" | "rejected") => void
  /** Approve the pending escalation and allow for the rest of the session. */
  onApprovalAllowSession?: () => void
}) {
  const [sel, setSel] = createSignal(0)
  const [checked, setChecked] = createSignal<string[]>([])
  // Ask-user / plan-review batch pagination state.
  const [page, setPage] = createSignal(0)
  const [answers, setAnswers] = createSignal<Record<string, string[]>>({})
  const [footerFocus, setFooterFocus] = createSignal(false)
  const [footerSel, setFooterSel] = createSignal(0)

  // Force a repaint whenever the interactive state changes. Solid/OpenTUI
  // updates the renderable nodes, but on the main-thread (useThread:false)
  // renderer the repaint is not always scheduled; an explicit requestRender()
  // guarantees the highlight/checkbox reflects the keypress.
  const renderer = useRenderer()
  createEffect(() => {
    sel()
    checked()
    page()
    answers()
    footerFocus()
    footerSel()
    renderer.requestRender()
  })

  const asks = createMemo(() => props.askQuestions?.() ?? [])
  const isBatch = createMemo(() => asks().length > 1)
  const q = createMemo(() => props.question())

  // Reset selection/checked when a new question or batch arrives. Inside a
  // batch `question()` stays pinned to the first item, so paging never resets
  // the accumulated answers.
  createEffect(() => {
    const x = q()
    if (!x) return
    setSel(0)
    setChecked(x.requests?.filter((r) => r.suggested !== false).map((r) => r.id) ?? [])
    setPage(0)
    setAnswers({})
    setFooterFocus(false)
    setFooterSel(0)
  })

  const isMulti = createMemo(() => {
    const x = q()
    return x?.kind === "permission" && !!x.requests?.length
  })

  const current = createMemo<HarnessQuestion>(() => {
    const a = asks()
    return a.length > 0 ? (a[page()] ?? a[0])! : q()!
  })
  const cur = () => current()

  const pageCount = createMemo(() => (isBatch() ? asks().length : 1))
  const isLast = createMemo(() => (isBatch() ? page() + 1 >= pageCount() : true))
  const canPrev = createMemo(() => page() > 0)
  const allAnswered = createMemo(() => asks().every((item) => answers()[item.id] !== undefined))

  useKeyboard((key) => {
    const x = q()
    if (!x) return

    // Permission multi-select: Space/a/n/i/l toggle, Enter/Esc answer all.
    if (isMulti()) {
      const requests = x.requests as NonNullable<HarnessQuestion["requests"]>
      const toggle = (id: string) =>
        setChecked((ids) => (ids.includes(id) ? ids.filter((z) => z !== id) : [...ids, id]))
      if (isUp(key)) setSel((s) => Math.max(0, s - 1))
      else if (isDown(key)) setSel((s) => Math.min(requests.length - 1, s + 1))
      else if (isSpace(key)) toggle(requests[sel()]?.id as string)
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

    // Sandbox-escalation approval: allow-once / allow-session / reject.
    if (x.approval) {
      if (isEnter(key)) {
        if (sel() === 0) props.onApproval?.("allowed-once")
        else if (sel() === 1) props.onApprovalAllowSession?.()
        else props.onApproval?.("rejected")
      } else if (key.name === "escape") props.onApproval?.("rejected")
      else if (isUp(key)) setSel((s) => Math.max(0, s - 1))
      else if (isDown(key)) setSel((s) => Math.min(x.options.length - 1, s + 1))
      return
    }

    if (isBatch()) {
      const items = asks()
      const qq = items[page()] ?? items[0]!
      // Footer action row is focused: ←/→ switch the active chip, Enter runs it.
      if (footerFocus()) {
        if (key.name === "left" || key.name === "right") {
          setFooterSel((s) => (s === 0 ? 1 : 0))
        } else if (isEnter(key)) {
          if (footerSel() === 0) {
            if (canPrev()) setPage((p) => Math.max(0, p - 1))
          } else {
            if (!isLast()) {
              setPage((p) => Math.min(items.length - 1, p + 1))
            } else if (allAnswered()) {
              props.onAnswerBatch?.(
                items.map((item) => ({ id: item.id, selected: answers()[item.id] ?? [item.options[item.options.length - 1] ?? ""] })),
              )
            }
          }
          setFooterFocus(false)
          setFooterSel(0)
        } else if (key.name === "escape") {
          props.onAnswerBatch?.(items.map((item) => ({ id: item.id, selected: [item.options[item.options.length - 1] ?? ""] })))
          setFooterFocus(false)
          setFooterSel(0)
        } else if (key.name === "tab") {
          setFooterFocus(false)
        }
        return
      }
      // Option list focus.
      if (isUp(key)) setSel((s) => Math.max(0, s - 1))
      else if (isDown(key)) setSel((s) => Math.min(qq.options.length - 1, s + 1))
      else if (key.name === "left") {
        setPage((p) => Math.max(0, p - 1))
        setSel(0)
      } else if (key.name === "right") {
        setPage((p) => Math.min(items.length - 1, p + 1))
        setSel(0)
      }
      else if (isEnter(key)) {
        const opt = qq.options[sel()] ?? qq.options[qq.options.length - 1] ?? ""
        setAnswers((a) => ({ ...a, [qq.id]: [opt] }))
        // Record the option then auto-advance to the next question. On the last
        // question there is nothing to advance to, so reveal the footer on
        // "确认全部" for the explicit submit (a second Enter) — never an
        // accidental auto-submit.
        if (isLast()) {
          setFooterFocus(true)
          setFooterSel(1)
        } else {
          setPage((p) => Math.min(items.length - 1, p + 1))
          setSel(0)
        }
      } else if (key.name === "escape") {
        props.onAnswerBatch?.(items.map((item) => ({ id: item.id, selected: [item.options[item.options.length - 1] ?? ""] })))
      } else if (key.name === "tab") {
        setFooterFocus(true)
        setFooterSel(0)
      }
      return
    }

    // Single ask-user / plan-review question.
    if (isUp(key)) setSel((s) => Math.max(0, s - 1))
    else if (isDown(key)) setSel((s) => Math.min(x.options.length - 1, s + 1))
    else if (isEnter(key)) props.onAnswer(x.options[sel()] as string)
    else if (key.name === "escape") props.onAnswer(x.options[x.options.length - 1] as string)
  })

  if (!cur()) return null

  const kindColor = createMemo(() => {
    const x = current()
    return x.approval
      ? theme.accent
      : x.kind === "permission"
        ? theme.warning
        : x.kind === "plan-approval"
          ? theme.accent
          : theme.info
  })

  const multi = isMulti()
  const batch = isBatch()

  const eyebrow = createMemo(() => {
    const x = current()
    if (x.approval) return "🔒 权限确认"
    if (x.kind === "permission") return multi ? `🔒 Permission · ${x.requests?.length ?? 0} 个请求` : "🔒 Permission"
    // ask-user / plan-review show only the question's own text as the title;
    // no icon, no flavour label.
    return ""
  })
  const title = createMemo(() => {
    const x = current()
    if (x.approval) return "是否允许这次沙箱权限升级？"
    if (x.kind === "permission") return x.title || (multi ? `允许这 ${x.requests?.length ?? 0} 个请求吗？` : "是否允许这个请求？")
    if (x.kind === "plan-approval") return x.title || "确认执行这份计划？"
    return x.title || ""
  })
  const hint = createMemo(() => {
    if (multi) return "Space 切换 · a 全选 · n 全不选 · i 反选 · l 只选最新 · Enter 确认 · Esc 拒绝"
    if (batch) return ""
    return "↑↓ 选择 · Enter 确认 · Esc 拒绝"
  })

  const primaryBtn = createMemo(() => {
    if (multi) return { label: "允许", fg: theme.background, bg: theme.accent }
    const x = current()
    if (x.approval) {
      if (sel() === 0) return { label: "允许本次", fg: theme.background, bg: theme.accent }
      if (sel() === 1) return { label: "允许整个会话", fg: theme.background, bg: theme.accent }
      return { label: "拒绝", fg: theme.text, bg: theme.backgroundElement }
    }
    if (batch) {
      if (!isLast()) return { label: "下一页", fg: theme.background, bg: theme.accent }
      return { label: "确认全部", fg: theme.background, bg: theme.accent }
    }
    return { label: "确认", fg: theme.background, bg: theme.accent }
  })
  const secondaryBtn = createMemo(() => {
    const x = current()
    if (!multi && x.approval) return { label: "拒绝", fg: theme.text, bg: theme.backgroundElement }
    if (batch) return { label: "上一题", fg: theme.textMuted, bg: theme.backgroundElement }
    return { label: "拒绝", fg: theme.textMuted, bg: theme.backgroundElement }
  })

  const primary = primaryBtn
  const secondary = secondaryBtn

  return (
    // Docked confirmation card rendered in normal flow above the composer, so
    // the conversation stays visible while an approval/question is pending.
    // OpenTUI's in-place repaint now works (useThread:true), so no full-screen
    // mask is needed.
    <box
      width="100%"
      border
      borderStyle="rounded"
      borderColor={theme.border}
      backgroundColor={theme.backgroundCard}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
      marginBottom={1}
    >
      {/* Eyebrow: muted small label (only for permission / approval) */}
      <Show when={eyebrow()}>
        <text fg={theme.textMuted}>
          <b>{eyebrow()}</b>
        </text>
      </Show>

      {/* Title: bright, bold */}
      <text fg={theme.text} wrapMode="char">
        <b>{title()}</b>
      </text>

      <Show when={cur().detail}>
        <box flexDirection="column" marginTop={1}>
          <For each={truncateBody(cur().detail as string).split("\n")}>
            {(line) => (
              <text fg={theme.textMuted} wrapMode="char">
                {line}
              </text>
            )}
          </For>
        </box>
      </Show>

      {/* Options / requests */}
      <box flexDirection="column" marginTop={1} marginBottom={1}>
        <Show
          when={multi}
          fallback={
            <For each={cur().options}>
              {(option, i) => (
                <box flexDirection="row" backgroundColor={i() === sel() ? theme.backgroundCardActive : undefined}>
                  <text fg={i() === sel() ? kindColor() : theme.border}>{i() === sel() ? "▎" : " "}</text>
                  <text
                    fg={batch && answers()[cur().id]?.[0] === option ? kindColor() : i() === sel() ? theme.text : theme.textMuted}
                    wrapMode="char"
                  >
                    {batch && answers()[cur().id]?.[0] === option ? "✓" : " "} {option}
                  </text>
                </box>
              )}
            </For>
          }
        >
          <For each={cur().requests}>
            {(request, i) => {
              const isChecked = () => checked().includes(request.id)
              return (
                <box flexDirection="column" backgroundColor={i() === sel() ? theme.backgroundCardActive : undefined}>
                  <box flexDirection="row">
                    <text fg={i() === sel() ? kindColor() : theme.border}>{i() === sel() ? "▎" : " "}</text>
                    <text fg={i() === sel() ? theme.text : isChecked() ? theme.text : theme.textMuted} wrapMode="char">
                      {isChecked() ? "[x]" : "[ ]"} {request.label}
                    </text>
                  </box>
                  <Show when={request.detail}>
                    <text fg={theme.textMuted} wrapMode="char">
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
        </Show>
      </box>

      {/* Divider */}
      <box height={1} />

      {/* Hint line */}
      <Show when={hint()}>
        <text fg={theme.textMuted} wrapMode="char">
          {hint()}
        </text>
      </Show>

      {/* Bottom row: pagination (left) + action buttons (right) */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
        <Show when={pageCount() > 1}>
          <text fg={theme.textMuted}>
            ‹ 第 {page() + 1}/{pageCount()} 题 ›
          </text>
        </Show>
        <Show when={pageCount() <= 1}>
          <text fg={theme.textMuted}> </text>
        </Show>
        <box flexDirection="row" alignItems="center">
          <Show when={batch && footerFocus()}>
            <text fg={theme.textMuted} marginRight={1}>
              {"  "}
            </text>
          </Show>
          <box
            backgroundColor={footerFocus() && footerSel() === 0 ? theme.backgroundCardActive : secondary().bg}
            paddingLeft={1}
            paddingRight={1}
            marginRight={1}
          >
            <text fg={batch && footerFocus() && footerSel() === 0 ? theme.accent : secondary().fg}>
              {footerFocus() && footerSel() === 0 ? "▎" : " "}
              {secondary().label}
            </text>
          </box>
          <box
            backgroundColor={
              footerFocus() && footerSel() === 1
                ? theme.backgroundCardActive
                : batch && isLast() && !allAnswered()
                  ? theme.backgroundElement
                  : primary().bg
            }
            paddingLeft={1}
            paddingRight={1}
          >
            <text
              fg={
                footerFocus() && footerSel() === 1
                  ? theme.accent
                  : batch && isLast() && !allAnswered()
                    ? theme.textMuted
                    : primary().fg
              }
            >
              {footerFocus() && footerSel() === 1 ? "▎" : " "}
              {primary().label}
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}
