import fs from 'node:fs'
import path from 'node:path'
import { dshHome } from '../config.ts'
import type { ToolDef } from './types.ts'

export interface Skill {
  name: string
  description: string
  body: string
}

/** Load skills from ~/.dskharness/skills/<name>/SKILL.md (front-matter: name, description). */
export function loadSkill(name: string): Skill | null {
  const p = path.join(dshHome(), 'skills', name, 'SKILL.md')
  try {
    const raw = fs.readFileSync(p, 'utf8')
    return parseSkill(name, raw)
  } catch {
    return null
  }
}

export function listSkills(): Skill[] {
  const dir = path.join(dshHome(), 'skills')
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: Skill[] = []
  for (const e of entries) {
    const p = path.join(dir, e, 'SKILL.md')
    if (fs.existsSync(p)) {
      try {
        const s = parseSkill(e, fs.readFileSync(p, 'utf8'))
        out.push(s)
      } catch {
        /* skip malformed skill */
      }
    }
  }
  return out
}

function parseSkill(name: string, raw: string): Skill {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (!m) return { name, description: '', body: raw }
  const front = m[1] as string
  const body = (m[2] ?? '').trim()
  const descM = /description:\s*(.+)/.exec(front)
  return { name, description: descM ? (descM[1] as string).trim() : '', body }
}

export const skillListTool: ToolDef = {
  name: 'skill_list',
  description: 'List available skills (instructions you can load for specific kinds of work).',
  parameters: { type: 'object', properties: {} },
  permission: 'auto',
  planSafe: true,
  summary: () => 'skill_list',
  async execute() {
    const skills = listSkills()
    if (!skills.length) return 'No skills installed. Add them under ~/.dskharness/skills/<name>/SKILL.md'
    return skills.map((s) => `${s.name}: ${s.description}`).join('\n')
  },
}

export const skillLoadTool: ToolDef = {
  name: 'skill_load',
  description: 'Load the full instructions of a skill by name (see skill_list).',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `skill_load ${a.name}`,
  async execute(args) {
    const s = loadSkill(String(args.name ?? ''))
    if (!s) return `No skill named "${args.name}". Use skill_list to see available skills.`
    return s.body
  },
}
