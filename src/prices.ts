/** A live quote for a stock, with the price as integer cents. */
export interface Quote {
  readonly symbol: string;
  readonly priceCents: number;
  readonly currency: string;
}

export interface Prices {
  readonly quote: (symbol: string) => Promise<Quote>;
}

/** The given ticker doesn't exist (or has no current price). */
export class UnknownSymbol extends Error {
  readonly code = "UnknownSymbol";

  constructor(readonly symbol: string) {
    super(`Unknown stock symbol: ${symbol}`);
    this.name = "UnknownSymbol";
  }
}

/** The price provider could not be reached or returned something unexpected. */
export class PriceUnavailable extends Error {
  readonly code = "PriceUnavailable";

  constructor(
    readonly symbol: string,
    cause: unknown,
  ) {
    super(`Price unavailable for ${symbol}`, { cause });
    this.name = "PriceUnavailable";
  }
}

interface YahooResult {
  readonly meta: {
    readonly symbol?: string;
    readonly regularMarketPrice?: number;
    readonly currency?: string;
  };
  readonly indicators?: {
    readonly quote: ReadonlyArray<{
      readonly close: ReadonlyArray<number | null | undefined>;
    }>;
  };
}

const parseYahooResult = (value: unknown): YahooResult | undefined => {
  if (typeof value !== "object" || value === null || !("chart" in value)) {
    throw new TypeError("Yahoo response is missing chart data");
  }
  const chart = value.chart;
  if (typeof chart !== "object" || chart === null || !("result" in chart)) {
    throw new TypeError("Yahoo response has invalid chart data");
  }
  const result = chart.result;
  if (result == null) return undefined;
  if (!Array.isArray(result)) {
    throw new TypeError("Yahoo chart result is not an array");
  }
  const first: unknown = result[0];
  if (first === undefined) return undefined;
  if (typeof first !== "object" || first === null || !("meta" in first)) {
    throw new TypeError("Yahoo chart result is missing metadata");
  }
  const meta = first.meta;
  if (typeof meta !== "object" || meta === null) {
    throw new TypeError("Yahoo chart metadata is invalid");
  }

  const record = first as Record<string, unknown>;
  const indicators = record.indicators;
  if (indicators !== undefined) {
    if (
      typeof indicators !== "object" ||
      indicators === null ||
      !("quote" in indicators) ||
      !Array.isArray(indicators.quote)
    ) {
      throw new TypeError("Yahoo chart indicators are invalid");
    }
    const quote = indicators.quote[0];
    if (
      quote !== undefined &&
      (typeof quote !== "object" ||
        quote === null ||
        !("close" in quote) ||
        !Array.isArray(quote.close) ||
        quote.close.some(
          (item: unknown) =>
            item !== null && item !== undefined && typeof item !== "number",
        ))
    ) {
      throw new TypeError("Yahoo chart closes are invalid");
    }
  }

  for (const key of ["symbol", "currency"] as const) {
    const field = (meta as Record<string, unknown>)[key];
    if (field !== undefined && typeof field !== "string") {
      throw new TypeError(`Yahoo metadata ${key} is invalid`);
    }
  }
  const marketPrice = (meta as Record<string, unknown>).regularMarketPrice;
  if (marketPrice !== undefined && typeof marketPrice !== "number") {
    throw new TypeError("Yahoo market price is invalid");
  }

  return first as YahooResult;
};

export const createPrices = (
  fetch_: typeof fetch = globalThis.fetch,
  timeoutMs = 10_000,
): Prices => ({
  quote: async (rawSymbol) => {
    const symbol = rawSymbol.trim().toUpperCase();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?interval=1m&range=1d&includePrePost=true`;

    let result: YahooResult | undefined;
    try {
      const response = await fetch_(url, {
        headers: { "User-Agent": "Mozilla/5.0 (paper-trading-bot)" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Yahoo returned HTTP ${response.status}`);
      }
      result = parseYahooResult(await response.json());
    } catch (cause) {
      throw new PriceUnavailable(symbol, cause);
    }

    const closes = result?.indicators?.quote[0]?.close;
    const price =
      Array.from(closes ?? [])
        .reverse()
        .find((close) => typeof close === "number") ??
      result?.meta.regularMarketPrice;
    if (!result || typeof price !== "number") {
      throw new UnknownSymbol(symbol);
    }

    return {
      symbol: result.meta.symbol ?? symbol,
      priceCents: Math.round(price * 100),
      currency: result.meta.currency ?? "USD",
    };
  },
});
