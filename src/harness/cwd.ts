/**
 * Bridge Windows ↔ WSL path styles between the terminal client and the
 * harness when the two run on different sides of a WSL boundary.
 *
 * The client derives its workspace from the process that launched it, so a
 * native-Windows client sends `D:\Users\...` while a harness running inside
 * WSL (Linux) rejects that string: its `node:path.isAbsolute` uses POSIX
 * rules, which treat a drive-letter path as relative. The same mismatch
 * happens in reverse for a Windows harness reached from a WSL-launched
 * client.
 *
 * Translation uses the WSL automount convention (`D:\...` → `/mnt/d/...`).
 * It is applied only when the two sides disagree about path style; paths in
 * the same style are returned untouched.
 */

const WIN32_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/
const WSL_MOUNT_RE = /^\/mnt\/([A-Za-z])(?:\/|$)/

/** True for a Windows drive-absolute path (`C:\...`, `D:/...`). */
export function isWin32Absolute(path: string): boolean {
  return WIN32_ABSOLUTE_RE.test(path)
}

/** True for a POSIX-absolute path (starts with `/`). */
export function isPosixAbsolute(path: string): boolean {
  return path.startsWith("/")
}

/** `D:\Users\Seahi` → `/mnt/d/Users/Seahi` (WSL automount convention). */
export function win32ToWsl(path: string): string {
  const drive = path.charAt(0).toLowerCase()
  const rest = path.slice(2).replace(/\\/g, "/")
  return `/mnt/${drive}${rest}`
}

/** `/mnt/d/Users/Seahi` → `D:\Users\Seahi`. */
export function wslToWin32(path: string): string {
  const drive = path.charAt(5).toUpperCase()
  const rest = path.slice(7).replace(/^\//, "").replace(/\//g, "\\")
  return `${drive}:\\${rest}`
}

/**
 * Normalize a client-side workspace cwd to the harness's path style, using
 * the harness's own reported cwd as a platform probe.
 *
 * - client `D:\...` + harness `/...`: translate to `/mnt/d/...`;
 * - client `/mnt/d/...` + harness `D:\...`: translate to `D:\...`;
 * - same style (or an unknown harness cwd): return the cwd unchanged.
 */
export function harnessCwdFor(clientCwd: string, hostCwd: string | undefined): string {
  if (!hostCwd) return clientCwd
  if (isWin32Absolute(clientCwd) && isPosixAbsolute(hostCwd)) return win32ToWsl(clientCwd)
  if (isPosixAbsolute(clientCwd) && isWin32Absolute(hostCwd) && WSL_MOUNT_RE.test(clientCwd)) {
    return wslToWin32(clientCwd)
  }
  return clientCwd
}
