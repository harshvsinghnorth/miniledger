# The MiniLedger API as a container image, built in two stages.

# ---- Stage 1: build. Install everything, generate the Prisma client, compile TypeScript. ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Copy only the package files first: Docker caches this layer, so dependencies are
# reinstalled only when package.json or package-lock.json change, not on every code edit.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# ---- Stage 2: run. Only production dependencies and the compiled JavaScript. ----
FROM node:22-bookworm-slim
# Prisma's migration engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --ignore-scripts skips our own postinstall (prisma generate: the client is already compiled
# into dist/). `npm rebuild` then runs only Prisma's install step, which downloads the
# migration engine now, while we're still root, instead of at startup.
RUN npm ci --omit=dev --ignore-scripts && npm rebuild prisma @prisma/engines

COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./

# Run as the unprivileged "node" user, not root. It owns only the receipts folder.
RUN mkdir -p uploads && chown node:node uploads
USER node

EXPOSE 3000
# Docker asks /health every 30 s; it also fails if the database is unreachable (503).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Apply any migrations that haven't run yet, then start the API.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/server.js"]
