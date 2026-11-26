declare module "cloudflare:sockets" {
  export interface SocketInfo {
    remoteAddress?: string;
    localAddress?: string;
  }

  export interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<SocketInfo>;
    closed: Promise<void>;
    close(): Promise<void>;
  }

  export interface SocketAddress {
    hostname: string;
    port: number;
  }

  export interface SocketOptions {
    secureTransport?: "off" | "on" | "starttls";
    allowHalfOpen?: boolean;
  }

  export function connect(address: SocketAddress, options?: SocketOptions): Socket;
}
