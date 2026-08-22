import { migrate } from "drizzle-orm/bun-sql/migrator";
import { db, sqlClient, writeSqlClient } from "./client";

try {
  await migrate(db, {
    migrationsFolder: new URL("./migrations", import.meta.url).pathname,
  });
} finally {
  await Promise.all([sqlClient.close(), writeSqlClient.close()]);
}
