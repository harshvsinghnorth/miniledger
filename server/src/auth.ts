import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

const TOKEN_LIFETIME = "7d";

// Tell TypeScript that requests which passed requireAuth carry the user's id.
declare module "fastify" {
  interface FastifyRequest {
    userId: number;
  }
}

// The token says "user <id>", signed with JWT_SECRET so it can't be forged or edited.
export function signToken(userId: number): string {
  return jwt.sign({}, config.jwtSecret, {
    subject: String(userId),
    expiresIn: TOKEN_LIFETIME,
    algorithm: "HS256",
  });
}

// A preHandler hook: Fastify runs it before the route handler, like a Spring
// filter or a NestJS guard. It either rejects the request or records who is asking.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing or malformed Authorization header" });
  }

  try {
    // Pinning the algorithm stops a forged token from choosing a weaker one.
    const payload = jwt.verify(header.slice("Bearer ".length), config.jwtSecret, {
      algorithms: ["HS256"],
    });
    if (typeof payload === "string" || !payload.sub) {
      throw new Error("Token has no subject");
    }
    request.userId = Number(payload.sub);
  } catch {
    // Expired, tampered with, or signed with another secret: same answer for all.
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}
