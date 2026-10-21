import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// On a laptop, read server/.env. In CI and Docker there is no .env file:
// the variables come from the real environment instead.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
