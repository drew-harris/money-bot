import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { openDatabase } from "./db.js";
import type { Quote } from "./prices.js";
import {
  accounts,
  cashMovements,
  holdings,
  orders,
  profiles,
  STARTING_CASH_CENTS,
  trades,
  transferIntents,
} from "./schema.js";
import {
  createTrading,
  InsufficientFunds,
  InsufficientShares,
  IntentNotFound,
  IntentExpired,
  IntentUnavailable,
  RecipientNotStarted,
} from "./trading.js";

const quote = (symbol: string, priceCents: number): Quote => ({
  symbol: symbol.trim().toUpperCase(),
  name: null,
  exchange: null,
  priceCents,
  previousCloseCents: null,
  changeCents: null,
  changePercent: null,
  currency: "USD",
  marketState: null,
  asOf: new Date(0),
});

const prices = {
  quote: async (symbol: string) =>
    quote(symbol, symbol.trim().toUpperCase() === "MSFT" ? 20_000 : 10_000),
};

test("accounts are created explicitly and reads have no enrollment side effects", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    assert.equal(await trading.portfolio("alice"), undefined);
    assert.deepEqual(await trading.leaderboard(), []);

    const started = trading.start("alice");
    assert.equal(started.created, true);
    assert.equal(trading.start("alice").created, false);
    assert.equal(
      (await trading.portfolio("alice"))?.cashCents,
      STARTING_CASH_CENTS,
    );
    assert.equal(database.db.select().from(cashMovements).all().length, 1);
  } finally {
    database.close();
  }
});

test("buy, sell, liquidate, and pay update profile-scoped audit rows", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    const alice = trading.start("alice");
    const bob = trading.start("bob");
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
        .where(eq(holdings.profileId, alice.profileId))
        .all(),
      [],
    );

    const payment = await trading.pay("alice", "bob", 25_050);
    assert.equal(payment.senderCashCents, STARTING_CASH_CENTS - 25_050);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.profileId, bob.profileId))
        .get()?.cashCents,
      STARTING_CASH_CENTS + 25_050,
    );
    assert.equal(database.db.select().from(trades).all().length, 5);
    assert.equal(database.db.select().from(cashMovements).all().length, 4);
  } finally {
    database.close();
  }
});

test("order previews do not mutate balances and confirmation is idempotent", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    trading.start("alice");
    const preview = await trading.prepareOrder("alice", "buy", "AAPL", 2);
    assert.equal(
      (await trading.portfolio("alice"))?.cashCents,
      STARTING_CASH_CENTS,
    );
    assert.equal(database.db.select().from(trades).all().length, 0);

    const first = await trading.confirmOrder("alice", preview.id);
    const repeated = await trading.confirmOrder("alice", preview.id);
    assert.equal(first.replayed, false);
    assert.equal(repeated.replayed, true);
    assert.deepEqual({ ...repeated, replayed: false }, first);
    assert.equal(first.totalCents, 20_000);
    assert.equal(database.db.select().from(trades).all().length, 1);
    assert.equal(
      database.db.select().from(orders).where(eq(orders.id, preview.id)).get()
        ?.status,
      "filled",
    );
  } finally {
    database.close();
  }
});

test("order confirmation re-prices the fill and enforces ownership", async () => {
  const database = openDatabase(":memory:");
  let priceCents = 10_000;
  try {
    const trading = createTrading(database.db, {
      quote: async (symbol) => quote(symbol, priceCents),
    });
    trading.start("alice");
    trading.start("bob");
    const preview = await trading.prepareOrder("alice", "buy", "AAPL", 2);
    priceCents = 12_000;
    await assert.rejects(
      trading.confirmOrder("bob", preview.id),
      IntentNotFound,
    );
    const fill = await trading.confirmOrder("alice", preview.id);
    assert.equal(fill.priceCents, 12_000);
    assert.equal(fill.totalCents, 24_000);

    const cancelled = await trading.prepareOrder("alice", "buy", "AAPL", 1);
    trading.cancelOrder("alice", cancelled.id);
    await assert.rejects(
      trading.confirmOrder("alice", cancelled.id),
      IntentUnavailable,
    );
  } finally {
    database.close();
  }
});

