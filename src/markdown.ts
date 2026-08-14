/**
 * A compact markdown parser producing a block tree the Ink renderer can draw.
 * Supports: ATX headers, fenced code, blockquotes, ordered/unordered lists,
 * horizontal rules, paragraphs, and inline bold/italic/code/links/strike.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; url: string }

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; items: { marker: string; children: Block[] }[] }
  | { type: 'rule' }
  | { type: 'thematic' }

function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  const push = (t: Inline) => {
    const last = out[out.length - 1]
    if (t.type === 'text' && last && last.type === 'text') {
      last.text += t.text
    } else if (t.type !== 'text' || t.text) {
      out.push(t)
    }
  }
  const re = /(\*\*|__|\*|_|`|~~|\[[^\]]*\]\([^)]*\))/g
  let m: RegExpExecArray | null
  let lastIndex = 0
  while ((m = re.exec(src)) !== null) {
    const pre = src.slice(lastIndex, m.index)
    if (pre) push({ type: 'text', text: pre })
    const tok = m[0]
    if (tok === '**' || tok === '__') {
      const close = src.indexOf(tok, m.index + 2)
      if (close !== -1) {
        push({ type: 'bold', children: parseInline(src.slice(m.index + 2, close)) })
        lastIndex = close + 2
        re.lastIndex = lastIndex
        continue
      }
      push({ type: 'text', text: tok })
    } else if (tok === '*' || tok === '_') {
      const close = src.indexOf(tok, m.index + 1)
      if (close !== -1) {
        push({ type: 'italic', children: parseInline(src.slice(m.index + 1, close)) })
        lastIndex = close + 1
        re.lastIndex = lastIndex
        continue
      }
      push({ type: 'text', text: tok })
    } else if (tok === '~~') {
      const close = src.indexOf('~~', m.index + 2)
      if (close !== -1) {
        push({ type: 'strike', children: parseInline(src.slice(m.index + 2, close)) })
        lastIndex = close + 2
        re.lastIndex = lastIndex
        continue
      }
      push({ type: 'text', text: tok })
    } else if (tok.startsWith('`')) {
      const close = src.indexOf('`', m.index + 1)
      if (close !== -1) {
        push({ type: 'code', text: src.slice(m.index + 1, close) })
        lastIndex = close + 1
        re.lastIndex = lastIndex
        continue
      }
      push({ type: 'text', text: tok })
    } else if (tok.startsWith('[')) {
      const md = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(tok)
      if (md) {
        push({ type: 'link', text: md[1] as string, url: md[2] as string })
      } else {
        push({ type: 'text', text: tok })
      }
    } else {
      push({ type: 'text', text: tok })
    }
    lastIndex = m.index + tok.length
  }
  const rest = src.slice(lastIndex)
  if (rest) push({ type: 'text', text: rest })
  return out
}

const BLOCK_RE =
  /^```(\S*)\s*$|^(#{1,6})\s+(.*)$|^>\s?(.*)$|^(\s*)([-*+]|\d+[.)])\s+(.*)$|^(-{3,}|\*{3,}|_{3,})\s*$/

/** Parse a markdown string into blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  const pushBlock = (b: Block | null) => {
    if (b) blocks.push(b)
  }

  while (i < lines.length) {
    const line = lines[i] as string
    const m = BLOCK_RE.exec(line)

    if (m && m[1] !== undefined) {
      // fenced code
      const lang = m[1]
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i] as string)) {
        buf.push(lines[i] as string)
        i++
      }
      i++ // closing fence
      pushBlock({ type: 'code', lang, text: buf.join('\n') })
      continue
    }
    if (m && m[2]) {
      pushBlock({ type: 'heading', level: (m[2] as string).length, children: parseInline(m[3] as string) })
      i++
      continue
    }
    if (m && m[3] !== undefined) {
      // blockquote — gather consecutive quote lines
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i] as string)) {
        buf.push((lines[i] as string).replace(/^>\s?/, ''))
        i++
      }
      pushBlock({ type: 'quote', children: parseMarkdown(buf.join('\n')) })
      continue
    }
    if (m && m[5] !== undefined) {
      // list item
      const ordered = /^\d+[.)]/.test((m[5] as string))
      const items: { marker: string; children: Block[] }[] = []
      const listIndent = (m[4] as string).length
      while (i < lines.length) {
        const lm = BLOCK_RE.exec(lines[i] as string)
        if (lm && lm[5] !== undefined && (lm[4] as string).length === listIndent) {
          items.push({
            marker: (lm[5] as string).replace(/[.)]$/, '.'),
            children: parseMarkdown((lm[6] as string) || ''),
          })
          i++
          // continuation lines (indented)
          while (i < lines.length && /^\s+/.test(lines[i] as string) && !BLOCK_RE.test(lines[i] as string)) {
            items[items.length - 1]?.children.push({ type: 'paragraph', children: parseInline((lines[i] as string).trim()) })
            i++
          }
        } else break
      }
      pushBlock({ type: 'list', ordered, items })
      continue
    }
    if (m && m[7]) {
      pushBlock({ type: 'rule' })
      i++
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    // paragraph — gather until blank line or a block start
    const buf: string[] = []
    while (i < lines.length) {
      const cur = lines[i] as string
      if (!cur.trim() || BLOCK_RE.test(cur)) break
      buf.push(cur)
      i++
    }
    pushBlock({ type: 'paragraph', children: parseInline(buf.join(' ')) })
  }
  return blocks
}

/** Extract plain text (for summaries and the tool-result copy). */
export function markdownToText(src: string, max = 4000): string {
  const blocks = parseMarkdown(src)
  let out = ''
  const walk = (blocks: Block[]): void => {
    for (const b of blocks) {
      const inlineText = (inl: Inline[]): string =>
        inl
          .map((t) => {
            switch (t.type) {
              case 'text':
              case 'code':
                return t.text
              case 'bold':
              case 'italic':
              case 'strike':
                return inlineText(t.children)
              case 'link':
                return `${t.text} (${t.url})`
            }
          })
          .join('')
      switch (b.type) {
        case 'heading':
          out += `${'#'.repeat(b.level)} ${inlineText(b.children)}\n`
          break
        case 'paragraph':
          out += `${inlineText(b.children)}\n`
          break
        case 'code':
          out += `\`\`\`${b.lang}\n${b.text}\n\`\`\`\n`
          break
        case 'quote':
          out += '> '
          walk(b.children)
          break
        case 'list':
          for (const it of b.items) {
            out += `- `
            walk(it.children)
          }
          break
        case 'rule':
          out += '---\n'
          break
        case 'thematic':
          break
      }
      if (out.length > max) return
    }
  }
  walk(blocks)
  return out.slice(0, max)
}
