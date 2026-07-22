import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { eq } from "drizzle-orm";
import { openDatabase } from "./db.js";
import { accounts, cashMovements, trades } from "./schema.js";

test("profile migration preserves legacy portfolios and reconciles cash", () => {
  const directory = mkdtempSync(join(tmpdir(), "money-bot-migration-"));
  const filename = join(directory, "legacy.db");
  const legacy = new BetterSqlite3(filename);
  try {
    legacy.exec(`
      CREATE TABLE accounts (
        user_id text PRIMARY KEY NOT NULL,
        cash_cents integer DEFAULT 1000000 NOT NULL,
        created_at integer NOT NULL
      );
      CREATE TABLE holdings (
        user_id text NOT NULL,
        symbol text NOT NULL,
        quantity integer NOT NULL,
        PRIMARY KEY(user_id, symbol)
      );
      CREATE TABLE trades (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        user_id text NOT NULL,
        symbol text NOT NULL,
        side text NOT NULL,
        quantity integer NOT NULL,
        price_cents integer NOT NULL,
        created_at integer NOT NULL
      );
      CREATE TABLE __drizzle_migrations (
        id integer PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO accounts VALUES ('alice', 900000, 123000);
      INSERT INTO holdings VALUES ('alice', 'AAPL', 2);
      INSERT INTO trades VALUES (42, 'alice', 'AAPL', 'buy', 2, 5000, 124000);
      INSERT INTO __drizzle_migrations (id, hash, created_at)
      VALUES (1, 'legacy', 1781408775811);
    `);
  } finally {
    legacy.close();
  }

  const database = openDatabase(filename);
  try {
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.profileId, "alice"))
        .get()?.cashCents,
      900_000,
    );
    assert.equal(database.db.select().from(trades).get()?.id, 42);
    const movements = database.db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.profileId, "alice"))
      .all();
    assert.deepEqual(
      movements.map(({ kind, amountCents }) => ({ kind, amountCents })),
      [
        { kind: "starting_cash", amountCents: 1_000_000 },
        { kind: "migration_adjustment", amountCents: -90_000 },
      ],
    );
    assert.equal(movements[0]?.createdAt.getTime(), 123_000);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("receipt balance migration upgrades an already-applied profile schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "money-bot-receipts-"));
  const filename = join(directory, "profile.db");
  const before = new BetterSqlite3(filename);
  try {
    before.exec(`
      CREATE TABLE orders (
        id text PRIMARY KEY NOT NULL,
        filled_price_cents integer
      );
      CREATE TABLE transfer_intents (
        id text PRIMARY KEY NOT NULL,
        cents integer NOT NULL
      );
      CREATE TABLE __drizzle_migrations (
        id integer PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO __drizzle_migrations (id, hash, created_at)
      VALUES (2, 'profiles', 1784701768682);
    `);
  } finally {
    before.close();
  }

  const database = openDatabase(filename);
  database.close();
  const after = new BetterSqlite3(filename, { readonly: true });
  try {
    const orderColumns = after
      .prepare("PRAGMA table_info(orders)")
      .all()
      .map((column) => (column as { name: string }).name);
    const transferColumns = after
      .prepare("PRAGMA table_info(transfer_intents)")
      .all()
      .map((column) => (column as { name: string }).name);
    assert.ok(orderColumns.includes("cash_after_cents"));
    assert.ok(transferColumns.includes("sender_cash_after_cents"));
  } finally {
    after.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
