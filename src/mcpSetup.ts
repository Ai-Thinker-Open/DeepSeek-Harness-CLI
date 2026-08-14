import type { CliConfig } from './config.ts'
import { McpClient } from './mcp.ts'
import type { ToolDef } from './tools/types.ts'

/** Start configured MCP stdio servers and collect their tools. */
export async function setupMcp(
  config: CliConfig,
): Promise<{ defs: ToolDef[]; close: () => void }> {
  const entries = Object.entries(config.mcpServers ?? {})
  const clients = entries.map(([name, cfg]) => new McpClient(name, cfg))
  const defs: ToolDef[] = []
  for (const c of clients) {
    try {
      await c.start()
      defs.push(...c.toToolDefs())
      console.error(`  🧩 MCP server "${c.serverName}" connected`)
    } catch (e) {
      console.error(`  ⚠ MCP server "${c.serverName}" failed to start: ${(e as Error).message}`)
    }
  }
  return { defs, close: () => clients.forEach((c) => c.close()) }
}
