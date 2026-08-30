/**
 * Pure helpers for collapsing large pastes in the composer.
 *
 * Mirrors the Codex TUI behavior (LARGE_PASTE_CHAR_THRESHOLD = 1000 chars):
 * a paste that is "large" is kept out of the textarea and shown as a fold
 * bar with a first-line preview; the full text is expanded on submit and is
 * never visible as a placeholder in recalled history.
 */

export interface PasteFoldInfo {
  /** The complete pasted text, sent verbatim on submit. */
  fullText: string
  /** First-line preview shown on the fold bar (display-width truncated). */
  preview: string
  /** Number of lines (split on \r?\n). */
  lineCount: number
  /** Number of characters, counted as Unicode code points. */
  charCount: number
}

export const DEFAULT_COLLAPSE_MIN_LINES = 5
export const DEFAULT_COLLAPSE_MIN_CHARS = 1000
// Kept compact so the fold bar (preview + "已折叠 N 行 · M 字符" marker) fits
// inside an 80-column composer without OpenTUI's center-eliding truncation.
export const PREVIEW_MAX_WIDTH = 24

/** Terminal display width: CJK glyphs occupy two cells in a monospace font. */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1
  }
  return width
}

/** Number of lines; a trailing newline still counts its (empty) last line. */
export function countLines(text: string): number {
  return text.split(/\r?\n/).length
}

/**
 * Whether a paste should be collapsed: at least `minLines` lines OR at least
 * `minChars` characters, counted as Unicode code points like Codex's
 * `chars().count()`.
 */
export function shouldCollapsePaste(
  text: string,
  minLines = DEFAULT_COLLAPSE_MIN_LINES,
  minChars = DEFAULT_COLLAPSE_MIN_CHARS,
): boolean {
  if (!text) return false
  if (countLines(text) >= minLines) return true
  return Array.from(text).length >= minChars
}

/** First line truncated to a display width; CJK counts as two columns. */
function firstLinePreview(text: string, maxWidth = PREVIEW_MAX_WIDTH): string {
  const first = text.split(/\r?\n/)[0] ?? ""
  if (first === "") return "（空行）"
  let out = ""
  for (const ch of first) {
    if (displayWidth(out + ch) > maxWidth) return `${out}…`
    out += ch
  }
  return out
}

export function buildPasteFoldInfo(fullText: string): PasteFoldInfo {
  return {
    fullText,
    preview: firstLinePreview(fullText),
    lineCount: countLines(fullText),
    charCount: Array.from(fullText).length,
  }
}
