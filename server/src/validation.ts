import { z } from "zod";
import { rupeesToPaise } from "./money.js";

// ₹1 crore per entry (Indian digit grouping: 1,00,00,000 rupees), in paise.
// Comfortably inside a Postgres INTEGER, which tops out around ₹2.1 crore.
export const MAX_AMOUNT_PAISE = 1_00_00_000 * 100;

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

export const friendNameSchema = z
  .string({ error: "Friend's name is required" })
  .trim()
  .min(1, "Friend's name is required")
  .max(60, "Name can be at most 60 characters");

// Rupees, sent as a JSON number (250.5) or as text ("250.50"), with at most 2 decimals.
// Outputs whole paise. A float like 0.30000000000000004 fails the 2-decimal rule.
export const amountSchema = z
  .union([z.number(), z.string()], { error: "Amount is required" })
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount in rupees, with at most 2 decimal places"))
  .transform(rupeesToPaise)
  .refine((paise) => paise > 0, "Amount must be more than ₹0")
  .refine((paise) => paise <= MAX_AMOUNT_PAISE, "Amount can't be more than ₹1,00,00,000 (1 crore)");

// A calendar date as "YYYY-MM-DD". Past dates are allowed, to record an old loan.
export const dueDateSchema = z.iso.date({ error: "Due date must be a date like 2026-10-31" });

// Route parameters always arrive as text ("/loans/7"), so coerce turns "7" into 7.
export const loanIdSchema = z.coerce
  .number({ error: "Loan id must be a number" })
  .int("Loan id must be a whole number")
  .positive("Loan id must be positive");
