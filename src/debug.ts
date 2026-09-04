/**
 * dsh-cli debug logging.
 *
 * Every `[dsh-cli]`/`[dsh]` debug line goes through {@link debug} and is written
 * to a LOG FILE — never to stderr. The OpenTUI terminal client owns the
 * terminal, so debug lines written to stderr interleave with the renderer and
 * corrupt the screen (leftover fragments like `cookie=yes` and `POST
 * /api/session/...` in the conversation view are the symptom).
 *
 * Log path:
 *   - `$DSH_DEBUG_LOG` if set, otherwise
 *   - `$TMPDIR/dsh-cli-debug-<pid>.log` (one file per process).
 *
 * `DSH_DEBUG` (any truthy value) enables it. Output is best-effort and never
 * throws.
 */
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let resolved: string | null = null

function logPath(): string {
  if (resolved) return resolved
  resolved = process.env.DSH_DEBUG_LOG || join(tmpdir(), `dsh-cli-debug-${process.pid}.log`)
  return resolved
}

/**
 * Whether debug logging is enabled.
 *
 * Treats a set DSH_DEBUG as enabled unless it is an explicit off value, so
 * `DSH_DEBUG=0` (a common "disable" gesture) does not silently turn logging on.
 */
export function isDebugEnabled(): boolean {
  const v = process.env.DSH_DEBUG
  if (!v) return false
  const s = v.trim().toLowerCase()
  return s !== "0" && s !== "false" && s !== "no" && s !== "off"
}

/** Append one debug line (parts joined by a space) to the debug log file. */
export function debug(...parts: unknown[]): void {
  if (!isDebugEnabled()) return
  try {
    // `mode: 0o600` so the log (which can carry auth cookies and session/tool
    // content) is not readable by other users on a shared machine.
    appendFileSync(logPath(), parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ") + "\n", { mode: 0o600 })
  } catch {
    /* best effort — debug logging must never break the client */
  }
}
