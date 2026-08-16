export type PermissionMode = "read-only" | "workspace-write" | "full-access"

export const PERMISSION_MODES: ReadonlyArray<{ id: PermissionMode; label: string }> = [
  { id: "read-only", label: "Read only" },
  { id: "workspace-write", label: "Workspace write" },
  { id: "full-access", label: "Full access" },
]

export function nextMode(mode: PermissionMode, reverse = false): PermissionMode {
  const count = PERMISSION_MODES.length
  const index = PERMISSION_MODES.findIndex((item) => item.id === mode)
  const offset = reverse ? count - 1 : 1
  return PERMISSION_MODES[(index + offset) % count]!.id
}

export function modeLabel(mode: PermissionMode): string {
  return PERMISSION_MODES.find((item) => item.id === mode)?.label ?? mode
}
