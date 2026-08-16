import { createMemo, For, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { theme } from "../theme"

/**
 * Lightweight Markdown rendering for assistant messages.
 *
 * Handles the blocks and inline styles that matter in chat replies without
 * pulling in a tree-sitter / syntax-style dependency: headings, fenced code,
 * blockquotes, horizontal rules, bullet/numbered lists, pipe tables, and
 * inline bold/italic/code/strikethrough/links.
 */

export interface InlineSeg {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  fg?: RGBA
}

type MdBlock =
  | { kind: "text"; segs: InlineSeg[] }
  | { kind: "heading"; level: number; segs: InlineSeg[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; segs: InlineSeg[] }
  | { kind: "list"; marker: string; segs: InlineSeg[] }
  | { kind: "hr" }
  | { kind: "table"; rows: InlineSeg[][][] }

const INLINE_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\))/g
const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/

export function parseInline(text: string, base: Partial<InlineSeg> = {}): InlineSeg[] {
  const segs: InlineSeg[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) segs.push({ ...base, text: text.slice(last, idx) })
    const raw = m[0] as string
    if (raw.startsWith("**") && raw.endsWith("**")) {
      segs.push({ ...base, text: raw.slice(2, -2), bold: true })
    } else if (raw.startsWith("`") && raw.endsWith("`")) {
      segs.push({ ...base, text: raw.slice(1, -1), code: true })
    } else if (raw.startsWith("~~") && raw.endsWith("~~")) {
      segs.push({ ...base, text: raw.slice(2, -2), strike: true })
    } else if (raw.startsWith("*") && raw.endsWith("*")) {
      segs.push({ ...base, text: raw.slice(1, -1), italic: true })
    } else {
      const link = LINK_RE.exec(raw)
      if (link) {
        segs.push({ ...base, text: link[1] ?? "" })
        segs.push({ ...base, text: ` (${link[2] ?? ""})`, fg: theme.textMuted })
      } else {
        segs.push({ ...base, text: raw })
      }
    }
    last = idx + raw.length
  }
  if (last < text.length) segs.push({ ...base, text: text.slice(last) })
  return segs
}

function plainOf(segs: InlineSeg[]): string {
  return segs.map((s) => s.text).join("")
}

function parseTable(lines: string[]): MdBlock {
  const rows: InlineSeg[][][] = []
  for (const line of lines) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim())
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    rows.push(cells.map((cell) => parseInline(cell)))
  }
  return { kind: "table", rows }
}

export function parseBlocks(text: string): MdBlock[] {
  const rawLines = text.split("\n")
  const blocks: MdBlock[] = []
  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i] as string
    const fence = /^\s*(```|~~~)\s*[\w+-]*\s*$/.exec(line)
    if (fence) {
      const closer = fence[1] as string
      const code: string[] = []
      i++
      while (i < rawLines.length && !new RegExp(`^\\s*${closer}`).test(rawLines[i] as string)) {
        code.push(rawLines[i] as string)
        i++
      }
      i++ // skip the closing fence
      blocks.push({ kind: "code", text: code.join("\n") })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: "heading", level: (heading[1] as string).length, segs: parseInline(heading[2] as string) })
      i++
      continue
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ kind: "hr" })
      i++
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      blocks.push({ kind: "quote", segs: parseInline(line.replace(/^\s*>\s?/, "")) })
      i++
      continue
    }
    const list = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (list) {
      blocks.push({ kind: "list", marker: list[2] as string, segs: parseInline(list[3] as string) })
      i++
      continue
    }
    if (line.trim().startsWith("|") && line.includes("|")) {
      const tableLines: string[] = []
      while (i < rawLines.length && (rawLines[i] as string).trim().startsWith("|")) {
        tableLines.push(rawLines[i] as string)
        i++
      }
      blocks.push(parseTable(tableLines))
      continue
    }
    blocks.push({ kind: "text", segs: parseInline(line) })
    i++
  }
  return blocks
}

function Segs({ segs, base }: { segs: InlineSeg[]; base?: Partial<InlineSeg> }) {
  return (
    <>
      {segs.map((seg) => {
        const merged: InlineSeg = { ...base, ...seg }
        return (
          <span
            style={{
              fg: merged.fg,
              bg: merged.code ? theme.backgroundElement : undefined,
              bold: merged.bold,
              italic: merged.italic,
              strikethrough: merged.strike,
            }}
          >
            {merged.text}
          </span>
        )
      })}
    </>
  )
}

function HeadingBlock({ level, segs }: { level: number; segs: InlineSeg[] }) {
  const fg = level === 1 ? theme.primary : level === 2 ? theme.accent : theme.text
  return (
    <box marginBottom={1}>
      <text wrapMode="char">
        <span style={{ fg, bold: true }}>
          <Segs segs={segs} />
        </span>
      </text>
    </box>
  )
}

function CodeBlock({ text }: { text: string }) {
  const lines = createMemo(() => text.split("\n"))
  return (
    <box
      flexDirection="column"
      backgroundColor={theme.backgroundElement}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      marginBottom={1}
    >
      <For each={lines()}>
        {(line) => (
          <text fg={theme.textMuted} wrapMode="char">
            {line}
          </text>
        )}
      </For>
    </box>
  )
}

function TableBlock({ rows }: { rows: InlineSeg[][][] }) {
  if (rows.length === 0) return null
  const colCount = Math.max(...rows.map((r) => r.length))
  const widths = Array.from({ length: colCount }, (_, c) =>
    Math.max(...rows.map((r) => (r[c] ? plainOf(r[c] as InlineSeg[]).length : 0))),
  )
  const renderRow = (row: InlineSeg[][], header: boolean) => (
    <box flexDirection="row">
      {row.map((cell, c) => (
        <text wrapMode="char">
          <span style={{ fg: theme.text, bold: header }}>{plainOf(cell)}</span>
          <span style={{ fg: theme.textMuted }}>{" ".repeat(Math.max(0, (widths[c] ?? 0) - plainOf(cell).length))}</span>
          <Show when={c < row.length - 1}>
            <span style={{ fg: theme.borderSubtle }}> │ </span>
          </Show>
        </text>
      ))}
    </box>
  )
  return (
    <box flexDirection="column" marginBottom={1}>
      {renderRow(rows[0] as InlineSeg[][], true)}
      <text fg={theme.borderSubtle}>
        {widths.map((w, c) => (c > 0 ? `─┼${"─".repeat(w)}` : "─".repeat(w))).join("")}
      </text>
      <For each={rows.slice(1)}>{(row) => renderRow(row as InlineSeg[][], false)}</For>
    </box>
  )
}

function BlockView({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "heading":
      return <HeadingBlock level={block.level} segs={block.segs} />
    case "code":
      return <CodeBlock text={block.text} />
    case "quote":
      return (
        <text fg={theme.textMuted} wrapMode="char">
          │ <Segs segs={block.segs} />
        </text>
      )
    case "list":
      return (
        <text wrapMode="char">
          <span style={{ fg: theme.primary, bold: true }}>{block.marker}</span> <Segs segs={block.segs} />
        </text>
      )
    case "hr":
      return <text fg={theme.borderSubtle}>{"─".repeat(40)}</text>
    case "table":
      return <TableBlock rows={block.rows} />
    case "text":
      return (
        <text wrapMode="char">
          <Segs segs={block.segs} />
        </text>
      )
  }
}

export function MarkdownText(props: { text: string }) {
  const blocks = createMemo(() => parseBlocks(props.text))
  return (
    <box flexDirection="column">
      <For each={blocks()}>{(block) => <BlockView block={block} />}</For>
    </box>
  )
}
