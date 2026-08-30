import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA, SyntaxStyle } from "@opentui/core"
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid"
import type { CommandItem, CommandResultView } from "../commands"
import { filterCommands } from "../commands"
import {
  formatBytes,
  getHostClipboard,
  imageFromPathText,
  readClipboardImage,
  readImageFromPath,
  tryWindowsClipboard,
  type AttachedImage,
  type ClipboardReadLike,
} from "../images"
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageCommandImage,
  type ImageContentPart,
  type ImageLimits,
  type ImageMediaType,
  type PromptContentPart,
} from "../harness/client"
import { isDown, isEnter, isUp } from "./key-match"
import { modeLabel, type PermissionMode } from "../permission"
import { ACCENT_BORDER, theme } from "../theme"
import {
  buildPasteFoldInfo,
  displayWidth,
  shouldCollapsePaste,
  type PasteFoldInfo,
} from "../paste-fold"

const PROMPT_PLACEHOLDER = "给智能体发消息"
const MAX_MENU_ROWS = 10
const MAX_RESULT_ROWS = 12
const HISTORY_LIMIT = 100

/** A draft image whose visible form is a `[...]` tag inside the message text. */
interface DraftImage extends AttachedImage {
  id: string
  /** The exact `[图片名-序号.png]` tag inserted in the draft (round-trip key). */
  tag?: string
}

const IMAGE_EXT: Record<ImageMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/** File stem without the media extension (e.g. `Shot.png` → `Shot`). */
function imageStem(name: string | undefined, mediaType: ImageMediaType): string {
  const base = name || "图片"
  const ext = IMAGE_EXT[mediaType]
  return ext && base.toLowerCase().endsWith(`.${ext}`) ? base.slice(0, -(ext.length + 1)) : base
}

/**
 * Display tag for a draft image. Matches the reference naming: the first image
 * is `[名字.png]`, the second `[名字-1.png]`, etc. — the ordinal sits before
 * the extension, like Explorer's "copy" suffix. `order` is the 1-based attach
 * order (not the render index), so tags are stable across reorders.
 */
function imageTag(image: DraftImage, order: number): string {
  const stem = imageStem(image.name, image.mediaType)
  const copy = order > 1 ? `-${order - 1}` : ""
  return `[${stem}${copy}.${IMAGE_EXT[image.mediaType]}]`
}

/** All `[图片名-序号.ext]` tags in a draft, in appearance order. */
const IMAGE_TAG_RE = /\[[^\]\n]*?\.(?:png|jpe?g|webp|gif)\]/gi

function imageTagsIn(text: string): string[] {
  return text.match(IMAGE_TAG_RE) ?? []
}

