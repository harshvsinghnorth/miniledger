// ESLint reads the code without running it and flags likely bugs and risky patterns.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  // Build output and Prisma's generated client aren't our code.
  { ignores: ["dist/", "src/generated/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
);
