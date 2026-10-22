// Money is stored as whole paise (₹1 = 100 paise), so it is always an exact integer.

// "250.5" -> 25050. Works on the text, so no floating-point multiplication happens
// (in JavaScript, 1.15 * 100 = 114.99999999999999).
export function rupeesToPaise(rupees: string): number {
  const [whole = "0", fraction = ""] = rupees.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

// 25050 -> 250.5, for JSON responses. Formatting it as "₹250.50" is the app's job.
export function paiseToRupees(paise: number): number {
  return paise / 100;
}
