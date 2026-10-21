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

export const config = {
  host: process.env["HOST"] ?? "0.0.0.0",
  port: Number(process.env["PORT"] ?? 3000),
  databaseUrl: required("DATABASE_URL"),
};
