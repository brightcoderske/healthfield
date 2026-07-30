import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const globalDatabase = globalThis as typeof globalThis & { healthfieldPool?: mysql.Pool };

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be configured before database access.");
  }

  // Reuse the pool across hot reloads and requests to avoid exhausting cPanel connections.
  globalDatabase.healthfieldPool ??= mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 3,
    enableKeepAlive: true,
    decimalNumbers: true,
  });

  return drizzle(globalDatabase.healthfieldPool, { schema, mode: "default" });
}
