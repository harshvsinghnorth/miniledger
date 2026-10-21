import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { config } from "./config.js";

// One PrismaClient for the whole app. It keeps a pool of open connections
// to Postgres, so each request reuses one instead of connecting from scratch.
const adapter = new PrismaPg({ connectionString: config.databaseUrl });

export const prisma = new PrismaClient({ adapter });
