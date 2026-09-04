declare module "ws" {
  interface WebSocketOptions {
    headers?: Record<string, string>
    [key: string]: unknown
  }

  interface WebSocketEvents {
    open: () => void
    message: (data: unknown, isBinary: boolean) => void
    close: (code: number, reason: string) => void
    error: (err: Error) => void
  }

  class WebSocket {
    constructor(url: string, protocols?: string | string[], options?: WebSocketOptions)
    send(data: string | ArrayBuffer | Uint8Array): void
    close(code?: number, reason?: string): void
    ping(data?: unknown): void
    on<E extends keyof WebSocketEvents>(event: E, cb: WebSocketEvents[E]): this
    readonly readyState: number
    readonly OPEN: number
    readonly CLOSING: number
    readonly CLOSED: number
    readonly CONNECTING: number
  }

  export default WebSocket
}
