import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type Database = BetterSQLite3Database<typeof schema>;

export interface OpenDatabase {
  readonly db: Database;
  readonly close: () => void;
}

const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export const openDatabase = (
  file = process.env.DATABASE_URL ?? "data/money-bot.db",
): OpenDatabase => {
  const filename = file.startsWith("file:") ? fileURLToPath(file) : file;
  if (filename !== ":memory:" && filename !== "") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const sqlite = new BetterSqlite3(filename);
  try {
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    if (filename !== ":memory:" && filename !== "") {
      sqlite.pragma("journal_mode = WAL");
    }
    console.info(`Database ready: ${filename}`);
    return {
      db,
      close: () => {
        if (sqlite.open) sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
};
