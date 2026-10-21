import Fastify from "fastify";
import { prisma } from "./db.js";

// Builds the app without starting it. server.ts calls listen() on it;
// tests will call app.inject() instead, which sends fake requests without a real port.
export function buildApp() {
  const app = Fastify({ logger: true });

  // Checks the whole chain: HTTP -> Fastify -> Prisma -> Postgres.
  app.get("/health", async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (err) {
      request.log.error(err, "health check: database unreachable");
      return reply.code(503).send({ ok: false, error: "Database unreachable" });
    }
  });

  // Close database connections when the server shuts down.
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
