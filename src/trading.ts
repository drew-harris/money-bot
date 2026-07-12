import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import { type Prices, PriceUnavailable } from "./prices.js";
import { accounts, holdings, trades } from "./schema.js";

export class InvalidQuantity extends Error {}

export class InsufficientFunds extends Error {
  constructor(
    readonly needCents: number,
    readonly haveCents: number,
  ) {
    super("Insufficient funds");
  }
}

export class InsufficientShares extends Error {
  constructor(
    readonly symbol: string,
    readonly have: number,
    readonly want: number,
  ) {
    super("Insufficient shares");
  }
}

export class NoHoldings extends Error {}
export class InvalidPaymentAmount extends Error {}
export class SamePaymentRecipient extends Error {}

const mapConcurrent = async <A, B>(
  values: ReadonlyArray<A>,
  concurrency: number,
  transform: (value: A) => Promise<B>,
): Promise<Array<B>> => {
  const results = new Array<B>(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await transform(values[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

const checkedMoney = (value: number) => {
  if (!Number.isSafeInteger(value)) throw new RangeError("Money overflow");
  return value;
};

export interface Trading {
  readonly portfolio: (userId: string) => Promise<{
    cashCents: number;
    positions: Array<{
      symbol: string;
      quantity: number;
      priceCents: number;
      valueCents: number;
    }>;
    netWorthCents: number;
  }>;
  readonly leaderboard: () => Promise<
    Array<{ userId: string; netWorthCents: number }>
  >;
  readonly buy: (
    userId: string,
    symbol: string,
    quantity: number,
  ) => Promise<{
    symbol: string;
    quantity: number;
    priceCents: number;
    costCents: number;
    cashCents: number;
  }>;
  readonly sell: (
    userId: string,
    symbol: string,
    quantity: number,
  ) => Promise<{
    symbol: string;
    quantity: number;
    priceCents: number;
    proceedsCents: number;
    cashCents: number;
  }>;
  readonly liquidate: (userId: string) => Promise<{
    orders: Array<{
      symbol: string;
      quantity: number;
      priceCents: number;
      proceedsCents: number;
    }>;
    proceedsCents: number;
    cashCents: number;
  }>;
  readonly pay: (
    fromUserId: string,
    toUserId: string,
    cents: number,
  ) => Promise<{ cents: number; senderCashCents: number }>;
}

export const createTrading = (db: Database, prices: Prices): Trading => {
  const quoteUsd = async (symbol: string) => {
    const quote = await prices.quote(symbol);
    if (
      quote.currency !== "USD" ||
      !Number.isSafeInteger(quote.priceCents) ||
      quote.priceCents <= 0
    ) {
      throw new PriceUnavailable(
        symbol,
        new RangeError(`Invalid USD quote for ${symbol}`),
      );
    }
    return quote;
  };

  const ensureAccount = (userId: string) => {
    db.insert(accounts).values({ userId }).onConflictDoNothing().run();
  };

  const getAccount = (userId: string) => {
    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .get();
    if (!account) throw new Error(`Account not found: ${userId}`);
    return account;
  };

  return {
    portfolio: async (userId) => {
      ensureAccount(userId);
      const account = getAccount(userId);
      const rows = db
        .select()
        .from(holdings)
        .where(eq(holdings.userId, userId))
        .all();
      const positions = await mapConcurrent(rows, 5, async (holding) => {
        const quote = await quoteUsd(holding.symbol);
        return {
          symbol: holding.symbol,
          quantity: holding.quantity,
          priceCents: quote.priceCents,
          valueCents: checkedMoney(quote.priceCents * holding.quantity),
        };
      });
      const holdingsValue = positions.reduce(
        (sum, position) => checkedMoney(sum + position.valueCents),
        0,
      );
      return {
        cashCents: account.cashCents,
        positions,
        netWorthCents: checkedMoney(account.cashCents + holdingsValue),
      };
    },

    leaderboard: async () => {
      const accountRows = db.select().from(accounts).all();
      const holdingRows = db.select().from(holdings).all();
      const symbols = [...new Set(holdingRows.map(({ symbol }) => symbol))];
      const quotePairs = await mapConcurrent(
        symbols,
        5,
        async (symbol) =>
          [symbol, (await quoteUsd(symbol)).priceCents] as const,
      );
      const pricesBySymbol = new Map(quotePairs);
      const holdingsValueByUser = new Map<string, number>();
      for (const holding of holdingRows) {
        const priceCents = pricesBySymbol.get(holding.symbol);
        if (priceCents === undefined) {
          throw new Error(`Missing quote for ${holding.symbol}`);
        }
        const value = checkedMoney(priceCents * holding.quantity);
        holdingsValueByUser.set(
          holding.userId,
          checkedMoney((holdingsValueByUser.get(holding.userId) ?? 0) + value),
        );
      }
      return accountRows
        .map((account) => ({
          userId: account.userId,
          netWorthCents: checkedMoney(
            account.cashCents + (holdingsValueByUser.get(account.userId) ?? 0),
          ),
        }))
        .sort((a, b) => b.netWorthCents - a.netWorthCents);
    },

    buy: async (userId, rawSymbol, quantity) => {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new InvalidQuantity();
      }
      const symbol = rawSymbol.trim().toUpperCase();
      const quote = await quoteUsd(symbol);
      const costCents = checkedMoney(quote.priceCents * quantity);
      return db.transaction((tx) => {
        tx.insert(accounts).values({ userId }).onConflictDoNothing().run();
        const account = tx
          .select()
          .from(accounts)
          .where(eq(accounts.userId, userId))
          .get()!;
        if (account.cashCents < costCents) {
          throw new InsufficientFunds(costCents, account.cashCents);
        }
        const cashCents = checkedMoney(account.cashCents - costCents);
        tx.update(accounts)
          .set({ cashCents })
          .where(eq(accounts.userId, userId))
          .run();
        tx.insert(holdings)
          .values({ userId, symbol, quantity })
          .onConflictDoUpdate({
            target: [holdings.userId, holdings.symbol],
            set: { quantity: sql`${holdings.quantity} + ${quantity}` },
          })
          .run();
        tx.insert(trades)
          .values({
            userId,
            symbol,
            side: "buy",
            quantity,
            priceCents: quote.priceCents,
          })
          .run();
        return {
          symbol,
          quantity,
          priceCents: quote.priceCents,
          costCents,
          cashCents,
        };
      });
    },

    sell: async (userId, rawSymbol, quantity) => {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new InvalidQuantity();
      }
      const symbol = rawSymbol.trim().toUpperCase();
      ensureAccount(userId);
      const where = and(
        eq(holdings.userId, userId),
        eq(holdings.symbol, symbol),
      );
      const initial = db.select().from(holdings).where(where).get();
      if (!initial || initial.quantity < quantity) {
        throw new InsufficientShares(symbol, initial?.quantity ?? 0, quantity);
      }
      const quote = await quoteUsd(symbol);
      const proceedsCents = checkedMoney(quote.priceCents * quantity);
      return db.transaction((tx) => {
        const existing = tx.select().from(holdings).where(where).get();
        if (!existing || existing.quantity < quantity) {
          throw new InsufficientShares(
            symbol,
            existing?.quantity ?? 0,
            quantity,
          );
        }
        if (existing.quantity === quantity) {
          tx.delete(holdings).where(where).run();
        } else {
          tx.update(holdings)
            .set({ quantity: existing.quantity - quantity })
            .where(where)
            .run();
        }
        const account = tx
          .select()
          .from(accounts)
          .where(eq(accounts.userId, userId))
          .get()!;
        const cashCents = checkedMoney(account.cashCents + proceedsCents);
        tx.update(accounts)
          .set({ cashCents })
          .where(eq(accounts.userId, userId))
          .run();
        tx.insert(trades)
          .values({
            userId,
            symbol,
            side: "sell",
            quantity,
            priceCents: quote.priceCents,
          })
          .run();
        return {
          symbol,
          quantity,
          priceCents: quote.priceCents,
          proceedsCents,
          cashCents,
        };
      });
    },

    liquidate: async (userId) => {
      ensureAccount(userId);
      const positions = db
        .select()
        .from(holdings)
        .where(eq(holdings.userId, userId))
        .all();
      if (positions.length === 0) throw new NoHoldings();
      const orders = await mapConcurrent(positions, 5, async (position) => {
        const quote = await quoteUsd(position.symbol);
        return {
          symbol: position.symbol,
          quantity: position.quantity,
          priceCents: quote.priceCents,
          proceedsCents: checkedMoney(quote.priceCents * position.quantity),
        };
      });
      const proceedsCents = orders.reduce(
        (total, order) => checkedMoney(total + order.proceedsCents),
        0,
      );
      return db.transaction((tx) => {
        const currentPositions = tx
          .select()
          .from(holdings)
          .where(eq(holdings.userId, userId))
          .all();
        if (
          currentPositions.length !== orders.length ||
          currentPositions.some(
            (position) =>
              !orders.some(
                (order) =>
                  order.symbol === position.symbol &&
                  order.quantity === position.quantity,
              ),
          )
        ) {
          throw new Error("Portfolio changed while prices were loading");
        }
        for (const order of orders) {
          const where = and(
            eq(holdings.userId, userId),
            eq(holdings.symbol, order.symbol),
          );
          const current = tx.select().from(holdings).where(where).get();
          if (!current || current.quantity !== order.quantity) {
            throw new Error("Portfolio changed while prices were loading");
          }
          tx.delete(holdings).where(where).run();
          tx.insert(trades)
            .values({
              userId,
              symbol: order.symbol,
              side: "sell",
              quantity: order.quantity,
              priceCents: order.priceCents,
            })
            .run();
        }
        tx.update(accounts)
          .set({ cashCents: sql`${accounts.cashCents} + ${proceedsCents}` })
          .where(eq(accounts.userId, userId))
          .run();
        const account = tx
          .select()
          .from(accounts)
          .where(eq(accounts.userId, userId))
          .get()!;
        checkedMoney(account.cashCents);
        return { orders, proceedsCents, cashCents: account.cashCents };
      });
    },

    pay: async (fromUserId, toUserId, cents) => {
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        throw new InvalidPaymentAmount();
      }
      if (fromUserId === toUserId) throw new SamePaymentRecipient();
      return db.transaction((tx) => {
        tx.insert(accounts)
          .values([{ userId: fromUserId }, { userId: toUserId }])
          .onConflictDoNothing()
          .run();
        const sender = tx
          .select()
          .from(accounts)
          .where(eq(accounts.userId, fromUserId))
          .get()!;
        const recipient = tx
          .select()
          .from(accounts)
          .where(eq(accounts.userId, toUserId))
          .get()!;
        if (sender.cashCents < cents) {
          throw new InsufficientFunds(cents, sender.cashCents);
        }
        const senderCashCents = checkedMoney(sender.cashCents - cents);
        const recipientCashCents = checkedMoney(recipient.cashCents + cents);
        tx.update(accounts)
          .set({ cashCents: senderCashCents })
          .where(eq(accounts.userId, fromUserId))
          .run();
        tx.update(accounts)
          .set({ cashCents: recipientCashCents })
          .where(eq(accounts.userId, toUserId))
          .run();
        return { cents, senderCashCents };
      });
    },
  };
};
