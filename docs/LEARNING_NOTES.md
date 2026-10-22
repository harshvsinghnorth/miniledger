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

---

## 4. Commands

```bash
docker compose up -d          # start Postgres (from the repo root)
cd server
npm install                   # install packages + generate the Prisma client
npm run db:migrate            # apply migrations (dev) + regenerate the client
npm run dev                   # start the API with auto-restart on file changes
curl.exe http://localhost:3000/health
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
