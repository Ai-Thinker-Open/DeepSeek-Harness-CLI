import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_IMAGE_LIMITS } from "../src/harness/client"
import {
  base64FromBytes,
  detectImageMime,
  imageFromPathText,
  normalizeImagePath,
  readClipboardImage,
  readImageFromPath,
  type ClipboardReadLike,
} from "../src/images"

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const PNG_BYTES = Buffer.from(PNG_B64, "base64")

test("detectImageMime reads magic bytes, never extensions", () => {
  expect(detectImageMime(PNG_BYTES)).toBe("image/png")
  expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  expect(detectImageMime(webp)).toBe("image/webp")
  expect(detectImageMime(new TextEncoder().encode("GIF89a...."))).toBe("image/gif")
  expect(detectImageMime(new TextEncoder().encode("not an image"))).toBeNull()
})

test("base64FromBytes produces canonical base64", () => {
  const b64 = base64FromBytes(PNG_BYTES)
  expect(Buffer.from(b64, "base64").toString("base64")).toBe(b64)
  expect(Buffer.from(b64, "base64")).toEqual(PNG_BYTES)
})

test("normalizeImagePath expands tilde and bridges Windows↔WSL styles", () => {
  expect(normalizeImagePath("  ~/x.png  ").startsWith("/")).toBe(true)
  if (process.platform === "linux") {
    expect(normalizeImagePath("D:\\Users\\Seahi\\shot.png")).toBe("/mnt/d/Users/Seahi/shot.png")
    expect(normalizeImagePath("/mnt/d/Users/Seahi/shot.png")).toBe("/mnt/d/Users/Seahi/shot.png")
  }
})

test("readImageFromPath validates bytes and reports a friendly error for non-images", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-img-test-"))
  const png = join(dir, "shot.png")
  writeFileSync(png, PNG_BYTES)

  const ok = await readImageFromPath(png, DEFAULT_IMAGE_LIMITS)
  expect(ok.ok).toBe(true)
  if (ok.ok) {
    expect(ok.mediaType).toBe("image/png")
    expect(ok.name).toBe("shot.png")
    expect(ok.bytes).toBe(PNG_BYTES.length)
    expect(ok.data).toBe(PNG_B64)
  }

  const text = join(dir, "note.txt")
  writeFileSync(text, "hello")
  const bad = await readImageFromPath(text, DEFAULT_IMAGE_LIMITS)
  expect(bad.ok).toBe(false)
  if (!bad.ok) expect(bad.message).toContain("不是受支持的图片")

  const missing = await readImageFromPath(join(dir, "nope.png"), DEFAULT_IMAGE_LIMITS)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.message).toContain("无法读取")
})

test("readImageFromPath enforces the per-image byte limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-img-test-"))
  const png = join(dir, "big.png")
  writeFileSync(png, PNG_BYTES)
  const limits = { ...DEFAULT_IMAGE_LIMITS, maxImageBytes: 4 }
  const result = await readImageFromPath(png, limits)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.message).toContain("大小限制")
})

test("readClipboardImage turns image bytes into a canonical attachment", async () => {
  const reader: ClipboardReadLike = {
    read: async () => ({ status: "read", representation: { mimeType: "image/png", bytes: PNG_BYTES } }),
  }
  const result = await readClipboardImage(reader, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })
  expect(result.status).toBe("image")
  if (result.status === "image") {
    expect(result.image.mediaType).toBe("image/png")
    expect(result.image.data).toBe(PNG_B64)
  }
})

test("readClipboardImage falls back to plain text and reports empty/limits", async () => {
  const text: ClipboardReadLike = {
    read: async () => ({ status: "read", representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("hi") } }),
  }
  expect((await readClipboardImage(text, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })).status).toBe("text")

  const empty: ClipboardReadLike = {
    read: async () => ({ status: "empty" }),
  }
  const emptyResult = await readClipboardImage(empty, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })
  expect(emptyResult.status).toBe("empty")

  const big: ClipboardReadLike = {
    read: async () => ({ status: "limit-exceeded" }),
  }
  const bigResult = await readClipboardImage(big, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })
  expect(bigResult.status).toBe("failed")
})

