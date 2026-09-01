import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useRenderer } from "@opentui/solid"
import type { ChatImage, ChatMessage } from "../session"
import type { ToolCallRecord, ToolResultRecord, ToolCallStatus } from "../session"
import { ACCENT_BORDER, theme } from "../theme"
import { CONTEXT_FORM_LABELS } from "../harness/fold"
import {
  buildDiffText,
  editPair,
  questionItems,
  todoItems,
  toolRowModel,
  writeText,
  type ToolRowModel,
} from "../harness/tool-card"
import { MarkdownText } from "./markdown"
import { ShineSpans, ShineText } from "./shine-text"
import { ToolIcon } from "./tool-icon"

/** While a message is streaming, only render its tail so layout stays cheap. */
const STREAMING_CONTENT_TAIL = 4000
/** Bound on a finalized message's rendered text (head+tail, with a note). */
const MAX_RENDERED_CONTENT = 32_000
const INJECT_PREVIEW_LINES = 8
const MAX_OUTPUT_LINES = 20

/** Kitty/Sixel graphics availability (same probe as ToolIcon). */
function graphicsSupported(): boolean {
  const caps = useRenderer().capabilities
  if (!caps) return false
  return (
    caps.kitty_graphics ||
    caps.sixel ||
    caps.image_protocol === "kitty" ||
    caps.image_protocol === "sixel"
  )
}

const MAX_IMAGE_CELLS_W = 40
const MAX_IMAGE_CELLS_H = 12

