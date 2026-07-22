import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import { type Prices, PriceUnavailable } from "./prices.js";
import {
  accounts,
  cashMovements,
  holdings,
  orders,
  profiles,
  STARTING_CASH_CENTS,
  trades,
  transferIntents,
  users,
} from "./schema.js";

export class InvalidQuantity extends Error {}
export class AccountNotFound extends Error {}
export class RecipientNotStarted extends Error {}
export class NoHoldings extends Error {}
export class InvalidPaymentAmount extends Error {}
export class SamePaymentRecipient extends Error {}
export class IntentNotFound extends Error {}
export class IntentExpired extends Error {}
export class IntentUnavailable extends Error {}

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

export type OrderSide = "buy" | "sell";

export interface Portfolio {
  readonly profileId: string;
  readonly profileName: string;
  readonly cashCents: number;
  readonly positions: Array<{
    symbol: string;
    quantity: number;
    priceCents: number | null;
    valueCents: number | null;
    costBasisCents: number;
    gainLossCents: number | null;
  }>;
  readonly netWorthCents: number;
  readonly partial: boolean;
  readonly holdingsVersion: string;
}

export interface OrderPreview {
  readonly id: string;
  readonly side: OrderSide;
  readonly symbol: string;
  readonly quantity: number;
  readonly quotedPriceCents: number;
  readonly estimatedTotalCents: number;
  readonly cashCents: number;
  readonly shares: number;
  readonly expiresAt: Date;
}

export interface FilledOrder {
  readonly id: string;
  readonly side: OrderSide;
  readonly symbol: string;
  readonly quantity: number;
  readonly priceCents: number;
  readonly totalCents: number;
  readonly cashCents: number;
  readonly replayed: boolean;
}

export interface TransferPreview {
  readonly id: string;
  readonly toUserId: string;
  readonly cents: number;
  readonly note: string | null;
  readonly senderCashCents: number;
  readonly expiresAt: Date;
}

export interface TransferReceipt {
  readonly id: string;
  readonly toUserId: string;
  readonly cents: number;
  readonly note: string | null;
  readonly senderCashCents: number;
  readonly replayed: boolean;
}

export type ActivityItem =
  | {
      readonly id: string;
      readonly kind: "trade";
      readonly side: OrderSide;
      readonly symbol: string;
      readonly quantity: number;
      readonly priceCents: number;
      readonly createdAt: Date;
    }
  | {
      readonly id: string;
      readonly kind: "transfer_sent" | "transfer_received";
      readonly cents: number;
      readonly counterpartyUserId: string | null;
      readonly note: string | null;
      readonly createdAt: Date;
    };