test("readClipboardImage attaches a copied image file path instead of pasting text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-img-clip-"))
  const png = join(dir, "copied.png")
  writeFileSync(png, PNG_BYTES)

  const reader: ClipboardReadLike = {
    read: async () => ({
      status: "read",
      representation: { mimeType: "text/plain", bytes: new TextEncoder().encode(png) },
    }),
  }
  const result = await readClipboardImage(reader, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })
  expect(result.status).toBe("image")
  if (result.status === "image") {
    expect(result.image.name).toBe("copied.png")
    expect(result.image.data).toBe(PNG_B64)
  }

  // A Windows-style path resolves through WSL translation when it exists.
  if (process.platform === "linux") {
    const win = join(dir, "win.png")
    writeFileSync(win, PNG_BYTES)
    const winPath = `C:\\Users\\Seahi\\${win.replace(/^\//, "").replace(/\//g, "\\")}`
    const winReader: ClipboardReadLike = {
      read: async () => ({
        status: "read",
        representation: { mimeType: "text/plain", bytes: new TextEncoder().encode(winPath) },
      }),
    }
    // The synthetic drive path does not exist under /mnt/c, so it must stay text.
    const winResult = await readClipboardImage(winReader, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })
    expect(winResult.status).toBe("text")
  }

  // Multi-line selections and plain prose stay text.
  const multi: ClipboardReadLike = {
    read: async () => ({
      status: "read",
      representation: { mimeType: "text/plain", bytes: new TextEncoder().encode(`${png}\n${png}`) },
    }),
  }
  expect((await readClipboardImage(multi, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })).status).toBe("text")

  const prose: ClipboardReadLike = {
    read: async () => ({
      status: "read",
      representation: { mimeType: "text/plain", bytes: new TextEncoder().encode("hello world") },
    }),
  }
  expect((await readClipboardImage(prose, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })).status).toBe("text")
})

test("imageFromPathText attaches a single-line image path and keeps other text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-img-path-"))
  const png = join(dir, "path.png")
  writeFileSync(png, PNG_BYTES)

  const image = await imageFromPathText(png, DEFAULT_IMAGE_LIMITS)
  expect(image?.name).toBe("path.png")
  expect(await imageFromPathText("hello world", DEFAULT_IMAGE_LIMITS)).toBeNull()
  expect(await imageFromPathText(`${png}\n${png}`, DEFAULT_IMAGE_LIMITS)).toBeNull()
})

test("readClipboardImage reports failed natively and never fabricates an image", async () => {
  const failed: ClipboardReadLike = {
    read: async () => ({ status: "failed", error: new Error("wslg unavailable") }),
  }
  const result = await readClipboardImage(failed, DEFAULT_IMAGE_LIMITS, { allowWindowsFallback: false })
  expect(result.status).toBe("failed")
  if (result.status === "failed") expect(result.message).toContain("wslg unavailable")
})

test("readClipboardImage probes Windows first when a windowsProbe is injected", async () => {
  let probed = false
  const probe = async () => {
    probed = true
    return { mediaType: "image/png" as const, data: PNG_B64, bytes: PNG_BYTES.length, name: "win-shot" }
  }
  // The native reader must never be reached while Windows has the image.
  const reader: ClipboardReadLike = {
    read: async () => {
      throw new Error("native reader should not be called when Windows probe hits")
    },
  }
  const result = await readClipboardImage(reader, DEFAULT_IMAGE_LIMITS, { windowsProbe: probe })
  expect(probed).toBe(true)
  expect(result.status).toBe("image")
  if (result.status === "image") {
    expect(result.image.name).toBe("win-shot")
    expect(result.image.data).toBe(PNG_B64)
  }
})

test("readClipboardImage falls through to the native reader when the Windows probe is empty", async () => {
  let nativeCalled = false
  const reader: ClipboardReadLike = {
    read: async () => {
      nativeCalled = true
      return { status: "read", representation: { mimeType: "image/png", bytes: PNG_BYTES } }
    },
  }
  const result = await readClipboardImage(reader, DEFAULT_IMAGE_LIMITS, { windowsProbe: async () => null })
  expect(nativeCalled).toBe(true)
  expect(result.status).toBe("image")
})

test("readClipboardImage probes Windows only once even when the native read fails", async () => {
  let probeCalls = 0
  const reader: ClipboardReadLike = {
    read: async () => ({ status: "empty" }),
  }
  const result = await readClipboardImage(reader, DEFAULT_IMAGE_LIMITS, {
    windowsProbe: async () => {
      probeCalls++
      return null
    },
  })
  expect(probeCalls).toBe(1)
  expect(result.status).toBe("empty")
})
