import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type McpServerStatus = {
  name: string
  status: "connected" | "connecting" | "failed" | "disabled"
  url?: string
}

/** One `@deepseek-ai/dsh-mcp-client` row declared in the tui profile. */
export interface McpServerConfig {
  serverName: string
  url?: string
  command?: string
  args?: string[]
}

/** One tool exposed by a configured MCP server (MCP `tools/list`). */
export interface McpToolEntry {
  server: string
  name: string
  description?: string
}

const PROFILE = "tui"
const PROBE_TIMEOUT_MS = 1500
const TOOL_CACHE_TTL_MS = 60_000

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh")
}

function profileDir(): string {
  return join(dshHome(), "profiles", PROFILE)
}

/** Locate `@deepseek-ai/dsh-mcp-client` rows inside one profile patch file. */
export function parseMcpServers(text: string): McpServerConfig[] {
  const servers: McpServerConfig[] = []
  let current: Partial<McpServerConfig> | undefined
  let inArgs = false
  const flush = () => {
    if (current?.serverName) {
      servers.push({
        serverName: current.serverName,
        ...(current.url !== undefined ? { url: current.url } : {}),
        ...(current.command !== undefined ? { command: current.command } : {}),
        ...(current.args && current.args.length > 0 ? { args: current.args } : {}),
      })
    }
    current = undefined
    inArgs = false
  }
  for (const line of text.split("\n")) {
    // A new `- insert:` / `- id:` row closes the previous one.
    if (/^\s*- (insert|id):/.test(line)) {
      flush()
      continue
    }
    if (!current) {
      if (/name:\s*['"]?@deepseek-ai\/dsh-mcp-client['"]?/.test(line)) current = {}
      continue
    }
    const nameMatch = /serverName:\s*(\S+)/.exec(line)
    if (nameMatch) {
      current.serverName = nameMatch[1]
      continue
    }
    const urlMatch = /url:\s*(\S+)/.exec(line)
    if (urlMatch) {
      current.url = urlMatch[1]
      continue
    }
    const cmdMatch = /command:\s*(.+)/.exec(line)
    if (cmdMatch) {
      current.command = (cmdMatch[1] ?? "").trim().replace(/^['"]|['"]$/g, "")
      continue
    }
    if (/^\s*args:/.test(line)) {
      inArgs = true
      continue
    }
    const argsMatch = /^\s*-\s+(.+)$/.exec(line)
    if (argsMatch && inArgs) {
      current.args = [...(current.args ?? []), (argsMatch[1] ?? "").trim().replace(/^['"]|['"]$/g, "")]
    }
  }
  flush()
  return servers
}

/** Read every MCP server configured in the tui profile patches. */
export function configuredMcpServers(): McpServerConfig[] {
  const dir = profileDir()
  if (!existsSync(dir)) return []
  const servers: McpServerConfig[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".patch.yml") && file !== "cordis.patch.yml") continue
    try {
      servers.push(...parseMcpServers(readFileSync(join(dir, file), "utf8")))
    } catch {
      // A malformed patch file is not worth failing startup over.
    }
  }
  return servers
}

/** Bounded reachability probe for an SSE/HTTP MCP server. */
async function probeServer(url: string): Promise<"connected" | "failed"> {
  try {
    const res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) return "failed"
    // Drain one chunk so a server that accepts but never speaks counts down.
    if (res.body) {
      const reader = res.body.getReader()
      await reader.read().catch(() => undefined)
      reader.releaseLock()
    }
    return "connected"
  } catch {
    return "failed"
  }
}

/** Current status of every configured MCP server. */
export async function refreshMcpStatus(): Promise<McpServerStatus[]> {
  const servers = configuredMcpServers()
  return Promise.all(
    servers.map(async (s) => ({
      name: s.serverName,
      status: s.url ? await probeServer(s.url) : ("disabled" as const),
      ...(s.url ? { url: s.url } : {}),
    })),
  )
}

/** Parse the SSE `endpoint` event a legacy MCP SSE server sends on connect. */
async function readSseEndpoint(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal })
  if (!res.ok || !res.body) throw new Error(`MCP SSE ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (const block of buffer.split("\n\n")) {
      let event = "message"
      let data = ""
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) data = line.slice(5).trim()
      }
      if (event === "endpoint" && data) return data
    }
  }
  throw new Error("MCP SSE endpoint not received")
}

/** One JSON-RPC round-trip against the MCP messages endpoint. */
async function mcpRpc<T>(
  endpoint: string,
  method: string,
  params: unknown,
  id: number | null,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
    signal,
  })
  // JSON-RPC notifications carry no id and get no response: spec-compliant
  // MCP servers answer with an empty 202 body. Treat any 2xx as success
  // instead of trying to JSON.parse an empty body.
  if (id === null) {
    if (!res.ok) throw new Error(`${method} failed with HTTP ${res.status}`)
    return undefined as T
  }
  const text = await res.text()
  const dataLines = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
  const body = dataLines.length > 0 ? (dataLines[dataLines.length - 1] ?? text) : text
  const json = JSON.parse(body) as { error?: { message?: string }; result?: T }
  if (json.error) throw new Error(json.error.message ?? method)
  return json.result as T
}

interface McpToolSchema {
  name: string
  description?: string
}

interface McpToolsResult {
  tools?: McpToolSchema[]
}

/** Discover one server's tool list via the MCP SSE protocol. */
export async function listServerTools(config: McpServerConfig, signal?: AbortSignal): Promise<McpToolEntry[]> {
  if (!config.url) return []
  const timeout = signal ?? AbortSignal.timeout(5000)
  const endpointPath = await readSseEndpoint(config.url, timeout)
  const endpoint = new URL(endpointPath, config.url).href
  await mcpRpc<{ protocolVersion?: string }>(
    endpoint,
    "initialize",
    { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "dsh-cli", version: "0.2.15" } },
    1,
    timeout,
  )
  await mcpRpc(endpoint, "notifications/initialized", {}, null, timeout)
  const result = await mcpRpc<McpToolsResult>(endpoint, "tools/list", {}, 2, timeout)
  return (result.tools ?? []).map((t) => ({ server: config.serverName, name: t.name, description: t.description }))
}

const toolCache = new Map<string, { at: number; tools: McpToolEntry[] }>()

/** All configured MCP servers' tools, cached for a short TTL. */
export async function listMcpTools(): Promise<McpToolEntry[]> {
  const servers = configuredMcpServers()
  const out: McpToolEntry[] = []
  for (const server of servers) {
    const cached = toolCache.get(server.serverName)
    if (cached && Date.now() - cached.at < TOOL_CACHE_TTL_MS) {
      out.push(...cached.tools)
      continue
    }
    const tools = await listServerTools(server).catch(() => [])
    toolCache.set(server.serverName, { at: Date.now(), tools })
    out.push(...tools)
  }
  return out
}
