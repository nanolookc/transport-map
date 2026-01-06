import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://localbus:localbus@localhost:5439/localbus";

export const sqlClient = new SQL(databaseUrl);
export const db = drizzle({ client: sqlClient });