/** Strip every image tag from a draft, returning the message text only. */
function stripImageTags(text: string): string {
  return text.replace(IMAGE_TAG_RE, "").trim()
}
const KEY_LOG = join(tmpdir(), "dsh-cli-keys.log")

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
  onSubmit?: (content: PromptContentPart[]) => void
  onCommand?: (line: string, images?: ImageCommandImage[]) => Promise<CommandResultView | null>
  /** Transient user feedback (toast) for clipboard/attach outcomes. */
  onNotice?: (text: string, kind?: "success" | "error") => void
  /** Harness image limits (defaults when unknown). */
  imageLimits?: () => ImageLimits
  /** Host clipboard reader; defaults to the lazy OpenTUI service. */
  clipboard?: ClipboardReadLike
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
  const [attachments, setAttachments] = createSignal<DraftImage[]>([])
  const [pastedFold, setPastedFold] = createSignal<PasteFoldInfo | null>(null)
  const mode = props.mode ?? (() => "workspace-write" as PermissionMode)
  const model = props.model ?? (() => "DeepSeek-V4-Flash")
  const limits = props.imageLimits ?? (() => DEFAULT_IMAGE_LIMITS)
  const active = props.active ?? (() => true)
  const terminal = useTerminalDimensions()
  let ref: TextareaRenderable | undefined
  /** Draft captured before ↑ started walking the history, restored on ↓ end. */
  let historyDraft = ""
  /** Draft captured before an interruption (question modal), restored after. */
  let savedDraft: string | null = null
  let restoreTimer: ReturnType<typeof setTimeout> | undefined
  let draftSeq = 0
  let visionWarned = false
  /** Syntax style used to color `[图片名-序号.ext]` tags inside the draft. */
  let imageStyle: SyntaxStyle | null = null
  /** Last bracketed-paste / Ctrl+V press timestamp (dedup for release signals). */
  let lastPasteEventAt = 0
  /** Last clipboard read triggered by the Ctrl+V key-release fallback. */
  let releaseReadAt = 0
  let releasePasteTimer: ReturnType<typeof setTimeout> | undefined

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
  let prevOverride = props.resultOverride?.()
  createEffect(() => {
    const next = props.resultOverride?.()
    if (next) {
      setResult(next)
      setResultScroll(0)
    } else if (prevOverride) {
      // The external panel was cleared (e.g. home → session transition):
      // drop the mirrored internal panel too, otherwise it lingers.
      setResult(null)
      setResultScroll(0)
    }
    prevOverride = next
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
    // Color the `[图片名-序号.ext]` tags inside the draft. OpenTUI exposes
    // this through a SyntaxStyle with persistent style ids; we clear and
    // re-add on every text change so tags stay highlighted as the user edits
    // around or between them.
    try {
      imageStyle = SyntaxStyle.fromStyles({
        // Text runs in the accent color with no background fill, so the tag
        // reads as plain colored text (`[剪贴板.png]`) rather than a chip.
        "image-tag": { fg: theme.primary },
      })
      ref?.editBuffer.setSyntaxStyle(imageStyle)
    } catch {
      imageStyle = null
    }
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
      // Keep tags highlighted as the user edits around/between them. This is
      // the trailing safety net; the composer also colors a tag instantly at
      // insertion so it never waits for the next poll tick.
      applyImageHighlights(text)
    }, 60)
    onCleanup(() => {
      clearInterval(timer)
      imageStyle?.destroy()
      imageStyle = null
    })
  })

  const setDraft = (text: string) => {
    ref?.setText(text)
    // Native cursor move: `cursorOffset` uses visual offsets and lands wrong
    // for CJK text; gotoBufferEnd puts the caret at the true end of the draft.
    ref?.gotoBufferEnd()
    setValue(text)
    setSelected(0)
  }

  const runCommandLine = async (line: string, images: AttachedImage[] = []) => {
    // Clear the draft and close the slash menu as soon as the command is
    // dispatched. If we waited for the harness round-trip, the menu would
    // stay open (single "/model" entry) and swallow arrow keys pressed while
    // the command panel is loading — the "arrows do nothing on the model
    // picker" symptom.
    setDraft("")
    // `/image` is a composer-local command: it attaches a draft image instead
    // of dispatching to the harness command registry.
    if (line.startsWith("/image")) {
      void handleImageCommand(line)
      return
    }
    if (!props.onCommand) return
    const commandImages: ImageCommandImage[] = images.map((img) => ({
      mediaType: img.mediaType,
      data: img.data,
      ...(img.name ? { name: img.name } : {}),
    }))
    const view = await props.onCommand(line, commandImages)
    if (view) {
      setResult(view)
      setResultScroll(0)
    }
  }

  /** Validate and append one acquired image to the draft attachment rail. */
  function addDraftImage(image: AttachedImage): boolean {
    const current = attachments()
    const limitsNow = limits()
    if (current.length >= limitsNow.maxImagesPerMessage) {
      props.onNotice?.(`一条消息最多附加 ${limitsNow.maxImagesPerMessage} 张图片`, "error")
      return false
    }
    const totalBytes = current.reduce((sum, a) => sum + a.bytes, 0) + image.bytes
    if (totalBytes > limitsNow.maxMessageImageBytes) {
      props.onNotice?.("图片总大小超过单条消息限制", "error")
      return false
    }
    const draft: DraftImage = { ...image, id: `img-${++draftSeq}` }
    const order = current.length + 1
    draft.tag = imageTag(draft, order)
    setAttachments([...current, draft])
    // The image lives as a `[图片名-序号.ext]` tag inside the draft text, so
    // it reads as part of the message being composed (see reference). It is
    // recovered back into a real image block on submit.
    const base = ref?.plainText ?? value()
    const sep = base && !/[\s]$/.test(base) ? " " : ""
    insertIntoDraft(sep + draft.tag)
    // Color the tag immediately — not on the next 60ms poll — so pasted
    // images appear highlighted in the frame where they insert.
    applyImageHighlights(ref?.plainText ?? value())
    if (!visionWarned && !/(?:vision|multimodal|omni|vl)/i.test(model())) {
      visionWarned = true
      props.onNotice?.("当前模型可能不支持图片，请切换到视觉模型（如 DeepSeek-V4-Flash-Vision-Exp）", "error")
    }
    return true
  }

  /** `/image <路径|clipboard>` — read a file (or the clipboard) into the draft. */
  async function handleImageCommand(line: string): Promise<void> {
    const arg = line.trim().slice("/image".length).trim()
    if (!arg) {
      setResult({ title: "图片", rows: ["用法：/image <路径|clipboard>"] })
      setResultScroll(0)
      return
    }
    if (/^clipboard$/i.test(arg)) {
      await pasteFromClipboard()
      return
    }
    const result = await readImageFromPath(arg, limits())
    if (result.ok) {
      if (addDraftImage(result)) {
        setResult({ title: "图片", rows: [`✓ 已添加：${result.name ?? "未命名"}（${formatBytes(result.bytes)}）`] })
      }
    } else {
      setResult({ title: "图片", rows: [`✕ ${result.message}`] })
    }
    setResultScroll(0)
  }

  /** Read the host clipboard as an image; fall back to text insertion. */
  async function pasteFromClipboard(): Promise<void> {
    const reader = props.clipboard ?? getHostClipboard()
    if (!reader) {
      // No native clipboard service (common under WSL2 without WSLg): the
      // Windows clipboard may still be reachable via PowerShell.
      const win = await tryWindowsClipboard(limits())
      if (win) {
        if (addDraftImage(win)) {
          props.onNotice?.(`✓ 已添加图片：${win.name ?? "未命名"}`, "success")
        }
        return
      }
      props.onNotice?.("当前环境不支持读取宿主剪贴板，可用 /image <路径> 添加图片", "error")
      return
    }
    // With the real host reader (no injected test seam), probe the Windows
    // clipboard first on WSL: a Windows screenshot lives in the *Windows*
    // clipboard, while the WSLg native clipboard may hold stale text from an
    // earlier copy. Mirrors MiMo Code's WSL ordering; the injected probe is
    // replaced in tests so they never spawn powershell.exe.
    const result = await readClipboardImage(
      reader,
      limits(),
      !props.clipboard ? { windowsProbe: () => tryWindowsClipboard(limits()) } : {},
    )
    if (result.status === "image") {
      if (addDraftImage(result.image)) {
        props.onNotice?.(`✓ 已添加图片：${result.image.name ?? "未命名"}`, "success")
      }
    } else if (result.status === "text") {
      insertPasteText(result.text)
    } else {
      props.onNotice?.(result.message, "error")
    }
  }

  /** Append text to the end of the draft (caret follows). */
  function insertIntoDraft(text: string): void {
    const base = ref?.plainText ?? value()
    setDraft(base + text)
  }

  /**
   * Color every `[图片名-序号.ext]` tag in the draft. OpenTUI maps highlight
   * offsets by terminal display width (CJK = 2 columns), so char indexes are
   * converted with `displayWidth`. Rebuilding from the current text keeps tags
   * aligned as the user edits.
   */
  function applyImageHighlights(text: string): void {
    if (!imageStyle || !ref?.editBuffer) return
    try {
      if (!ref.editBuffer.getSyntaxStyle()) ref.editBuffer.setSyntaxStyle(imageStyle)
      ref.editBuffer.clearAllHighlights()
      for (const m of text.matchAll(IMAGE_TAG_RE)) {
        const at = m.index ?? 0
        const start = displayWidth(text.slice(0, at))
        const end = displayWidth(text.slice(0, at + m[0].length))
        const styleId = imageStyle.getStyleId("image-tag")
        if (styleId === null) break
        ref.editBuffer.addHighlightByCharRange({ start, end, styleId })
      }
    } catch {
      /* non-fatal highlight refresh */
    }
  }

  /**
   * Insert pasted text, collapsing it into a fold bar when it is large
   * (Codex-style `[Pasted Content N chars]`). The full text stays in
   * `pastedFold` and is expanded on submit; the textarea keeps the draft
   * that was already there.
   */
  function insertPasteText(text: string): void {
    if (shouldCollapsePaste(text)) {
      setPastedFold(buildPasteFoldInfo(text))
      return
    }
    insertIntoDraft(text)
  }

  /** Materialize the folded paste into the textarea (Ctrl+E or click). */
  function expandPastedFold(): void {
    const fold = pastedFold()
    if (!fold) return
    const base = ref?.plainText ?? value()
    setDraft(base + fold.fullText)
    setPastedFold(null)
  }

  /**
   * Terminal paste events (bracketed paste). Windows Terminal intercepts
   * Ctrl+V and delivers it here instead of a keypress — this is the path
   * WSL2 users actually hit. Non-empty text pastes straight in (image file
   * paths attach); an empty paste means the clipboard holds no text — read
   * the host clipboard for a screenshot/image.
   */
  function handleTerminalPaste(bytes: Uint8Array): void {
    const text = new TextDecoder().decode(bytes)
    if (text.trim()) {
      // OpenTUI already inserted the pasted text into the focused editor, so
      // plain text needs no extra work here. Only intercept when the whole
      // paste is one image file path — replace the inserted text with an
      // attachment (Explorer-style file copies paste as a path) — or when
      // the paste is large enough to collapse into a fold bar.
      void (async () => {
        const fromPath = await imageFromPathText(text, limits())
        if (fromPath) {
          const current = ref?.plainText ?? value()
          if (current.endsWith(text)) ref?.setText(current.slice(0, current.length - text.length))
          else setDraft("")
          if (addDraftImage(fromPath)) {
            props.onNotice?.(`✓ 已添加图片：${fromPath.name ?? "未命名"}`, "success")
          }
          return
        }
        // Large multi-line text collapses into a fold bar instead of filling
        // the textarea. OpenTUI already inserted the paste, so strip it back
        // out first; only end-of-draft pastes fold cleanly (pasting into the
        // middle of existing text stays raw).
        if (shouldCollapsePaste(text)) {
          const current = ref?.plainText ?? value()
          if (current.endsWith(text)) {
            setDraft(current.slice(0, current.length - text.length))
            setPastedFold(buildPasteFoldInfo(text))
          }
          return
        }
      })()
      return
    }
    // No text representation (e.g. a screenshot copied on Windows): the
    // image lives in the host clipboard only.
    void pasteFromClipboard()
  }

  usePaste((event) => {
    if (!active()) return
    lastPasteEventAt = Date.now()
    // A real paste event supersedes any pending key-release fallback read.
    if (releasePasteTimer) {
      clearTimeout(releasePasteTimer)
      releasePasteTimer = undefined
    }
    handleTerminalPaste(event.bytes)
  })

  /**
   * Windows Terminal ≥1.25 with the kitty keyboard protocol enabled does not
   * emit the empty bracketed-paste sequence for an image-only clipboard — the
   * only signal is the Ctrl+V key release (`CSI 118;5;3u`). Watch for it as a
   * fallback trigger, deduped against the paste/press paths so a text paste
   * (which does emit a paste event) never double-inserts.
   */
  useKeyboard(
    (key) => {
      if (!active()) return
      if (key.eventType !== "release") return
      const isCtrlV = key.ctrl && (key.name === "v" || key.name === "ctrl-v")
      if (!isCtrlV) return
      if (Date.now() - lastPasteEventAt < 500) return
      if (releaseReadAt !== 0 && Date.now() - releaseReadAt < 400) return
      if (releasePasteTimer) clearTimeout(releasePasteTimer)
      releasePasteTimer = setTimeout(() => {
        releasePasteTimer = undefined
        // The bracketed-paste payload may still be in flight; if it lands
        // within the window, the usePaste handler cancels this via the
        // timestamp update above.
        if (Date.now() - lastPasteEventAt < 500) return
        releaseReadAt = Date.now()
        void pasteFromClipboard()
      }, 120)
    },
    { release: true },
  )

  const submitDraft = () => {
    // While a question modal is open the composer is deactivated: the
    // textarea still receives Enter through OpenTUI's key routing, but it
    // must neither send the draft nor clear it (the draft survives the
    // plan-review interruption).
    if (!active()) return
    const raw = ref?.plainText ?? value()
    const fold = pastedFold()
    const draftImages = attachments()
    // Recover the images from the `[图片名-序号.ext]` tags that live inside
    // the draft text. Tags use the per-image `tag` key so edits/reorders are
    // fine; a tag the user deleted simply drops its image.
    const tags = imageTagsIn(raw)
    const byTag = new Map<string, DraftImage>()
    for (const d of draftImages) if (d.tag) byTag.set(d.tag, d)
    const matched: DraftImage[] = []
    for (const t of tags) {
      const d = byTag.get(t)
      if (d) matched.push(d)
    }
    // The message text is the draft with every image tag stripped; the folded
    // paste is appended verbatim so pasted code/logs arrive byte-for-byte.
    const messageText = stripImageTags(raw) + (fold?.fullText ?? "")
    setDraft("")
    setAttachments([])
    setPastedFold(null)
    visionWarned = false
    if (!messageText && matched.length === 0) return
    setHistoryIndex(-1)
    // A draft that looks like a slash command only routes as a command when
    // there are no attachments: an absolute image path (e.g. `/tmp/x.png`)
    // also starts with `/` and must send as a normal message with the image.
    // A folded paste (possibly starting with `/`) is never a command either,
    // mirroring the attachment rule and avoiding Codex's long-paste-as-slash
    // bug (openai/codex#7093, #22616).
    if (messageText.startsWith("/") && matched.length === 0 && !fold) {
      void runCommandLine(messageText, matched)
      return
    }
    if (SEND_HISTORY[SEND_HISTORY.length - 1] !== messageText) {
      SEND_HISTORY.push(messageText)
      if (SEND_HISTORY.length > HISTORY_LIMIT) SEND_HISTORY.shift()
    }
    props.onSubmit?.([
      ...matched.map(
        (img): ImageContentPart => ({
          type: "image",
          mediaType: img.mediaType,
          data: img.data,
          ...(img.name ? { name: img.name } : {}),
        }),
      ),
      ...(messageText ? [{ type: "text" as const, text: messageText }] : []),
    ])
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
      appendFileSync(KEY_LOG, debugLine)
    } catch {
      // debug aid only; never fail on logging
    }
    // Folded paste shortcuts: Ctrl+E expands the fold into the textarea so
    // it can be edited; works in any panel state (the fold is inert).
    if (
      key.ctrl &&
      (key.name === "e" || key.name === "ctrl-e" || key.raw === "\x05") &&
      pastedFold() !== null
    ) {
      expandPastedFold()
      key.preventDefault()
      return
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
      // Plain draft: Ctrl+V pastes an image from the host clipboard (or text
      // when the clipboard holds no image); Backspace on an empty draft
      // removes the last attached image; ↑/↓ walk the sent-message history.
      // Esc while a paste is folded discards the fold (keeping typed text).
      if (key.name === "escape" && pastedFold() !== null) {
        setPastedFold(null)
        key.preventDefault()
        return
      }
      if (key.ctrl && (key.name === "v" || key.name === "ctrl-v" || key.raw === "\x16")) {
        lastPasteEventAt = Date.now()
        void pasteFromClipboard()
        key.preventDefault()
        return
      }
      // Alt+V: the terminal-independent paste shortcut. Windows Terminal
      // intercepts Ctrl+V at the emulator level (and newer kitty-mode builds
      // only hint at it via a key release), so Ctrl+V can leave the app with
      // no signal at all; Alt+V always reaches the app and reads the host
      // clipboard directly.
      if (
        (key.meta || key.option) &&
        (key.name === "v" || key.raw === "\x1bv" || key.raw === "\x1bV")
      ) {
        lastPasteEventAt = Date.now()
        void pasteFromClipboard()
        key.preventDefault()
        return
      }
      if (pastedFold() !== null) {
        // Folded state: arrow keys must not walk history and Backspace on an
        // empty textarea must not remove attachments or expand the fold —
        // expansion is explicit (Ctrl+E / click / Enter sends the whole
        // message). Backspace still edits non-empty visible text.
        if (isUp(key) || isDown(key)) {
          key.preventDefault()
          return
        }
        if (!(ref?.plainText ?? value()) && (key.name === "backspace" || key.name === "delete")) {
          key.preventDefault()
          return
        }
      }
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
        flexDirection="column"
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
          <Show when={pastedFold() !== null}>
            <box flexDirection="row" minWidth={0} marginTop={1}>
              <box
                flexDirection="row"
                border
                borderColor={theme.border}
                paddingLeft={1}
                paddingRight={1}
                onMouse={(evt) => {
                  // Click the fold bar to expand the pasted content.
                  if (evt.type === "down" && evt.button === 0) {
                    expandPastedFold()
                    evt.preventDefault()
                  }
                }}
              >
                <text fg={theme.text} wrapMode="none" truncate>
                  <span>📋 </span>
                  <span>{pastedFold()?.preview}</span>
                  <span style={{ fg: theme.textMuted }}>
                    {" "}[已折叠 {pastedFold()?.lineCount} 行 · {pastedFold()?.charCount} 字符 · Ctrl+E]
                  </span>
                </text>
              </box>
            </box>
          </Show>
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
