// @ts-nocheck
import { box, text } from '@opentui/solid'

/** opencode-style home screen: centered figlet brand title + quiet hints. */
const DEEPSEEK_ART = [
  ' ____                 ____            _    ',
  '|  _ \\  ___  ___ _ __/ ___|  ___  ___| | __',
  '| | | |/ _ \\/ _ \\ \'_ \\\\___ \\ / _ \\/ _ \\ |/ /',
  '| |_| |  __/  __/ |_) |__) |  __/  __/   < ',
  '|____/ \\___|\\___| .__/____/ \\___|\\___|_|\\_\\',
  '                |_|                        ',
  ' _   _                                ',
  '| | | | __ _ _ __ _ __   ___  ___ ___ ',
  '| |_| |/ _` | \'__| \'_ \\ / _ \\/ __/ __|',
  '|  _  | (_| | |  | | | |  __/\\__ \\__ \\',
  '|_| |_|\\__,_|_|  |_| |_|\\___||___/___/',
].join('\n')

export function HomeScreen() {
  return (
    <box flexDirection="column" alignItems="center" paddingTop={3}>
      <text fg="#E4E4E7" bold>
        {DEEPSEEK_ART}
      </text>
      <text fg="#6B7280" marginTop={2}>
        Terminal client for DeepSeek Harness
      </text>
      <text fg="#52525B" marginTop={1}>
        Enter to send · / for commands · Ctrl+R sessions · Ctrl+M model · Ctrl+C quit
      </text>
    </box>
  )
}
