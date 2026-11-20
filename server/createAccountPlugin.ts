import { loadEnv, type Plugin } from "vite";
import { apiEnvFrom, handleNodeApi } from "./handleApi";

export function createAccountPlugin(): Plugin {
  return {
    name: "direct-account-create",
    configureServer(server) {
      const configOf = () => apiEnvFrom(loadEnv(server.config.mode, process.cwd(), ""));
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split("?")[0] ?? "";
        if (!pathname.startsWith("/api/")) return next();
        try {
          await handleNodeApi(req, res, configOf());
        } catch (error) {
          const message = error instanceof Error ? error.message : "Data permintaan tidak terbaca.";
          console.error("API gagal diproses:", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}
