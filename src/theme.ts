import { RGBA } from "@opentui/core"

export type Theme = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
}

export const theme: Theme = {
  primary: RGBA.fromHex("#4D6BFE"),
  secondary: RGBA.fromHex("#6E86FF"),
  accent: RGBA.fromHex("#818CF8"),
  error: RGBA.fromHex("#FB7185"),
  warning: RGBA.fromHex("#FBBF24"),
  success: RGBA.fromHex("#4D6BFE"),
  info: RGBA.fromHex("#6E86FF"),
  text: RGBA.fromHex("#EEEEEE"),
  textMuted: RGBA.fromHex("#808080"),
  background: RGBA.fromHex("#0A0A0A"),
  backgroundPanel: RGBA.fromHex("#141414"),
  backgroundElement: RGBA.fromHex("#1E1E1E"),
  border: RGBA.fromHex("#484848"),
  borderActive: RGBA.fromHex("#606060"),
  borderSubtle: RGBA.fromHex("#3C3C3C"),
}

export function useTheme() {
  return { theme }
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}
