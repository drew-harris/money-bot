import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { Prices } from "../prices.js";
import { catchQuoteErrors } from "./quote-errors.js";

// Sends users to Yahoo Finance's full quote page after confirming the ticker exists.
export const stockinfo = command({
  name: "stockinfo",
  description: "Open a stock's chart and company details",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
  },
  execute: ({ symbol }) =>
    Effect.gen(function* () {
      const prices = yield* Prices;
      const quote = yield* prices.quote(symbol);
      const url = `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}/`;

      return {
        embeds: [
          {
            title: `${quote.symbol} stock information`,
            color: 0x5865f2,
            description: `[Open chart, company details, and news](${url})`,
            fields: [
              {
                name: "Latest price",
                value: `${usd(quote.priceCents)} ${quote.currency}`,
                inline: true,
              },
            ],
          },
        ],
      };
    }).pipe(
      catchQuoteErrors({
        priceUnavailable: (symbol) =>
          `Couldn't fetch information for **${symbol}** right now. Try again shortly.`,
      }),
    ),
});
