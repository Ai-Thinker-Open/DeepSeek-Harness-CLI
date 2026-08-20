import { expect, test } from "bun:test"
import { shineSpans } from "../src/components/shine-text"
import { theme } from "../src/theme"

test("shineSpans rolls a highlight band across the letters", () => {
  const base = theme.primary
  const atStart = shineSpans("Read", 0, base)
  const afterBand = shineSpans("Read", 4, base)
  expect(atStart.map((s) => s.ch).join("")).toBe("Read")
  // At tick 0 the band covers the leading letters; once it passes, they
  // return to the base color (the same RGBA instance).
  expect(atStart[0]!.fg).not.toBe(base)
  expect(afterBand[0]!.fg).toBe(base)
  // The band moves: tick 0 brightens "R" more than tick 1 does.
  expect(shineSpans("Read", 0, base)[0]!.fg).not.toBe(shineSpans("Read", 1, base)[0]!.fg)
})