test("expired reviews persist their terminal status", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    trading.start("alice");
    trading.start("bob");
    const order = await trading.prepareOrder("alice", "buy", "AAPL", 1);
    database.db
      .update(orders)
      .set({ expiresAt: new Date(0) })
      .where(eq(orders.id, order.id))
      .run();
    await assert.rejects(
      trading.confirmOrder("alice", order.id),
      IntentExpired,
    );
    assert.equal(
      database.db.select().from(orders).where(eq(orders.id, order.id)).get()
        ?.status,
      "expired",
    );

    const transfer = trading.prepareTransfer("alice", "bob", 100);
    database.db
      .update(transferIntents)
      .set({ expiresAt: new Date(0) })
      .where(eq(transferIntents.id, transfer.id))
      .run();
    assert.throws(
      () => trading.confirmTransfer("alice", transfer.id),
      IntentExpired,
    );
    assert.equal(
      database.db
        .select()
        .from(transferIntents)
        .where(eq(transferIntents.id, transfer.id))
        .get()?.status,
      "expired",
    );
  } finally {
    database.close();
  }
});

test("message-sourced direct buys are idempotent", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    const first = await trading.buy("alice", "MAN", 1, "discord-message");
    const repeated = await trading.buy("alice", "MAN", 1, "discord-message");
    assert.deepEqual(repeated, first);
    assert.equal(database.db.select().from(trades).all().length, 1);
  } finally {
    database.close();
  }
});

test("domain validation leaves portfolio state unchanged", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    const alice = trading.start("alice");
    await assert.rejects(trading.buy("alice", "AAPL", 101), InsufficientFunds);
    await assert.rejects(trading.sell("alice", "AAPL", 1), InsufficientShares);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.profileId, alice.profileId))
        .get()?.cashCents,
      STARTING_CASH_CENTS,
    );
    assert.equal(database.db.select().from(trades).all().length, 0);
  } finally {
    database.close();
  }
});

test("portfolio reports FIFO cost basis and unrealized return", async () => {
  const database = openDatabase(":memory:");
  let priceCents = 10_000;
  const changingPrices = {
    quote: async (symbol: string) => quote(symbol, priceCents),
  };
  try {
    const trading = createTrading(database.db, changingPrices);
    trading.start("alice");
    await trading.buy("alice", "AAPL", 2);
    priceCents = 15_000;
    await trading.buy("alice", "AAPL", 1);
    await trading.sell("alice", "AAPL", 1);
    priceCents = 12_000;

    const portfolio = await trading.portfolio("alice");
    assert.ok(portfolio);
    assert.deepEqual(portfolio.positions, [
      {
        symbol: "AAPL",
        quantity: 2,
        priceCents: 12_000,
        valueCents: 24_000,
        costBasisCents: 25_000,
        gainLossCents: -1_000,
      },
    ]);
  } finally {
    database.close();
  }
});

test("one failed quote produces a partial portfolio instead of failing it", async () => {
  const database = openDatabase(":memory:");
  let failMsft = false;
  try {
    const trading = createTrading(database.db, {
      quote: async (symbol) => {
        if (failMsft && symbol === "MSFT") throw new Error("provider down");
        return quote(symbol, 10_000);
      },
    });
    trading.start("alice");
    await trading.buy("alice", "AAPL", 1);
    await trading.buy("alice", "MSFT", 1);
    failMsft = true;
    const portfolio = await trading.portfolio("alice");
    assert.ok(portfolio?.partial);
    assert.equal(
      portfolio.positions.find(({ symbol }) => symbol === "MSFT")?.priceCents,
      null,
    );
  } finally {
    database.close();
  }
});

