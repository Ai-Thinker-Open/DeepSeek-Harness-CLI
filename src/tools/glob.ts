import fs from 'node:fs'
import path from 'node:path'

const SKIP = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '.cache'])

/** Convert a glob pattern to a RegExp. `**` crosses directories. */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i)
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++
        // skip a following '/'
        if (pattern[i + 1] === '/') i++
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += '\\' + ch
    } else {
      out += ch
    }
  }
  return new RegExp(`^${out}$`)
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

/** Find files matching a glob pattern under `base`. Results in mtime order, capped at 100. */
export async function glob(pattern: string, base: string): Promise<string[]> {
  const absPattern = path.isAbsolute(pattern) ? pattern : path.join(base, pattern)
  const re = globToRegExp(absPattern)
  const files = walk(base, 2000)
  const matches = files.filter((f) => re.test(f))
  matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return matches.slice(0, 100)
}
