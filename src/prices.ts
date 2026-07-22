export type HistoryRange = "1D" | "1W" | "1M" | "3M" | "1Y";

export interface Quote {
  readonly symbol: string;
  readonly name: string | null;
  readonly exchange: string | null;
  readonly priceCents: number;
  readonly previousCloseCents: number | null;
  readonly changeCents: number | null;
  readonly changePercent: number | null;
  readonly currency: string;
  readonly marketState: string | null;
  readonly asOf: Date;
}

export interface HistoryPoint {
  readonly at: Date;
  readonly openCents: number | null;
  readonly highCents: number | null;
  readonly lowCents: number | null;
  readonly closeCents: number;
  readonly volume: number | null;
}

export interface PriceHistory {
  readonly range: HistoryRange;
  readonly quote: Quote;
  readonly points: ReadonlyArray<HistoryPoint>;
}

export interface SymbolSearchResult {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
}

export interface Prices {
  readonly quote: (
    symbol: string,
    options?: { readonly fresh?: boolean },
  ) => Promise<Quote>;
  readonly history: (
    symbol: string,
    range: HistoryRange,
  ) => Promise<PriceHistory>;
  readonly search: (
    query: string,
  ) => Promise<ReadonlyArray<SymbolSearchResult>>;
}

export class UnknownSymbol extends Error {
  readonly code = "UnknownSymbol";

  constructor(readonly symbol: string) {
    super(`Unknown stock symbol: ${symbol}`);
    this.name = "UnknownSymbol";
  }
}

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

interface YahooMeta {
  readonly symbol?: string;
  readonly shortName?: string;
  readonly longName?: string;
  readonly exchangeName?: string;
  readonly fullExchangeName?: string;
  readonly regularMarketPrice?: number;
  readonly previousClose?: number;
  readonly chartPreviousClose?: number;
  readonly currency?: string;
  readonly marketState?: string;
  readonly regularMarketTime?: number;
}

interface YahooIndicator {
  readonly open?: ReadonlyArray<number | null | undefined>;
  readonly high?: ReadonlyArray<number | null | undefined>;
  readonly low?: ReadonlyArray<number | null | undefined>;
  readonly close: ReadonlyArray<number | null | undefined>;
  readonly volume?: ReadonlyArray<number | null | undefined>;
}

interface YahooResult {
  readonly meta: YahooMeta;
  readonly timestamp?: ReadonlyArray<number>;
  readonly indicators?: { readonly quote: ReadonlyArray<YahooIndicator> };
}

interface Cached<T> {
  readonly expiresAt: number;
  readonly value: Promise<T>;
}

const POPULAR_SYMBOLS: ReadonlyArray<SymbolSearchResult> = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "Nasdaq" },
  { symbol: "MSFT", name: "Microsoft Corporation", exchange: "Nasdaq" },
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "Nasdaq" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", exchange: "Nasdaq" },
  { symbol: "GOOGL", name: "Alphabet Inc.", exchange: "Nasdaq" },
];

const RANGE_QUERY: Record<HistoryRange, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1wk" },
};

const isNumberArray = (value: unknown): value is Array<number | null> =>
  Array.isArray(value) &&
  value.every(
    (item) => item === null || item === undefined || typeof item === "number",
  );

