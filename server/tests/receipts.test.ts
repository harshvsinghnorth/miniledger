import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { authHeader, login, resetDatabase } from "./helpers.js";

const app = buildApp({ logger: false });

let alice: string;
let bob: string;
let loanId: number;

// The first bytes of real image formats (the rest of the file doesn't matter to the check).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);

// Builds a multipart/form-data body by hand, the way a phone sends a file:
// a boundary line, headers describing the file, the raw bytes, and a closing boundary.
function multipartBody(fileName: string, contentType: string, content: Buffer) {
  const boundary = "----miniledger-test-boundary";
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="receipt"; filename="${fileName}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function upload(token: string, id: number, fileName: string, contentType: string, content: Buffer) {
  const body = multipartBody(fileName, contentType, content);
  return app.inject({
    method: "POST",
    url: `/loans/${id}/receipt`,
    headers: { ...authHeader(token), ...body.headers },
    payload: body.payload,
  });
}

function download(token: string, id: number) {
  return app.inject({ url: `/loans/${id}/receipt`, headers: authHeader(token) });
}

async function filesOnDisk(): Promise<string[]> {
  return existsSync(config.uploadsDir) ? readdir(config.uploadsDir) : [];
}

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDatabase();
  await rm(config.uploadsDir, { recursive: true, force: true });
  alice = await login(app, "9876543210");
  bob = await login(app, "9123456789");
  const res = await app.inject({
    method: "POST",
    url: "/loans",
    headers: authHeader(alice),
    payload: { friendName: "Ramesh", amount: 500, dueDate: "2026-12-31" },
  });
  loanId = res.json().id;
});

describe("POST /loans/:id/receipt", () => {
  it("requires login", async () => {
    const body = multipartBody("receipt.png", "image/png", PNG);
    const res = await app.inject({ method: "POST", url: `/loans/${loanId}/receipt`, ...body });
    expect(res.statusCode).toBe(401);
  });

  it("stores a real image under a random name and returns where to fetch it", async () => {
    const res = await upload(alice, loanId, "my receipt.png", "image/png", PNG);
    expect(res.statusCode).toBe(200);
    expect(res.json().receiptUrl).toMatch(new RegExp(`^/loans/${loanId}/receipt\\?v=`));

    const files = await filesOnDisk();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.png$/); // our name, not "my receipt.png"
  });

  it("rejects a script pretending to be a JPEG (checks the bytes, not the name)", async () => {
    const script = Buffer.from("<script>alert('hacked')</script>");
    const res = await upload(alice, loanId, "receipt.jpg", "image/jpeg", script);
    expect(res.statusCode).toBe(415);
    expect(await filesOnDisk()).toEqual([]);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).receiptPath).toBeNull();
  });

  it("rejects a file over 5 MB", async () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(alice, loanId, "huge.jpg", "image/jpeg", huge);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("The photo must be 5 MB or smaller");
    expect(await filesOnDisk()).toEqual([]);
  });

  it("returns 404 when uploading to someone else's loan, and stores nothing", async () => {
    const res = await upload(bob, loanId, "receipt.png", "image/png", PNG);
    expect(res.statusCode).toBe(404);
    expect(await filesOnDisk()).toEqual([]);
  });

  it("replaces the old photo and deletes its file", async () => {
    await upload(alice, loanId, "first.png", "image/png", PNG);
    await upload(alice, loanId, "second.jpg", "image/jpeg", JPEG);

    const files = await filesOnDisk();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.jpg$/);
  });
});

describe("GET /loans/:id/receipt", () => {
  it("sends the owner the exact bytes, with the image type and nosniff", async () => {
    await upload(alice, loanId, "receipt.png", "image/png", PNG);

    const res = await download(alice, loanId);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it("returns 404 to anyone else (no IDOR on files)", async () => {
    await upload(alice, loanId, "receipt.png", "image/png", PNG);
    expect((await download(bob, loanId)).statusCode).toBe(404);
  });

  it("returns 404 when the loan has no receipt", async () => {
    expect((await download(alice, loanId)).statusCode).toBe(404);
  });

  it("shows up in the loan list as receiptUrl", async () => {
    await upload(alice, loanId, "receipt.png", "image/png", PNG);
    const list = await app.inject({ url: "/loans", headers: authHeader(alice) });
    expect(list.json().loans[0].receiptUrl).toMatch(/^\/loans\/\d+\/receipt\?v=/);
  });
});
