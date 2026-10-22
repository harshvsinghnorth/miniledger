import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { authHeader, lastOtpSent, login, resetDatabase } from "./helpers.js";

const app = buildApp({ logger: false });
const PHONE = "9876543210";

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDatabase);

function requestOtp(phone = PHONE) {
  return app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
}
function verifyOtp(otp: string, phone = PHONE) {
  return app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp } });
}
// Any 6-digit code that isn't the real one.
function wrongCode(code: string) {
  return code === "000000" ? "111111" : "000000";
}

describe("POST /auth/request-otp", () => {
  it("rejects an invalid phone number with a message for that field", async () => {
    const res = await requestOtp("12345");
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.phone).toEqual(["Enter a valid 10-digit Indian mobile number"]);
  });

  it("sends a code but never returns it, and stores only a hash of it", async () => {
    const res = await requestOtp("+91 98765 43210");
    expect(res.statusCode).toBe(200);

    const code = lastOtpSent();
    expect(res.body).not.toContain(code);

    const row = await prisma.otpCode.findFirstOrThrow();
    expect(row.phone).toBe("+919876543210");
    expect(row.codeHash).not.toContain(code);
  });

  it("refuses to send another code within 30 seconds", async () => {
    await requestOtp();
    const res = await requestOtp();
    expect(res.statusCode).toBe(429);
    expect(res.json().retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("POST /auth/verify-otp", () => {
  it("logs in with the right code and returns a token that works", async () => {
    await requestOtp();
    const res = await verifyOtp(lastOtpSent());
    expect(res.statusCode).toBe(200);

    const { token, user } = res.json();
    const me = await app.inject({ url: "/auth/me", headers: authHeader(token) });
    expect(me.json()).toEqual({ id: user.id, phone: "+919876543210" });
  });

  it("rejects a wrong code and says how many attempts are left", async () => {
    await requestOtp();
    const res = await verifyOtp(wrongCode(lastOtpSent()));
    expect(res.statusCode).toBe(401);
    expect(res.json().attemptsLeft).toBe(4);
  });

  it("locks the code after 5 wrong attempts, even against the right code", async () => {
    await requestOtp();
    const code = lastOtpSent();
    for (let i = 0; i < 5; i++) {
      await verifyOtp(wrongCode(code));
    }
    const res = await verifyOtp(code);
    expect(res.statusCode).toBe(429);
  });

  it("lets exactly 5 attempts through when 10 guesses arrive at the same moment", async () => {
    await requestOtp();
    const guess = wrongCode(lastOtpSent());

    // All 10 requests run at once, so they race each other inside the database.
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(guess)));
    const statuses = results.map((res) => res.statusCode);

    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    expect((await prisma.otpCode.findFirstOrThrow()).attempts).toBe(5);
  });

  it("accepts each code only once", async () => {
    await requestOtp();
    const code = lastOtpSent();
    expect((await verifyOtp(code)).statusCode).toBe(200);
    expect((await verifyOtp(code)).statusCode).toBe(401);
  });

  it("rejects an expired code", async () => {
    await requestOtp();
    await prisma.otpCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verifyOtp(lastOtpSent())).statusCode).toBe(401);
  });
});

describe("protected routes", () => {
  it("reject a request with no token", async () => {
    const res = await app.inject({ url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("reject a token whose payload was edited to another user", async () => {
    const token = await login(app, PHONE);
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "999" })).toString("base64url");

    const res = await app.inject({
      url: "/auth/me",
      headers: authHeader(`${header}.${forgedPayload}.${signature}`),
    });
    expect(res.statusCode).toBe(401);
  });
});
