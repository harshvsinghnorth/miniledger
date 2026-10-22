// Formatting money and dates the way people in India read them.

// Indian digit grouping: the last 3 digits, then groups of 2.
// "12345678" -> "1,23,45,678"
function groupIndian(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }
  const groups = [digits.slice(-3)];
  let rest = digits.slice(0, -3);
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  groups.unshift(rest);
  return groups.join(",");
}

// 125000 -> "₹1,25,000"; 250.5 -> "₹250.50". Works in whole paise to avoid float noise.
export function formatRupees(amount: number): string {
  const paise = Math.round(amount * 100);
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  const decimals = remainder ? `.${String(remainder).padStart(2, "0")}` : "";
  return `₹${groupIndian(String(rupees))}${decimals}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // UTC+05:30, no daylight saving

// The calendar date in India at a given moment, as "YYYY-MM-DD" (same rule as the server).
export function dateInIndia(moment: Date): string {
  return new Date(moment.getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

// "2026-10-31" -> "31 Oct 2026"
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

// "2026-10-22" + 7 -> "2026-10-29"
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The date picker works with Date objects in the phone's own calendar.
// These convert between that and our "YYYY-MM-DD" text.
export function toIsoDate(local: Date): string {
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${local.getFullYear()}-${month}-${day}`;
}

export function fromIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Whole days from one "YYYY-MM-DD" to another (negative if `to` is earlier).
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// The line under a friend's name: "Overdue by 3 days", "Due tomorrow", "Repaid on 22 Oct 2026"...
export function dueLabel(loan: { dueDate: string; repaidAt: string | null }, today: string): string {
  if (loan.repaidAt) {
    return `Repaid on ${formatDate(dateInIndia(new Date(loan.repaidAt)))}`;
  }
  const days = daysBetween(today, loan.dueDate);
  if (days < 0) {
    return `Overdue by ${plural(-days, "day")} · was due ${formatDate(loan.dueDate)}`;
  }
  if (days === 0) {
    return "Due today";
  }
  if (days === 1) {
    return "Due tomorrow";
  }
  return `Due ${formatDate(loan.dueDate)} · in ${plural(days, "day")}`;
}
