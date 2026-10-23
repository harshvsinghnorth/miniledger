import { File } from "expo-file-system";
import { API_URL } from "./config";

const TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 60_000; // a photo over a slow hotspot can take a while

// An error a screen can show as-is: a readable message, plus the per-field
// messages the server sends with a 400 (e.g. { phone: ["Enter a valid ..."] }).
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number, // 0 = the server couldn't be reached at all
    public fields: Record<string, string[]> = {},
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown; // a plain object (sent as JSON) or FormData (a file upload)
  token?: string | null;
  timeoutMs?: number;
};

// The one place the app talks to the server.
export async function request<T>(
  path: string,
  { method = "GET", body, token, timeoutMs = TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const isUpload = body instanceof FormData;
  const headers: Record<string, string> = {};
  // Only say "this is JSON" when there is a JSON body: Fastify rejects an empty JSON body.
  // For an upload, fetch sets Content-Type itself, because it includes the multipart boundary.
  if (body !== undefined && !isUpload) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Give up after a while instead of spinning forever on a bad network.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isUpload ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // The user gets one plain sentence; the real cause goes to the Expo terminal while developing.
    if (__DEV__) {
      console.warn(`${method} ${path} failed before a response arrived:`, err);
    }
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error ?? `Something went wrong (${response.status})`, response.status, data.fields ?? {}, data);
  }
  return data as T;
}

export type User = { id: number; phone: string };

// The shapes the server sends back (see server/src/routes/loans.ts).
export type Loan = {
  id: number;
  friendName: string;
  amount: number; // rupees
  dueDate: string; // "YYYY-MM-DD"
  repaidAt: string | null; // ISO timestamp, null = not repaid
  isOverdue: boolean; // decided by the server, using today's date in India
  receiptUrl: string | null; // e.g. "/loans/7/receipt?v=1a2b3c4d"; needs the token to load
  createdAt: string;
};

// What expo-image's <Image source={...}> needs to show a receipt. Receipts aren't public,
// so the image request carries the same Authorization header as every other request.
// The URL's "?v=" changes with each new photo, so it doubles as the cache key.
export function receiptImageSource(token: string, receiptUrl: string) {
  return {
    uri: `${API_URL}${receiptUrl}`,
    headers: { Authorization: `Bearer ${token}` },
    cacheKey: receiptUrl,
  };
}

export type Summary = {
  totalLent: number;
  totalRepaid: number;
  overdueAmount: number;
  overdueCount: number;
};

export const api = {
  requestOtp: (phone: string) =>
    request<{ message: string; expiresInSeconds: number }>("/auth/request-otp", { method: "POST", body: { phone } }),

  verifyOtp: (phone: string, otp: string) =>
    request<{ token: string; user: User }>("/auth/verify-otp", { method: "POST", body: { phone, otp } }),

  me: (token: string) => request<User>("/auth/me", { token }),

  listLoans: (token: string) => request<{ loans: Loan[] }>("/loans", { token }),

  summary: (token: string) => request<Summary>("/loans/summary", { token }),

  repay: (token: string, id: number) => request<Loan>(`/loans/${id}/repay`, { method: "PATCH", token }),

  // amount is sent as text ("250.50"), so it never passes through a float on its way to paise.
  createLoan: (token: string, loan: { friendName: string; amount: string; dueDate: string }) =>
    request<Loan>("/loans", { method: "POST", body: loan, token }),

  uploadReceipt: (token: string, loanId: number, photoUri: string) => {
    const form = new FormData();
    // Expo's fetch needs a real file object that can hand over its bytes, like
    // expo-file-system's File. (React Native's older { uri, name, type } shortcut fails with
    // "Unsupported FormDataPart implementation".) The server checks the real bytes anyway.
    form.append("receipt", new File(photoUri));
    return request<Loan>(`/loans/${loanId}/receipt`, { method: "POST", body: form, token, timeoutMs: UPLOAD_TIMEOUT_MS });
  },
};
