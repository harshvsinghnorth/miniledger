import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { toDateString, todayInIndia } from "../dates.js";
import { prisma } from "../db.js";
import type { Loan } from "../generated/prisma/client.js";
import { paiseToRupees } from "../money.js";
import { amountSchema, dueDateSchema, friendNameSchema, loanIdSchema } from "../validation.js";

const createLoanBody = z.object({
  friendName: friendNameSchema,
  amount: amountSchema,
  dueDate: dueDateSchema,
});
const loanParams = z.object({ id: loanIdSchema });

// SUM and COUNT return Postgres BIGINT, which Prisma hands back as JavaScript BigInt.
type SummaryRow = {
  total_lent: bigint;
  total_repaid: bigint;
  overdue_amount: bigint;
  overdue_count: bigint;
};

// Overdue = not repaid yet, and the due date is before today in India.
// "YYYY-MM-DD" strings sort the same way as the dates they describe,
// so a plain string comparison is enough.
export function isOverdue(loan: Loan, today: string): boolean {
  return loan.repaidAt === null && toDateString(loan.dueDate) < today;
}

// What the API returns for a loan: rupees instead of paise, the due date as plain text.
function toLoanResponse(loan: Loan, today: string) {
  return {
    id: loan.id,
    friendName: loan.friendName,
    amount: paiseToRupees(loan.amountPaise),
    dueDate: toDateString(loan.dueDate),
    repaidAt: loan.repaidAt,
    isOverdue: isOverdue(loan, today),
    createdAt: loan.createdAt,
  };
}

export async function loanRoutes(app: FastifyInstance) {
  // Every route in this plugin needs a logged-in user. Fastify plugins are
  // encapsulated, so this hook doesn't affect routes registered outside it.
  app.addHook("preHandler", requireAuth);

  app.get("/loans", async (request) => {
    // Every loan query filters by the logged-in user: you only ever see your own loans.
    const loans = await prisma.loan.findMany({
      where: { userId: request.userId },
      // Unpaid first with the earliest due date on top, repaid ones after.
      orderBy: [{ repaidAt: { sort: "asc", nulls: "first" } }, { dueDate: "asc" }, { id: "asc" }],
    });
    const today = todayInIndia();
    return { loans: loans.map((loan) => toLoanResponse(loan, today)) };
  });

  app.post("/loans", async (request, reply) => {
    const { friendName, amount, dueDate } = createLoanBody.parse(request.body);
    const loan = await prisma.loan.create({
      data: {
        userId: request.userId, // from the token, never from the request body
        friendName,
        amountPaise: amount,
        dueDate: new Date(dueDate),
      },
    });
    return reply.code(201).send(toLoanResponse(loan, todayInIndia()));
  });

  app.patch("/loans/:id/repay", async (request, reply) => {
    const { id } = loanParams.parse(request.params);

    // id AND user_id in one WHERE: another user's loan id simply matches nothing (no IDOR).
    // repaidAt: null makes a repeat call harmless: the first repayment time is kept.
    await prisma.loan.updateMany({
      where: { id, userId: request.userId, repaidAt: null },
      data: { repaidAt: new Date() },
    });

    const loan = await prisma.loan.findFirst({ where: { id, userId: request.userId } });
    if (!loan) {
      // 404, not 403: don't even confirm that a loan with this id exists.
      return reply.code(404).send({ error: "Loan not found" });
    }
    return toLoanResponse(loan, todayInIndia());
  });

  app.get("/loans/summary", async (request) => {
    const today = todayInIndia();

    // One pass over this user's loans; FILTER (WHERE ...) limits what each total adds up.
    // The ${...} values are sent to Postgres as query parameters, separately from the
    // SQL text, so user input can never change the query: no SQL injection.
    const [row] = await prisma.$queryRaw<SummaryRow[]>`
      SELECT
        COALESCE(SUM(amount_paise), 0) AS total_lent,
        COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NOT NULL), 0) AS total_repaid,
        COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NULL AND due_date < ${today}::date), 0) AS overdue_amount,
        COUNT(*) FILTER (WHERE repaid_at IS NULL AND due_date < ${today}::date) AS overdue_count
      FROM loans
      WHERE user_id = ${request.userId}
    `;

    // A SUM with no GROUP BY always returns exactly one row (zeros when there are no loans).
    return {
      totalLent: paiseToRupees(Number(row.total_lent)),
      totalRepaid: paiseToRupees(Number(row.total_repaid)),
      overdueAmount: paiseToRupees(Number(row.overdue_amount)),
      overdueCount: Number(row.overdue_count),
    };
  });
}