export interface Trading {
  readonly start: (userId: string) => {
    profileId: string;
    profileName: string;
    created: boolean;
  };
  readonly profile: (
    userId: string,
  ) => { profileId: string; profileName: string } | undefined;
  readonly portfolio: (userId: string) => Promise<Portfolio | undefined>;
  readonly leaderboard: () => Promise<
    Array<{
      userId: string;
      profileId: string;
      profileName: string;
      netWorthCents: number;
      partial: boolean;
    }>
  >;
  readonly activity: (
    userId: string,
    offset?: number,
    limit?: number,
  ) => Array<ActivityItem>;
  readonly prepareOrder: (
    userId: string,
    side: OrderSide,
    symbol: string,
    quantity: number,
  ) => Promise<OrderPreview>;
  readonly confirmOrder: (
    userId: string,
    orderId: string,
  ) => Promise<FilledOrder>;
  readonly cancelOrder: (userId: string, orderId: string) => void;
  readonly buy: (
    userId: string,
    symbol: string,
    quantity: number,
    requestId?: string,
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
  readonly liquidate: (
    userId: string,
    expectedHoldingsVersion?: string,
  ) => Promise<{
    orders: Array<{
      symbol: string;
      quantity: number;
      priceCents: number;
      proceedsCents: number;
    }>;
    proceedsCents: number;
    cashCents: number;
  }>;
  readonly prepareTransfer: (
    fromUserId: string,
    toUserId: string,
    cents: number,
    note?: string,
  ) => TransferPreview;
  readonly confirmTransfer: (
    fromUserId: string,
    transferId: string,
  ) => TransferReceipt;
  readonly cancelTransfer: (fromUserId: string, transferId: string) => void;
  readonly pay: (
    fromUserId: string,
    toUserId: string,
    cents: number,
  ) => Promise<{ cents: number; senderCashCents: number }>;
}

export const createTrading = (
  db: Database,
  prices: Pick<Prices, "quote">,
): Trading => {
  const getProfile = (userId: string) => {
    const user = db
      .select()
      .from(users)
      .where(eq(users.discordUserId, userId))
      .get();
    if (!user?.activeProfileId) return undefined;
    const profile = db
      .select()
      .from(profiles)
      .where(eq(profiles.id, user.activeProfileId))
      .get();
    return profile?.ownerUserId === userId && profile.status === "active"
      ? profile
      : undefined;
  };

  const requireOwnedProfile = (userId: string, profileId: string) => {
    const profile = db
      .select()
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.ownerUserId, userId)))
      .get();
    if (!profile) throw new IntentNotFound();
    if (profile.status !== "active") throw new IntentUnavailable();
    return profile;
  };

  const requireProfile = (userId: string) => {
    const profile = getProfile(userId);
    if (!profile) throw new AccountNotFound();
    return profile;
  };

  const getAccount = (profileId: string) => {
    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.profileId, profileId))
      .get();
    if (!account)
      throw new Error(`Account not found for profile: ${profileId}`);
    return account;
  };

  const start = (userId: string) => {
    const existing = getProfile(userId);
    if (existing) {
      return {
        profileId: existing.id,
        profileName: existing.name,
        created: false,
      };
    }

    const profileId = randomUUID();
    return db.transaction((tx) => {
      const raced = tx
        .select()
        .from(users)
        .where(eq(users.discordUserId, userId))
        .get();
      if (raced?.activeProfileId) {
        const active = tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, raced.activeProfileId))
          .get();
        if (!active || active.ownerUserId !== userId) {
          throw new Error(`Invalid active profile for user: ${userId}`);
        }
        return {
          profileId: active.id,
          profileName: active.name,
          created: false,
        };
      }
      tx.insert(users)
        .values({ discordUserId: userId, activeProfileId: profileId })
        .onConflictDoNothing()
        .run();
      tx.insert(profiles)
        .values({ id: profileId, ownerUserId: userId, name: "Main" })
        .run();
      tx.insert(accounts).values({ profileId }).run();
      tx.insert(cashMovements)
        .values({
          profileId,
          kind: "starting_cash",
          amountCents: STARTING_CASH_CENTS,
        })
        .run();
      tx.update(users)
        .set({ activeProfileId: profileId })
        .where(eq(users.discordUserId, userId))
        .run();
      return { profileId, profileName: "Main", created: true };
    });
  };

  const quoteUsd = async (rawSymbol: string, fresh = false) => {
    const requestedSymbol = rawSymbol.trim().toUpperCase();
    const quote = await prices.quote(requestedSymbol, { fresh });
    if (
      quote.currency !== "USD" ||
      !Number.isSafeInteger(quote.priceCents) ||
      quote.priceCents <= 0
    ) {
      throw new PriceUnavailable(
        requestedSymbol,
        new RangeError(`Invalid USD quote for ${requestedSymbol}`),
      );
    }
    return { ...quote, symbol: quote.symbol.trim().toUpperCase() };
  };

  const positionRows = (profileId: string) =>
    db.select().from(holdings).where(eq(holdings.profileId, profileId)).all();

  const holdingsVersion = (
    rows: ReadonlyArray<{ readonly symbol: string; readonly quantity: number }>,
  ) =>
    createHash("sha256")
      .update(
        rows
          .map(({ symbol, quantity }) => `${symbol}:${quantity}`)
          .sort()
          .join("|"),
      )
      .digest("hex")
      .slice(0, 16);

  const remainingCostBasis = (
    rows: ReturnType<typeof positionRows>,
    buyRows: Array<typeof trades.$inferSelect>,
  ) => {
    const remainingBySymbol = new Map(
      rows.map(({ symbol, quantity }) => [symbol, quantity]),
    );
    const costBasisBySymbol = new Map<string, number>();
    for (const trade of buyRows) {
      const remaining = remainingBySymbol.get(trade.symbol) ?? 0;
      if (remaining === 0) continue;
      const quantity = Math.min(remaining, trade.quantity);
      const cost = checkedMoney(trade.priceCents * quantity);
      costBasisBySymbol.set(
        trade.symbol,
        checkedMoney((costBasisBySymbol.get(trade.symbol) ?? 0) + cost),
      );
      remainingBySymbol.set(trade.symbol, remaining - quantity);
    }
    const incomplete = rows.find(
      ({ symbol }) => (remainingBySymbol.get(symbol) ?? 0) !== 0,
    );
    if (incomplete) {
      throw new Error(`Missing purchase history for ${incomplete.symbol}`);
    }
    return { rows, costBasisBySymbol };
  };

  const filledResult = (
    profileId: string,
    order: typeof orders.$inferSelect,
  ): FilledOrder => {
    if (order.filledPriceCents === null) {
      throw new Error(`Filled order ${order.id} has no execution price`);
    }
    return {
      id: order.id,
      side: order.side,
      symbol: order.symbol,
      quantity: order.quantity,
      priceCents: order.filledPriceCents,
      totalCents: checkedMoney(order.filledPriceCents * order.quantity),
      cashCents: order.cashAfterCents ?? getAccount(profileId).cashCents,
      replayed: true,
    };
  };

  const executeOrder = (
    profileId: string,
    orderId: string,
    side: OrderSide,
    symbol: string,
    quantity: number,
    priceCents: number,
  ) => {
    const totalCents = checkedMoney(priceCents * quantity);
    const account = getAccount(profileId);
    const holdingWhere = and(
      eq(holdings.profileId, profileId),
      eq(holdings.symbol, symbol),
    );
    const holding = db.select().from(holdings).where(holdingWhere).get();
    let cashCents: number;

    if (side === "buy") {
      if (account.cashCents < totalCents) {
        throw new InsufficientFunds(totalCents, account.cashCents);
      }
      cashCents = checkedMoney(account.cashCents - totalCents);
      db.insert(holdings)
        .values({ profileId, symbol, quantity })
        .onConflictDoUpdate({
          target: [holdings.profileId, holdings.symbol],
          set: { quantity: sql`${holdings.quantity} + ${quantity}` },
        })
        .run();
    } else {
      if (!holding || holding.quantity < quantity) {
        throw new InsufficientShares(symbol, holding?.quantity ?? 0, quantity);
      }
      cashCents = checkedMoney(account.cashCents + totalCents);
      if (holding.quantity === quantity) {
        db.delete(holdings).where(holdingWhere).run();
      } else {
        db.update(holdings)
          .set({ quantity: holding.quantity - quantity })
          .where(holdingWhere)
          .run();
      }
    }

    db.update(accounts)
      .set({ cashCents })
      .where(eq(accounts.profileId, profileId))
      .run();
    db.insert(trades)
      .values({
        orderId,
        profileId,
        symbol,
        side,
        quantity,
        priceCents,
      })
      .run();
    return { totalCents, cashCents };
  };

  const makeCompletedTransfer = (
    fromUserId: string,
    toUserId: string,
    cents: number,
    note: string | null,
  ): TransferReceipt => {
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      throw new InvalidPaymentAmount();
    }
    if (fromUserId === toUserId) throw new SamePaymentRecipient();
    const senderProfile = requireProfile(fromUserId);
    const recipientProfile = getProfile(toUserId);
    if (!recipientProfile) throw new RecipientNotStarted();
    const id = randomUUID();
    return db.transaction((tx) => {
      const sender = tx
        .select()
        .from(accounts)
        .where(eq(accounts.profileId, senderProfile.id))
        .get()!;
      const recipient = tx
        .select()
        .from(accounts)
        .where(eq(accounts.profileId, recipientProfile.id))
        .get()!;
      if (sender.cashCents < cents) {
        throw new InsufficientFunds(cents, sender.cashCents);
      }
      const senderCashCents = checkedMoney(sender.cashCents - cents);
      const recipientCashCents = checkedMoney(recipient.cashCents + cents);
      tx.update(accounts)
        .set({ cashCents: senderCashCents })
        .where(eq(accounts.profileId, senderProfile.id))
        .run();
      tx.update(accounts)
        .set({ cashCents: recipientCashCents })
        .where(eq(accounts.profileId, recipientProfile.id))
        .run();
      tx.insert(transferIntents)
        .values({
          id,
          fromProfileId: senderProfile.id,
          toProfileId: recipientProfile.id,
          cents,
          senderCashAfterCents: senderCashCents,
          note,
          status: "completed",
          expiresAt: new Date(),
          completedAt: new Date(),
        })
        .run();
      tx.insert(cashMovements)
        .values([
          {
            profileId: senderProfile.id,
            kind: "transfer_sent",
            amountCents: -cents,
            transferId: id,
            counterpartyUserId: toUserId,
            note,
          },
          {
            profileId: recipientProfile.id,
            kind: "transfer_received",
            amountCents: cents,
            transferId: id,
            counterpartyUserId: fromUserId,
            note,
          },
        ])
        .run();
      return { id, toUserId, cents, note, senderCashCents, replayed: false };
    });
  };

  return {
    start,

    profile: (userId) => {
      const profile = getProfile(userId);
      return profile
        ? { profileId: profile.id, profileName: profile.name }
        : undefined;
    },

    portfolio: async (userId) => {
      const profile = getProfile(userId);
      if (!profile) return undefined;
      const snapshot = db.transaction((tx) => ({
        account: tx
          .select()
          .from(accounts)
          .where(eq(accounts.profileId, profile.id))
          .get(),
        rows: tx
          .select()
          .from(holdings)
          .where(eq(holdings.profileId, profile.id))
          .all(),
        buyRows: tx
          .select()
          .from(trades)
          .where(and(eq(trades.profileId, profile.id), eq(trades.side, "buy")))
          .orderBy(desc(trades.id))
          .all(),
      }));
      if (!snapshot.account) {
        throw new Error(`Account not found for profile: ${profile.id}`);
      }
      const { rows, costBasisBySymbol } = remainingCostBasis(
        snapshot.rows,
        snapshot.buyRows,
      );
      const positions = await mapConcurrent(rows, 5, async (holding) => {
        const costBasisCents = costBasisBySymbol.get(holding.symbol) ?? 0;
        try {
          const quote = await quoteUsd(holding.symbol);
          const valueCents = checkedMoney(quote.priceCents * holding.quantity);
          return {
            symbol: holding.symbol,
            quantity: holding.quantity,
            priceCents: quote.priceCents,
            valueCents,
            costBasisCents,
            gainLossCents: checkedMoney(valueCents - costBasisCents),
          };
        } catch {
          return {
            symbol: holding.symbol,
            quantity: holding.quantity,
            priceCents: null,
            valueCents: null,
            costBasisCents,
            gainLossCents: null,
          };
        }
      });
      const holdingsValue = positions.reduce(
        (sum, position) => checkedMoney(sum + (position.valueCents ?? 0)),
        0,
      );
      return {
        profileId: profile.id,
        profileName: profile.name,
        cashCents: snapshot.account.cashCents,
        positions,
        netWorthCents: checkedMoney(snapshot.account.cashCents + holdingsValue),
        partial: positions.some(({ priceCents }) => priceCents === null),
        holdingsVersion: holdingsVersion(rows),
      };
    },

    leaderboard: async () => {
      const snapshot = db.transaction((tx) => ({
        profileRows: tx.select().from(profiles).all(),
        accountRows: tx.select().from(accounts).all(),
        tradedProfileRows: tx
          .select({ profileId: trades.profileId })
          .from(trades)
          .all(),
        holdingRows: tx.select().from(holdings).all(),
      }));
      const tradedProfiles = new Set(
        snapshot.tradedProfileRows.map(({ profileId }) => profileId),
      );
      const accountsByProfile = new Map(
        snapshot.accountRows.map((account) => [account.profileId, account]),
      );
      const { profileRows, holdingRows } = snapshot;
      const symbols = [...new Set(holdingRows.map(({ symbol }) => symbol))];
      const quotePairs = await mapConcurrent(symbols, 5, async (symbol) => {
        try {
          return [symbol, (await quoteUsd(symbol)).priceCents] as const;
        } catch {
          return [symbol, undefined] as const;
        }
      });
      const pricesBySymbol = new Map(quotePairs);
      return profileRows
        .filter(
          (profile) =>
            profile.status === "active" && tradedProfiles.has(profile.id),
        )
        .map((profile) => {
          const account = accountsByProfile.get(profile.id);
          if (!account) {
            throw new Error(`Account not found for profile: ${profile.id}`);
          }
          const ownHoldings = holdingRows.filter(
            ({ profileId }) => profileId === profile.id,
          );
          const partial = ownHoldings.some(
            ({ symbol }) => pricesBySymbol.get(symbol) === undefined,
          );
          const holdingsCents = ownHoldings.reduce((sum, holding) => {
            const priceCents = pricesBySymbol.get(holding.symbol);
            return checkedMoney(
              sum +
                (priceCents === undefined
                  ? 0
                  : checkedMoney(priceCents * holding.quantity)),
            );
          }, 0);
          return {
            userId: profile.ownerUserId,
            profileId: profile.id,
            profileName: profile.name,
            netWorthCents: checkedMoney(account.cashCents + holdingsCents),
            partial,
          };
        })
        .sort(
          (a, b) =>
            b.netWorthCents - a.netWorthCents ||
            a.userId.localeCompare(b.userId),
        );
    },

    activity: (userId, offset = 0, limit = 10) => {
      const profile = requireProfile(userId);
      const tradeItems: Array<ActivityItem> = db
        .select()
        .from(trades)
        .where(eq(trades.profileId, profile.id))
        .orderBy(desc(trades.createdAt))
        .limit(offset + limit)
        .all()
        .map((trade) => ({
          id: `trade:${trade.id}`,
          kind: "trade" as const,
          side: trade.side,
          symbol: trade.symbol,
          quantity: trade.quantity,
          priceCents: trade.priceCents,
          createdAt: trade.createdAt,
        }));
      const movementItems: Array<ActivityItem> = db
        .select()
        .from(cashMovements)
        .where(eq(cashMovements.profileId, profile.id))
        .orderBy(desc(cashMovements.createdAt))
        .limit(offset + limit)
        .all()
        .filter(
          (movement) =>
            movement.kind === "transfer_sent" ||
            movement.kind === "transfer_received",
        )
        .map((movement) => ({
          id: `cash:${movement.id}`,
          kind: movement.kind as "transfer_sent" | "transfer_received",
          cents: Math.abs(movement.amountCents),
          counterpartyUserId: movement.counterpartyUserId,
          note: movement.note,
          createdAt: movement.createdAt,
        }));
      return [...tradeItems, ...movementItems]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(offset, offset + limit);
    },

    prepareOrder: async (userId, side, rawSymbol, quantity) => {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new InvalidQuantity();
      }
      const profile = requireProfile(userId);
      const quote = await quoteUsd(rawSymbol);
      const totalCents = checkedMoney(quote.priceCents * quantity);
      const account = getAccount(profile.id);
      const holding = db
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.profileId, profile.id),
            eq(holdings.symbol, quote.symbol),
          ),
        )
        .get();
      if (side === "buy" && account.cashCents < totalCents) {
        throw new InsufficientFunds(totalCents, account.cashCents);
      }
      if (side === "sell" && (holding?.quantity ?? 0) < quantity) {
        throw new InsufficientShares(
          quote.symbol,
          holding?.quantity ?? 0,
          quantity,
        );
      }
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 2 * 60_000);
      db.insert(orders)
        .values({
          id,
          profileId: profile.id,
          side,
          symbol: quote.symbol,
          quantity,
          quotedPriceCents: quote.priceCents,
          expiresAt,
        })
        .run();
      return {
        id,
        side,
        symbol: quote.symbol,
        quantity,
        quotedPriceCents: quote.priceCents,
        estimatedTotalCents: totalCents,
        cashCents: account.cashCents,
        shares: holding?.quantity ?? 0,
        expiresAt,
      };
    },

    confirmOrder: async (userId, orderId) => {
      const initial = db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .get();
      if (!initial) throw new IntentNotFound();
      const profile = requireOwnedProfile(userId, initial.profileId);
      if (initial.status === "filled") return filledResult(profile.id, initial);
      if (initial.status !== "pending") throw new IntentUnavailable();
      if (initial.expiresAt.getTime() <= Date.now()) {
        const expired = db
          .update(orders)
          .set({ status: "expired" })
          .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
          .run();
        if (expired.changes !== 1) {
          const current = db
            .select()
            .from(orders)
            .where(eq(orders.id, orderId))
            .get();
          if (current?.status === "filled") {
            return filledResult(profile.id, current);
          }
          throw new IntentUnavailable();
        }
        throw new IntentExpired();
      }
      const quote = await quoteUsd(initial.symbol, true);
      const result = db.transaction((tx): FilledOrder | "expired" => {
        const current = tx
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .get();
        if (!current || current.profileId !== profile.id) {
          throw new IntentNotFound();
        }
        if (current.status === "filled")
          return filledResult(profile.id, current);
        if (current.status !== "pending") throw new IntentUnavailable();
        if (current.expiresAt.getTime() <= Date.now()) {
          tx.update(orders)
            .set({ status: "expired" })
            .where(eq(orders.id, orderId))
            .run();
          return "expired";
        }
        const execution = executeOrder(
          profile.id,
          orderId,
          current.side,
          current.symbol,
          current.quantity,
          quote.priceCents,
        );
        const filledAt = new Date();
        tx.update(orders)
          .set({
            status: "filled",
            filledPriceCents: quote.priceCents,
            cashAfterCents: execution.cashCents,
            filledAt,
          })
          .where(eq(orders.id, orderId))
          .run();
        return {
          id: orderId,
          side: current.side,
          symbol: current.symbol,
          quantity: current.quantity,
          priceCents: quote.priceCents,
          totalCents: execution.totalCents,
          cashCents: execution.cashCents,
          replayed: false,
        };
      });
      if (result === "expired") throw new IntentExpired();
      return result;
    },

    cancelOrder: (userId, orderId) => {
      const order = db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .get();
      if (!order) throw new IntentNotFound();
      requireOwnedProfile(userId, order.profileId);
      const result = db
        .update(orders)
        .set({ status: "cancelled" })
        .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
        .run();
      if (result.changes !== 1) throw new IntentUnavailable();
    },

    buy: async (userId, rawSymbol, quantity, requestId) => {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new InvalidQuantity();
      }
      const profile = start(userId);
      const orderId = requestId ? `message:${requestId}` : randomUUID();
      const existing = db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .get();
      if (existing) {
        if (
          existing.profileId !== profile.profileId ||
          existing.side !== "buy" ||
          existing.symbol !== rawSymbol.trim().toUpperCase() ||
          existing.quantity !== quantity ||
          existing.status !== "filled"
        ) {
          throw new IntentUnavailable();
        }
        const filled = filledResult(profile.profileId, existing);
        return {
          symbol: filled.symbol,
          quantity: filled.quantity,
          priceCents: filled.priceCents,
          costCents: filled.totalCents,
          cashCents: filled.cashCents,
        };
      }
      const quote = await quoteUsd(rawSymbol);
      const result = db.transaction(() => {
        const raced = db
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .get();
        if (raced) {
          if (
            raced.profileId !== profile.profileId ||
            raced.side !== "buy" ||
            raced.symbol !== quote.symbol ||
            raced.quantity !== quantity ||
            raced.status !== "filled"
          ) {
            throw new IntentUnavailable();
          }
          const filled = filledResult(profile.profileId, raced);
          return {
            totalCents: filled.totalCents,
            cashCents: filled.cashCents,
          };
        }
        const execution = executeOrder(
          profile.profileId,
          orderId,
          "buy",
          quote.symbol,
          quantity,
          quote.priceCents,
        );
        const now = new Date();
        db.insert(orders)
          .values({
            id: orderId,
            profileId: profile.profileId,
            side: "buy",
            symbol: quote.symbol,
            quantity,
            quotedPriceCents: quote.priceCents,
            filledPriceCents: quote.priceCents,
            cashAfterCents: execution.cashCents,
            status: "filled",
            expiresAt: now,
            filledAt: now,
          })
          .run();
        return execution;
      });
      return {
        symbol: quote.symbol,
        quantity,
        priceCents: quote.priceCents,
        costCents: result.totalCents,
        cashCents: result.cashCents,
      };
    },

    sell: async (userId, rawSymbol, quantity) => {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new InvalidQuantity();
      }
      const profile = requireProfile(userId);
      const quote = await quoteUsd(rawSymbol);
      const orderId = randomUUID();
      const result = db.transaction(() => {
        const execution = executeOrder(
          profile.id,
          orderId,
          "sell",
          quote.symbol,
          quantity,
          quote.priceCents,
        );
        const now = new Date();
        db.insert(orders)
          .values({
            id: orderId,
            profileId: profile.id,
            side: "sell",
            symbol: quote.symbol,
            quantity,
            quotedPriceCents: quote.priceCents,
            filledPriceCents: quote.priceCents,
            cashAfterCents: execution.cashCents,
            status: "filled",
            expiresAt: now,
            filledAt: now,
          })
          .run();
        return execution;
      });
      return {
        symbol: quote.symbol,
        quantity,
        priceCents: quote.priceCents,
        proceedsCents: result.totalCents,
        cashCents: result.cashCents,
      };
    },

    liquidate: async (userId, expectedHoldingsVersion) => {
      const profile = requireProfile(userId);
      const positions = positionRows(profile.id);
      if (positions.length === 0) throw new NoHoldings();
      if (
        expectedHoldingsVersion !== undefined &&
        holdingsVersion(positions) !== expectedHoldingsVersion
      ) {
        throw new IntentUnavailable();
      }
      const liquidationOrders = await mapConcurrent(
        positions,
        5,
        async (position) => {
          const quote = await quoteUsd(position.symbol);
          return {
            symbol: position.symbol,
            quantity: position.quantity,
            priceCents: quote.priceCents,
            proceedsCents: checkedMoney(quote.priceCents * position.quantity),
          };
        },
      );
      const proceedsCents = liquidationOrders.reduce(
        (sum, order) => checkedMoney(sum + order.proceedsCents),
        0,
      );
      const cashCents = db.transaction(() => {
        const current = positionRows(profile.id);
        if (
          current.length !== liquidationOrders.length ||
          current.some(
            (position) =>
              !liquidationOrders.some(
                (order) =>
                  order.symbol === position.symbol &&
                  order.quantity === position.quantity,
              ),
          )
        ) {
          throw new Error("Portfolio changed while prices were loading");
        }
        let cash = getAccount(profile.id).cashCents;
        for (const order of liquidationOrders) {
          const id = randomUUID();
          cash = checkedMoney(cash + order.proceedsCents);
          db.delete(holdings)
            .where(
              and(
                eq(holdings.profileId, profile.id),
                eq(holdings.symbol, order.symbol),
              ),
            )
            .run();
          const now = new Date();
          db.insert(orders)
            .values({
              id,
              profileId: profile.id,
              side: "sell",
              symbol: order.symbol,
              quantity: order.quantity,
              quotedPriceCents: order.priceCents,
              filledPriceCents: order.priceCents,
              cashAfterCents: cash,
              status: "filled",
              expiresAt: now,
              filledAt: now,
            })
            .run();
          db.insert(trades)
            .values({
              orderId: id,
              profileId: profile.id,
              side: "sell",
              symbol: order.symbol,
              quantity: order.quantity,
              priceCents: order.priceCents,
            })
            .run();
        }
        db.update(accounts)
          .set({ cashCents: cash })
          .where(eq(accounts.profileId, profile.id))
          .run();
        return cash;
      });
      return {
        orders: liquidationOrders,
        proceedsCents,
        cashCents,
      };
    },

    prepareTransfer: (fromUserId, toUserId, cents, note) => {
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        throw new InvalidPaymentAmount();
      }
      if (fromUserId === toUserId) throw new SamePaymentRecipient();
      const sender = requireProfile(fromUserId);
      const recipient = getProfile(toUserId);
      if (!recipient) throw new RecipientNotStarted();
      const senderAccount = getAccount(sender.id);
      if (senderAccount.cashCents < cents) {
        throw new InsufficientFunds(cents, senderAccount.cashCents);
      }
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 2 * 60_000);
      const normalizedNote = note?.trim().slice(0, 200) || null;
      db.insert(transferIntents)
        .values({
          id,
          fromProfileId: sender.id,
          toProfileId: recipient.id,
          cents,
          note: normalizedNote,
          expiresAt,
        })
        .run();
      return {
        id,
        toUserId,
        cents,
        note: normalizedNote,
        senderCashCents: senderAccount.cashCents,
        expiresAt,
      };
    },

    confirmTransfer: (fromUserId, transferId) => {
      const initial = db
        .select()
        .from(transferIntents)
        .where(eq(transferIntents.id, transferId))
        .get();
      if (!initial) throw new IntentNotFound();
      const senderProfile = requireOwnedProfile(
        fromUserId,
        initial.fromProfileId,
      );
      const result = db.transaction((tx): TransferReceipt | "expired" => {
        const intent = tx
          .select()
          .from(transferIntents)
          .where(eq(transferIntents.id, transferId))
          .get();
        if (!intent || intent.fromProfileId !== senderProfile.id) {
          throw new IntentNotFound();
        }
        const recipientProfile = tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, intent.toProfileId))
          .get();
        if (!recipientProfile) throw new RecipientNotStarted();
        if (intent.status === "completed") {
          if (intent.senderCashAfterCents === null) {
            throw new Error(
              `Completed transfer ${intent.id} has no resulting balance`,
            );
          }
          return {
            id: intent.id,
            toUserId: recipientProfile.ownerUserId,
            cents: intent.cents,
            note: intent.note,
            senderCashCents: intent.senderCashAfterCents,
            replayed: true,
          };
        }
        if (intent.status !== "pending") throw new IntentUnavailable();
        if (intent.expiresAt.getTime() <= Date.now()) {
          tx.update(transferIntents)
            .set({ status: "expired" })
            .where(eq(transferIntents.id, transferId))
            .run();
          return "expired";
        }
        const sender = tx
          .select()
          .from(accounts)
          .where(eq(accounts.profileId, senderProfile.id))
          .get()!;
        const recipient = tx
          .select()
          .from(accounts)
          .where(eq(accounts.profileId, recipientProfile.id))
          .get()!;
        if (sender.cashCents < intent.cents) {
          throw new InsufficientFunds(intent.cents, sender.cashCents);
        }
        const senderCashCents = checkedMoney(sender.cashCents - intent.cents);
        const recipientCashCents = checkedMoney(
          recipient.cashCents + intent.cents,
        );
        tx.update(accounts)
          .set({ cashCents: senderCashCents })
          .where(eq(accounts.profileId, senderProfile.id))
          .run();
        tx.update(accounts)
          .set({ cashCents: recipientCashCents })
          .where(eq(accounts.profileId, recipientProfile.id))
          .run();
        tx.update(transferIntents)
          .set({
            status: "completed",
            senderCashAfterCents: senderCashCents,
            completedAt: new Date(),
          })
          .where(eq(transferIntents.id, transferId))
          .run();
        tx.insert(cashMovements)
          .values([
            {
              profileId: senderProfile.id,
              kind: "transfer_sent",
              amountCents: -intent.cents,
              transferId,
              counterpartyUserId: recipientProfile.ownerUserId,
              note: intent.note,
            },
            {
              profileId: recipientProfile.id,
              kind: "transfer_received",
              amountCents: intent.cents,
              transferId,
              counterpartyUserId: fromUserId,
              note: intent.note,
            },
          ])
          .run();
        return {
          id: transferId,
          toUserId: recipientProfile.ownerUserId,
          cents: intent.cents,
          note: intent.note,
          senderCashCents,
          replayed: false,
        };
      });
      if (result === "expired") throw new IntentExpired();
      return result;
    },

    cancelTransfer: (fromUserId, transferId) => {
      const intent = db
        .select()
        .from(transferIntents)
        .where(eq(transferIntents.id, transferId))
        .get();
      if (!intent) throw new IntentNotFound();
      requireOwnedProfile(fromUserId, intent.fromProfileId);
      const result = db
        .update(transferIntents)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(transferIntents.id, transferId),
            eq(transferIntents.status, "pending"),
          ),
        )
        .run();
      if (result.changes !== 1) throw new IntentUnavailable();
    },

    pay: async (fromUserId, toUserId, cents) => {
      const payment = makeCompletedTransfer(fromUserId, toUserId, cents, null);
      return { cents: payment.cents, senderCashCents: payment.senderCashCents };
    },
  };
};
