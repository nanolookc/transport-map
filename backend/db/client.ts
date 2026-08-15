import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://localbus:localbus@localhost:5439/localbus";

const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 3);
const writePoolMax = Number(process.env.DATABASE_WRITE_POOL_MAX ?? 1);
const connectionMaxLifetimeSeconds = Number(
  process.env.DATABASE_MAX_LIFETIME_SECONDS ?? 0,
);

export const sqlClient = new SQL({
  url: databaseUrl,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
  maxLifetime:
    Number.isFinite(connectionMaxLifetimeSeconds) &&
    connectionMaxLifetimeSeconds >= 0
      ? connectionMaxLifetimeSeconds
      : 0,
});
export const db = drizzle({ client: sqlClient });

// Ingest writes are generated as multi-row VALUES statements, so their SQL text
// changes with every batch size. Keep them out of the long-lived prepared pool:
// otherwise each connection retains an unbounded number of named statements.
export const writeSqlClient = new SQL({
  url: databaseUrl,
  max: Number.isFinite(writePoolMax) && writePoolMax > 0 ? writePoolMax : 1,
  maxLifetime: 0,
  prepare: false,
});
export const writeDb = drizzle({ client: writeSqlClient });
