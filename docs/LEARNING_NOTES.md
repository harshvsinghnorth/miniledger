# MiniLedger – learning notes

How the project works and why it's built this way: architecture, every file, every decision and its trade-off, and questions I should be able to answer about it. Updated after every milestone.

---

## 1. The big picture

MiniLedger tracks money you lent to friends. It has two halves:

- **`server/`**: an API written in TypeScript with **Fastify**, storing data in **PostgreSQL** through **Prisma**.
- **`app/`** (Day 2): a **React Native** app (Expo) on an Android phone that calls the API.

We picked this stack because it is exactly what CredSetu uses (their listing names Fastify, Zod, Prisma, PostgreSQL, Vitest, GitHub Actions, Docker). The assignment only says "Node.js + TypeScript + PostgreSQL", and Fastify and Prisma sit inside that.

### Request flow: the basic path

```
curl / phone
   │   HTTP GET /health
   ▼
Fastify  (src/app.ts)          logs every request and response
   │   runs the route handler
   ▼
Prisma client  (src/db.ts)     reuses a pool of open DB connections
   │   SQL: SELECT 1
   ▼
PostgreSQL 17  (Docker container, laptop port 5433)
```

### Request flow: logging in

```
Phone ── POST /auth/request-otp {phone} ──►  zod checks + normalizes phone to +91XXXXXXXXXX
                                             asked < 30 s ago? ──► 429
                                             random 6-digit code ──► store HMAC hash + expiry (DB)
                                             "send SMS" = print code in server log
      ◄── { message: "OTP sent" }  (never the code)

Phone ── POST /auth/verify-otp {phone, otp} ──►  newest code for this phone (DB)
                                             missing / used / expired? ──► 401
                                             count attempt (conditional UPDATE): 5 used? ──► 429
                                             hash(otp) ≠ stored hash? ──► 401 + attemptsLeft
                                             mark used (conditional UPDATE)
                                             create user if first login, sign JWT
      ◄── { token, user }

Phone ── GET /auth/me   Authorization: Bearer <token> ──►
         requireAuth (preHandler): signature valid and not expired? else 401
         sets request.userId ──► route handler ──► { id, phone }
```

### Request flow: loans

```
Phone ── POST /loans {friendName, amount: 250.5, dueDate: "2026-10-31"}   Bearer <token>
         requireAuth (hook on the whole loans plugin) ──► request.userId
         zod: trim name; "250.5" ──► 25050 paise (text maths, no floats); real calendar date
         INSERT with user_id from the TOKEN (any userId in the body is dropped)
      ◄── 201 { id, friendName, amount: 250.5, dueDate, repaidAt: null, isOverdue, … }

Phone ── GET /loans          ──► SELECT … WHERE user_id = me ──► isOverdue per loan (today in India)
Phone ── PATCH /loans/7/repay ──► UPDATE … WHERE id = 7 AND user_id = me AND repaid_at IS NULL
                                  then SELECT … WHERE id = 7 AND user_id = me ──► none? 404
Phone ── GET /loans/summary  ──► one SQL query: SUM(...) FILTER (WHERE ...) ──► 4 numbers
```

### Request flow: the phone app

```
Expo Go on the phone ──scans QR──► Metro dev server on the laptop (port 8081) sends the app's JavaScript
App starts ──► session.ts: token saved in SecureStore?
                 yes ──► HomeScreen ── api.me(token) ──► 401? clear token ──► LoginScreen
                 no  ──► LoginScreen
LoginScreen ── api.requestOtp("9876543210") ──► http://<laptop>:3000/auth/request-otp
            ── api.verifyOtp(phone, code)   ──► { token } ──► saveToken ──► HomeScreen
<laptop> = the address Expo Go loaded the app from (Constants.expoConfig.hostUri), not typed by hand

HomeScreen ── Promise.all([GET /loans, GET /loans/summary]) ──► SummaryCard + FlatList of LoanRow
           ── "Mark repaid" → confirm → PATCH /loans/:id/repay → load() again
           ── load fails? keep the last data + yellow banner;  401? → LoginScreen
           ── NetInfo: offline → banner;  back online → load() automatically
           ── "+ Add loan" → Modal with AddLoanScreen
AddLoanScreen ── validate() in the app (instant) ── POST /loans { friendName, amount: "1500", dueDate }
              ── 400? server's field messages under each field;  201? close, toast, HomeScreen.load()
```

### How the tests run

```
npm test
 ├─ vitest.config.ts       loads .env.test  →  DATABASE_URL = …/miniledger_test
 ├─ tests/global-setup.ts  once: refuse unless the DB name ends in _test, then prisma migrate deploy
 ├─ tests/setup.ts         every file: replace sendOtpSms with a fake that records the code
 └─ each test file, one at a time
      beforeEach: TRUNCATE all tables (+ log in Alice and Bob for loan tests)
      app.inject({ method, url, payload, headers })  →  routes → zod → Prisma → miniledger_test
      expect(...) on status codes, JSON bodies, and rows read straight from the database
```

### What CI does on every push

```
git push ──► GitHub Actions: fresh Ubuntu machine + a throwaway Postgres 17 on port 5433
             npm ci ──► lint ──► typecheck ──► build ──► test ──► ✓ or ✗ next to the commit
```

---

## 2. Files and what they do

