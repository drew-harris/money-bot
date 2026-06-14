import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { Prices } from "../prices.js";

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
      return `**${quote.symbol}**: ${usd(quote.priceCents)} ${quote.currency}`;
    }).pipe(
      Effect.catchTags({
        UnknownSymbol: (e) =>
          Effect.succeed({
            content: `Couldn't find a stock with symbol **${e.symbol}**.`,
            ephemeral: true,
          }),
        PriceUnavailable: (e) =>
          Effect.succeed({
            content: `Couldn't fetch a price for **${e.symbol}** right now. Try again shortly.`,
            ephemeral: true,
          }),
      }),
    ),
});
