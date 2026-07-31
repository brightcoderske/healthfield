import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

let pool: mysql.Pool | undefined;

export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  pool ??= mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 5),
    enableKeepAlive: true,
  });
  return pool;
}

export function getDb() {
  return drizzle(getPool());
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}
