import assert from "node:assert/strict";
import test from "node:test";
import { createPrices, PriceUnavailable, UnknownSymbol } from "./prices.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("uses the latest intraday close and normalizes symbols", async () => {
  let requestedUrl = "";
  const prices = createPrices(async (input) => {
    requestedUrl = String(input);
    return jsonResponse({
      chart: {
        result: [
          {
            meta: {
              symbol: "AAPL",
              regularMarketPrice: 190.1,
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
    priceCents: 19_124,
    currency: "USD",
  });
  assert.match(requestedUrl, /chart\/AAPL/);
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
