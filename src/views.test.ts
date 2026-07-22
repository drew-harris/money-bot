import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "discord.js";
import { renderPortfolioAllocation, renderStockChart } from "./charts.js";
import type { PriceHistory } from "./prices.js";
import type { Portfolio } from "./trading.js";
import {
  orderPreviewView,
  portfolioView,
  stockView,
  transferPreviewView,
} from "./views.js";

const user = {
  id: "123456789",
  username: "Alice",
  displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
} as unknown as User;

const portfolio: Portfolio = {
  profileId: "profile-1",
  profileName: "Main",
  cashCents: 700_000,
  positions: [
    {
      symbol: "AAPL",
      quantity: 10,
      priceCents: 20_000,
      valueCents: 200_000,
      costBasisCents: 180_000,
      gainLossCents: 20_000,
    },
    {
      symbol: "MSFT",
      quantity: 5,
      priceCents: 20_000,
      valueCents: 100_000,
      costBasisCents: 110_000,
      gainLossCents: -10_000,
    },
  ],
  netWorthCents: 1_000_000,
  partial: false,
  holdingsVersion: "portfolio-version",
};

const history: PriceHistory = {
  range: "1D",
  quote: {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NasdaqGS",
    priceCents: 20_000,
    previousCloseCents: 19_000,
    changeCents: 1_000,
    changePercent: 5.263,
    currency: "USD",
    marketState: "REGULAR",
    asOf: new Date("2026-07-21T12:00:00Z"),
  },
  points: [
    {
      at: new Date("2026-07-21T10:00:00Z"),
      openCents: 19_000,
      highCents: 19_600,
      lowCents: 18_900,
      closeCents: 19_500,
      volume: 100,
    },
    {
      at: new Date("2026-07-21T12:00:00Z"),
      openCents: 19_500,
      highCents: 20_100,
      lowCents: 19_400,
      closeCents: 20_000,
      volume: 200,
    },
  ],
};

test("renders valid Components V2 portfolio and stock payloads", async () => {
  const allocation = await renderPortfolioAllocation(portfolio);
  const chart = await renderStockChart(history);
  assert.deepEqual([...allocation.subarray(1, 4)], [80, 78, 71]);
  assert.deepEqual([...chart.subarray(1, 4)], [80, 78, 71]);

  for (const view of [
    portfolioView(user, portfolio, allocation),
    stockView(history, chart),
  ]) {
    assert.equal(view.components?.length, 1);
    const component = view.components?.[0];
    assert.ok(component && "toJSON" in component);
    assert.doesNotThrow(() => component.toJSON());
  }
});

test("renders valid order and transfer confirmations", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const views = [
    orderPreviewView({
      id: "order-1",
      side: "buy",
      symbol: "AAPL",
      quantity: 2,
      quotedPriceCents: 20_000,
      estimatedTotalCents: 40_000,
      cashCents: 1_000_000,
      shares: 0,
      expiresAt,
    }),
    transferPreviewView({
      id: "transfer-1",
      toUserId: "987654321",
      cents: 2_500,
      note: "Lunch",
      senderCashCents: 1_000_000,
      expiresAt,
    }),
  ];
  for (const view of views) {
    const component = view.components?.[0];
    assert.ok(component && "toJSON" in component);
    assert.doesNotThrow(() => component.toJSON());
  }
});
