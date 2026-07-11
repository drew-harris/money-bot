import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";

// Sends users to Yahoo Finance's full quote page after confirming the ticker exists.
export const stockinfo = command({
  name: "stockinfo",
  description: "Open a stock's chart and company details",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
  },
  defer: true,
  execute: async ({ symbol }, { prices }) => {
    try {
      const quote = await prices.quote(symbol);
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
    } catch (error) {
      if (error instanceof UnknownSymbol) {
        return {
          content: `Couldn't find a stock with symbol **${error.symbol}**.`,
          ephemeral: true,
        };
      }
      if (error instanceof PriceUnavailable) {
        return {
          content: `Couldn't fetch information for **${error.symbol}** right now. Try again shortly.`,
          ephemeral: true,
        };
      }
      throw error;
    }
  },
});
