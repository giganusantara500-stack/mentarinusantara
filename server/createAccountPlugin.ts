import { loadEnv, type Plugin } from "vite";
import { apiEnvFrom, handleNodeApi } from "./handleApi";

export function createAccountPlugin(): Plugin {
  return {
    name: "direct-account-create",
    configureServer(server) {
      const configOf = () => {
        const source = loadEnv(server.config.mode, process.cwd(), "");
        for (const [key, value] of Object.entries(source)) {
          if (process.env[key] === undefined) process.env[key] = value;
        }
        return apiEnvFrom(source);
      };
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
