import { API_URL } from "./config";

const TIMEOUT_MS = 10_000;

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
  body?: unknown;
  token?: string | null;
};

// The one place the app talks to the server.
export async function request<T>(path: string, { method = "GET", body, token }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  // Only say "this is JSON" when there is a body: Fastify rejects an empty JSON body.
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Give up after 10 seconds instead of spinning forever on a bad network.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
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
  createdAt: string;
};

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
};
