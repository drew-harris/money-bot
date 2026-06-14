import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Money is stored as integer cents everywhere to avoid floating-point drift.
// Every new account starts with this much cash.
export const STARTING_CASH_CENTS = 1_000_000; // $10,000.00

// One row per trader: their cash balance.
export const accounts = sqliteTable("accounts", {
  userId: text("user_id").primaryKey(),
  cashCents: integer("cash_cents").notNull().default(STARTING_CASH_CENTS),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// One row per (trader, stock) they currently hold shares of.
export const holdings = sqliteTable(
  "holdings",
  {
    userId: text("user_id").notNull(),
    symbol: text("symbol").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.symbol] })],
);

// Append-only log of every buy/sell, for history and auditing.
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  quantity: integer("quantity").notNull(),
  priceCents: integer("price_cents").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Account = typeof accounts.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type Trade = typeof trades.$inferSelect;
