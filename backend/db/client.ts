import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://localbus:localbus@localhost:5439/localbus";

const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
const connectionMaxLifetimeSeconds = Number(
  process.env.DATABASE_MAX_LIFETIME_SECONDS ?? 3600,
);

export const sqlClient = new SQL({
  url: databaseUrl,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
  maxLifetime:
    Number.isFinite(connectionMaxLifetimeSeconds) &&
    connectionMaxLifetimeSeconds > 0
      ? connectionMaxLifetimeSeconds
      : 3600,
});
export const db = drizzle({ client: sqlClient });
