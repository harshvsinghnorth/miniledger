import { execSync } from "node:child_process";

// Runs once, before any test file.
export default function globalSetup() {
  // Tests delete every row before each test. Refuse to run against any database
  // whose name doesn't end in "_test", so a wrong DATABASE_URL can't wipe real data.
  const databaseName = (process.env["DATABASE_URL"] ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (!databaseName.endsWith("_test")) {
    const message = `Refusing to run tests against database "${databaseName}": its name must end in _test`;
    // Printed first because Vitest 5 can fail to display errors thrown from global setup.
    console.error(`\n${message}\n`);
    throw new Error(message);
  }

  // Bring the test database up to date with the committed migrations.
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
}
