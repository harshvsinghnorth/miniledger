import { describe, expect, it } from "vitest";
import { amountSchema, dueDateSchema, otpSchema, phoneSchema } from "../src/validation.js";

describe("phoneSchema", () => {
  it.each(["9876543210", "+919876543210", "919876543210", "09876543210", "+91 98765 43210", "98765-43210"])(
    "accepts %s and normalizes it to +919876543210",
    (input) => {
      expect(phoneSchema.parse(input)).toBe("+919876543210");
    },
  );

  it.each([
    ["12345", "too short"],
    ["98765432101", "11 digits"],
    ["5876543210", "Indian mobiles start with 6-9"],
    ["+449876543210", "not an Indian number"],
    ["abcdefghij", "not digits"],
    ["", "empty"],
  ])("rejects %s (%s)", (input, reason) => {
    expect(phoneSchema.safeParse(input).success, reason).toBe(false);
  });
});

describe("amountSchema", () => {
  it.each([
    [250, 25000],
    ["250.50", 25050],
    [0.01, 1],
    [10_000_000, 1_000_000_000],
  ])("accepts ₹%s as %i paise", (input, paise) => {
    expect(amountSchema.parse(input)).toBe(paise);
  });

  it.each([
    [0, "zero"],
    [-5, "negative"],
    [0.001, "more than 2 decimals"],
    [0.1 + 0.2, "a float artefact (0.30000000000000004)"],
    ["1,000", "a comma"],
    ["abc", "not a number"],
    [10_000_000.01, "over ₹1 crore"],
    [null, "missing"],
  ])("rejects %s (%s)", (input, reason) => {
    expect(amountSchema.safeParse(input).success, reason).toBe(false);
  });
});

describe("dueDateSchema", () => {
  it.each(["2026-10-31", "2028-02-29"])("accepts %s", (input) => {
    expect(dueDateSchema.parse(input)).toBe(input);
  });

  it.each([
    ["2026-02-30", "no such day"],
    ["2026-02-29", "2026 is not a leap year"],
    ["31-10-2026", "wrong order"],
    ["", "empty"],
  ])("rejects %s (%s)", (input, reason) => {
    expect(dueDateSchema.safeParse(input).success, reason).toBe(false);
  });
});

describe("otpSchema", () => {
  it("accepts 6 digits, including leading zeros", () => {
    expect(otpSchema.parse("007390")).toBe("007390");
  });

  it.each(["12345", "1234567", "12ab56", 123456])("rejects %s", (input) => {
    expect(otpSchema.safeParse(input).success).toBe(false);
  });
});
