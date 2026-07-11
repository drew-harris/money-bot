import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { openDatabase } from "./db.js";
import type { Prices } from "./prices.js";
import { accounts, holdings, STARTING_CASH_CENTS, trades } from "./schema.js";
import {
  createTrading,
  InsufficientFunds,
  InsufficientShares,
} from "./trading.js";

const prices: Prices = {
  quote: async (symbol) => ({
    symbol: symbol.trim().toUpperCase(),
    priceCents: symbol.trim().toUpperCase() === "MSFT" ? 20_000 : 10_000,
    currency: "USD",
  }),
};

test("buy, sell, liquidate, and pay update balances and audit rows", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    const buy = await trading.buy("alice", "aapl", 2);
    assert.equal(buy.cashCents, STARTING_CASH_CENTS - 20_000);

    const sell = await trading.sell("alice", "AAPL", 1);
    assert.equal(sell.cashCents, STARTING_CASH_CENTS - 10_000);

    await trading.buy("alice", "MSFT", 1);
    const liquidation = await trading.liquidate("alice");
    assert.equal(liquidation.orders.length, 2);
    assert.equal(liquidation.cashCents, STARTING_CASH_CENTS);
    assert.deepEqual(
      database.db
        .select()
        .from(holdings)
        .where(eq(holdings.userId, "alice"))
        .all(),
      [],
    );

    const payment = await trading.pay("alice", "bob", 25_050);
    assert.equal(payment.senderCashCents, STARTING_CASH_CENTS - 25_050);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, "bob"))
        .get()?.cashCents,
      STARTING_CASH_CENTS + 25_050,
    );
    assert.equal(database.db.select().from(trades).all().length, 5);
  } finally {
    database.close();
  }
});

test("domain validation leaves portfolio state unchanged", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    await assert.rejects(trading.buy("alice", "AAPL", 101), InsufficientFunds);
    await assert.rejects(trading.sell("alice", "AAPL", 1), InsufficientShares);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, "alice"))
        .get()?.cashCents,
      STARTING_CASH_CENTS,
    );
    assert.equal(database.db.select().from(trades).all().length, 0);
  } finally {
    database.close();
  }
});

test("a failed trade insert rolls back the entire buy", async () => {
  const database = openDatabase(":memory:");
  try {
    database.db.run(
      sql.raw(`
      CREATE TRIGGER reject_trades
      BEFORE INSERT ON trades
      BEGIN
        SELECT RAISE(FAIL, 'rejected trade');
      END
    `),
    );
    const trading = createTrading(database.db, prices);

    await assert.rejects(trading.buy("alice", "AAPL", 1), /rejected trade/);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, "alice"))
        .get(),
      undefined,
    );
    assert.equal(database.db.select().from(holdings).all().length, 0);
  } finally {
    database.close();
  }
});

test("invalid quotes and recipient overflow cannot change balances", async () => {
  const database = openDatabase(":memory:");
  try {
    const invalidPrices: Prices = {
      quote: async (symbol) => ({
        symbol,
        priceCents: -100,
        currency: "USD",
      }),
    };
    await assert.rejects(
      createTrading(database.db, invalidPrices).buy("alice", "AAPL", 1),
    );
    assert.equal(database.db.select().from(accounts).all().length, 0);

    const trading = createTrading(database.db, prices);
    await trading.portfolio("alice");
    await trading.portfolio("bob");
    database.db
      .update(accounts)
      .set({ cashCents: Number.MAX_SAFE_INTEGER })
      .where(eq(accounts.userId, "bob"))
      .run();

    await assert.rejects(trading.pay("alice", "bob", 1), RangeError);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, "alice"))
        .get()?.cashCents,
      STARTING_CASH_CENTS,
    );
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, "bob"))
        .get()?.cashCents,
      Number.MAX_SAFE_INTEGER,
    );
  } finally {
    database.close();
  }
});
