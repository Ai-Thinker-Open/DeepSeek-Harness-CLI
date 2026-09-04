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

/** Append one debug line (parts joined by a space) to the debug log file. */
export function debug(...parts: unknown[]): void {
  if (!process.env.DSH_DEBUG) return
  try {
    appendFileSync(logPath(), parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ") + "\n")
  } catch {
    /* best effort — debug logging must never break the client */
  }
}
