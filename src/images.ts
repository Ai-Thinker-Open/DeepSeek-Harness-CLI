/**
 * Image acquisition helpers for the composer: path reads (with Windows↔WSL
 * path translation) and host-clipboard reads (with a WSL PowerShell fallback).
 *
 * The harness wire expects canonical base64 (`Buffer.from(bytes, "base64")
 * re-encodes to the same string`) and one of png/jpeg/webp/gif — every path
 * here validates bytes with magic numbers before encoding, so a mismatched
 * extension can never reach the harness as a false declaration.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { createHostClipboard, type ClipboardReadResult, type HostClipboardService } from "@opentui/core"
import { isPosixAbsolute, isWin32Absolute, win32ToWsl, wslToWin32 } from "./harness/cwd"
import type { ImageLimits, ImageMediaType } from "./harness/client"

const execFileAsync = promisify(execFile)

/** A clipboard reader shaped like OpenTUI's host service (test seam). */
export interface ClipboardReadLike {
  read(options: { preferredTypes: readonly [string, ...string[]]; signal?: AbortSignal }): Promise<ClipboardReadResult>
}

/** A validated image ready to be attached to the composer. */
export interface AttachedImage {
  mediaType: ImageMediaType
  /** Canonical base64 (no `data:` prefix). */
  data: string
  bytes: number
  name?: string
}

export type ImageAcquireResult =
  | ({ ok: true } & AttachedImage)
  | { ok: false; message: string }

export type ClipboardImageOutcome =
  | { status: "image"; image: AttachedImage }
  | { status: "text"; text: string }
  | { status: "empty"; message: string }
  | { status: "unsupported"; message: string }
  | { status: "failed"; message: string }

const WSL_MOUNT_RE = /^\/mnt\/([A-Za-z])(?:\/|$)/
const WSL_POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"

/** Bytes → canonical base64 (Node/Bun Buffer encoding, no line breaks). */
export function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

/** Human-readable byte size (e.g. `1.2 MB`). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Detect the raster media type from magic bytes, never the extension. */
export function detectImageMime(bytes: Uint8Array): ImageMediaType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  const head = new TextDecoder().decode(bytes.slice(0, 6))
  if (head === "GIF87a" || head === "GIF89a") return "image/gif"
  return null
}

/**
 * Normalize a user-supplied image path: expand `~`, and translate Windows
 * drive paths (`D:\...`) to `/mnt/d/...` when running inside WSL (and the
 * reverse for `/mnt/...` paths typed on a native Windows client).
 */
export function normalizeImagePath(raw: string): string {
  let p = raw.trim()
  if (p.startsWith("~")) p = join(homedir(), p.slice(1))
  if (process.platform === "linux" && isWin32Absolute(p)) p = win32ToWsl(p)
  else if (process.platform === "win32" && isPosixAbsolute(p) && WSL_MOUNT_RE.test(p)) p = wslToWin32(p)
  return p
}

function validateImage(bytes: Uint8Array, limits: ImageLimits, source: string): ImageAcquireResult {
  const mediaType = detectImageMime(bytes)
  if (!mediaType) return { ok: false, message: `${source} 不是受支持的图片（PNG/JPEG/WebP/GIF）` }
  if (!limits.mediaTypes.includes(mediaType)) {
    return { ok: false, message: `${source} 的图片格式不受当前 Harness 支持：${mediaType}` }
  }
  if (bytes.length > limits.maxImageBytes) {
    return {
      ok: false,
      message: `${source} 超过单张大小限制（${formatBytes(limits.maxImageBytes)}）`,
    }
  }
  return { ok: true, mediaType, data: base64FromBytes(bytes), bytes: bytes.length }
}

