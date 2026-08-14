import fs from 'node:fs'
import path from 'node:path'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.npm-cache'])

export interface GrepMatch {
  file: string
  line: number
  text: string
}

function walk(root: string, maxFiles: number): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop() as string
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(path.join(dir, e.name))
      } else if (e.isFile()) {
        out.push(path.join(dir, e.name))
        if (out.length >= maxFiles) break
      }
    }
  }
  return out
}

/** Search file contents with a regex. Files limited to 1 MiB, first 2500 matches. */
export function grepFiles(pattern: string, base: string, include?: string): GrepMatch[] {
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  }
  const includeRe = include ? new RegExp(include.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`).replace(/\*/g, '.*')) : null
  const files = walk(base, 5000)
  const out: GrepMatch[] = []
  for (const file of files) {
    if (includeRe && !includeRe.test(path.basename(file))) continue
    let text: string
    try {
      const st = fs.statSync(file)
      if (st.size > 1_048_576) continue
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length && out.length < 2500; i++) {
      if (re.test(lines[i] as string)) {
        out.push({ file, line: i + 1, text: (lines[i] as string).slice(0, 300) })
      }
    }
  }
  return out
}