| File | Purpose |
|---|---|
| `docker-compose.yml` | Runs Postgres 17 in a container. Maps laptop port **5433** to the container's 5432, because a local Postgres already uses 5432. |
| `docker/init-test-db.sql` | Runs once when the container is first created; makes a separate `miniledger_test` database so tests never touch dev data. |
| `.gitignore` | Keeps `node_modules`, build output, `.env` secrets and generated code out of Git. |
| `server/package.json` | Dependencies and scripts (`dev`, `build`, `start`, `typecheck`, `db:*`). `"type": "module"` makes Node treat our files as modern ES modules (`import`/`export`). |
| `server/tsconfig.json` | TypeScript compiler settings. `strict: true` turns on all type checks. Compiles `src/` into `dist/`. |
| `server/.env` | Real settings on this laptop. **Never committed.** |
| `server/.env.example` | A committed template of `.env`, so anyone cloning knows which variables to set. |
| `server/prisma/schema.prisma` | The single description of our tables (`users`, `otp_codes`, `loans`). |
| `server/prisma/migrations/…_init/migration.sql` | The SQL Prisma generated from the schema, plus one CHECK constraint we added by hand. Committed to Git. |
| `server/prisma.config.ts` | Tells the Prisma CLI where the schema and migrations live, and which database URL to use. |
| `server/src/config.ts` | Reads environment variables once at startup; crashes early with a clear message if a required one is missing, or if a secret is shorter than 32 characters. |
| `server/src/db.ts` | Creates the one shared `PrismaClient` (with the `pg` driver adapter). |
| `server/src/app.ts` | `buildApp()`: creates the Fastify app, sets up logging and the **central error handler**, registers routes. Does **not** start listening. |
| `server/src/validation.ts` | Zod schemas shared by routes: `phoneSchema` (accepts many formats, outputs `+91XXXXXXXXXX`), `otpSchema` (exactly 6 digits), `friendNameSchema`, `amountSchema` (rupees in, integer paise out, max ₹1 crore), `dueDateSchema` (real `YYYY-MM-DD` date), `loanIdSchema`. |
| `server/src/money.ts` | `rupeesToPaise` (exact, works on the text) and `paiseToRupees` (for responses). |
| `server/src/dates.ts` | `todayInIndia()` (the date in Asia/Kolkata, whatever the server's timezone) and `toDateString()`. |
| `server/src/routes/loans.ts` | The loan routes: `GET /loans`, `POST /loans`, `PATCH /loans/:id/repay`, `GET /loans/summary`, plus `isOverdue()` and the response shape. |
| `server/tsconfig.json` / `tsconfig.build.json` | The first is for checking types (app + tests + configs, emits nothing); the second compiles only `src/` into `dist/`. |
| `server/eslint.config.js` | Lint rules: ESLint's and typescript-eslint's recommended sets; ignores build output and generated code. |
| `server/.env.test` | Test settings: the `miniledger_test` database and dummy secrets. Committed on purpose (nothing real in it); CI uses it too. |
| `server/vitest.config.ts` | Loads `.env.test`, registers the setup files, runs test files one after another (they share a database). |
| `server/tests/global-setup.ts` | Runs once: the "_test" safety guard, then applies migrations to the test database. |
| `server/tests/setup.ts` | Runs in every test file: swaps the SMS sender for a recording fake. |
| `server/tests/helpers.ts` | `resetDatabase`, `login`, `lastOtpSent`, `authHeader`, `daysFromToday`. |
| `server/tests/*.test.ts` | Unit tests (`money`, `dates`, `validation`, `otp`) and integration tests (`auth`, `loans`): 81 in total. |
| `.github/workflows/ci.yml` | The GitHub Actions workflow: lint, typecheck, build and test the API, and typecheck and bundle the app, on every push and pull request. |
| `app/package.json`, `app.json` | The Expo app's dependencies (Expo SDK 57, React Native 0.86, React 19.2) and its Expo settings (name, icons, plugins). |
| `app/index.ts` | Expo's entry point: registers `App` as the root component. |
| `app/App.tsx` | The root: loads a saved token on launch, then shows `HomeScreen` (logged in) or `LoginScreen`. |
| `app/src/config.ts` | Works out the API address: `EXPO_PUBLIC_API_URL` if set, else the laptop Expo Go loaded the app from, port 3000. |
| `app/src/api.ts` | The only place that calls `fetch`: adds the token, 10 s timeout, JSON only when there's a body, turns failures into `ApiError` with a readable message. Also the typed endpoint functions. |
| `app/src/session.ts` | Saves, loads and clears the JWT in `expo-secure-store`. |
| `app/src/theme.ts` | Shared colours and spacing. |
| `app/src/components/Button.tsx` | `PrimaryButton` (spinner, ignores taps while loading) and `LinkButton`. |
| `app/src/components/TextField.tsx` | A labelled input with an optional prefix (`+91`) and its error message underneath. |
| `app/src/screens/LoginScreen.tsx` | Phone step → OTP step, resend countdown, attempts-left messages. |
| `app/src/screens/HomeScreen.tsx` | The main screen: loads loans + summary, summary card, loan list, mark repaid, pull-to-refresh, and the loading / error / empty / offline states. |
| `app/src/format.ts` | `formatRupees` (Indian grouping: ₹1,25,000), `formatDate` ("31 Oct 2026"), `dateInIndia`, and `dueLabel` ("Overdue by 3 days", "Due tomorrow", "Repaid on …"). |
| `app/src/components/SummaryCard.tsx` | The three totals: Total lent, Repaid (green), Overdue (red, with the number of loans). |
| `app/src/components/LoanRow.tsx` | One loan: name, amount, due label, OVERDUE badge and red styling, "Mark repaid" with its own spinner. |
| `app/src/screens/AddLoanScreen.tsx` | The add-loan form: name, amount (₹, decimal pad), due date (picker + 1 week / 2 weeks / 1 month), instant checks, server field errors, past-date warning. |
| `server/src/otp.ts` | Pure OTP helpers: generate a secure random code, HMAC-hash it, compare in constant time. Also the limits (5 min, 5 attempts, 30 s cooldown). |
| `server/src/sms.ts` | The mock SMS sender: prints the code to the log. The single function a real SMS provider would replace. |
| `server/src/auth.ts` | `signToken()` creates a JWT; `requireAuth` is the preHandler hook that protects routes and sets `request.userId`. |
| `server/src/routes/auth.ts` | The auth routes: `POST /auth/request-otp`, `POST /auth/verify-otp`, `GET /auth/me`. |
| `server/src/server.ts` | Entry point: builds the app and calls `listen()`. |
| `server/src/generated/prisma/` | Type-safe client code generated by `prisma generate`. Not committed; regenerated on `npm install`. |

---

## 3. Decisions and trade-offs

### Milestone 1: setup

**Fastify, not Express or NestJS.**
CredSetu uses Fastify. It feels like Express (plain functions, no decorators or dependency injection), but has built-in structured logging (pino), a plugin system and good TypeScript types. NestJS is a layer *on top of* Express or Fastify; for a 7-endpoint API, its modules/providers would be boilerplate.

**Prisma, not plain SQL.**
CredSetu uses Prisma. Like Drizzle in AllocFlow, it gives type-safe queries generated from a schema. Its migrations are still plain `.sql` files we commit and can edit (we did, to add a CHECK constraint). For the summary endpoint we'll use `$queryRaw`, so the important SQL stays visible.
*Trade-off:* an extra layer between us and the database, and a generated client we must remember to regenerate.

**Prisma 7.10.1, not the "latest" Prisma 8.**
npm's `latest` tag points at `8.0.0-rc.24`, a release candidate (not final). A submission shouldn't depend on pre-release software, so we pinned the last stable version.

**TypeScript 5.9, not 7.**
TypeScript 7 (the new Go-based compiler) is out, but typescript-eslint, which we'll use for linting in CI, only supports up to 6.0. Older but compatible beats newest but broken.

**Money as `INTEGER` paise.**
Floats can't represent most decimals exactly (`0.1 + 0.2 = 0.30000000000000004`), and money errors compound. So ₹250.50 is stored as `25050` paise. Why `INTEGER` and not `BIGINT`: an `INTEGER` holds up to ₹2.1 crore per entry, which is plenty for loans to friends (we'll cap entries in validation), and Prisma returns `BIGINT` columns as JavaScript `BigInt`, which `JSON.stringify` can't handle, so every response would need converting. For a merchant product like Patrata, with bigger totals, I'd use `BIGINT`.

