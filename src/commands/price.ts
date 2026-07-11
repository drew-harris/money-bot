import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { Prices } from "../prices.js";
import { catchQuoteErrors } from "./quote-errors.js";

// A quick price check that doesn't touch any account.
export const price = command({
  name: "price",
  description: "Look up the current price of a stock",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
  },
  execute: ({ symbol }) =>
    Effect.gen(function* () {
      const prices = yield* Prices;
      const quote = yield* prices.quote(symbol);
      return {
        content: `**${quote.symbol}**: ${usd(quote.priceCents)} ${quote.currency}`,
        ephemeral: true,
      };
    }).pipe(catchQuoteErrors()),
});
