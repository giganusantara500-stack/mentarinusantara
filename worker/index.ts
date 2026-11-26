interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const UPSTREAM = "http://139.190.102.196:8787";

const DROP_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function forwardedHeaders(request: Request) {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

async function proxyApi(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM);
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    return await fetch(target, {
      method,
      headers: forwardedHeaders(request),
      body: hasBody ? request.body : undefined,
      redirect: "manual",
    });
  } catch {
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
