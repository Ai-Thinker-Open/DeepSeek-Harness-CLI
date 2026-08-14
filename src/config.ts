import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Where dskharness keeps config, sessions, skills. */
export function dshHome(): string {
  return process.env.DSH_CLI_HOME || path.join(os.homedir(), '.dskharness')
}

export interface CliConfig {
  apiKey: string
  baseUrl: string
  model: string
  temperature?: number
  /** Default auto-approve for dangerous tools in interactive mode. */
  autoApprove: boolean
  /** Extra model-facing instructions. */
  instructions?: string
  /** Working directory the agent operates in. */
  cwd: string
  /** MCP servers (stdio), keyed by name. Best-effort support. */
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
}

export const DEFAULT_MODEL = 'deepseek-chat'
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

export function defaultConfig(): CliConfig {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.DSH_CLI_API_KEY || '',
    baseUrl: process.env.DSH_CLI_BASE_URL || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.DSH_CLI_MODEL || DEFAULT_MODEL,
    autoApprove: process.env.DSH_CLI_AUTO_APPROVE === '1',
    cwd: process.cwd(),
    mcpServers: {},
  }
}

/** Load config.json if present, merged over defaults. */
export function loadConfig(): CliConfig {
  const cfg = defaultConfig()
  const p = path.join(dshHome(), 'config.json')
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<CliConfig>
    if (typeof raw.apiKey === 'string' && raw.apiKey) cfg.apiKey = raw.apiKey
    if (typeof raw.baseUrl === 'string' && raw.baseUrl) cfg.baseUrl = raw.baseUrl
    if (typeof raw.model === 'string' && raw.model) cfg.model = raw.model
    if (typeof raw.temperature === 'number') cfg.temperature = raw.temperature
    if (typeof raw.autoApprove === 'boolean') cfg.autoApprove = raw.autoApprove
    if (typeof raw.instructions === 'string') cfg.instructions = raw.instructions
    if (typeof raw.cwd === 'string' && raw.cwd) cfg.cwd = raw.cwd
    if (raw.mcpServers && typeof raw.mcpServers === 'object') cfg.mcpServers = raw.mcpServers
  } catch {
    // no config file — fine
  }
  return cfg
}

export function saveConfig(cfg: CliConfig): void {
  const dir = dshHome()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2) + '\n')
}

export function ensureDirs(): void {
  const home = dshHome()
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true })
  fs.mkdirSync(path.join(home, 'skills'), { recursive: true })
}