**A CHECK constraint, written by hand.**
`CHECK (amount_paise > 0)` means the database refuses a zero or negative loan even if our validation code has a bug: two layers of defence. Prisma's schema language can't express CHECK constraints, so we created the migration with `--create-only`, added one line of SQL, then applied it.

**Postgres in Docker on port 5433.**
Same database for anyone who clones the repo (`docker compose up -d`), no install needed. Port 5433 avoids clashing with the local Postgres on 5432 (otherwise you get confusing "wrong password" errors from the wrong server).

**A separate test database.**
Tests will wipe and refill tables. Running them against `miniledger_test` means they never destroy dev data.

**`buildApp()` separate from `server.ts`.**
Tests can build the app and send fake requests with `app.inject()`, no real port, no network. `server.ts` is the only place that calls `listen()`.

**`HOST=0.0.0.0`.**
By default a server only listens on `127.0.0.1` (this laptop only). `0.0.0.0` means "every network interface", so a phone on the same Wi-Fi can reach it at the laptop's LAN IP (the server log prints it, e.g. `http://10.7.19.118:3000`).

**`/health` really queries the database.**
`{"ok": true}` proves the whole chain works, not just that Node is running. If Postgres is down it returns **503 Service Unavailable** instead of crashing. We tested both cases.

**Node's built-in `.env` loading, no `dotenv` package.**
Node 22 can read `.env` files itself (`--env-file=.env` flag, `process.loadEnvFile()`). One less dependency.

**Why imports end in `.js` inside `.ts` files.**
TypeScript compiles `db.ts` into `db.js`, and Node runs the `.js` files. With modern ES modules, Node needs the exact file name, so the import names the file that will exist at runtime.

**Checked what the tools generated.**
`prisma init` also downloaded AI-agent instruction files (`.claude/`, `.windsurf/`, `.agents/`) into the project. We deleted them: they aren't part of the app, and a reviewer would wonder why they're there.

### Milestone 2: OTP login

**The OTP is stored as an HMAC, not plain text and not bcrypt.**
If the database leaked, plain codes could be used straight away. A plain SHA-256 isn't enough either: there are only 1,000,000 possible 6-digit codes, so an attacker could hash them all in under a second and look the stolen hash up. HMAC-SHA256 mixes in `OTP_SECRET`, which lives in `.env`, not the database, so a leaked table alone is useless. bcrypt (built for passwords) is deliberately slow, but 1,000,000 guesses would still crack it in hours, and our codes expire in 5 minutes anyway, so slowness buys nothing.
*Trade-off:* if the database **and** `OTP_SECRET` both leak, codes could be cracked, but only for codes still inside their 5 minutes.

**`crypto.randomInt`, not `Math.random`.**
`Math.random` is fast but predictable: with enough outputs, the next ones can be worked out. `crypto.randomInt` uses the operating system's secure random source.

**`timingSafeEqual` for comparing hashes.**
A normal `===` stops at the first different character, so a wrong answer that shares a long prefix takes slightly longer. Measuring that leaks information. `timingSafeEqual` always takes the same time.

**Only the newest code counts.** Requesting a new code silently retires the old one, so there is only ever one live code per phone.

**Attempt limit with a conditional UPDATE** (the same trick as bed allocation in AllocFlow).
"Read attempts, check `< 5`, write attempts + 1" has a race: two guesses sent at the same moment both read 4 and both get through. Instead, one statement does the check and the write: `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < 5`. Postgres runs it atomically; if it changed 0 rows, the limit was hit. The attempt is counted *before* comparing, so even a correct 6th guess is refused (we tested this).

**One-time use, also with a conditional UPDATE:** `SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`. If two requests race with the right code, only one updates a row, so only one gets a token.

**30-second resend cooldown.** Every real SMS costs money, and attackers abuse OTP endpoints to send thousands of paid SMS ("SMS pumping"). The response includes `retryAfterSeconds` so the app can show a countdown.

**Status codes:** `400` = your input is malformed; `401` = wrong, expired or used code, or a bad token; `429 Too Many Requests` = slow down.

**One message for every bad token.** Expired, tampered with or signed with another key all get "Invalid or expired token". Telling an attacker *which* check failed helps them.

**JWT details.** Signed with HS256 and `JWT_SECRET`; payload is just `sub` (the user id), `iat` (issued at) and `exp` (expires, 7 days later). The algorithm is pinned when verifying (`algorithms: ["HS256"]`) so a forged token can't pick a weaker algorithm.
*Trade-off:* JWTs are stateless (the server stores nothing), so one can't be cancelled before it expires. Fixing that needs short-lived tokens plus refresh tokens, or a list of revoked tokens: a "one more week" item.

**Account created on first login** (`upsert`): there is no separate sign-up step, just like OkCredit or Khatabook. Your phone number *is* your account.

**One central error handler.** Routes call `schema.parse()`, which throws on bad input; `setErrorHandler` in `app.ts` turns that into a `400` with a message per field (`{"fields": {"phone": ["Enter a valid 10-digit Indian mobile number"]}}`), which the app will show under each input. Unknown errors become a `500` with a generic message, and the details go only to the server log.

**`sms.ts` is the swap point.** Moving to a real provider (MSG91, Twilio, AWS SNS) changes only that function, which is already `async` because a real one would make a network call. In India, commercial SMS also needs TRAI DLT registration of the sender ID and message template.

**Readable logs on the laptop, JSON in production.** `pino-pretty` (a dev dependency) formats lines like `[17:11:34] INFO: [mock SMS] OTP for +919876543210 is 007390`. With `NODE_ENV=production`, logs stay one JSON object per line for tools like CloudWatch.

### Milestone 3: loans

**Rupees in the API, paise in the database, and no float maths in between.**
The app sends rupees (`250.5` or `"250.50"`). `amountSchema` turns the value into text, checks it has at most 2 decimals, and `rupeesToPaise` splits on the dot: `"250.5"` → 250 × 100 + 50 = `25050`. Multiplying the float instead goes wrong: `1.15 * 100` is `114.99999999999999` in JavaScript. A float like `0.1 + 0.2` (`0.30000000000000004`) fails the 2-decimal rule and gets a 400 instead of being silently rounded. Responses divide by 100 to send rupees back; formatting (`₹250.50`, lakh commas) is the app's job.

**Limit: ₹1 crore per entry.** Keeps every amount far inside a Postgres `INTEGER` (max ~₹2.1 crore), and a typo like an extra zero gets caught. Written in code with Indian grouping: `1_00_00_000 * 100`.

