import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, signToken } from "../auth.js";
import { prisma } from "../db.js";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  generateOtp,
  hashOtp,
  otpMatches,
} from "../otp.js";
import { sendOtpSms } from "../sms.js";
import { otpSchema, phoneSchema } from "../validation.js";

const requestOtpBody = z.object({ phone: phoneSchema });
const verifyOtpBody = z.object({ phone: phoneSchema, otp: otpSchema });

// A Fastify plugin: a function that registers related routes.
// It plays the role of a controller class in NestJS or Spring.
export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/request-otp", async (request, reply) => {
    // parse() throws on bad input; the error handler in app.ts turns that into a 400.
    const { phone } = requestOtpBody.parse(request.body);

    const latest = await prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      const waitMs = latest.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS - Date.now();
      if (waitMs > 0) {
        return reply.code(429).send({
          error: "Please wait before requesting another OTP",
          retryAfterSeconds: Math.ceil(waitMs / 1000),
        });
      }
    }

    const code = generateOtp();
    await prisma.otpCode.create({
      data: { phone, codeHash: hashOtp(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    await sendOtpSms(request.log, phone, code);

    // Never put the code itself in the response.
    return { message: "OTP sent", expiresInSeconds: OTP_TTL_MS / 1000 };
  });

  app.post("/auth/verify-otp", async (request, reply) => {
    const { phone, otp } = verifyOtpBody.parse(request.body);

    // Only the newest code for a phone counts: requesting a new code retires the old one.
    const record = await prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      return reply.code(401).send({ error: "OTP expired or not found. Request a new one." });
    }

    // Count the attempt with a conditional UPDATE: "add 1 only while under the limit".
    // Two guesses sent at the same moment can't both slip past the limit.
    const attempt = await prisma.otpCode.updateMany({
      where: { id: record.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count === 0) {
      return reply.code(429).send({ error: "Too many wrong attempts. Request a new OTP." });
    }

    if (!otpMatches(otp, record.codeHash)) {
      return reply.code(401).send({
        error: "Incorrect OTP",
        attemptsLeft: OTP_MAX_ATTEMPTS - (record.attempts + 1),
      });
    }

    // Mark the code used, again conditionally, so one code can't log in twice.
    const consumed = await prisma.otpCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      return reply.code(401).send({ error: "OTP already used. Request a new one." });
    }

    // The first successful login creates the account.
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });

    return { token: signToken(user.id), user: { id: user.id, phone: user.phone } };
  });

  // Protected: requireAuth runs first and sets request.userId.
  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    return { id: user.id, phone: user.phone };
  });
}