const parseYahooResult = (value: unknown): YahooResult | undefined => {
  if (typeof value !== "object" || value === null || !("chart" in value)) {
    throw new TypeError("Yahoo response is missing chart data");
  }
  const chart = value.chart;
  if (typeof chart !== "object" || chart === null || !("result" in chart)) {
    throw new TypeError("Yahoo response has invalid chart data");
  }
  if (chart.result == null) return undefined;
  if (!Array.isArray(chart.result)) {
    throw new TypeError("Yahoo chart result is not an array");
  }
  const first: unknown = chart.result[0];
  if (typeof first !== "object" || first === null || !("meta" in first)) {
    throw new TypeError("Yahoo chart result is missing metadata");
  }
  if (typeof first.meta !== "object" || first.meta === null) {
    throw new TypeError("Yahoo chart metadata is invalid");
  }
  const record = first as Record<string, unknown>;
  if (
    record.timestamp !== undefined &&
    (!Array.isArray(record.timestamp) ||
      record.timestamp.some((item) => typeof item !== "number"))
  ) {
    throw new TypeError("Yahoo chart timestamps are invalid");
  }
  if (record.indicators !== undefined) {
    const indicators = record.indicators;
    if (
      typeof indicators !== "object" ||
      indicators === null ||
      !("quote" in indicators) ||
      !Array.isArray(indicators.quote)
    ) {
      throw new TypeError("Yahoo chart indicators are invalid");
    }
    const quote = indicators.quote[0];
    if (quote !== undefined) {
      if (typeof quote !== "object" || quote === null) {
        throw new TypeError("Yahoo chart quote is invalid");
      }
      const quoteRecord = quote as Record<string, unknown>;
      if (!isNumberArray(quoteRecord.close)) {
        throw new TypeError("Yahoo chart closes are invalid");
      }
      for (const key of ["open", "high", "low", "volume"] as const) {
        if (
          quoteRecord[key] !== undefined &&
          !isNumberArray(quoteRecord[key])
        ) {
          throw new TypeError(`Yahoo chart ${key} values are invalid`);
        }
      }
    }
  }
  const meta = first.meta as Record<string, unknown>;
  for (const key of [
    "symbol",
    "shortName",
    "longName",
    "exchangeName",
    "fullExchangeName",
    "currency",
    "marketState",
  ] as const) {
    if (meta[key] !== undefined && typeof meta[key] !== "string") {
      throw new TypeError(`Yahoo metadata ${key} is invalid`);
    }
  }
  for (const key of [
    "regularMarketPrice",
    "previousClose",
    "chartPreviousClose",
    "regularMarketTime",
  ] as const) {
    if (meta[key] !== undefined && typeof meta[key] !== "number") {
      throw new TypeError(`Yahoo metadata ${key} is invalid`);
    }
  }
  return first as YahooResult;
};

const normalizeSymbol = (value: string) => value.trim().toUpperCase();
const cents = (value: number | null | undefined) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Number.isSafeInteger(Math.round(value * 100))
    ? Math.round(value * 100)
    : null;

