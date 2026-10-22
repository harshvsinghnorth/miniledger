import { z } from "zod";

// Accepts 9876543210, +91 98765 43210, 091-9876543210 and similar, and normalizes
// all of them to +919876543210, so one person always maps to one account.
// Indian mobile numbers are 10 digits starting with 6, 7, 8 or 9.
export const phoneSchema = z
  .string({ error: "Phone number is required" })
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+91|91|0)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"))
  .transform((value) => `+91${value.slice(-10)}`);

export const otpSchema = z
  .string({ error: "OTP is required" })
  .regex(/^\d{6}$/, "OTP must be 6 digits");