**"Today" means today in India.** Servers usually run on UTC. Between midnight and 5:30 am IST, UTC is still on yesterday's date, so a loan due yesterday wouldn't show as overdue until 5:30 am. `todayInIndia()` adds India's fixed +05:30 offset (India has no daylight saving, so a fixed offset is exact). We tested the switch: 18:29:59 UTC is still the 21st in India, 18:30:00 UTC is the 22nd.

**"Today" is computed once in JavaScript and passed into SQL.** The summary query uses `${today}::date` as a parameter instead of Postgres's own `now()`. So there is exactly one definition of "today", and tests can freeze the clock (Vitest fake timers) to test overdue logic on any date.

**Overdue = not repaid AND due date before today.** A loan due *today* is not overdue yet: you have until the end of the day. A repaid loan is never overdue, even if it was paid late.

**The summary is one SQL query, not JavaScript.**
`SUM(amount_paise) FILTER (WHERE repaid_at IS NOT NULL)` means "add up only the rows that match". All four totals come from one pass over the user's loans. Computing in SQL means the database (which is built for this) does the work, and only 4 numbers travel to the server instead of every loan row, which matters at thousands of loans. `COALESCE(…, 0)` turns "no loans" (SQL gives `NULL`) into `0`. `SUM`/`COUNT` return `BIGINT`, which Prisma gives back as a JavaScript `BigInt`; `Number()` converts it, and that's exact up to about ₹90 trillion.

**No SQL injection, even with raw SQL.** `prisma.$queryRaw` is a *tagged template*: each `${…}` becomes a numbered parameter (`$1`, `$2`) sent separately from the SQL text. Postgres treats them strictly as values, so a friend named `'; DROP TABLE loans; --` is just a strange name. The dangerous version is building SQL by string concatenation, which `$queryRawUnsafe` would allow and we never use.

**No IDOR: the user always comes from the token.**
The bug from the hospital project was trusting an id the client sent. Here, `user_id` comes only from the verified JWT (`request.userId`), and every query includes it: `WHERE id = $1 AND user_id = $2`. A `userId` sent in the body is dropped by zod (unknown keys are stripped); we tested it. Another user's loan id returns **404, not 403**: 403 would confirm that loan 7 exists and belongs to someone.

**Repay is idempotent.** `UPDATE … WHERE … AND repaid_at IS NULL` only changes an unpaid loan, so calling it twice keeps the first repayment time (tested). That matters on a phone: on a bad network the app may retry a request that actually succeeded. `PATCH` is the HTTP method for "change part of an existing thing".

**List order:** unpaid loans first, earliest due date on top (the most overdue ones are what you need to chase), then repaid ones. The response is `{ loans: [...] }`, not a bare array, so fields like a pagination cursor can be added later without breaking the app.

**One hook protects the whole loans plugin.** `app.addHook("preHandler", requireAuth)` inside `loanRoutes` covers every route in it, and no route can be forgotten. Fastify plugins are *encapsulated*: the hook doesn't leak to `/health` or the auth routes.

**`201 Created`** for a new loan, with the created loan in the body, so the app can show it without fetching the list again.

**Gotcha found while testing: `Content-Type: application/json` with an empty body is rejected (400).** The repay request has no body, so the app's fetch wrapper must only set that header when it sends one.

**Out of scope, on purpose:** pagination, editing or deleting a loan, and partial repayments. They're in the "what I'd add next" answers below.

### Milestone 4: tests and CI

**Two kinds of tests.**
*Unit tests* call one pure function directly: `rupeesToPaise("1.15")` must be `115`. They're instant and pinpoint the broken function. *Integration tests* send real HTTP requests through the whole app into a real database: they prove the pieces work *together* (route + validation + auth + SQL). 4 unit files, 2 integration files, 81 tests.

**`app.inject()` instead of Supertest.** Fastify can push a fake HTTP request straight into the app without opening a port. That's faster, needs no extra package, and is the reason `buildApp()` is separate from `server.ts`.

**A real test database, not a mocked Prisma.** The most important logic lives in SQL: the summary query, the conditional UPDATEs, the CHECK constraint. Mocking the database would only test the mock. So tests run against `miniledger_test`, a separate database in the same Postgres container.
*Trade-off:* tests need Postgres running and are a bit slower (~6 s for all 81). Worth it.

**Tests can't wipe real data.** Every test starts by emptying the tables. Two protections stop that from hitting the dev database: tests read `.env.test`, which points at `miniledger_test`, and `global-setup.ts` refuses to start if the database name doesn't end in `_test`. We tested the guard by pointing tests at the dev database: they refused, and the dev loans were still there.

**Each test starts from empty tables** (`TRUNCATE … RESTART IDENTITY` in `beforeEach`), so a test never depends on what another test left behind, and they pass in any order.

**Test files run one at a time** (`fileParallelism: false`). They share one database; in parallel, one file's `TRUNCATE` would delete another file's rows mid-test.

**Reading the OTP in tests: a fake SMS sender.** The real `sendOtpSms` only prints the code. `tests/setup.ts` uses `vi.mock` to replace it with `vi.fn()`, a fake that records every call; `lastOtpSent()` reads the code from the last call. This is the same idea as a Mockito `@MockBean` in Spring. Only the SMS edge is faked: everything else is real.

**Dates relative to today.** Overdue tests use `daysFromToday(-1)`, `daysFromToday(0)` and so on, so they pass on any day. The tricky midnight-in-India boundary is tested directly on `todayInIndia()` with fixed instants (18:29:59 vs 18:30:00 UTC), which is why that function takes `now` as a parameter.

**A race-condition test.** Ten wrong OTP guesses are fired at once with `Promise.all`. Exactly 5 must get 401 and 5 must get 429, and the database must say `attempts = 5`. That proves the conditional UPDATE holds under concurrency, not just in theory.

**Tests that check money the way users see it:** ₹0.10 + ₹0.20 lent must show `totalLent: 0.3`, not `0.30000000000000004`; and the summary's overdue total must equal the sum of the loans the list flags as overdue (SQL and JavaScript apply the same rule).

**Checking the tests themselves: a test only proves something if it can fail.** We deliberately removed `userId` from the repay query (re-creating the IDOR bug). The IDOR test failed with `expected 200 to be 404`, so it really guards that bug. Then we restored the line exactly.

**Tests are type-checked too.** `tsconfig.json` now covers `src/`, `tests/` and the config files; the build uses `tsconfig.build.json` so only `src/` ends up in `dist/`. This caught a real type mistake in a test table on the first run.

**ESLint** reads code without running it and flags likely bugs (unused variables, unsafe patterns). It uses ESLint's and typescript-eslint's recommended rules and ignores generated code.

**GitHub Actions CI.** On every push to `main` and every pull request, GitHub starts a clean Ubuntu machine with a throwaway Postgres 17 (same user, password, database name and port as `.env.test`, so no CI-only settings are needed), then runs `npm ci`, lint, typecheck, build and tests. A green tick or red cross appears next to each commit. `npm ci` (not `npm install`) installs exactly the versions in `package-lock.json`.

