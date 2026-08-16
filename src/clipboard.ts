export type CopyResult = "empty" | "ok" | "unsupported"

export function copySelection(
  clipboard: { copyToClipboardOSC52(text: string): boolean },
  text: string,
): CopyResult {
  if (!text.trim()) return "empty"
  return clipboard.copyToClipboardOSC52(text) ? "ok" : "unsupported"
}
