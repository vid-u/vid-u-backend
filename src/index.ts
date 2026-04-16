import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { disconnectPrisma } from "./lib/prisma.js";
import { logger } from "./utils/logger.js";

const app = createApp();
const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info(`Listening on port ${env.PORT}`, { nodeEnv: env.NODE_ENV });
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down`);
  server.close(async (err) => {
    if (err) {
      logger.error("HTTP server close error", { error: String(err) });
    }
    await disconnectPrisma().catch((e) =>
      logger.error("Prisma disconnect error", { error: String(e) })
    );
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
