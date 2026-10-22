import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import { todayInIndia } from "../src/dates.js";
import { prisma } from "../src/db.js";
import { sendOtpSms } from "../src/sms.js";

// Every test starts from empty tables, so tests can't affect each other.
export async function resetDatabase() {
  await prisma.$executeRaw`TRUNCATE otp_codes, loans, users RESTART IDENTITY CASCADE`;
}

// The OTP the server most recently "sent", read from the fake SMS sender.
export function lastOtpSent(): string {
  const call = vi.mocked(sendOtpSms).mock.calls.at(-1);
  if (!call) {
    throw new Error("No OTP has been sent");
  }
  return call[2];
}

// Logs in through the real endpoints and returns the JWT.
export async function login(app: FastifyInstance, phone: string): Promise<string> {
  await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
  const res = await app.inject({
    method: "POST",
    url: "/auth/verify-otp",
    payload: { phone, otp: lastOtpSent() },
  });
  return res.json().token;
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

// The date n days from today in India as "YYYY-MM-DD" (negative n = in the past).
export function daysFromToday(n: number): string {
  const date = new Date(`${todayInIndia()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
