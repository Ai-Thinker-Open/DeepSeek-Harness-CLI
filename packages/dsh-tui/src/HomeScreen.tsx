// @ts-nocheck
import { box, text } from '@opentui/solid'

/** opencode-style home screen: big ASCII brand title + hints. */
const DEEPSEEK_ART = [
  '  ____   _____   _____   ____   ____    _____   _____   _  __  ',
  ' |  _ \\ | ____| | ____| |  _ \\ / ___|  | ____| | ____| | |/ /  ',
  ' | | | ||  _|   |  _|   | |_) |\\___ \\  |  _|   |  _|   | \' /   ',
  ' | |_| || |___  | |___  |  __/  ___) | | |___  | |___  | . \\   ',
  ' |____/ |_____| |_____| |_|    |____/  |_____| |_____| |_|\\_\\  ',
].join('\n')

export function HomeScreen() {
  return (
    <box flexDirection="column" alignItems="center" paddingTop={4}>
      <text fg="#FF7A1A" bold>
        {DEEPSEEK_ART}
      </text>
      <text fg="#A1A1AA" marginTop={2}>
        Terminal client for DeepSeek Harness
      </text>
      <text fg="#6B7280" marginTop={1}>
        Enter to send · / for commands · Ctrl+R sessions · Ctrl+M model · Ctrl+C quit
      </text>
    </box>
  )
}
