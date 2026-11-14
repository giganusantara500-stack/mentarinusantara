import { loadEnv, type Plugin } from "vite";
import { sweepIdleAccounts } from "./accountAdmin";
import { apiEnvFrom, handleNodeApi } from "./handleApi";

export function createAccountPlugin(): Plugin {
  return {
    name: "direct-account-create",
    configureServer(server) {
      const configOf = () => apiEnvFrom(loadEnv(server.config.mode, process.cwd(), ""));
      const timer = setInterval(() => {
        sweepIdleAccounts(configOf()).catch(() => undefined);
      }, 60 * 60 * 1000);
      server.httpServer?.once("close", () => clearInterval(timer));
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split("?")[0] ?? "";
        if (!pathname.startsWith("/api/")) return next();
        try {
          await handleNodeApi(req, res, configOf());
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Data permintaan tidak terbaca." }));
        }
      });
    },
  };
}