function thumbnailCells(image: ChatImage): { width: number; height: number } {
  const w = image.width
  const h = image.height
  if (!w || !h) return { width: 12, height: 8 }
  const scale = Math.min(MAX_IMAGE_CELLS_W / w, MAX_IMAGE_CELLS_H / h, 1)
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

/** One attached image: Kitty/Sixel thumbnail, or a text chip fallback. */
function ImageThumb({ image }: { image: ChatImage }) {
  const [failed, setFailed] = createSignal(false)
  const cells = thumbnailCells(image)
  const dataUrl = image.data ? `data:${image.mediaType};base64,${image.data}` : undefined
  const showImage = () => graphicsSupported() && dataUrl !== undefined && !failed()
  return (
    <Show
      when={showImage()}
      fallback={
        <text fg={theme.textMuted}>
          <span>🖼 </span>
          <span>{image.name ?? "图片"}</span>
          <Show when={!image.data && !image.error}>
            <span>（加载中…）</span>
          </Show>
          <Show when={image.error}>
            <span>（加载失败）</span>
          </Show>
        </text>
      }
    >
      <image
        source={dataUrl}
        style={{ width: cells.width, height: cells.height }}
        fit="fit"
        protocol="auto"
        onError={() => setFailed(true)}
      />
    </Show>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function OutputLines({ text }: { text: string }) {
  // Bash-style outputs usually end with a newline; keeping it would render a
  // blank row at the bottom of the card and read as a large gap between
  // adjacent tool actions.
  const lines = createMemo(() => text.replace(/\n+$/, "").split("\n"))
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
  const terminal = model.card?.kind === "terminal" ? model.card.terminal : undefined
  const displayText = terminal?.output !== undefined ? terminal.output : markers.text
  const exitCode = terminal?.exitCode !== undefined ? terminal.exitCode : markers.exitCode
  return (
    <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
      <Show when={model.body}>
        <text fg={theme.text} wrapMode="char">
          <span style={{ fg: theme.primary, bold: true }}>❯ </span>
          {model.body}
        </text>
      </Show>
      <Show when={displayText}>
        <OutputLines text={displayText} />
      </Show>
      <Show when={markers.sandbox}>
        <text fg={theme.warning}>⚠ {markers.sandbox}</text>
      </Show>
      <Show when={exitCode !== undefined}>
        <text fg={exitCode === 0 ? theme.textMuted : theme.error}>
          {exitCode === 0 ? "✓ 退出码 0" : `✗ 退出码 ${exitCode}`}
        </text>
      </Show>
    </box>
  )
}

function ReadCard({ model }: { model: ToolRowModel }) {
  const read = model.card?.kind === "read" ? model.card : null
  const readLines = read?.lines
  if (readLines && readLines.length > 0) {
    return (
      <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
        <For each={readLines.slice(0, MAX_OUTPUT_LINES)}>
          {(line) => (
            <text fg={theme.textMuted} wrapMode="char">
              {String(line.number).padStart(4, " ")} | {line.text}
            </text>
          )}
        </For>
        <Show when={readLines.length > MAX_OUTPUT_LINES}>
          <text fg={theme.textMuted}>… ({readLines.length - MAX_OUTPUT_LINES} more lines)</text>
        </Show>
      </box>
    )
  }
  return (
    <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
      <Show when={model.output}>
        <OutputLines text={model.output as string} />
      </Show>
    </box>
  )
}

function EditCard({ model, args, newOnly }: { model: ToolRowModel; args: Record<string, unknown>; newOnly?: boolean }) {
  // Explicit OpenTUI diff colors (canonical green-for-added / red-for-removed,
  // the same values MiMo Code uses): removed lines render red, added lines
  // render green instead of relying on the component defaults drifting.
  const DIFF_ADDED_SIGN = "#22c55e"
  const DIFF_REMOVED_SIGN = "#ef4444"
  const DIFF_ADDED_BG = "#1a4d1a"
  const DIFF_REMOVED_BG = "#4d1a1a"
  const hunks = createMemo(() => {
    const hunks = model.card?.kind === "diff" ? model.card.diffs ?? null : null
    if (hunks) return hunks.map((h) => ({ path: h.path, oldText: h.oldText, newText: h.newText }))
    const pair = editPair(args)
    const path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : undefined
    return [{ path, oldText: newOnly ? undefined : pair.oldText, newText: newOnly ? writeText(args) : pair.newText }]
  })
  // The OpenTUI viewer renders only the first patch, so build one diff per
  // file and render them as separate rows.
  const groups = createMemo(() => {
    const out: Array<{ path: string; diff: string; totalLines: number }> = []
    const byPath = new Map<string, ReturnType<typeof hunks>[number][]>()
    for (const hunk of hunks()) {
      const path = hunk.path || "file"
      const group = byPath.get(path) ?? []
      group.push(hunk)
      byPath.set(path, group)
    }
    for (const [path, group] of byPath) {
      const built = buildDiffText(group, { newFile: newOnly, maxLines: MAX_OUTPUT_LINES })
      if (built) out.push({ path, diff: built.diff, totalLines: built.totalLines })
    }
    return out
  })
  return (
    <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
      <For each={groups()}>
        {(group) => (
          <box flexDirection="column">
            <text fg={theme.textMuted}>
              <b> {group.path}</b>
            </text>
            <diff
              diff={group.diff}
              view="unified"
              showLineNumbers
              wrapMode="char"
              addedSignColor={DIFF_ADDED_SIGN}
              removedSignColor={DIFF_REMOVED_SIGN}
              addedBg={DIFF_ADDED_BG}
              removedBg={DIFF_REMOVED_BG}
            />
            <Show when={group.totalLines > MAX_OUTPUT_LINES}>
              <text fg={theme.textMuted}>… ({group.totalLines - MAX_OUTPUT_LINES} more lines)</text>
            </Show>
          </box>
        )}
      </For>
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
      return <EditCard model={model} args={args} />
    case "write":
      return <EditCard model={model} args={args} newOnly />
    case "search": {
      const search = model.card?.kind === "search" ? model.card : null
      if (search?.files) {
        return (
          <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
            <For each={search.files}>
              {(file) => (
                <box flexDirection="column">
                  <text fg={theme.text}>{file.path}</text>
                  <For each={file.matches.slice(0, MAX_OUTPUT_LINES)}>
                    {(match) => (
                      <text fg={theme.textMuted} wrapMode="char">
                        {"  "}
                        {match.lineNumber}: {match.line}
                      </text>
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
        )
      }
      if (search?.paths) {
        return (
          <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
            <For each={search.paths}>
              {(path) => (
                <text fg={theme.textMuted} wrapMode="char">
                  {path}
                </text>
              )}
            </For>
          </box>
        )
      }
      return (
        <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={1}>
          <Show when={model.output}>
            <OutputLines text={model.output as string} />
          </Show>
        </box>
      )
    }
    case "todo":
      return <TodoCard args={args} />
    case "question":
      return <QuestionCard args={args} />
    default:
      return (
        <box flexDirection="column" paddingLeft={2}>
          <Show when={model.isPlan && model.body}>
            {/* The plan artifact is markdown: render it so headings, lists,
                and code blocks read properly instead of raw markers. */}
            <MarkdownText text={model.body as string} />
          </Show>
          <Show when={!model.isPlan && model.body}>
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
  const [hovered, setHovered] = createSignal(false)
  let autoExpanded = false
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
  // Show file-change records as soon as the call settles: edit/write cards
  // (or any result carrying a diff card) expand once by default, so the
  // added/removed content is visible in the conversation. A manual collapse
  // stays collapsed.
  createEffect(() => {
    if (call.status === "running" || autoExpanded) return
    const variant = model().variant
    if (variant === "edit" || variant === "write" || call.name === "exit_plan_mode" || model().card?.kind === "diff") {
      autoExpanded = true
      setExpanded(true)
    }
  })
  return (
    <box flexDirection="column" paddingLeft={2} marginTop={1}>
      <box
        flexDirection="row"
        width="100%"
        onMouse={(evt) => {
          if (evt.type === "over") setHovered(true)
          else if (evt.type === "out") setHovered(false)
          else if (evt.type === "down" && evt.button === 0 && expandable()) toggle()
        }}
      >
        <ToolIcon
          glyph={model().icon}
          pngKey={call.name === "web_search" ? "web" : model().variant}
          expanded={expanded()}
          hovered={hovered()}
          expandable={expandable()}
        />
        {/* One non-wrapping line: a long summary used to wrap the header to
         * two rows, making adjacent tool cards look far apart. */}
        <text fg={theme.textMuted} wrapMode="none" truncate>
          <Show when={call.status !== "running"}>
            <span style={{ fg: theme.primary, bold: true }}> {model().title}</span>
          </Show>
          <Show when={call.status === "running"}>
            <span> </span>
            <ShineSpans text={model().title} />
          </Show>
          <Show when={model().summary || errorLine()}>
            <span style={{ fg: call.status === "error" && errorLine() ? theme.error : theme.textMuted }}>
              {" · "}
              {errorLine() ?? model().summary}
            </span>
          </Show>
          <Show when={dur}>
            <span>{dur}</span>
          </Show>
          {/* Codex-style settled marker for command/terminal executions. */}
          <Show
            when={
              call.status !== "running" &&
              (model().variant === "bash" || model().variant === "terminal")
            }
          >
            <span style={{ fg: call.status === "error" ? theme.error : "#22c55e" }}>
              {call.status === "error" ? " ✗" : " ✓"}
            </span>
          </Show>
          <Show when={call.status === "running"}>
            <span> …</span>
          </Show>
        </text>
      </box>
      <Show when={expanded() && call.status !== "running"}>
        <ToolBody model={model()} args={(call.args ?? {}) as Record<string, unknown>} />
        <Show when={result?.truncated}>
          <text fg={theme.textMuted}>… 输出已截断</text>
        </Show>
      </Show>
    </box>
  )
}

function CommandCard({ message }: { message: ChatMessage }) {
  const command = message.command
  if (!command) return null
  const [expanded, setExpanded] = createSignal(false)
  const expandable = () => Boolean(command.resultText)
  return (
    <box flexDirection="column" paddingLeft={2} marginBottom={1}>
      <box
        flexDirection="row"
        width="100%"
        onMouse={(evt) => {
          if (evt.type === "down" && evt.button === 0 && expandable()) setExpanded((v) => !v)
        }}
      >
        <text fg={theme.textMuted}>
          <Show when={expandable()}>
            <span>{expanded() ? "▾" : "▸"} </span>
          </Show>
          <span>❯</span>
          <b> /{command.name}</b>
          <Show when={command.args}>
            <span>{command.args}</span>
          </Show>
          <Show when={command.status === "running"}>
            <span> …</span>
          </Show>
          <Show when={command.status === "error" && command.resultText}>
            <span style={{ fg: theme.error }}> · {command.resultText}</span>
          </Show>
        </text>
      </box>
      <Show when={expanded() && command.resultText}>
        <box paddingLeft={2}>
          <text fg={theme.textMuted} wrapMode="char">
            {command.resultText}
          </text>
        </box>
      </Show>
    </box>
  )
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [expanded, setExpanded] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)
  // Bounded slice first so huge reasoning dumps never split in full.
  const lines = createMemo(() => text.slice(0, 12_000).split("\n"))
  const expandable = () => text.length > 0
  const toggle = () => setExpanded((v) => !v)
  const preview = () => {
    const all = lines()
    return all.length > 12 ? [...all.slice(0, 12), `… (${all.length - 12} more lines)`] : all
  }
  // Stream the reasoning body live: auto-expand the moment a stream starts so
  // the reader watches the output unfold, and leave it up to them once it ends.
  createEffect(() => {
    if (streaming) setExpanded(true)
  })
  return (
    <box flexDirection="column" paddingLeft={2}>
      <box
        flexDirection="row"
        width="100%"
        onMouse={(evt) => {
          if (evt.type === "over") setHovered(true)
          else if (evt.type === "out") setHovered(false)
          else if (evt.type === "down" && evt.button === 0 && expandable()) toggle()
        }}
      >
        <ToolIcon
          glyph="✺"
          pngKey="think"
          expanded={expanded()}
          hovered={hovered()}
          expandable={expandable()}
        />
        <text fg={theme.textMuted} wrapMode="none" truncate>
          <Show when={!streaming}>
            <b> Think</b>
          </Show>
          <Show when={streaming}>
            <span> </span>
            <ShineSpans text="Think" />
          </Show>
        </text>
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
        width="100%"
        border={["left"]}
        borderColor={theme.borderSubtle}
        paddingLeft={1}
        onMouse={(evt) => {
          if (evt.type === "down" && evt.button === 0) toggle()
        }}
      >
        <text fg={theme.textMuted}>
          <span>{expanded() ? "▾" : "▸"} ▤</span>
          <b> 上下文注入</b>
          <span> · {inject.source}</span>
          <Show when={formLabel}>
            <span> · {formLabel}</span>
          </Show>
          <Show when={inject.form === "notice" && inject.summary}>
            <span> · {inject.summary}</span>
          </Show>
        </text>
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
  if (props.message.command) {
    return <CommandCard message={props.message} />
  }
  if (props.message.inject) {
    return <ContextInjectionBlock message={props.message} />
  }
  if (props.message.role === "user") {
    return (
      <box
        backgroundColor={theme.backgroundPanel}
        flexDirection="row"
        marginBottom={1}
        border={["left"]}
        borderColor={theme.primary}
        customBorderChars={ACCENT_BORDER}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexGrow={1}
          minWidth={0}
          flexDirection="column"
        >
          <Show when={props.message.images?.length}>
            <box
              flexDirection="row"
              flexWrap="wrap"
              gap={1}
              marginBottom={props.message.content ? 1 : 0}
            >
              <For each={props.message.images ?? []}>
                {(image) => <ImageThumb image={image} />}
              </For>
            </box>
          </Show>
          <Show when={props.message.content}>
            <text fg={theme.text} wrapMode="char">
              {props.message.content}
            </text>
          </Show>
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
