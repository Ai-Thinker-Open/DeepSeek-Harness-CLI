const FONT: Record<string, string[]> = {
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  S: ["█████", "█    ", "████ ", "    █", "████ "],
  K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
  H: ["█   █", "█   █", "█████", "█   █", "█   █"],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
}

export function word(text: string): string[] {
  const letters = text.toUpperCase().split("")
  const rows = 5
  return Array.from({ length: rows }, (_, row) =>
    letters.map((ch) => FONT[ch]?.[row] ?? " ".repeat(5)).join(" "),
  )
}

export const deepseek = word("DEEPSEEK")
export const harness = word("HARNESS")

/**
 * The CLI's slogan as a single-line pixel-art banner: each of the seven glyphs
 * rendered at 10×5 half-block cells (70 columns total) so the home logo reads
 * big while still fitting an 80-column terminal.
 */
export const explore = [
  " ▄▄           ▄▄        ▄▄                 ▄▄      ▄   ▄▄   ",
  "▄█████████▄████████▄ ▄▄▄██▄▄▄ ▀▀███▀█▀▀▀   ▀██     █ ▀██▀██ ",
  "▀█████▄██ ██████████▄▄▄▄██▄▄▄▄ ███▄▄██▄  ▀▀▀▀███▀ ▀█▀▀█████▀",
  "███▀████▀▀ ███████▄ ▀▀▀████▀▀▀ ▄▄▄██▄██    ▄██▀    █▄▄█████ ",
  " ██▄█████▄ ███▀████ ▄██▀██▀█▄▄▄▄▄▄██▄▄▄▄▄▄███     █▀▀▄████ ▄",
]
