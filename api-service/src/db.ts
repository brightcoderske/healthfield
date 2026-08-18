import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type RowDataPacket } from "mysql2/promise";

let pool: mysql.Pool | undefined;

/**
 * Healthfield trades in one timezone, so both ends of the connection are pinned to it.
 *
 * Two separate clocks decide what a stored timestamp means, and left to their defaults
 * they disagree: MySQL answers `now()` in whatever the server's `time_zone` is, while
 * mysql2 parses the returned DATETIME string using the Node process's local timezone.
 * With a UTC host and a +03:00 database, every timestamp is read three hours ahead of
 * the event it records. Setting both to the same offset makes the round trip exact.
 *
 * TIMESTAMP columns hold UTC internally and are converted on the way in and out, so
 * pinning the session timezone corrects rows that were already written, not just new
 * ones. Verify after deploying with /health, which reports both clocks.
 */
export const DATABASE_TIMEZONE = /^[+-]\d{2}:\d{2}$/.test(process.env.DB_TIMEZONE || "")
  ? (process.env.DB_TIMEZONE as string)
  : "+03:00";

export function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const created = mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    enableKeepAlive: true,
    timezone: DATABASE_TIMEZONE,
  });
  // Every pooled connection is stamped as it is opened. The pool option above only
  // tells mysql2 how to read what it is given; this tells MySQL what to give. The
  // offset is validated above, so interpolating it here cannot inject anything —
  // MySQL does not accept a placeholder in a SET for a system variable.
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
