import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { authHeader, daysFromToday, login, resetDatabase } from "./helpers.js";

const app = buildApp({ logger: false });

// Two users, so every test can check that one can't touch the other's data.
let alice: string;
let bob: string;

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDatabase();
  alice = await login(app, "9876543210");
  bob = await login(app, "9123456789");
});

function addLoan(token: string, body: object) {
  return app.inject({ method: "POST", url: "/loans", headers: authHeader(token), payload: body });
}
function get(token: string, url: string) {
  return app.inject({ url, headers: authHeader(token) });
}
function repay(token: string, id: number | string) {
  return app.inject({ method: "PATCH", url: `/loans/${id}/repay`, headers: authHeader(token) });
}

type LoanJson = { id: number; friendName: string; amount: number; isOverdue: boolean };

describe("POST /loans", () => {
  it("requires login", async () => {
    const res = await app.inject({ method: "POST", url: "/loans", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("creates a loan and stores the amount as whole paise", async () => {
    const res = await addLoan(alice, { friendName: "  Ramesh ", amount: 250.5, dueDate: "2026-12-31" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      friendName: "Ramesh",
      amount: 250.5,
      dueDate: "2026-12-31",
      repaidAt: null,
    });

    const row = await prisma.loan.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.amountPaise).toBe(25050);
  });

  it.each([
    [{ friendName: "", amount: 100, dueDate: "2026-12-31" }, "friendName"],
    [{ friendName: "A", amount: 0, dueDate: "2026-12-31" }, "amount"],
    [{ friendName: "A", amount: -5, dueDate: "2026-12-31" }, "amount"],
    [{ friendName: "A", amount: 0.001, dueDate: "2026-12-31" }, "amount"],
    [{ friendName: "A", amount: 10_000_000.01, dueDate: "2026-12-31" }, "amount"],
    [{ friendName: "A", amount: 100, dueDate: "2026-02-30" }, "dueDate"],
    [{ friendName: "A", amount: 100 }, "dueDate"],
  ])("rejects %j with a message for %s", async (body, field) => {
    const res = await addLoan(alice, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().fields[field]).toHaveLength(1);
  });

  it("ignores a userId in the body: the loan belongs to whoever is logged in", async () => {
    const bobId = (await get(bob, "/auth/me")).json().id;
    const res = await addLoan(alice, { friendName: "Sneaky", amount: 1, dueDate: "2026-12-31", userId: bobId });
    expect(res.statusCode).toBe(201);
    expect((await get(bob, "/loans")).json().loans).toEqual([]);
  });
});

describe("GET /loans", () => {
  it("flags a loan overdue only if it is unpaid and was due before today", async () => {
    await addLoan(alice, { friendName: "Yesterday", amount: 100, dueDate: daysFromToday(-1) });
    await addLoan(alice, { friendName: "Today", amount: 100, dueDate: daysFromToday(0) });
    await addLoan(alice, { friendName: "Next month", amount: 100, dueDate: daysFromToday(30) });
    const paidLate = await addLoan(alice, { friendName: "Paid late", amount: 100, dueDate: daysFromToday(-10) });
    await repay(alice, paidLate.json().id);

    const loans: LoanJson[] = (await get(alice, "/loans")).json().loans;
    const overdueByName = Object.fromEntries(loans.map((loan) => [loan.friendName, loan.isOverdue]));
    expect(overdueByName).toEqual({ Yesterday: true, Today: false, "Next month": false, "Paid late": false });
  });

  it("lists unpaid loans first, earliest due date on top, then repaid ones", async () => {
    const paid = await addLoan(alice, { friendName: "Paid", amount: 100, dueDate: daysFromToday(-20) });
    await addLoan(alice, { friendName: "Later", amount: 100, dueDate: daysFromToday(10) });
    await addLoan(alice, { friendName: "Sooner", amount: 100, dueDate: daysFromToday(-5) });
    await repay(alice, paid.json().id);

    const loans: LoanJson[] = (await get(alice, "/loans")).json().loans;
    expect(loans.map((loan) => loan.friendName)).toEqual(["Sooner", "Later", "Paid"]);
  });

  it("shows only the logged-in user's loans", async () => {
    await addLoan(alice, { friendName: "Alice's friend", amount: 100, dueDate: "2026-12-31" });
    await addLoan(bob, { friendName: "Bob's friend", amount: 100, dueDate: "2026-12-31" });

    const loans: LoanJson[] = (await get(alice, "/loans")).json().loans;
    expect(loans.map((loan) => loan.friendName)).toEqual(["Alice's friend"]);
  });
});

describe("PATCH /loans/:id/repay", () => {
  it("marks a loan repaid, and repeating it keeps the first repayment time", async () => {
    const { id } = (await addLoan(alice, { friendName: "Ramesh", amount: 500, dueDate: "2026-12-31" })).json();

    const first = await repay(alice, id);
    expect(first.statusCode).toBe(200);
    expect(first.json().repaidAt).not.toBeNull();

    const second = await repay(alice, id);
    expect(second.statusCode).toBe(200);
    expect(second.json().repaidAt).toBe(first.json().repaidAt);
  });

  it("returns 404 for someone else's loan and leaves it unpaid (no IDOR)", async () => {
    const { id } = (await addLoan(alice, { friendName: "Ramesh", amount: 500, dueDate: "2026-12-31" })).json();

    const res = await repay(bob, id);
    expect(res.statusCode).toBe(404);

    const row = await prisma.loan.findUniqueOrThrow({ where: { id } });
    expect(row.repaidAt).toBeNull();
  });

  it("returns 404 for a loan that doesn't exist and 400 for an id that isn't a number", async () => {
    expect((await repay(alice, 99999)).statusCode).toBe(404);
    expect((await repay(alice, "abc")).statusCode).toBe(400);
  });
});

describe("GET /loans/summary", () => {
  it("is all zeros for a user with no loans", async () => {
    const summary = (await get(alice, "/loans/summary")).json();
    expect(summary).toEqual({ totalLent: 0, totalRepaid: 0, overdueAmount: 0, overdueCount: 0 });
  });

  it("adds up lent, repaid and overdue amounts, counting only this user's loans", async () => {
    await addLoan(alice, { friendName: "Overdue", amount: 1000.1, dueDate: daysFromToday(-5) });
    await addLoan(alice, { friendName: "Not due yet", amount: 2500.25, dueDate: daysFromToday(5) });
    const paid = await addLoan(alice, { friendName: "Repaid", amount: 499.65, dueDate: daysFromToday(-3) });
    await repay(alice, paid.json().id);
    await addLoan(bob, { friendName: "Bob's", amount: 9999, dueDate: daysFromToday(-1) });

    const summary = (await get(alice, "/loans/summary")).json();
    expect(summary).toEqual({ totalLent: 4000, totalRepaid: 499.65, overdueAmount: 1000.1, overdueCount: 1 });
  });

  it("adds money exactly: ₹0.10 + ₹0.20 is ₹0.30, not 0.30000000000000004", async () => {
    await addLoan(alice, { friendName: "A", amount: 0.1, dueDate: "2026-12-31" });
    await addLoan(alice, { friendName: "B", amount: 0.2, dueDate: "2026-12-31" });

    expect(0.1 + 0.2).not.toBe(0.3); // what float maths would give
    expect((await get(alice, "/loans/summary")).json().totalLent).toBe(0.3);
  });

  it("agrees with the overdue flags in the list (SQL and JavaScript use the same rule)", async () => {
    await addLoan(alice, { friendName: "A", amount: 120, dueDate: daysFromToday(-40) });
    await addLoan(alice, { friendName: "B", amount: 75.5, dueDate: daysFromToday(-1) });
    await addLoan(alice, { friendName: "C", amount: 300, dueDate: daysFromToday(0) });
    const repaid = await addLoan(alice, { friendName: "D", amount: 50, dueDate: daysFromToday(-2) });
    await repay(alice, repaid.json().id);

    const loans: LoanJson[] = (await get(alice, "/loans")).json().loans;
    const overdueInList = loans.filter((loan) => loan.isOverdue);
    const summary = (await get(alice, "/loans/summary")).json();

    // Compare in paise so the check itself doesn't add float error.
    const listPaise = overdueInList.reduce((sum, loan) => sum + Math.round(loan.amount * 100), 0);
    expect(Math.round(summary.overdueAmount * 100)).toBe(listPaise);
    expect(summary.overdueCount).toBe(overdueInList.length);
  });
});
