import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as Drizzle from "@effect/sql-drizzle/Sqlite";
import { SqliteClient } from "@effect/sql-sqlite-node";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Config, Effect, Layer } from "effect";

// Path to the SQLite database file (override with DATABASE_URL).
const DatabaseFile = Config.string("DATABASE_URL").pipe(
  Config.withDefault("data/money-bot.db"),
);

// Apply pending drizzle-kit migrations from ./migrations using a short-lived
// connection, before the app opens its own. Drizzle's better-sqlite3 migrator
// is used here because @effect/sql-drizzle turns queries into Effects, which the
// proxy migrator cannot drive.
const runMigrations = (file: string) =>
  Effect.try(() => {
    mkdirSync(dirname(file), { recursive: true });
    const sqlite = new BetterSqlite3(file);
    try {
      migrate(drizzle(sqlite), { migrationsFolder: "migrations" });
    } finally {
      sqlite.close();
    }
  }).pipe(
    Effect.tap(() => Effect.logInfo(`Database ready: ${file}`)),
    Effect.orDie,
  );

// SqlClient layer. Migrations run first so the schema exists before any query.
const SqlLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const file = yield* DatabaseFile;
    yield* runMigrations(file);
    return SqliteClient.layer({ filename: file });
  }),
);

// Drizzle query-builder integration, backed by the Effect SqlClient.
// Yield `SqliteDrizzle` in a handler to run type-safe drizzle queries as Effects.
export const DatabaseLive = Drizzle.layer.pipe(Layer.provideMerge(SqlLive));

export const SqliteDrizzle = Drizzle.SqliteDrizzle;
