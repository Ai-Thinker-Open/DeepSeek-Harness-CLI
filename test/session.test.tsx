/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { SessionScreen } from "../src/screens/session"
import type { ChatMessage } from "../src/session"

const messages: ChatMessage[] = [
  { id: "1", role: "user", content: "你好" },
  { id: "2", role: "assistant", content: "收到，演示回复" },
]

test("session screen renders title, messages, model and back hint", async () => {
  const app = await testRender(
    () => (
      <SessionScreen
        title={() => "你好"}
        messages={() => messages}
        mode={() => "workspace-write"}
        model={() => "DeepSeek-V4-Flash"}
        toast={() => null}
        onSend={() => {}}
        onBack={() => {}}
      />
    ),
    { width: 80, height: 32 },
  )
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("你好")
  expect(frame).toContain("收到，演示回复")
  expect(frame).toContain("DeepSeek-V4-Flash")
  expect(frame).toContain("esc 返回")
})

test("escape in the session returns home", async () => {
  let backed = false
  const app = await testRender(
    () => (
      <SessionScreen
        title={() => "你好"}
        messages={() => messages}
        mode={() => "workspace-write"}
        model={() => "DeepSeek-V4-Flash"}
        toast={() => null}
        onSend={() => {}}
        onBack={() => {
          backed = true
        }}
      />
    ),
    { width: 80, height: 32 },
  )
  await app.renderOnce()

  app.mockInput.pressEscape()
  // A lone ESC is ambiguous for the terminal parser, so it dispatches after a short timeout.
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()

  expect(backed).toBe(true)
})
