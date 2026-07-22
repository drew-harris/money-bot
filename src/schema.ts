import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Money is stored as integer cents everywhere to avoid floating-point drift.
export const STARTING_CASH_CENTS = 1_000_000; // $10,000.00

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  discordUserId: text("discord_user_id").primaryKey(),
  activeProfileId: text("active_profile_id"),
  createdAt: timestamp("created_at"),
});

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.discordUserId),
    name: text("name").notNull().default("Main"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("profiles_owner_user_id_idx").on(table.ownerUserId),
    check(
      "profiles_status_valid",
      sql`${table.status} IN ('active', 'archived')`,
    ),
  ],
);

export const accounts = sqliteTable(
  "profile_accounts",
  {
    profileId: text("profile_id")
      .primaryKey()
      .references(() => profiles.id),
    cashCents: integer("cash_cents").notNull().default(STARTING_CASH_CENTS),
  },
  (table) => [
    check(
      "profile_accounts_cash_valid",
      sql`typeof(${table.cashCents}) = 'integer' AND ${table.cashCents} >= 0`,
    ),
  ],
);

export const holdings = sqliteTable(
  "profile_holdings",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    symbol: text("symbol").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.symbol] }),
    check(
      "profile_holdings_quantity_valid",
      sql`typeof(${table.quantity}) = 'integer' AND ${table.quantity} > 0`,
    ),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    symbol: text("symbol").notNull(),
    quantity: integer("quantity").notNull(),
    quotedPriceCents: integer("quoted_price_cents").notNull(),
    filledPriceCents: integer("filled_price_cents"),
    cashAfterCents: integer("cash_after_cents"),
    status: text("status", {
      enum: ["pending", "filled", "cancelled", "expired"],
    })
      .notNull()
      .default("pending"),
    source: text("source", { enum: ["manual", "strategy"] })
      .notNull()
      .default("manual"),
    strategyRevisionId: text("strategy_revision_id"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    filledAt: integer("filled_at", { mode: "timestamp_ms" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("orders_profile_status_idx").on(table.profileId, table.status),
    check(
      "orders_values_valid",
      sql`${table.side} IN ('buy', 'sell') AND ${table.status} IN ('pending', 'filled', 'cancelled', 'expired') AND typeof(${table.quantity}) = 'integer' AND ${table.quantity} > 0 AND typeof(${table.quotedPriceCents}) = 'integer' AND ${table.quotedPriceCents} > 0`,
    ),
  ],
);

// Immutable executions. Order IDs are nullable for imported and legacy fills.
export const trades = sqliteTable(
  "profile_trades",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: text("order_id").unique(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    quantity: integer("quantity").notNull(),
    priceCents: integer("price_cents").notNull(),
    source: text("source", { enum: ["manual", "strategy"] })
      .notNull()
      .default("manual"),
    strategyRevisionId: text("strategy_revision_id"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("profile_trades_profile_created_idx").on(
      table.profileId,
      table.createdAt,
    ),
    check(
      "profile_trades_values_valid",
      sql`${table.side} IN ('buy', 'sell') AND typeof(${table.quantity}) = 'integer' AND ${table.quantity} > 0 AND typeof(${table.priceCents}) = 'integer' AND ${table.priceCents} > 0`,
    ),
  ],
);

export const transferIntents = sqliteTable(
  "transfer_intents",
  {
    id: text("id").primaryKey(),
    fromProfileId: text("from_profile_id")
      .notNull()
      .references(() => profiles.id),
    toProfileId: text("to_profile_id")
      .notNull()
      .references(() => profiles.id),
    cents: integer("cents").notNull(),
    senderCashAfterCents: integer("sender_cash_after_cents"),
    note: text("note"),
    status: text("status", {
      enum: ["pending", "completed", "cancelled", "expired"],
    })
      .notNull()
      .default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    check(
      "transfer_intents_values_valid",
      sql`${table.status} IN ('pending', 'completed', 'cancelled', 'expired') AND typeof(${table.cents}) = 'integer' AND ${table.cents} > 0`,
    ),
  ],
);

export const cashMovements = sqliteTable(
  "cash_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    kind: text("kind", {
      enum: [
        "starting_cash",
        "migration_adjustment",
        "transfer_sent",
        "transfer_received",
      ],
    }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    transferId: text("transfer_id"),
    counterpartyUserId: text("counterparty_user_id"),
    note: text("note"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    check(
      "cash_movements_amount_valid",
      sql`${table.kind} IN ('starting_cash', 'migration_adjustment', 'transfer_sent', 'transfer_received') AND typeof(${table.amountCents}) = 'integer'`,
    ),
  ],
);

export const portfolioSnapshots = sqliteTable(
  "portfolio_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    netWorthCents: integer("net_worth_cents").notNull(),
    recordedAt: timestamp("recorded_at"),
  },
  (table) => [
    check(
      "portfolio_snapshots_value_valid",
      sql`typeof(${table.netWorthCents}) = 'integer' AND ${table.netWorthCents} >= 0`,
    ),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type Order = typeof orders.$inferSelect;