export const createPrices = (
  fetch_: typeof fetch = globalThis.fetch,
  timeoutMs = 10_000,
): Prices => {
  const chartCache = new Map<string, Cached<PriceHistory>>();
  const searchCache = new Map<
    string,
    Cached<ReadonlyArray<SymbolSearchResult>>
  >();

  const cached = <T>(
    cache: Map<string, Cached<T>>,
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ) => {
    const existing = cache.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.value;
    const value = load().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, { expiresAt: Date.now() + ttlMs, value });
    return value;
  };

  const loadHistory = async (
    rawSymbol: string,
    historyRange: HistoryRange,
  ): Promise<PriceHistory> => {
    const symbol = normalizeSymbol(rawSymbol);
    const query = RANGE_QUERY[historyRange];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?interval=${query.interval}&range=${query.range}&includePrePost=true`;

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

    const indicator = result?.indicators?.quote[0];
    const closes = indicator?.close;
    let latestCloseIndex = -1;
    for (let index = (closes?.length ?? 0) - 1; index >= 0; index--) {
      if (typeof closes?.[index] === "number") {
        latestCloseIndex = index;
        break;
      }
    }
    const latestClose =
      latestCloseIndex === -1 ? undefined : closes?.[latestCloseIndex];
    const price = latestClose ?? result?.meta.regularMarketPrice;
    if (!result || typeof price !== "number") throw new UnknownSymbol(symbol);

    const previousClose =
      result.meta.previousClose ?? result.meta.chartPreviousClose;
    const priceCents = cents(price);
    if (priceCents === null || priceCents <= 0) {
      throw new PriceUnavailable(
        symbol,
        new RangeError(`Invalid market price for ${symbol}`),
      );
    }
    const previousCloseCents = cents(previousClose);
    const changeCents =
      previousCloseCents === null ? null : priceCents - previousCloseCents;
    const timestamps = result.timestamp ?? [];
    const points: Array<HistoryPoint> = [];
    for (let index = 0; index < timestamps.length; index++) {
      const close = closes?.[index];
      if (typeof close !== "number") continue;
      const closeCents = cents(close);
      if (closeCents === null) continue;
      const volume = indicator?.volume?.[index];
      points.push({
        at: new Date(timestamps[index]! * 1000),
        openCents: cents(indicator?.open?.[index]),
        highCents: cents(indicator?.high?.[index]),
        lowCents: cents(indicator?.low?.[index]),
        closeCents,
        volume: typeof volume === "number" ? Math.round(volume) : null,
      });
    }
    const quote: Quote = {
      symbol: normalizeSymbol(result.meta.symbol ?? symbol),
      name: result.meta.longName ?? result.meta.shortName ?? null,
      exchange:
        result.meta.fullExchangeName ?? result.meta.exchangeName ?? null,
      priceCents,
      previousCloseCents,
      changeCents,
      changePercent:
        changeCents === null ||
        previousCloseCents === null ||
        previousCloseCents === 0
          ? null
          : (changeCents / previousCloseCents) * 100,
      currency: result.meta.currency ?? "UNKNOWN",
      marketState: result.meta.marketState ?? null,
      asOf: new Date(
        (latestCloseIndex >= 0 && timestamps[latestCloseIndex] !== undefined
          ? timestamps[latestCloseIndex]
          : (result.meta.regularMarketTime ?? Math.floor(Date.now() / 1000))) *
          1000,
      ),
    };
    return { range: historyRange, quote, points };
  };

  const history = (symbol: string, historyRange: HistoryRange) => {
    const normalized = normalizeSymbol(symbol);
    return cached(
      chartCache,
      `${normalized}:${historyRange}`,
      historyRange === "1D" ? 15_000 : 60_000,
      () => loadHistory(normalized, historyRange),
    );
  };

  return {
    quote: async (symbol, options) =>
      options?.fresh
        ? (await loadHistory(symbol, "1D")).quote
        : (await history(symbol, "1D")).quote,
    history,
    search: async (rawQuery) => {
      const query = rawQuery.trim();
      if (!query) return POPULAR_SYMBOLS;
      const key = query.toLowerCase();
      return cached(searchCache, key, 5 * 60_000, async () => {
        const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
          query,
        )}&quotesCount=10&newsCount=0`;
        try {
          const response = await fetch_(url, {
            headers: { "User-Agent": "Mozilla/5.0 (paper-trading-bot)" },
            signal: AbortSignal.timeout(Math.min(timeoutMs, 2_500)),
          });
          if (!response.ok) {
            throw new Error(`Yahoo returned HTTP ${response.status}`);
          }
          const body: unknown = await response.json();
          if (
            typeof body !== "object" ||
            body === null ||
            !("quotes" in body) ||
            !Array.isArray(body.quotes)
          ) {
            throw new TypeError("Yahoo search response is invalid");
          }
          return body.quotes
            .flatMap((value): Array<SymbolSearchResult> => {
              if (typeof value !== "object" || value === null) return [];
              const row = value as Record<string, unknown>;
              if (typeof row.symbol !== "string") return [];
              const type =
                typeof row.quoteType === "string" ? row.quoteType : "";
              if (type && !["EQUITY", "ETF", "INDEX"].includes(type)) return [];
              return [
                {
                  symbol: normalizeSymbol(row.symbol),
                  name:
                    typeof row.longname === "string"
                      ? row.longname
                      : typeof row.shortname === "string"
                        ? row.shortname
                        : normalizeSymbol(row.symbol),
                  exchange:
                    typeof row.exchange === "string" ? row.exchange : null,
                },
              ];
            })
            .slice(0, 10);
        } catch (cause) {
          throw new PriceUnavailable(query, cause);
        }
      });
    },
  };
};
