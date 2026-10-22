import { describe, expect, it } from "vitest";
import { toDateString, todayInIndia } from "../src/dates.js";

describe("todayInIndia", () => {
  it("is still the same day one second before midnight in India (18:29:59 UTC)", () => {
    expect(todayInIndia(new Date("2026-10-21T18:29:59Z"))).toBe("2026-10-21");
  });

  it("moves to the next day at midnight in India (18:30 UTC)", () => {
    expect(todayInIndia(new Date("2026-10-21T18:30:00Z"))).toBe("2026-10-22");
  });

  it("differs from the UTC date early in the Indian morning", () => {
    const halfPastOneInIndia = new Date("2026-10-21T20:00:00Z"); // 01:30 IST on the 22nd
    expect(toDateString(halfPastOneInIndia)).toBe("2026-10-21"); // what a UTC server would say
    expect(todayInIndia(halfPastOneInIndia)).toBe("2026-10-22");
  });
});

describe("toDateString", () => {
  it("turns a Postgres DATE (midnight UTC) back into YYYY-MM-DD", () => {
    expect(toDateString(new Date("2026-10-31T00:00:00Z"))).toBe("2026-10-31");
  });
});
