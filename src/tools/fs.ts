import fs from 'node:fs'
import path from 'node:path'
import type { ToolDef } from './types.ts'

const MAX_READ_CHARS = 40_000

function resolvePath(cwd: string, p: string): string {
  return path.resolve(cwd, p)
}

function truncate(text: string, max = MAX_READ_CHARS): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n… [truncated ${text.length - max} chars]`
}

export const fsRead: ToolDef = {
  name: 'fs_read',
  description:
    'Read a text file. Returns content with line numbers, starting at `offset` (1-based) for `limit` lines. Use for files whose content you need verbatim.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root (or absolute).' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: 'Max lines to return. Defaults to 2000.' },
    },
    required: ['path'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `read ${a.path}`,
  async execute(args, ctx) {
    const p = resolvePath(ctx.cwd, args.path as string)
    const stat = fs.statSync(p)
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(p).slice(0, 100)
      return `Directory listing (${entries.length} shown):\n${entries.join('\n')}`
    }
    const raw = fs.readFileSync(p, 'utf8')
    const lines = raw.split('\n')
    const offset = Math.max(1, (args.offset as number) ?? 1)
    const limit = (args.limit as number) ?? 2000
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    const numbered = slice.map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join('\n')
    const total = lines.length
    const notice =
      offset + limit - 1 < total ? `\n… (${total - (offset + limit - 1)} more lines; use offset=${offset + limit})` : ''
    return truncate(numbered + notice)
  },
}

export const fsWrite: ToolDef = {
  name: 'fs_write',
  description: 'Create a file with the given content, overwriting it if it exists. Creates parent directories.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root (or absolute).' },
      content: { type: 'string', description: 'Full file content.' },
    },
    required: ['path', 'content'],
  },
  permission: 'ask',
  planSafe: false,
  summary: (a) => `write ${a.path}`,
  async execute(args, ctx) {
    const p = resolvePath(ctx.cwd, args.path as string)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, String(args.content ?? ''))
    return `Wrote ${p} (${Buffer.byteLength(String(args.content ?? ''), 'utf8')} bytes)`
  },
}

export const fsEdit: ToolDef = {
  name: 'fs_edit',
  description:
    'Edit a file by replacing literal text. old_string must appear exactly once unless replace_all is true. Prefer read first, then edit.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root (or absolute).' },
      old_string: { type: 'string', description: 'Literal text to replace.' },
      new_string: { type: 'string', description: 'Replacement text (may be empty to delete).' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence. Defaults to false.' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  permission: 'ask',
  planSafe: false,
  summary: (a) => `edit ${a.path}`,
  async execute(args, ctx) {
    const p = resolvePath(ctx.cwd, args.path as string)
    const raw = fs.readFileSync(p, 'utf8')
    const oldS = String(args.old_string ?? '')
    const newS = String(args.new_string ?? '')
    let count = 0
    let out: string
    if (args.replace_all) {
      out = raw.split(oldS).join(newS)
      count = raw.split(oldS).length - 1
    } else {
      const idx = raw.indexOf(oldS)
      if (idx === -1) throw new Error(`old_string not found in ${p}`)
      const idx2 = raw.indexOf(oldS, idx + 1)
      if (idx2 !== -1) throw new Error(`old_string appears multiple times (${countCheck(raw, oldS)}); use replace_all or a longer old_string`)
      out = raw.slice(0, idx) + newS + raw.slice(idx + oldS.length)
      count = 1
    }
    if (count === 0) throw new Error(`old_string not found in ${p}`)
    fs.writeFileSync(p, out)
    return `Edited ${p}: ${count} replacement(s)`
  },
}

function countCheck(text: string, needle: string): number {
  let n = 0
  let i = 0
  while ((i = text.indexOf(needle, i)) !== -1) {
    n++
    i += needle.length
  }
  return n
}

export const fsLs: ToolDef = {
  name: 'fs_ls',
  description: 'List a directory. Shows files and directories with sizes and modification times.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Directory path. Defaults to the workspace root.' } },
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `ls ${(a.path as string) || '.'}`,
  async execute(args, ctx) {
    const p = resolvePath(ctx.cwd, (args.path as string) || '.')
    const entries = fs.readdirSync(p, { withFileTypes: true })
    const rows = entries
      .map((e) => {
        const full = path.join(p, e.name)
        let size = ''
        let mtime = ''
        try {
          const st = fs.statSync(full)
          size = st.isDirectory() ? '<dir>' : humanSize(st.size)
          mtime = st.mtime.toISOString().slice(0, 19).replace('T', ' ')
        } catch {
          /* noop */
        }
        return `${e.isDirectory() ? 'd' : '-'}  ${size.padStart(8)}  ${mtime}  ${e.name}`
      })
      .sort()
    return rows.join('\n')
  },
}

export const fsGlob: ToolDef = {
  name: 'fs_glob',
  description:
    'Find files by glob pattern (e.g. "**/*.ts"). A pattern with no "/" matches basenames at any depth. Returns up to 100 paths in modification-time order.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern.' },
      path: { type: 'string', description: 'Directory to search in. Defaults to the workspace root.' },
    },
    required: ['pattern'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `glob ${a.pattern}`,
  async execute(args, ctx) {
    const { glob } = await import('./glob.ts')
    const base = resolvePath(ctx.cwd, (args.path as string) || '.')
    const results = await glob(String(args.pattern), base)
    return results.length ? results.join('\n') : `No files match ${args.pattern}`
  },
}

export const fsGrep: ToolDef = {
  name: 'fs_grep',
  description:
    'Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file (first 250 matches).',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression (ripgrep syntax).' },
      path: { type: 'string', description: 'File or directory to search. Defaults to the workspace root.' },
      include: { type: 'string', description: 'One glob filter for which files to search (e.g. "*.ts").' },
    },
    required: ['pattern'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `grep ${a.pattern}`,
  async execute(args, ctx) {
    const { grepFiles } = await import('./grep.ts')
    const base = resolvePath(ctx.cwd, (args.path as string) || '.')
    const results = grepFiles(String(args.pattern), base, (args.include as string | undefined) || undefined)
    if (!results.length) return `No matches for ${args.pattern}`
    return results
      .slice(0, 250)
      .map((r) => `${r.file}:${r.line}: ${r.text}`)
      .join('\n')
  },
}

export const fsDelete: ToolDef = {
  name: 'fs_delete',
  description: 'Delete a file or empty directory. Use with care.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Path to delete.' } },
    required: ['path'],
  },
  permission: 'ask',
  planSafe: false,
  summary: (a) => `delete ${a.path}`,
  async execute(args, ctx) {
    const p = resolvePath(ctx.cwd, args.path as string)
    fs.rmSync(p, { recursive: true })
    return `Deleted ${p}`
  },
}

function humanSize(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`
  return `${(n / 1024 / 1024).toFixed(1)}M`
}
