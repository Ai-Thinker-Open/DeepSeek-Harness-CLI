import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, parse, resolve } from "node:path"

/**
 * The workspace the client was launched with, before any Windows↔WSL
 * translation. This is the path the user recognizes and the one the risk
 * confirmation should talk about.
 */
export function effectiveWorkspace(): string {
  return process.env.DSH_CWD ?? process.cwd()
}

/**
 * True when the directory is the user's home directory or a filesystem root
 * (`/` on POSIX, `C:\` on Windows). These grant access to personal files or
 * the whole machine, so they deserve the red high-risk warning. `home` is
 * injectable for tests.
 */
export function isHighRiskDirectory(dir: string, home: string = homedir()): boolean {
  const resolved = resolve(dir)
  return (
    // Windows drive root (`C:\` / `C:/`); checked on the raw input so it also
    // holds when the resolver runs on a POSIX host.
    /^[A-Za-z]:[\\/]$/.test(dir) ||
    resolved === parse(resolved).root ||
    resolved === resolve(home)
  )
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh")
}

/**
 * True when the risk confirmation was already accepted once for this
 * directory (a line in `<dshHome>/confirmed-workspaces`). High-risk
 * directories are never recorded: home/root warn on every launch.
 */
export function workspaceConfirmed(dir: string): boolean {
  try {
    const file = join(dshHome(), "confirmed-workspaces")
    if (!existsSync(file)) return false
    const wanted = resolve(dir)
    return readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .some((line) => resolve(line) === wanted)
  } catch {
    return false
  }
}

/** Record that the confirmation was accepted for `dir` (best-effort). */
export function markWorkspaceConfirmed(dir: string): void {
  try {
    // Home/root are never recorded: they warn on every launch.
    if (isHighRiskDirectory(dir)) return
    if (workspaceConfirmed(dir)) return
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const file = join(home, "confirmed-workspaces")
    const entry = `${resolve(dir)}\n`
    if (!existsSync(file)) {
      writeFileSync(file, `# Directories where the startup risk confirmation was accepted.\n${entry}`)
    } else {
      appendFileSync(file, entry)
    }
  } catch {
    // Best-effort: a failed write only means the prompt shows again next time.
  }
}
