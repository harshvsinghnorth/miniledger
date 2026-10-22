// All settings come from environment variables, read once at startup.
// A missing required value stops the server immediately with a clear error,
// instead of failing later in a confusing way.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

// A short secret can be guessed by brute force, so refuse to start with one.
function secret(name: string): string {
  const value = required(name);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters long`);
  }
  return value;
}

export const config = {
  isProduction: process.env["NODE_ENV"] === "production",
  host: process.env["HOST"] ?? "0.0.0.0",
  port: Number(process.env["PORT"] ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: secret("JWT_SECRET"),
  otpSecret: secret("OTP_SECRET"),
};
