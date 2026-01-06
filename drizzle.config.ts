import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./backend/db/schema.ts",
  out: "./backend/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgres://localbus:localbus@localhost:5439/localbus",
  },
});
