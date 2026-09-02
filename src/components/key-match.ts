/**
 * Arrow/enter key matching shared by the slash menu, result panels and the
 * question modal.
 *
 * Accept the canonical OpenTUI names plus keypad/alternate spellings some
 * terminals emit (e.g. DECCKM `ESC O A`), then fall back to the raw terminal
 * bytes so these keys keep working even when a terminal talks the kitty
 * keyboard protocol (CSI-u sequences like `ESC [ 57352u` for Up) while kitty
 * parsing is unavailable.
 */

interface KeyLike {
  name: string
  raw: string
}

const KEY_UP = new Set(["up", "kpup", "arrowup", "ArrowUp"])
const KEY_DOWN = new Set(["down", "kpdown", "arrowdown", "ArrowDown"])
const KEY_ENTER = new Set(["return", "linefeed", "enter", "Enter"])
const KEY_SPACE = new Set(["space", "spacebar", " "])

// CSI-u key codes: left=57350, right=57351, up=57352, down=57353, return=57345.
const UP_RAW = [/^\x1b\[A$/, /^\x1bOA$/, /^\x1b\[57352u(?:$|;)/]
const DOWN_RAW = [/^\x1b\[B$/, /^\x1bOB$/, /^\x1b\[57353u(?:$|;)/]
const ENTER_RAW = [/^\r$/, /^\n$/, /^\x1b\[57345u(?:$|;)/]
const SPACE_RAW = [/^ $/, /^\x20$/, /^[ ]$/]

export const isUp = (key: KeyLike): boolean =>
  KEY_UP.has(key.name) || UP_RAW.some((re) => re.test(key.raw))

export const isDown = (key: KeyLike): boolean =>
  KEY_DOWN.has(key.name) || DOWN_RAW.some((re) => re.test(key.raw))

export const isEnter = (key: KeyLike): boolean =>
  KEY_ENTER.has(key.name) || ENTER_RAW.some((re) => re.test(key.raw))

export const isSpace = (key: KeyLike): boolean =>
  KEY_SPACE.has(key.name) || SPACE_RAW.some((re) => re.test(key.raw))
