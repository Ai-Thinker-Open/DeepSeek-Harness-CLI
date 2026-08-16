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
