import { describe, expect, it } from "vitest";
import { generateOtp, hashOtp, otpMatches } from "../src/otp.js";

describe("OTP helpers", () => {
  it("always generates exactly 6 digits, keeping leading zeros", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("hashes a code into 64 hex characters, never the code itself", () => {
    const hash = hashOtp("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe("123456");
  });

  it("matches only the right code", () => {
    const hash = hashOtp("123456");
    expect(otpMatches("123456", hash)).toBe(true);
    expect(otpMatches("123457", hash)).toBe(false);
  });
});
