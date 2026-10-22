// India (Asia/Kolkata) is UTC+05:30 all year round, with no daylight saving,
// so adding a fixed offset gives the exact Indian time.
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// Today's calendar date in India as "YYYY-MM-DD".
// Not the server's own date: cloud servers usually run on UTC, which is still
// "yesterday" between midnight and 5:30 am in India.
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

// A Postgres DATE comes back from Prisma as a Date at 00:00 UTC;
// this turns it back into "YYYY-MM-DD".
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
