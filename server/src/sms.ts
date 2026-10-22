import type { FastifyBaseLogger } from "fastify";

// Mock SMS: the assignment asks for the OTP to be printed in the server log.
// A real provider (MSG91, Twilio, AWS SNS) would replace only this function,
// which is why it is already async. Never log OTPs in production.
export async function sendOtpSms(log: FastifyBaseLogger, phone: string, code: string): Promise<void> {
  log.info({ phone }, `[mock SMS] OTP for ${phone} is ${code}`);
}
