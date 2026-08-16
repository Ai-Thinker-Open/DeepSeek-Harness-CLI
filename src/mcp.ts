export type McpServerStatus = {
  name: string
  status: "connected" | "connecting" | "failed" | "disabled"
}

// Placeholder until the agent backend is wired in the next phase.
export function getMcpServers(): McpServerStatus[] {
  return []
}