test("leaderboard values one synchronous account and holdings snapshot", async () => {
  const database = openDatabase(":memory:");
  let blockNextQuote = false;
  let quoteStarted!: () => void;
  let releaseQuote!: () => void;
  const started = new Promise<void>((resolve) => {
    quoteStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseQuote = resolve;
  });
  try {
    const trading = createTrading(database.db, {
      quote: async (symbol) => {
        if (blockNextQuote) {
          blockNextQuote = false;
          quoteStarted();
          await release;
        }
        return quote(symbol, 10_000);
      },
    });
    trading.start("alice");
    await trading.buy("alice", "AAPL", 1);
    blockNextQuote = true;
    const leaderboard = trading.leaderboard();
    await started;
    await trading.sell("alice", "AAPL", 1);
    releaseQuote();
    assert.equal((await leaderboard)[0]?.netWorthCents, STARTING_CASH_CENTS);
  } finally {
    database.close();
  }
});

test("liquidation confirmation rejects a changed portfolio snapshot", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    trading.start("alice");
    await trading.buy("alice", "AAPL", 1);
    const preview = await trading.portfolio("alice");
    assert.ok(preview);
    await trading.buy("alice", "MSFT", 1);
    await assert.rejects(
      trading.liquidate("alice", preview.holdingsVersion),
      IntentUnavailable,
    );
    assert.equal((await trading.portfolio("alice"))?.positions.length, 2);
  } finally {
    database.close();
  }
});

test("a failed fill insert rolls back the entire order execution", async () => {
  const database = openDatabase(":memory:");
  try {
    database.db.run(
      sql.raw(`
      CREATE TRIGGER reject_trades
      BEFORE INSERT ON profile_trades
      BEGIN
        SELECT RAISE(FAIL, 'rejected trade');
      END
    `),
    );
    const trading = createTrading(database.db, prices);
    const alice = trading.start("alice");

    await assert.rejects(trading.buy("alice", "AAPL", 1), /rejected trade/);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.profileId, alice.profileId))
        .get()?.cashCents,
      STARTING_CASH_CENTS,
    );
    assert.equal(database.db.select().from(holdings).all().length, 0);
  } finally {
    database.close();
  }
});

test("transfers require an active recipient and cannot overflow balances", async () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    const alice = trading.start("alice");
    await assert.rejects(trading.pay("alice", "bob", 1), RecipientNotStarted);

    const bob = trading.start("bob");
    database.db
      .update(accounts)
      .set({ cashCents: Number.MAX_SAFE_INTEGER })
      .where(eq(accounts.profileId, bob.profileId))
      .run();

    await assert.rejects(trading.pay("alice", "bob", 1), RangeError);
    assert.equal(
      database.db
        .select()
        .from(accounts)
        .where(eq(accounts.profileId, alice.profileId))
        .get()?.cashCents,
      STARTING_CASH_CENTS,
    );
  } finally {
    database.close();
  }
});

test("transfer reviews are idempotent and appear in both activity feeds", () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    trading.start("alice");
    trading.start("bob");
    const preview = trading.prepareTransfer(
      "alice",
      "bob",
      2_500,
      "Paper lunch",
    );
    assert.equal(trading.activity("alice").length, 0);
    const first = trading.confirmTransfer("alice", preview.id);
    const repeated = trading.confirmTransfer("alice", preview.id);
    assert.equal(first.replayed, false);
    assert.equal(repeated.replayed, true);
    assert.deepEqual({ ...repeated, replayed: false }, first);
    assert.equal(trading.activity("alice")[0]?.kind, "transfer_sent");
    assert.equal(trading.activity("bob")[0]?.kind, "transfer_received");
    assert.equal(database.db.select().from(cashMovements).all().length, 4);
  } finally {
    database.close();
  }
});

test("the schema allows multiple profiles for one owner", () => {
  const database = openDatabase(":memory:");
  try {
    const trading = createTrading(database.db, prices);
    trading.start("alice");
    assert.doesNotThrow(() =>
      database.db
        .insert(profiles)
        .values({
          id: "strategy-profile",
          ownerUserId: "alice",
          name: "Momentum",
        })
        .run(),
    );
  } finally {
    database.close();
  }
});
