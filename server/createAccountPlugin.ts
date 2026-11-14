import { loadEnv, type Plugin } from "vite";
import { createNetworkAccount, resetAccountPassword, type CreateAccountInput } from "./createAccount";
import { handleDepositRequest, loadCaller } from "./deposits";
import { handleOpsRequest } from "./ops";
import { allocateBalance, assignOwnRole, getUserDetail, listAccounts, sessionProfile, sweepIdleAccounts, updateUserDetails } from "./accountAdmin";

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function createAccountPlugin(): Plugin {
  return {
    name: "direct-account-create",
    configureServer(server) {
      const configOf = () => {
        const env = loadEnv(server.config.mode, process.cwd(), "");
        return {
          supabaseUrl: env.VITE_SUPABASE_URL,
          anonKey: env.VITE_SUPABASE_ANON_KEY,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
          resendApiKey: env.RESEND_API_KEY,
          emailFrom: env.EMAIL_FROM_ADDRESS,
        };
      };
      const timer = setInterval(() => {
        sweepIdleAccounts(configOf()).catch(() => undefined);
      }, 60 * 60 * 1000);
      server.httpServer?.once("close", () => clearInterval(timer));
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split("?")[0] ?? "";
        if (!pathname.startsWith("/api/")) return next();
        const env = loadEnv(server.config.mode, process.cwd(), "");
        const config = {
          supabaseUrl: env.VITE_SUPABASE_URL,
          anonKey: env.VITE_SUPABASE_ANON_KEY,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
          resendApiKey: env.RESEND_API_KEY,
          emailFrom: env.EMAIL_FROM_ADDRESS,
        };
        try {
          const body = req.method === "GET" ? {} : await readBody(req);
          if (pathname === "/api/me" && req.method === "GET") {
            const result = await sessionProfile(req.headers.authorization ?? "", config);
            send(res, result.status, result.body);
            return;
          }
          if (pathname === "/api/assign-role" && req.method === "POST") {
            const result = await assignOwnRole(req.headers.authorization ?? "", String(body.role ?? ""), config);
            send(res, result.status, result.body);
            return;
          }
          if (pathname === "/api/create-account" && req.method === "POST") {
            const result = await createNetworkAccount(req.headers.authorization ?? "", body as CreateAccountInput, config);
            send(res, result.status, result.body);
            return;
          }
          if (pathname === "/api/accounts" && req.method === "GET") {
            const result = await listAccounts(req.headers.authorization ?? "", config);
            send(res, result.status, result.body);
            return;
          }
          if (pathname === "/api/user-detail" && req.method === "GET") {
            const id = new URL(req.url ?? "", "http://localhost").searchParams.get("id") ?? "";
            const result = await getUserDetail(req.headers.authorization ?? "", id, config);
            send(res, result.status, result.body);
            return;
          }
          if (pathname === "/api/update-account" && req.method === "POST") {
            const result = await updateUserDetails(req.headers.authorization ?? "", body, config);
            send(res, result.status, result.body);
            return;
          }
          if (pathname === "/api/allocate" && req.method === "POST") {
            const result = await allocateBalance(req.headers.authorization ?? "", String(body.userId ?? ""), Number(body.amount), config);
            send(res, result.status, result.body);
            return;
          }
          if (pathname === "/api/reset-password" && req.method === "POST") {
            const result = await resetAccountPassword(req.headers.authorization ?? "", String(body.userId ?? ""), config);
            send(res, result.status, result.body);
            return;
          }
          const caller = await loadCaller(req.headers.authorization ?? "", config);
          if (caller) {
            const ops = await handleOpsRequest(req.method ?? "GET", pathname, body, caller, req.headers.authorization ?? "", config);
            if (ops) {
              send(res, ops.status, ops.body);
              return;
            }
          }
          if (!caller) {
            send(res, 401, { error: "Sesi tidak valid. Silakan login ulang." });
            return;
          }
          const deposit = await handleDepositRequest(req.method ?? "GET", pathname, body, caller, config, req.headers.authorization ?? "");
          if (!deposit) {
            send(res, 404, { error: "Permintaan tidak dikenali." });
            return;
          }
          send(res, deposit.status, deposit.body);
        } catch {
          send(res, 400, { error: "Data permintaan tidak terbaca." });
        }
      });
    },
  };
}
