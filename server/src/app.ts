import Fastify, { type FastifyError } from "fastify";
import { ZodError, z } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { loanRoutes } from "./routes/loans.js";

function loggerOptions(enabled: boolean) {
  if (!enabled) {
    return false;
  }
  // In production: one JSON object per line, which log tools such as
  // AWS CloudWatch can search and filter.
  if (config.isProduction) {
    return true;
  }
  // On the laptop: readable, coloured log lines.
  return {
    transport: {
      target: "pino-pretty",
      options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
    },
  };
}

// Builds the app without starting it. server.ts calls listen() on it; tests call
// app.inject() instead, which sends requests straight in without a real port.
// Tests pass { logger: false } to keep their output clean.
export function buildApp({ logger = true }: { logger?: boolean } = {}) {
  const app = Fastify({ logger: loggerOptions(logger) });

  // The one place where errors become HTTP responses.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Bad input from the client (a zod schema rejected the body).
    if (error instanceof ZodError) {
      const { formErrors, fieldErrors } = z.flattenError(error);
      return reply.code(400).send({ error: formErrors[0] ?? "Validation failed", fields: fieldErrors });
    }
    // Errors Fastify raised itself for a bad request, e.g. malformed JSON: keep their 4xx.
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    // Anything else is a bug on our side: log the details, but don't send them to the client.
    request.log.error(error);
    return reply.code(500).send({ error: "Something went wrong" });
  });

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

  app.register(authRoutes);
  app.register(loanRoutes);

  // Close database connections when the server shuts down.
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
