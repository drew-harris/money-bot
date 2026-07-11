import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";

// A quick price check that doesn't touch any account.
export const price = command({
  name: "price",
  description: "Look up the current price of a stock",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
  },
  defer: { ephemeral: true },
  execute: async ({ symbol }, { prices }) => {
    try {
      const quote = await prices.quote(symbol);
      return {
        content: `**${quote.symbol}**: ${usd(quote.priceCents)} ${quote.currency}`,
        ephemeral: true,
      };
    } catch (error) {
      if (error instanceof UnknownSymbol) {
        return {
          content: `Couldn't find a stock with symbol **${error.symbol}**.`,
          ephemeral: true,
        };
      }
      if (error instanceof PriceUnavailable) {
        return {
          content: `Couldn't fetch a price for **${error.symbol}** right now. Try again shortly.`,
          ephemeral: true,
        };
      }
      throw error;
    }
  },
});
