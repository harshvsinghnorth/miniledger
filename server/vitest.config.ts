import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Tests always use the test database and dummy secrets from .env.test.
// (Variables already set in the environment win, which is how CI could override them.)
if (existsSync(".env.test")) process.loadEnvFile(".env.test");

export default defineConfig({
  test: {
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // All test files share one database, so run them one after another.
    fileParallelism: false,
  },
});
