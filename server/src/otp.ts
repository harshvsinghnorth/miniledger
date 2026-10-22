import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export const OTP_TTL_MS = 5 * 60 * 1000; // a code works for 5 minutes
export const OTP_MAX_ATTEMPTS = 5; // after 5 guesses, a new code is needed
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // real SMS costs money: max one code per 30 s

// randomInt uses the operating system's secure random source.
// Math.random is not secure: its output can be predicted.
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// HMAC = a hash mixed with a secret key. A plain SHA-256 of a 6-digit code could be
// reversed by hashing all 1,000,000 codes; without OTP_SECRET, a leaked table is useless.
export function hashOtp(code: string): string {
  return createHmac("sha256", config.otpSecret).update(code).digest("hex");
}

// timingSafeEqual takes the same time whether the first byte or the last byte differs,
// so an attacker can't learn anything from how long the comparison took.
export function otpMatches(code: string, storedHash: string): boolean {
  const given = Buffer.from(hashOtp(code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}
