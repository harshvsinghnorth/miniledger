import { vi } from "vitest";

// Runs before every test file. "Sending an SMS" is replaced by a fake function that
// records how it was called, so tests can read the OTP the server generated
// (the same idea as a Mockito mock in Spring).
vi.mock("../src/sms.js", () => ({ sendOtpSms: vi.fn() }));
