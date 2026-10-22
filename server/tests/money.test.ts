import { describe, expect, it } from "vitest";
import { paiseToRupees, rupeesToPaise } from "../src/money.js";

describe("rupeesToPaise", () => {
  it.each([
    ["250", 25000],
    ["250.5", 25050],
    ["250.50", 25050],
    ["0.01", 1],
    ["1.15", 115],
    ["10000000", 1_000_000_000],
  ])("turns ₹%s into %i paise", (rupees, paise) => {
    expect(rupeesToPaise(rupees)).toBe(paise);
  });

  it("avoids the error that multiplying a float by 100 would cause", () => {
    expect(1.15 * 100).not.toBe(115); // 114.99999999999999
    expect(rupeesToPaise("1.15")).toBe(115);
  });
});

describe("paiseToRupees", () => {
  it("turns paise back into rupees", () => {
    expect(paiseToRupees(25050)).toBe(250.5);
    expect(paiseToRupees(1)).toBe(0.01);
    expect(paiseToRupees(0)).toBe(0);
  });
});
