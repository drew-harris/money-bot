import { HttpClient, HttpClientResponse } from "@effect/platform";
import { NodeHttpClient } from "@effect/platform-node";
import { Data, Effect, Schema } from "effect";

/** A live quote for a stock, with the price as integer cents. */
export interface Quote {
  readonly symbol: string;
  readonly priceCents: number;
  readonly currency: string;
}

/** The given ticker doesn't exist (or has no current price). */
export class UnknownSymbol extends Data.TaggedError("UnknownSymbol")<{
  readonly symbol: string;
}> {}

/** The price provider could not be reached or returned something unexpected. */
export class PriceUnavailable extends Data.TaggedError("PriceUnavailable")<{
  readonly symbol: string;
  readonly cause: unknown;
}> {}

// Schema for the bits of Yahoo's chart response we actually read. Unlisted
// fields are ignored, and a malformed body fails parsing (→ PriceUnavailable).
const YahooChart = Schema.Struct({
  chart: Schema.Struct({
    result: Schema.NullishOr(
      Schema.Array(
        Schema.Struct({
          meta: Schema.Struct({
            symbol: Schema.optional(Schema.String),
            regularMarketPrice: Schema.optional(Schema.Number),
            currency: Schema.optional(Schema.String),
          }),
        }),
      ),
    ),
  }),
});

const makePrices = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const quote = (rawSymbol: string) =>
    Effect.gen(function* () {
      const symbol = rawSymbol.trim().toUpperCase();
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?interval=1d&range=1d`;

      const body = yield* client
        .get(url, {
          // Yahoo rejects requests without a browser-like User-Agent.
          headers: { "User-Agent": "Mozilla/5.0 (paper-trading-bot)" },
        })
        .pipe(
          // Decode + validate the JSON body against the schema.
          Effect.flatMap(HttpClientResponse.schemaBodyJson(YahooChart)),
          // Network/parse failures become a single, friendly error type.
          Effect.mapError((cause) => new PriceUnavailable({ symbol, cause })),
        );

      const meta = body.chart.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== "number") {
        return yield* new UnknownSymbol({ symbol });
      }

      return {
        symbol: meta.symbol ?? symbol,
        priceCents: Math.round(meta.regularMarketPrice * 100),
        currency: meta.currency ?? "USD",
      } satisfies Quote;
    });

  return { quote } as const;
});

/**
 * Stock price lookups. Backed by Yahoo Finance's public chart endpoint, which
 * needs no API key. Swap the implementation here to change providers — nothing
 * else in the app depends on Yahoo.
 */
export class Prices extends Effect.Service<Prices>()("app/Prices", {
  effect: makePrices,
  // The provider brings its own HTTP client, so callers just provide Prices.Default.
  dependencies: [NodeHttpClient.layerUndici],
}) {}
