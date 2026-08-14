/**
 * The DeepSeek 小鲸鱼 (little whale) thinking animation.
 *
 * A round little whale that dives, blows a water spout and bubbles,
 * wiggles its tail and blinks while the model is thinking.
 * Pure ASCII/Unicode so it renders identically in any terminal.
 *
 * Canvas layout (10 lines tall, 20 wide):
 *   lines 0-2 : spout + bubbles (above the head)
 *   lines 3-8 : whale body (bobs by 1 line)
 *   right cols: tail flukes
 */

const W = 20

// Whale body, 6 lines, facing right.
const BODY: string[] = [
  '    .-""""-.   ',
  '   /        \\  ',
  '  |  o   o  |  ',
  '  |    ^    |  ',
  '   \\        /  ',
  "    '-....-'   ",
]

// Tail flukes, drawn over the right margin of body lines 1-3 (two phases).
const TAIL_A: string[] = ['  ~~~', '    ~', '     ']
const TAIL_B: string[] = ['     ', '    ~', '  ~~~']

// Spout frames, 3 lines, placed at col 5 (blowhole sits at col 7).
const SPOUT_0 = ['      ', '      ', '      ']
const SPOUT_1 = ['      ', '      ', '  |   ']
const SPOUT_2 = ['      ', '  |   ', '  |   ']
const SPOUT_3 = ['  o   ', '  |   ', '  |   ']

// Bubble positions [col, line] in the top 3 lines, right of the spout.
const BUBBLE_POS: Array<[number, number]> = [
  [9, 0],
  [11, 1],
  [10, 2],
  [13, 0],
  [8, 2],
  [12, 1],
  [14, 2],
  [10, 0],
]

function putChar(grid: string[], col: number, line: number, ch: string): void {
  if (line < 0 || line >= grid.length) return
  const row = grid[line] as string
  if (col < 0 || col >= row.length) return
  grid[line] = row.slice(0, col) + ch + row.slice(col + 1)
}

/** Build one animation frame. */
function frame(
  spout: string[],
  tail: string[],
  bubbles: Array<[number, number]>,
  blink: boolean,
  bob: number,
): string {
  const grid = Array.from({ length: 10 }, () => ' '.repeat(W))
  // body, offset by bob
  for (let i = 0; i < BODY.length; i++) {
    grid[i + 3 + bob] = (BODY[i] as string).padEnd(W)
  }
  // spout above the blowhole
  for (let i = 0; i < spout.length; i++) {
    const src = spout[i] as string
    for (let c = 0; c < src.length; c++) {
      const ch = src.charAt(c)
      if (ch !== ' ') putChar(grid, 5 + c, i, ch)
    }
  }
  // bubbles
  for (const [col, line] of bubbles) {
    putChar(grid, col, line, 'o')
  }
  // tail
  for (let i = 0; i < tail.length; i++) {
    const src = tail[i] as string
    const line = 4 + i + bob
    for (let c = 0; c < src.length; c++) {
      const ch = src.charAt(c)
      if (ch !== ' ') putChar(grid, 16 + c, line, ch)
    }
  }
  // eyes (blink)
  if (blink) {
    putChar(grid, 5, 5 + bob, '-')
    putChar(grid, 9, 5 + bob, '-')
  }
  return grid.map((r) => r.replace(/\s+$/, '')).join('\n')
}

/**
 * Generate `count` animation frames: spout grows, bubbles rise,
 * the whale sinks and rises again, tail wiggles, occasional blink.
 */
export function whaleFrames(count = 8): string[] {
  const frames: string[] = []
  const spouts = [SPOUT_1, SPOUT_2, SPOUT_3, SPOUT_3, SPOUT_2, SPOUT_1, SPOUT_0, SPOUT_1]
  for (let i = 0; i < count; i++) {
    const spout = spouts[i % spouts.length] as string[]
    const tail = i % 2 === 0 ? TAIL_A : TAIL_B
    const bubbles = BUBBLE_POS.slice((i * 2) % BUBBLE_POS.length, (i * 2) % BUBBLE_POS.length + 4)
    const blink = i % 7 === 5
    const bob = i % 4 === 3 ? 1 : 0
    frames.push(frame(spout, tail, bubbles, blink, bob))
  }
  return frames
}

/** Single-line mini whale for the status bar. */
export function miniWhaleFrames(count = 6): string[] {
  const frames: string[] = []
  for (let i = 0; i < count; i++) {
    const eye = i % 5 === 4 ? '-' : 'o'
    const bub = ['°', '·', 'o', '°', '·', 'o'][i % 6] as string
    const swim = ['～', '〜', '〜', '～'][i % 4] as string
    frames.push(`${bub}  ( ${eye}ᴗ${eye} )${swim.repeat(2)}`)
  }
  return frames
}

/** Static whale for banners. */
export function whaleBanner(): string {
  return [
    '        o        ',
    '       o         ',
    '   .-""""-.  ~~~ ',
    '  /        \\  ~  ',
    ' |   o  o   | ~  ',
    ' |    ^     |    ',
    '  \\        /  ~  ',
    "   '-....-'  ~~~ ",
  ].join('\n')
}
