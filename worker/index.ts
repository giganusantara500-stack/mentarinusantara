import { connect } from "cloudflare:sockets";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const UPSTREAM_HOST = "139.190.102.196";
const UPSTREAM_PORT = 8787;

function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function headerValue(request: Request, name: string) {
  const value = request.headers.get(name)?.trim() ?? "";
  if (!value || /[\r\n]/.test(value)) return "";
  return value;
}

function authorizationValue(request: Request) {
  const value = headerValue(request, "authorization");
  const bearer = /Bearer\s+\S+/i.exec(value);
  return bearer ? bearer[0] : value;
}

function encodeRequest(method: string, path: string, request: Request, body: Uint8Array | null) {
  const lines = [`${method} ${path} HTTP/1.1`, `Host: ${UPSTREAM_HOST}:${UPSTREAM_PORT}`, "Connection: close"];
  const authorization = authorizationValue(request);
  if (authorization) lines.push(`Authorization: ${authorization}`);
  const contentType = headerValue(request, "content-type");
  if (body && contentType && contentType.length <= 200) lines.push(`Content-Type: ${contentType}`);
  const callbackSecret = headerValue(request, "x-callback-secret");
  if (callbackSecret && callbackSecret.length <= 256) lines.push(`X-Callback-Secret: ${callbackSecret}`);
  if (body) lines.push(`Content-Length: ${body.byteLength}`);
  const head = new TextEncoder().encode(`${lines.join("\r\n")}\r\n\r\n`);
  if (!body || body.byteLength === 0) return head;
  const out = new Uint8Array(head.byteLength + body.byteLength);
  out.set(head, 0);
  out.set(body, head.byteLength);
  return out;
}

function concat(chunks: Uint8Array[], total: number) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function responseReady(raw: Uint8Array) {
  const splitAt = headerEnd(raw);
  if (splitAt < 0) return false;
  const head = new TextDecoder().decode(raw.subarray(0, splitAt)).toLowerCase();
  const body = raw.subarray(splitAt + 4);
  if (head.includes("transfer-encoding:") && head.includes("chunked")) {
    return /\r\n0\r\n\r\n$/.test(new TextDecoder().decode(body));
  }
  const match = /content-length:\s*(\d+)/.exec(head);
  if (!match) return false;
  return body.byteLength >= Number(match[1]);
}

async function readHttpMessage(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value && value.byteLength > 0) {
        chunks.push(value);
        total += value.byteLength;
      }
      const raw = concat(chunks, total);
      if (responseReady(raw) || done) return raw;
    }
  } finally {
    reader.releaseLock();
  }
}

function headerEnd(bytes: Uint8Array) {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) return i;
  }
  return -1;
}

function decodeChunks(body: Uint8Array) {
  const parts: Uint8Array[] = [];
  let offset = 0;
  const decoder = new TextDecoder();
  while (offset < body.length) {
    let lineEnd = offset;
    while (lineEnd + 1 < body.length && !(body[lineEnd] === 13 && body[lineEnd + 1] === 10)) lineEnd++;
    if (lineEnd + 1 >= body.length) break;
    const size = Number.parseInt(decoder.decode(body.subarray(offset, lineEnd)).split(";", 1)[0].trim(), 16);
    if (!Number.isFinite(size) || size < 0) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    if (offset + size > body.length) break;
    parts.push(body.subarray(offset, offset + size));
    offset += size + 2;
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

function parseHttpResponse(raw: Uint8Array): Response {
  const splitAt = headerEnd(raw);
  if (splitAt < 0) {
    return Response.json({ error: "Backend VPS membalas data yang tidak lengkap." }, { status: 502 });
  }
  const head = new TextDecoder().decode(raw.subarray(0, splitAt));
  const lines = head.split("\r\n");
  const match = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/.exec(lines[0] ?? "");
  if (!match) {
    return Response.json({ error: "Backend VPS membalas status yang tidak dikenali." }, { status: 502 });
  }
  const status = Number(match[1]);
  const statusText = match[2] ?? "";
  const headers = new Headers();
  let chunked = false;
  let contentLength: number | null = null;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (/[\r\n]/.test(value)) continue;
    const lower = name.toLowerCase();
    if (lower === "transfer-encoding") {
      chunked = value.toLowerCase().includes("chunked");
      continue;
    }
    if (lower === "connection" || lower === "keep-alive") continue;
    if (lower === "content-length") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) contentLength = parsed;
    }
    headers.append(name, value);
  }
  let body = raw.subarray(splitAt + 4);
  if (chunked) body = decodeChunks(body);
  else if (contentLength !== null) body = body.subarray(0, contentLength);
  if (status === 204 || status === 304) return new Response(null, { status, statusText, headers });
  headers.set("content-length", String(body.byteLength));
  return new Response(body, { status, statusText, headers });
}

async function proxyApi(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = `${incoming.pathname}${incoming.search}` || "/";
  if (/[\r\n\s]/.test(method) || /[\r\n]/.test(path)) {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : null;

  try {
    const socket = connect({ hostname: UPSTREAM_HOST, port: UPSTREAM_PORT }, { secureTransport: "off" });
    await socket.opened;
    const pending = readHttpMessage(socket.readable);
    const writer = socket.writable.getWriter();
    await writer.write(encodeRequest(method, path, request, body));
    const waitMs = method === "POST" && incoming.pathname === "/api/loket-sales" ? 55_000 : 180_000;
    const raw = await Promise.race([
      pending,
      new Promise<Uint8Array>((_resolve, reject) => {
        setTimeout(() => reject(new Error("timeout")), waitMs);
      }),
    ]);
    await writer.close();
    return parseHttpResponse(raw);
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "timeout";
    if (timedOut) {
      return Response.json({
        error: "Pembayaran belum mendapat jawaban tepat waktu. Cek status sebelum mengulang. Saldo hanya terpotong bila status Sukses.",
        statusText: "pending",
      }, { status: 504 });
    }
    return Response.json({ error: "Backend VPS tidak terjangkau." }, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) return proxyApi(request);
    return env.ASSETS.fetch(request);
  },
};
