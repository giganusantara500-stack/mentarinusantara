import { apiEnvFrom, handleApi } from "../../server/handleApi";

export default async (request: Request) => {
  const url = new URL(request.url);
  const marker = url.pathname.indexOf("/api/");
  const pathname = marker >= 0 ? url.pathname.slice(marker) : url.pathname;
  let body: Record<string, unknown> = {};
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.json().catch(() => ({})) as Record<string, unknown>;
  }
  try {
    const result = await handleApi({
      method: request.method,
      pathname,
      search: url.search,
      authorization: request.headers.get("authorization") ?? "",
      body,
      env: apiEnvFrom(process.env),
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Permintaan kolektif gagal diproses." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