**A fresh-clone check before committing.** We copied only the files Git would commit (no `.env`, no `node_modules`, no generated client) and ran the whole CI sequence there. It passed, which proves the repo works for someone who just cloned it.

**A tool quirk we worked around:** Vitest 5 can crash while *displaying* an error thrown from global setup (`code.charCodeAt is not a function`), hiding the real message. The guard prints its message with `console.error` before throwing, so the reason is always visible.

**What the tests don't cover** (say this honestly in the interview): the mobile app; a real SMS provider; token expiry after 7 days; load and performance; and we don't measure coverage. With more time: a test for expired tokens using fake timers, coverage reporting, and end-to-end tests of the app.

### Milestone 5: the app and the login screen

**React Native = React with phone components.** Same components, props, `useState` and `useEffect` as React on the web; `<View>` instead of `<div>`, `<Text>` instead of `<p>`, `<TextInput>` instead of `<input>`, `<Pressable>` instead of `<button>`, and styles as JavaScript objects (`StyleSheet.create`, Flexbox by default). React Native turns them into real Android views, not HTML.

**Expo + Expo Go.** Expo is the officially recommended way to build React Native apps: it handles the native build setup. During development, Expo Go (a ready-made app from the Play Store) downloads our JavaScript from the laptop's Metro server and runs it, so there's no Android Studio build. *Trade-off:* Expo Go only includes Expo's own native modules; something custom would need a development build.

**Expo SDK 57, not the newest 58.** npm already had SDK 58, but the Play Store's Expo Go only runs SDK 57, so the phone refused the project ("requires a newer version of Expo Go"). We checked Expo's version API (`expoGoSdkVersion: 57.0.0`), moved to 57 with `expo install --fix` (it aligns every Expo package), and re-ran `expo-doctor` (21/21). Staying on 57 also means a reviewer can open the project in the store's Expo Go.

**No navigation library, on purpose.** With two screens, `App.tsx` simply shows `LoginScreen` or `HomeScreen` depending on whether there's a token. With more screens and a back stack, I'd use expo-router or React Navigation.

**The API address is never typed in.** The phone can't use `localhost` (that's the phone itself). Expo Go knows which laptop it loaded the app from (`Constants.expoConfig.hostUri`, e.g. `10.37.63.146:8081`), so `config.ts` uses that address with port 3000. This mattered straight away: on the phone's hotspot the laptop's address changed from `10.7.19.118` to `10.37.63.146`, and the app needed no change. For a deployed server, `EXPO_PUBLIC_API_URL` overrides it.

**One `fetch` wrapper (`api.ts`).** Every request goes through `request()`, which adds `Authorization: Bearer`, sets `Content-Type: application/json` only when there's a body (the Fastify empty-body gotcha), aborts after 10 seconds with `AbortController` (a phone on a weak network shouldn't spin forever), and turns any failure into an `ApiError` with a message a screen can show. `status: 0` means "couldn't reach the server at all", so the screen can say "check your connection" instead of a server error.

**The token lives in `expo-secure-store`.** On Android it's encrypted with a key from the Android Keystore. `AsyncStorage` would keep it as plain text in the app's storage. On launch, `App.tsx` reads it back, so you stay logged in after closing the app (we tested this). If any request gets a `401` (token expired or invalid), the app clears it and shows the login screen.

**Validation in two places, for different reasons.** The app checks "10 digits" and "6 digits" instantly, for a better experience. The server validates everything again, because anyone can call the API without the app. Server messages (e.g. "Enter a valid 10-digit Indian mobile number") are shown as they are.

**Small touches that match how people use OTP screens:** the number pad keyboard; `+91` shown as a fixed prefix; `autoComplete="sms-otp"` so Android can offer to fill the code from an SMS once a real provider sends one; a "Resend in 30s" countdown that uses the server's `retryAfterSeconds`; "Incorrect OTP. 3 attempts left."; and buttons that show a spinner and ignore taps while a request runs, so a double-tap can't send twice.

**An honest label:** the login screen says "Demo: SMS is mocked. The OTP is printed in the server's terminal." The assignment asks for a mock OTP, and the README must not pretend otherwise.

**Safe areas.** Android now draws apps edge to edge (behind the status bar). `react-native-safe-area-context` adds the right padding so nothing hides under the clock or camera cut-out.

**Getting the phone to reach the laptop (troubleshooting we actually did):**
- College Wi-Fi ("Students 26") blocks devices from talking to each other, so the phone couldn't reach the laptop. The fix was the phone's own hotspot.
- On Windows, a "Public" network blocks incoming connections unless the program is allowed. Node.js was already allowed on Public networks, which we checked read-only with `Get-NetFirewallRule`.
- The quick test: open `http://<laptop-ip>:3000/health` in the phone's browser. If that fails, the app can't work either.
- Plain `http://` works in Expo Go. A standalone APK would need cleartext traffic allowed, or HTTPS on a deployed server.

**CI now checks the app too:** a second job runs `npm ci`, the TypeScript check and `expo export --platform android` (it builds the JavaScript bundle the phone downloads, which catches broken imports).

### Milestone 6: the home screen

**The list and the summary load in parallel.** `Promise.all([api.listLoans, api.summary])` sends both requests at once, so the screen waits for the slower one, not the two added together.

**The phone never decides money or overdue.** Totals come from `/loans/summary` (SQL), and the red highlight uses the server's `isOverdue`. The phone only *formats*. So the list and the card can't disagree, and the rule lives in one place (the server, which has tests). The phone does compute labels like "Overdue by 3 days", using India's date, the same rule as the server.

**Every state has a screen**, which is the first duty in CredSetu's listing:
- *first load:* a spinner;
- *first load failed:* what went wrong, plus a **Try again** button;
- *no loans:* an empty state with a sentence, not a blank screen;
- *a refresh failed:* the old data **stays** with a yellow banner ("Couldn't refresh: … Pull down to try again."). Wiping a screen full of useful data because one refresh failed is worse than showing it slightly old;
- *offline:* NetInfo reports `isConnected === false`, and the banner says "You're offline. Showing data from 14:05." When the connection comes back, the screen refreshes on its own. We tested all of these on the phone by stopping the server and using airplane mode.

