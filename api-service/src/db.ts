import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type RowDataPacket } from "mysql2/promise";

let pool: mysql.Pool | undefined;

/**
 * Drizzle's MySQL TIMESTAMP mapper treats every returned wall-clock string as UTC.
 * Therefore the SQL session must also return UTC. A +03:00 SQL session makes Drizzle
 * append a false UTC suffix and every order, payment and receipt appears three hours
 * ahead on Nova. Keep the storage/driver boundary canonical, then format timestamps as
 * Africa/Nairobi at the API/UI edge.
 */
export const DATABASE_TIMEZONE = "+00:00";

export function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const created = mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    enableKeepAlive: true,
    timezone: DATABASE_TIMEZONE,
  });
  // Every pooled connection is stamped as it is opened. The pool option above tells
  // mysql2 how to read values; this tells MySQL and Drizzle what wall clock to return.
  //
  // Issued synchronously from the event handler, so it is first in that connection's
  // command queue and MySQL executes it before whatever the caller runs next.
  created.on("connection", (connection) => {
    // The promise pool forwards this event straight from the core pool, so despite the
    // typings the connection handed over here is the callback-style one. Awaiting its
    // query throws "not a promise" and takes the whole service down at startup.
    const raw = connection as unknown as {
      query: (sql: string, callback: (error: unknown) => void) => void;
    };
    raw.query(`SET time_zone = '${DATABASE_TIMEZONE}'`, (error) => {
      if (error) console.error("Database timezone could not be set on a new connection", error);
    });
  });
  pool = created;
  return pool;
}

export function getDb() {
  return drizzle(getPool());
}

/** Both clocks, so a deployment can be checked against Nairobi time from /health. */
export async function databaseClock() {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "select now() as databaseTime, @@session.time_zone as sessionTimezone, @@global.time_zone as serverTimezone",
  );
  const row = rows[0] ?? {};
  return {
    databaseTime: String(row.databaseTime ?? ""),
    sessionTimezone: String(row.sessionTimezone ?? ""),
    serverTimezone: String(row.serverTimezone ?? ""),
    configuredTimezone: DATABASE_TIMEZONE,
    nairobiTime: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi", hourCycle: "h23" }),
  };
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}
