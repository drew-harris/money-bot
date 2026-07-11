import { and, eq, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { SqliteDrizzle } from "./db.js";
import { Prices } from "./prices.js";
import { accounts, holdings, trades } from "./schema.js";

/** Tried to buy/sell zero or a negative number of shares. */
export class InvalidQuantity extends Data.TaggedError("InvalidQuantity")<{}> {}

/** Not enough cash to cover a buy. */
export class InsufficientFunds extends Data.TaggedError("InsufficientFunds")<{
  readonly needCents: number;
  readonly haveCents: number;
}> {}

/** Tried to sell more shares than are held. */
export class InsufficientShares extends Data.TaggedError("InsufficientShares")<{
  readonly symbol: string;
  readonly have: number;
  readonly want: number;
}> {}

/** Tried to liquidate a portfolio with no stock positions. */
export class NoHoldings extends Data.TaggedError("NoHoldings")<{}> {}

const makeTrading = Effect.gen(function* () {
  const db = yield* SqliteDrizzle;
  const prices = yield* Prices;

  // Create the account (with the starting cash default) if it's the first
  // time we've seen this user; a no-op afterwards.
  const ensureAccount = (userId: string) =>
    db.insert(accounts).values({ userId }).onConflictDoNothing();

  const getAccount = (userId: string) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId));
      return rows[0]!;
    });

  const portfolio = (userId: string) =>
    Effect.gen(function* () {
      yield* ensureAccount(userId);
      const account = yield* getAccount(userId);
      const rows = yield* db
        .select()
        .from(holdings)
        .where(eq(holdings.userId, userId));

      // Value each position at its current market price.
      const positions = yield* Effect.forEach(
        rows,
        (h) =>
          prices.quote(h.symbol).pipe(
            Effect.map((q) => ({
              symbol: h.symbol,
              quantity: h.quantity,
              priceCents: q.priceCents,
              valueCents: q.priceCents * h.quantity,
            })),
          ),
        { concurrency: 5 },
      );

      const holdingsValue = positions.reduce((sum, p) => sum + p.valueCents, 0);
      return {
        cashCents: account.cashCents,
        positions,
        netWorthCents: account.cashCents + holdingsValue,
      };
    });

  const buy = (userId: string, rawSymbol: string, quantity: number) =>
    Effect.gen(function* () {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return yield* new InvalidQuantity();
      }
      const symbol = rawSymbol.trim().toUpperCase();
      yield* ensureAccount(userId);

      const quote = yield* prices.quote(symbol);
      const costCents = quote.priceCents * quantity;
      const account = yield* getAccount(userId);
      if (account.cashCents < costCents) {
        return yield* new InsufficientFunds({
          needCents: costCents,
          haveCents: account.cashCents,
        });
      }

      const cashCents = account.cashCents - costCents;
      yield* db
        .update(accounts)
        .set({ cashCents })
        .where(eq(accounts.userId, userId));
      yield* db
        .insert(holdings)
        .values({ userId, symbol, quantity })
        .onConflictDoUpdate({
          target: [holdings.userId, holdings.symbol],
          set: { quantity: sql`${holdings.quantity} + ${quantity}` },
        });
      yield* db.insert(trades).values({
        userId,
        symbol,
        side: "buy",
        quantity,
        priceCents: quote.priceCents,
      });

      return {
        symbol,
        quantity,
        priceCents: quote.priceCents,
        costCents,
        cashCents,
      };
    });

  const sell = (userId: string, rawSymbol: string, quantity: number) =>
    Effect.gen(function* () {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return yield* new InvalidQuantity();
      }
      const symbol = rawSymbol.trim().toUpperCase();
      yield* ensureAccount(userId);

      const where = and(
        eq(holdings.userId, userId),
        eq(holdings.symbol, symbol),
      );
      const existingRows = yield* db.select().from(holdings).where(where);
      const existing = existingRows[0];
      if (!existing || existing.quantity < quantity) {
        return yield* new InsufficientShares({
          symbol,
          have: existing?.quantity ?? 0,
          want: quantity,
        });
      }

      const quote = yield* prices.quote(symbol);
      const proceedsCents = quote.priceCents * quantity;

      if (existing.quantity === quantity) {
        yield* db.delete(holdings).where(where);
      } else {
        yield* db
          .update(holdings)
          .set({ quantity: existing.quantity - quantity })
          .where(where);
      }

      const account = yield* getAccount(userId);
      const cashCents = account.cashCents + proceedsCents;
      yield* db
        .update(accounts)
        .set({ cashCents })
        .where(eq(accounts.userId, userId));
      yield* db.insert(trades).values({
        userId,
        symbol,
        side: "sell",
        quantity,
        priceCents: quote.priceCents,
      });

      return {
        symbol,
        quantity,
        priceCents: quote.priceCents,
        proceedsCents,
        cashCents,
      };
    });

  const liquidate = (userId: string) =>
    Effect.gen(function* () {
      yield* ensureAccount(userId);
      const positions = yield* db
        .select()
        .from(holdings)
        .where(eq(holdings.userId, userId));
      if (positions.length === 0) {
        return yield* new NoHoldings();
      }

      // Resolve every price before changing the portfolio, so a price failure
      // leaves every holding intact rather than creating a partial liquidation.
      const orders = yield* Effect.forEach(
        positions,
        (position) =>
          prices.quote(position.symbol).pipe(
            Effect.map((quote) => ({
              symbol: position.symbol,
              quantity: position.quantity,
              priceCents: quote.priceCents,
              proceedsCents: quote.priceCents * position.quantity,
            })),
          ),
        { concurrency: 5 },
      );
      const proceedsCents = orders.reduce(
        (total, order) => total + order.proceedsCents,
        0,
      );

      for (const order of orders) {
        yield* db
          .delete(holdings)
          .where(
            and(eq(holdings.userId, userId), eq(holdings.symbol, order.symbol)),
          );
        yield* db.insert(trades).values({
          userId,
          symbol: order.symbol,
          side: "sell",
          quantity: order.quantity,
          priceCents: order.priceCents,
        });
      }

      yield* db
        .update(accounts)
        .set({ cashCents: sql`${accounts.cashCents} + ${proceedsCents}` })
        .where(eq(accounts.userId, userId));
      const account = yield* getAccount(userId);

      return { orders, proceedsCents, cashCents: account.cashCents };
    });

  return { portfolio, buy, sell, liquidate } as const;
});

/**
 * Paper-trading operations: account management, buying, selling, and reading a
 * portfolio. Commands use this service and never touch the database directly.
 */
export class Trading extends Effect.Service<Trading>()("app/Trading", {
  effect: makeTrading,
}) {}
