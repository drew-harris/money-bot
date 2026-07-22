import assert from "node:assert/strict";
import test from "node:test";
import { createPrices, PriceUnavailable, UnknownSymbol } from "./prices.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("normalizes symbols and returns rich quote metadata", async () => {
  let requestedUrl = "";
  const prices = createPrices(async (input) => {
    requestedUrl = String(input);
    return jsonResponse({
      chart: {
        result: [
          {
            meta: {
              symbol: "AAPL",
              longName: "Apple Inc.",
              fullExchangeName: "NasdaqGS",
              regularMarketPrice: 190.1,
              previousClose: 189,
              regularMarketTime: 1_700_000_000,
              marketState: "REGULAR",
              currency: "USD",
            },
            indicators: { quote: [{ close: [190.2, null, 191.235] }] },
          },
        ],
      },
    });
  });

  assert.deepEqual(await prices.quote(" aapl "), {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NasdaqGS",
    priceCents: 19_124,
    previousCloseCents: 18_900,
    changeCents: 224,
    changePercent: (224 / 18_900) * 100,
    currency: "USD",
    marketState: "REGULAR",
    asOf: new Date(1_700_000_000_000),
  });
  assert.match(requestedUrl, /chart\/AAPL/);
});

test("returns timestamped history and caches matching requests", async () => {
  let calls = 0;
  const prices = createPrices(async () => {
    calls++;
    return jsonResponse({
      chart: {
        result: [
          {
            meta: { symbol: "MSFT", regularMarketPrice: 20, currency: "USD" },
            timestamp: [100, 200],
            indicators: {
              quote: [
                {
                  open: [19, 20],
                  high: [21, 22],
                  low: [18, 19],
                  close: [20, 21.25],
                  volume: [1000, 2000],
                },
              ],
            },
          },
        ],
      },
    });
  });

  const first = await prices.history("MSFT", "1D");
  const second = await prices.history("msft", "1D");
  assert.equal(calls, 1);
  assert.equal(second, first);
  await prices.quote("MSFT", { fresh: true });
  assert.equal(calls, 2);
  assert.deepEqual(first.points[1], {
    at: new Date(200_000),
    openCents: 2_000,
    highCents: 2_200,
    lowCents: 1_900,
    closeCents: 2_125,
    volume: 2_000,
  });
});

test("search returns supported market symbols", async () => {
  const prices = createPrices(async () =>
    jsonResponse({
      quotes: [
        {
          symbol: "AAPL",
          longname: "Apple Inc.",
          exchange: "NMS",
          quoteType: "EQUITY",
        },
        {
          symbol: "BTC-USD",
          shortname: "Bitcoin",
          quoteType: "CRYPTOCURRENCY",
        },
      ],
    }),
  );
  assert.deepEqual(await prices.search("apple"), [
    { symbol: "AAPL", name: "Apple Inc.", exchange: "NMS" },
  ]);
  assert.equal((await prices.search(""))[0]?.symbol, "AAPL");
});

test("classifies a missing quote as an unknown symbol", async () => {
  const prices = createPrices(async () =>
    jsonResponse({ chart: { result: null } }),
  );
  await assert.rejects(prices.quote("missing"), UnknownSymbol);
});

test("classifies malformed responses and HTTP failures as unavailable", async () => {
  const malformed = createPrices(async () => jsonResponse({ nope: true }));
  await assert.rejects(malformed.quote("bad"), PriceUnavailable);

  const failed = createPrices(async () => jsonResponse({}, 503));
  await assert.rejects(failed.quote("down"), PriceUnavailable);
});
