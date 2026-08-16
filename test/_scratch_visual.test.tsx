/** @jsxImportSource @opentui/solid */
import { test } from "bun:test"
import { testRender } from "@opentui/solid"
import { SessionScreen } from "../src/screens/session"
import { EMPTY_STATS, type ChatMessage } from "../src/session"

for (const width of [10, 12, 14, 16]) {
  test(`visual check width=${width}`, async () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: "好的",
        thinking: "推理",
        streaming: true,
        createdAt: 1,
      },
    ]
    const app = await testRender(
      () => (
        <SessionScreen
          messages={() => messages}
          mode={() => "workspace-write"}
          model={() => "DeepSeek-V4-Flash"}
          toast={() => null}
          stats={() => EMPTY_STATS}
          statusText={() => ""}
          question={() => null}
          onSend={() => {}}
          onBack={() => {}}
          onQuestion={() => {}}
        />
      ),
      { width, height: 24 },
    )
    await app.renderOnce()
    console.log(`\n--- width ${width} ---\n` + app.captureCharFrame().split("\n").map((l) => l.replace(/\s+$/, "")).slice(0, 8).join("\n"))
  })
}
