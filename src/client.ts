/**
 * Public library entry: the harness wire client, for tools that want to talk
 * to a DeepSeek Harness instance without the TUI.
 */
export { HarnessClient, HarnessError } from './harness/client.ts'
export type {
  HostDescribe,
  SessionSummary,
  SessionEvent,
  HistoryEntry,
  QuestionItem,
  RpcResult,
  ServerRequest,
  ServerResponse,
} from './harness/client.ts'
export { foldHistory, eventToMessage, titleFromEvents } from './harness/fold.ts'