/** Read and validate an image file from a user-supplied path. */
export async function readImageFromPath(rawPath: string, limits: ImageLimits): Promise<ImageAcquireResult> {
  const path = normalizeImagePath(rawPath)
  try {
    const bytes = new Uint8Array(await readFile(path))
    const validated = validateImage(bytes, limits, path)
    if (!validated.ok) return validated
    return { ...validated, name: path.split(/[\\/]/).pop() || path }
  } catch (e) {
    return { ok: false, message: `无法读取图片：${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * Read the host clipboard as an image (falling back to text). On WSL, when
 * the native read comes back empty/unsupported, try the Windows clipboard via
 * PowerShell once. `windowsProbe` runs *before* the native read when provided
 * (production WSL passes the PowerShell probe: the user's real clipboard is
 * the Windows one, and the WSLg native clipboard may hold stale text while
 * Windows holds the screenshot). Tests inject a fake probe to verify ordering
 * without spawning PowerShell.
 */
export async function readClipboardImage(
  reader: ClipboardReadLike,
  limits: ImageLimits,
  options: { allowWindowsFallback?: boolean; windowsProbe?: () => Promise<AttachedImage | null> } = {},
): Promise<ClipboardImageOutcome> {
  const probeTried = options.windowsProbe !== undefined
  if (options.windowsProbe) {
    const win = await options.windowsProbe()
    if (win) return { status: "image", image: win }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const result = await reader.read({
      preferredTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"],
      signal: controller.signal,
    })
    if (result.status === "read" && result.representation) {
      const { mimeType, bytes } = result.representation
      if (mimeType.startsWith("image/")) {
        const mediaType = mimeType as ImageMediaType
        if (!limits.mediaTypes.includes(mediaType)) {
          return { status: "failed", message: `剪贴板图片格式不受支持：${mediaType}` }
        }
        if (bytes.length > limits.maxImageBytes) {
          return { status: "failed", message: `剪贴板图片超过大小限制（${formatBytes(limits.maxImageBytes)}）` }
        }
        return {
          status: "image",
          image: { mediaType, data: base64FromBytes(bytes), bytes: bytes.length, name: "剪贴板" },
        }
      }
      if (mimeType === "text/plain") {
        const text = new TextDecoder().decode(bytes)
        // Explorer-style file copies put the file path in the clipboard:
        // when the whole text is one path to an existing image, attach it
        // directly instead of inserting the path as text.
        const fromPath = await imageFromPathText(text, limits)
        if (fromPath) return { status: "image", image: fromPath }
        return { status: "text", text }
      }
    }
    if (result.status === "empty") {
      if (options.allowWindowsFallback !== false && !probeTried) {
        const win = await tryWindowsClipboard(limits)
        if (win) return { status: "image", image: win }
      }
      return { status: "empty", message: "剪贴板里没有图片" }
    }
    if (result.status === "unsupported") {
      if (options.allowWindowsFallback !== false && !probeTried) {
        const win = await tryWindowsClipboard(limits)
        if (win) return { status: "image", image: win }
      }
      return { status: "unsupported", message: "当前环境不支持读取宿主剪贴板（SSH 远端或无桌面会话）" }
    }
    if (result.status === "failed") {
      // A native read failure (e.g. WSLg absent) can still be served by the
      // Windows clipboard — try the PowerShell fallback before giving up.
      if (options.allowWindowsFallback !== false && !probeTried) {
        const win = await tryWindowsClipboard(limits)
        if (win) return { status: "image", image: win }
      }
      return {
        status: "failed",
        message: result.error ? result.error.message : "剪贴板读取失败",
      }
    }
    if (result.status === "limit-exceeded") {
      return { status: "failed", message: "剪贴板图片超过大小限制" }
    }
    if (result.status === "cancelled" || result.status === "timed-out") {
      return { status: "failed", message: "剪贴板读取超时或被取消" }
    }
    return { status: "failed", message: "剪贴板读取失败" }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Treat a pasted/copied text as an image file path when it is a single line
 * that resolves to a valid image on disk (Windows drive paths are translated
 * via `normalizeImagePath`). Anything else — multi-line selections, URLs,
 * plain prose — returns null and stays text.
 */
export async function imageFromPathText(text: string, limits: ImageLimits): Promise<AttachedImage | null> {
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return null
  const result = await readImageFromPath(trimmed, limits)
  if (!result.ok) return null
  return { mediaType: result.mediaType, data: result.data, bytes: result.bytes, name: result.name }
}

/**
 * WSL→Windows clipboard fallback: `powershell.exe Clipboard::GetImage()` saved
 * as PNG, base64 on stdout. Only attempted when a Windows PowerShell exists.
 */
export async function tryWindowsClipboard(limits: ImageLimits): Promise<AttachedImage | null> {
  if (process.platform !== "linux" || !existsSync(WSL_POWERSHELL)) return null
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
    "$img = [System.Windows.Forms.Clipboard]::GetImage(); " +
    "if ($null -eq $img) { [Console]::Out.Write('__EMPTY__'); exit 0 }; " +
    "$ms = New-Object System.IO.MemoryStream; " +
    "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); " +
    "[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray())); $ms.Dispose()"
  // STA is required for `Clipboard` access; a Windows-side working directory
  // avoids WSL interop quirks. WSL→Windows process startup can fail
  // intermittently (vsock), so retry once before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { stdout } = await execFileAsync(
        WSL_POWERSHELL,
        ["-NoProfile", "-STA", "-NonInteractive", "-Command", script],
        { cwd: "/mnt/c", timeout: 5000, maxBuffer: limits.maxImageBytes * 2 },
      )
      const b64 = stdout.trim()
      if (!b64 || b64 === "__EMPTY__") return null
      const bytes = Buffer.from(b64, "base64")
      if (bytes.length === 0 || bytes.length > limits.maxImageBytes) return null
      // PowerShell errors or odd encodings can slip past base64 decoding —
      // validate magic bytes so garbage never reaches the harness as PNG.
      if (detectImageMime(bytes) !== "image/png") return null
      return { mediaType: "image/png", data: b64, bytes: bytes.length, name: "剪贴板" }
    } catch {
      // retry once (interop hiccup), then give up
    }
  }
  return null
}

/** Lazy process-wide host clipboard service (native init failures degrade to null). */
let clipboardSingleton: HostClipboardService | null | undefined

export function getHostClipboard(): HostClipboardService | null {
  if (clipboardSingleton === undefined) {
    try {
      clipboardSingleton = createHostClipboard()
    } catch {
      clipboardSingleton = null
    }
  }
  return clipboardSingleton
}

/** Release the native clipboard service on app exit (idempotent). */
export async function disposeHostClipboard(): Promise<void> {
  if (!clipboardSingleton) return
  const service = clipboardSingleton
  clipboardSingleton = null
  try {
    await service.dispose()
  } catch {
    /* best-effort teardown */
  }
}
