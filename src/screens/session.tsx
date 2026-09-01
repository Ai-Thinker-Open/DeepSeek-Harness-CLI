import { For, Show, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Footer } from "../components/footer"
import { MessageView } from "../components/message-view"
import { Prompt } from "../components/prompt"
import { QueueDock } from "../components/queue-dock"
import { QuestionModal } from "../components/question-modal"
import { StatusMarquee } from "../components/status-marquee"
import { PlanModeBadge } from "../components/plan-mode-badge"
import { StatsBar } from "../components/stats-bar"
import { Toast, type ToastMessage } from "../components/toast"
import type { PermissionMode } from "../permission"
import { DEEP_DIVING_STATUS, type ChatMessage, type HarnessQuestion, type SessionStats } from "../session"
import { theme } from "../theme"
import type { CommandItem, CommandResultView } from "../commands"
import type { ClipboardReadLike } from "../images"
import type { ImageLimits, QueueAction, QueueItem } from "../harness/client"
import type { ImageCommandImage } from "../harness/client"
import type { PromptContentPart } from "../harness/client"

export function SessionScreen(props: {
  messages: () => ChatMessage[]
  mode: () => PermissionMode
  model: () => string
  toast: () => ToastMessage | null
  stats: () => SessionStats
  statusText: () => string
  busy: () => boolean
  planMode: () => boolean
  planPending: () => boolean
  question: () => HarnessQuestion | null
  onSend: (content: PromptContentPart[]) => void
  onNotice?: (text: string, kind?: "success" | "error") => void
  imageLimits?: () => ImageLimits
  clipboard?: ClipboardReadLike
  onCancel: () => void
  onQuestion: (choice: string) => void
  onQuestionMany?: (ids: string[]) => void
  onApproval?: (outcome: "allowed-once" | "rejected") => void
  onApprovalAllowSession?: () => void
  commandItems?: () => CommandItem[]
  onCommand?: (line: string, images?: ImageCommandImage[]) => Promise<CommandResultView | null>
  onCommandPopupOpen?: (open: boolean) => void
  commandsLoading?: () => boolean
  resultOverride?: () => CommandResultView | null
  queue?: () => QueueItem[]
  onQueueAction?: (itemId: string, action: QueueAction) => void
  sessionId?: () => string | null
  visible?: boolean
  active?: () => boolean
}) {
  const [commandOpen, setCommandOpen] = createSignal(false)
  /**
   * The composer must survive any SessionScreen re-render (question opens or
   * closes, busy flips, status changes): those re-renders would otherwise hand
   * the Prompt fresh closures, Solid would re-run it, and OpenTUI would
   * recreate the textarea — silently dropping the user's draft. Memoizing the
   * whole subtree keeps the same node unless its real inputs change; `active`
   * still reads the question lazily so blur/focus react without re-rendering.
   */
  const promptNode = createMemo(() => {
    return (
      <Prompt
        mode={props.mode}
        model={props.model}
        onSubmit={(content) => props.onSend(content)}
        onNotice={props.onNotice}
        imageLimits={props.imageLimits}
        clipboard={props.clipboard}
        commandItems={props.commandItems}
        onCommand={props.onCommand}
        onPopupOpenChange={(open) => {
          setCommandOpen(open)
          props.onCommandPopupOpen?.(open)
        }}
        commandsLoading={props.commandsLoading}
        resultOverride={props.resultOverride}
        sessionId={props.sessionId}
        active={() => (props.active?.() ?? true) && !props.question()}
        inputId="session-prompt-input"
      />
    )
  })
  useKeyboard((key) => {
    if (props.question()) return
    if (commandOpen()) return
    if (!(props.active?.() ?? true) || key.name !== "escape") return
    // Once a session is open there is deliberately no way back to the home
    // screen: the harness session keeps running in the background, so Esc
    // only cancels an active turn or leaves plan mode. Question/menu Esc
    // still win above; an idle session Esc is a no-op.
    if (props.busy()) {
      props.onCancel()
      key.preventDefault()
    } else if (props.planMode()) {
      void props.onCommand?.("/plan off")
      key.preventDefault()
    }
  })

  return (
    <box
      position="relative"
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.background}
      visible={props.visible ?? true}
    >
      <scrollbox
        flexGrow={1}
        minHeight={0}
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        stickyScroll
        stickyStart="bottom"
      >
        <Show
          when={props.messages().length > 0}
          fallback={
            <box height="100%" alignItems="center" justifyContent="center">
              <text fg={theme.textMuted}>发送消息开始对话</text>
            </box>
          }
        >
          <For each={props.messages()}>{(message) => <MessageView message={message} />}</For>
        </Show>
      </scrollbox>

      <box
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        flexShrink={0}
      >
        <Show when={props.statusText() || props.planMode() || props.planPending() || props.busy()}>
          <box flexDirection="row" width="100%" paddingBottom={1} alignItems="center">
            <box flexGrow={1} minWidth={0}>
              <Show when={props.statusText()}>
                <StatusMarquee
                  text={props.statusText()}
                  animated={props.statusText() === DEEP_DIVING_STATUS}
                />
              </Show>
            </box>
            <Show when={props.busy()}>
              <text fg={theme.textMuted}>Esc 取消</text>
            </Show>
            <Show when={props.planMode() && !props.busy()}>
              <text fg={theme.textMuted}>Esc 退出计划模式</text>
            </Show>
            <PlanModeBadge active={props.planMode} pending={props.planPending} />
          </box>
        </Show>
        <Show when={(props.queue?.().length ?? 0) > 0}>
          <box paddingBottom={1}>
            <QueueDock queue={props.queue ?? (() => [])} onAction={props.onQueueAction ?? (() => {})} />
          </box>
        </Show>
        {promptNode()}
        <StatsBar stats={props.stats} />
      </box>

      <Footer />
      <Toast toast={props.toast} />
      <Show when={props.question()}>
        <QuestionModal
          question={props.question}
          onAnswer={props.onQuestion}
          onAnswerMany={props.onQuestionMany}
          onApproval={props.onApproval}
          onApprovalAllowSession={props.onApprovalAllowSession}
        />
      </Show>
    </box>
  )
}
