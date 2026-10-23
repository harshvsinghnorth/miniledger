import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { config } from "./config.js";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB: plenty for a phone photo

// Every image format starts with fixed "magic bytes". Checking them tells us what a file
// really is, whatever its name says or whatever type the client claims to be sending.
const IMAGE_TYPES = [
  {
    ext: ".jpg",
    mime: "image/jpeg",
    matches: (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  },
  {
    ext: ".png",
    mime: "image/png",
    matches: (data: Buffer) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: ".webp",
    mime: "image/webp",
    matches: (data: Buffer) => data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP",
  },
];

export function detectImageType(data: Buffer) {
  return IMAGE_TYPES.find((type) => type.matches(data)) ?? null;
}

// The Content-Type to send back, from the extension we chose when saving.
export function mimeTypeFor(fileName: string): string {
  return IMAGE_TYPES.find((type) => type.ext === extname(fileName))?.mime ?? "application/octet-stream";
}

// Saved under a random name we choose, never the uploader's file name,
// which could contain tricks like "../" to write outside the folder.
export async function saveReceipt(data: Buffer, ext: string): Promise<string> {
  await mkdir(config.uploadsDir, { recursive: true });
  const fileName = `${randomUUID()}${ext}`;
  await writeFile(join(config.uploadsDir, fileName), data);
  return fileName;
}

export function receiptFilePath(fileName: string): string {
  return join(config.uploadsDir, fileName);
}

// Best effort: a leftover file is harmless, so a failed delete shouldn't fail the request.
export async function deleteReceipt(fileName: string): Promise<void> {
  await unlink(receiptFilePath(fileName)).catch(() => undefined);
}