**Mark repaid:** a confirmation dialog first (there's no undo), a spinner on that row only, then the whole list and summary reload from the server. *Trade-off:* reloading costs one extra request, but updating the row on the phone would mean copying the server's overdue and totals rules into the app. If the request fails, the user can simply try again, because the server ignores a second repay of the same loan (idempotent).

**`FlatList`, not `ScrollView` + `map`.** `FlatList` only creates the rows near the screen and reuses them while scrolling, so 1,000 loans scroll as smoothly as 10. It also gives pull-to-refresh (`RefreshControl`), a header (the summary card scrolls with the list) and an empty state.

**Indian number formatting is done by hand** in `formatRupees`: last 3 digits, then groups of 2 (`1,23,45,678`). `Intl.NumberFormat("en-IN")` would also work, but the phone's JavaScript engine (Hermes) handles locales differently from Node, and a 15-line function behaves the same everywhere and is easy to check. It works in whole paise, so even `0.1 + 0.2` displays as `₹0.30`.

**Overdue rows stand out three ways:** a red left edge, a red tint and an OVERDUE badge, plus red text, so they're obvious when scrolling and don't rely on colour alone. Repaid loans go grey with a green edge and drop to the bottom (the server's sort order).

**Not done (talking points):** the offline copy lives in memory, so if the app is closed while offline, it opens to an error. With more time I'd save the last data on the device (SQLite or AsyncStorage) and queue actions taken offline, like "mark repaid", to send when the connection returns, which is what a shop owner on a weak connection really needs.

### Milestone 7: the add-loan form

**A `Modal`, not a new navigation stack.** The form slides up over the list. `onRequestClose` makes Android's back button close it, and after saving, the home screen reloads. A Modal is a separate native window, so it gets its own `SafeAreaProvider` to know where the status bar is.

**Two layers of validation, shown in the same place.** `validate()` in the app catches the obvious (empty name, an amount that isn't like `1500` or `250.50`) instantly, without a network call. Anything the server rejects (e.g. ₹2 crore → "Amount can't be more than ₹1,00,00,000") comes back as `fields`, and the form puts each message under its own field. We tested both on the phone.

**The amount is sent as text** (`"1500"`, `"250.50"`). The server accepts a number or a string, and text means the value never becomes a float on the way: the server turns `"250.50"` into `25050` paise exactly.

**Due date: a picker, plus quick choices.** Udhaar is usually given "for a week" or "for a month", so 1 week / 2 weeks / 1 month are one tap away, with the default set to a week from today. "Change" opens Android's calendar (`@react-native-community/datetimepicker`); the component is rendered only while it's needed, and the result is kept only when the user taps OK (`event.type === "set"`).

**Dates as text, converted only at the picker.** The app keeps the due date as `"YYYY-MM-DD"`, the same as the API. The picker works with JavaScript `Date` objects in the phone's calendar, so `fromIsoDate`/`toIsoDate` convert at that boundary using the local year, month and day. This avoids the classic bug where midnight in India becomes the previous day in UTC.

**Past dates are allowed on purpose**: you may be recording a loan you gave last month. The form says, in red, that it will show as overdue, so it's never a surprise. (The demo video needs an overdue entry too.)

**Nothing typed is lost on failure.** If saving fails (offline, server down, validation), the form stays open with everything filled in and shows why. The Save button can't be double-tapped while saving.

**Small touches:** the name field gets focus and capitalises words; the amount uses the decimal number pad with a ₹ prefix; a toast ("Added ₹1,500 lent to Rahul") confirms the save, since the form disappears; the empty list now says how to add the first loan.

---

## 4. Commands

```bash
docker compose up -d          # start Postgres (from the repo root)
cd server
npm install                   # install packages + generate the Prisma client
npm run db:migrate            # apply migrations (dev) + regenerate the client
npm run dev                   # start the API with auto-restart on file changes
curl.exe http://localhost:3000/health

npm test                      # all 81 tests, against the miniledger_test database
npm run lint                  # ESLint
npm run typecheck             # TypeScript, app + tests
```

On Windows PowerShell, type **`curl.exe`**, not `curl`: plain `curl` is an alias for PowerShell's `Invoke-WebRequest`, which behaves differently.

Logging in from PowerShell (`Invoke-RestMethod` handles JSON bodies without quoting problems):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/auth/request-otp -ContentType 'application/json' -Body '{"phone":"9876543210"}'
# read the 6-digit code from the server terminal, then:
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/auth/verify-otp -ContentType 'application/json' -Body '{"phone":"9876543210","otp":"123456"}'
Invoke-RestMethod -Uri http://localhost:3000/auth/me -Headers @{ Authorization = "Bearer $($login.token)" }
```

---

## 5. Interview Q&A

### Milestone 1: setup

**Q: What happens when you call `GET /health`?**
Fastify receives the request, logs it, and runs the handler. The handler asks Prisma to run `SELECT 1` on Postgres. If that works, it returns `{"ok": true}` with 200; if the database is unreachable, it logs the error and returns 503.

**Q: What is a migration, and why commit them?**
A migration is a SQL file that changes the database structure (create a table, add a column). Committing them means every developer, the CI server and production build the exact same database by running the same files in order. Prisma records which ones ran in a `_prisma_migrations` table.

**Q: `prisma migrate dev` vs `prisma migrate deploy`?**
`dev` is for your laptop: it compares the schema with the database, creates a new migration if something changed, and applies it. `deploy` is for CI and production: it only applies migrations that are already committed and never creates new ones.

**Q: How would you roll back a migration?**
Prisma migrations are forward-only: there's no automatic "down". To undo a change, you write a new migration that reverses it (e.g. drops the added column), and for real data loss, you restore from a backup. That's why you take a backup before deploying a risky migration.

**Q: Why store money as integer paise?**
Floats can't represent most decimal amounts exactly, so totals drift. Integers are exact. ₹250.50 → `25050`. The app sends rupees; the server converts to paise, and back to rupees in responses.

**Q: Why `INTEGER` and not `BIGINT` or `NUMERIC`?**
`INTEGER` covers ₹2.1 crore per entry, more than enough here, and avoids `BigInt` values that JSON can't serialize. `NUMERIC` is exact too, but Prisma returns it as a `Decimal` object, which is more conversion work for no benefit, since paise are always whole numbers.

**Q: Why Fastify?**
It's what your team uses. Beyond that: built-in JSON logging, good TypeScript support, and `inject()` for testing without opening a port. Compared with NestJS (which I used in AllocFlow), there's no dependency-injection layer, which suits a small API.

**Q: Why does the server listen on `0.0.0.0`?**
So devices on the same network (my phone) can reach it. Think of the laptop as a building with several doors: `127.0.0.1` is an internal door only programs on the laptop can use; `10.7.19.118` is the street door on the Wi-Fi. `HOST=127.0.0.1` answers only the internal door, so the phone knocks on the right address and nobody answers. `0.0.0.0` means "answer at every door".

**Q: Why does `/health` return 503 instead of letting the error throw?**
Fastify wouldn't crash, but it would send a `500 Internal Server Error`, which means "my code has a bug" (wrong here: a dependency is down) and its default body includes the raw error message, leaking internal details. `503 Service Unavailable` means "I'm alive but can't serve right now, try later". The app can show a retry message, and monitoring (UptimeRobot, an AWS load balancer, Cloud Run health checks) knows to alert or stop sending traffic. We still log the full error for ourselves.

**Q: Why did you create the first migration with `--create-only`?**
To edit the SQL before it ran. Prisma can't express CHECK constraints, so we added `CHECK (amount_paise > 0)` by hand. Applied migrations shouldn't be edited (Prisma stores a checksum of each file and complains if it changes), so editing the draft first kept it to one clean migration instead of a second "fix-up" one.

### Milestone 2: OTP login

**Q: Walk me through your OTP login.**
The app sends the phone number; the server validates and normalizes it, refuses if a code was sent in the last 30 seconds, generates a secure random 6-digit code, stores only its HMAC hash with a 5-minute expiry, and "sends" it (prints it to the log). The app then sends the phone and code; the server takes the newest code for that phone, rejects it if missing, used or expired, counts the attempt (max 5), compares hashes in constant time, marks the code used, creates the user on first login and returns a signed JWT.

**Q: Why hash the OTP, and why HMAC instead of bcrypt?**
So a database leak doesn't hand out working codes. Plain SHA-256 fails because there are only a million codes to try. HMAC adds a secret key that isn't in the database. bcrypt's slowness doesn't help when the whole space is a million codes and they expire in 5 minutes.

**Q: What stops someone brute-forcing the OTP?**
5 guesses per code, then that code is dead; a new code needs 30 seconds; and each new code goes by SMS to the real owner, who notices. 5 guesses in a million is a 1-in-200,000 chance per code. At one code per 30 seconds, guessing right would take around a month of nonstop requests on average. With more time I'd add per-IP rate limiting too.

**Q: Why a conditional UPDATE for the attempt counter?**
Because "read, check, then write" is a race: two guesses at the same instant could both read 4 attempts and both get in. `UPDATE … SET attempts = attempts + 1 WHERE id = $1 AND attempts < 5` does the check and the write atomically in Postgres, the same idea I used for bed allocation in AllocFlow.

**Q: What is a JWT and what's inside yours?**
Three base64url parts joined by dots: header (`{"alg":"HS256"}`), payload (`{"sub":"1","iat":…,"exp":…}`) and signature. It is *signed, not encrypted*: anyone can read the payload, but nobody without `JWT_SECRET` can change it without breaking the signature (we tested a tampered token: 401). That's why there's nothing secret in the payload.

**Q: What happens when the token expires? Can you log someone out?**
After 7 days, every protected request gets 401 and the app sends the user back to login. Because JWTs are stateless, I can't cancel one early. The fix is short-lived access tokens plus refresh tokens, or a revocation list.

**Q: How does a protected route work in Fastify?**
The route has `preHandler: requireAuth`. Fastify runs that hook first; it checks the `Authorization: Bearer` header, verifies the signature and expiry, and either replies 401 or sets `request.userId` for the handler. It's the Fastify version of a Spring filter or a NestJS guard.

**Q: What changes with a real SMS provider?**
Only `sendOtpSms` in `sms.ts`, plus removing the code from logs, handling delivery failures, stricter rate limits (SMS costs money), and in India, TRAI DLT registration of the sender ID and template.

### Milestone 3: loans

**Q: How do you make sure a user can't see or repay someone else's loan?**
The user id comes only from the verified JWT, never from the request. Every loan query includes it: `WHERE id = $1 AND user_id = $2`. Another user's loan id matches nothing and returns 404. A `userId` in the request body is stripped by zod. This is the IDOR bug I fixed in the hospital project, prevented by design here.

**Q: Why 404 and not 403 for someone else's loan?**
403 says "this exists, but it's not yours", which leaks that loan 7 exists. 404 treats it exactly like a loan that doesn't exist.

**Q: How do you calculate the overdue amount? Which timezone is "today"?**
The sum of loans that are not repaid and whose due date is before today. "Today" is the date in India (Asia/Kolkata), not the server's date: a server on UTC would still be on yesterday until 5:30 am IST. I compute today once in JavaScript and pass it into the SQL as a parameter, so tests can freeze the date.

**Q: Show me the summary query. Why SQL and not JavaScript?**
`SELECT COALESCE(SUM(amount_paise), 0), COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NOT NULL), 0), … FROM loans WHERE user_id = $1`. The database adds it up in one pass and returns 4 numbers instead of every row. That's less data over the wire and it stays fast with many loans; with an index on `user_id`, Postgres reads only that user's rows.

**Q: How do you prevent SQL injection?**
Never build SQL from strings. Prisma's normal queries are parameterized, and for the raw summary query I use `$queryRaw` as a tagged template, where every `${value}` is sent as a separate parameter. User input can't change the query's structure.

**Q: How do you turn rupees into paise without floating-point errors?**
I never multiply the float. The amount is turned into text, checked for at most 2 decimals, and split on the dot: `"250.5"` → 250 × 100 + 50. `1.15 * 100` in JavaScript is `114.99999999999999`, which is exactly the bug this avoids.

**Q: What happens if the app calls "mark repaid" twice?**
Nothing bad: the update only touches rows where `repaid_at IS NULL`, so the second call changes nothing and returns the same loan with the original repayment time. Phones retry requests on bad networks, so endpoints like this should be idempotent.

**Q: What would you change if this had a million users?**
Indexes for the real queries (`user_id` already; `(user_id, due_date)` for sorting and overdue), pagination on `GET /loans`, rate limiting on the OTP endpoints per phone and per IP, a real SMS provider, receipts in S3 instead of the server's disk, several API instances behind a load balancer (easy, because JWTs are stateless), and caching or pre-computing summaries if they get slow.

**Q: What would you add with one more week?**
Partial repayments (a `repayments` table, with the balance calculated from it, which is how udhaar actually works for merchants), edit and delete with a history of changes, WhatsApp reminders, pagination, refresh tokens, and deployment with CI/CD.

### Milestone 4: tests and CI

**Q: What do your tests cover? What don't they?**
81 tests. Unit: rupee/paise conversion, India's date at the midnight boundary, phone/amount/date/OTP validation, OTP hashing. Integration, through real HTTP and a real database: the whole OTP flow (wrong codes, the 5-attempt lock, a 10-request race, one-time use, expiry, cooldown, forged tokens) and loans (validation errors, overdue rules, ordering, idempotent repay, IDOR, summary maths). Not covered: the mobile app, a real SMS provider, token expiry after 7 days, performance, and coverage isn't measured.

**Q: What's the difference between a unit test and an integration test?**
A unit test checks one function in isolation, so it's fast and points straight at the broken piece. An integration test checks several pieces working together: here a real HTTP request goes through routing, validation, auth and SQL into a real database.

**Q: Why test against a real database instead of mocking Prisma?**
Because the important logic is in SQL: the summary query, the conditional UPDATEs, the CHECK constraint. A mocked database would only prove my mock behaves the way I assumed. The trade-off is that tests need Postgres running, which CI provides as a service container.

**Q: The OTP is only printed in a log. How do your tests get it?**
The test setup replaces the SMS function with a Vitest fake (`vi.fn()`) that records its arguments, and the tests read the code from the last call, like a Mockito mock in Spring. Only that edge is faked; the rest of the flow is real.

**Q: Tests delete all rows before each test. How do you stop that from wiping real data?**
They run against a separate `miniledger_test` database from `.env.test`, and the global setup refuses to start unless the database name ends in `_test`. I tested that guard against the dev database: it refused and the dev data was untouched.

**Q: How do you know your tests actually test something?**
I broke the code on purpose: removed the `user_id` check from the repay query. The IDOR test failed (`expected 200 to be 404`), then I restored it. A test that can't fail proves nothing.

**Q: How do you test something that depends on today's date?**
Overdue tests create due dates relative to today (`daysFromToday(-1)`), so they pass on any day. The timezone edge is tested on `todayInIndia(now)` directly with fixed instants: that's why the function takes `now` as a parameter instead of always reading the clock.

**Q: What does your CI pipeline do, and why have one?**
On every push and pull request, GitHub Actions spins up Ubuntu with a throwaway Postgres, runs `npm ci`, lint, typecheck, build and the tests, and marks the commit green or red. It catches "works on my machine" problems and stops a broken change from being merged unnoticed.

**Q: What is `app.inject()`?**
Fastify's way of sending a request straight into the app in memory, without a network port. It's why the tests are fast, and why `buildApp()` is separate from `server.ts`, which is the only place that calls `listen()`.

### Milestone 5: the app and the login screen

**Q: Walk me through tapping "Verify" to seeing the home screen.**
`LoginScreen` checks the code is 6 digits, sets `loading` (the button shows a spinner and ignores taps), and calls `api.verifyOtp`. `api.ts` sends `POST /auth/verify-otp` with a JSON body to the laptop's address. The server checks the code and returns `{ token, user }`. `App.tsx` saves the token in SecureStore and puts it in state; React re-renders, sees a token, and shows `HomeScreen`, which calls `GET /auth/me` with `Authorization: Bearer <token>`.

**Q: How does the phone reach your laptop's server during development?**
Both are on the same network (my phone's hotspot; college Wi-Fi blocks device-to-device traffic). The server listens on `0.0.0.0`, so it accepts connections from the network, and Windows Firewall allows Node.js. The app doesn't hard-code the IP: Expo Go knows which laptop it loaded the app from (`hostUri`), so the app calls that address on port 3000.

**Q: Where do you store the JWT on the phone, and why there?**
In `expo-secure-store`, which on Android encrypts it with a key held in the Android Keystore. `AsyncStorage` would be plain text. It's read on launch so the user stays logged in; on a `401` it's deleted and the login screen comes back.

**Q: How is React Native different from React on the web?**
Same React (components, props, hooks). Different building blocks: `<View>`, `<Text>`, `<TextInput>`, `<Pressable>` instead of HTML elements, and styles are JS objects with Flexbox. It renders real native Android views, not a web page.

**Q: Why no navigation library?**
Two screens chosen by one condition (is there a token?) don't need one, and every dependency should earn its place. With a back stack, tabs or deep links I'd add expo-router or React Navigation.

**Q: The server validates input, so why does the app check it too?**
Different jobs: the app's check is for instant feedback without a network round trip; the server's is for security, because anyone can call the API directly. The server's messages are the source of truth, and the app displays them.

**Q: What happens on a bad network?**
Requests give up after 10 seconds (`AbortController`). A request that never reached the server becomes "Can't reach the server. Check your connection and try again." instead of an endless spinner. The buttons ignore taps while a request runs, so retries are deliberate.

**Q: Why Expo SDK 57 when 58 exists?**
The Play Store's Expo Go only supports SDK 57. I hit "requires a newer version of Expo Go", checked Expo's version API, and moved to 57. That also means any reviewer can open the project in the store's Expo Go.

### Milestone 6: the home screen

**Q: How do you handle loading, error, empty and offline states?**
Each has its own UI: a spinner on first load; an error with "Try again" if the first load fails; an empty state if there are no loans. If a later refresh fails, the last good data stays on screen with a banner explaining why. NetInfo tells me when the phone is offline (banner with the time of the data shown) and when it's back (automatic refresh). A 401 logs the user out.

**Q: How are overdue loans highlighted, and who decides what's overdue?**
The server decides: each loan has `isOverdue`, computed with India's date. The row then gets a red edge, a red tint, an OVERDUE badge and red "Overdue by N days" text. Because the summary also comes from the server, the list and the totals always agree.

**Q: Why not calculate the totals on the phone from the list?**
One source of truth. The rules (what counts as overdue, which "today") live on the server, where they're tested, and the SQL does the sums exactly in paise. Calculating on the phone would duplicate the rules and risk the card disagreeing with the server, and once the list is paginated the phone wouldn't even have all the loans.

**Q: What happens if "Mark repaid" is tapped on a bad network?**
The button shows a spinner and can't be tapped again. If the request times out or fails, the user sees an error and can retry, which is safe because the endpoint is idempotent: a second repay changes nothing. After success, the list and totals reload from the server.

**Q: Why FlatList?**
It virtualizes: it only renders rows near the screen and recycles them, so long lists stay fast and use little memory. It also has pull-to-refresh, header and empty-state support built in.

**Q: How do you show ₹1,25,000 instead of ₹125,000?**
A small function: take the last 3 digits, then group the rest in pairs. I wrote it by hand rather than relying on the phone's locale support, so it formats the same on every device, and I work in whole paise so floating-point noise never shows.

### Milestone 7: the add-loan form

**Q: How does validation work in the add-loan form?**
Two layers. The app checks the obvious instantly (name present, amount looks like `1500` or `250.50`). Then the server validates everything with zod; if it rejects something, it returns a message per field, and the form shows each under its field. The server is the real gatekeeper because anyone can call the API without the app.

**Q: Why send the amount as a string?**
So it never becomes a floating-point number on the way. The server parses `"250.50"` as text into `25050` paise. If the app sent `250.5` as a JSON number it would still work for that value, but text keeps the whole path exact by design.

**Q: How do you handle the due date and time zones?**
The date is a plain `"YYYY-MM-DD"` everywhere: app state, API and a Postgres `DATE` column. Only the date picker needs a `Date` object, and I convert at that boundary using the phone's local year, month and day, so picking 22 October can never turn into 21 October through a UTC conversion.

**Q: Why allow a due date in the past?**
Because people record loans after the fact. The form warns in red that the loan will show as overdue, so the user isn't surprised.

**Q: What happens if saving fails?**
The form stays open with everything still filled in, shows why (a field error, "Can't reach the server", etc.), and the button is ready to retry. While a save is running, the button shows a spinner and ignores taps, so a loan can't be added twice by a double-tap.
