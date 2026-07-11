import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";
import { InsufficientShares, InvalidQuantity } from "../trading.js";

export const sell = command({
  name: "sell",
  description: "Sell shares of a stock at the current market price",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
    quantity: input.integer("Number of shares to sell"),
  },
  defer: true,
  execute: async ({ symbol, quantity }, { caller, trading }) => {
    try {
      const order = await trading.sell(caller.id, symbol, quantity);

      return {
        embeds: [
          {
            title: "✅ Order filled",
            color: 0xed4245,
            description: `Sold **${order.quantity}** ${order.symbol} @ ${usd(order.priceCents)}`,
            fields: [
              {
                name: "Proceeds",
                value: usd(order.proceedsCents),
                inline: true,
              },
              { name: "Cash now", value: usd(order.cashCents), inline: true },
            ],
          },
        ],
      };
    } catch (error) {
      if (error instanceof InvalidQuantity) {
        return {
          content: "Quantity must be a positive whole number of shares.",
          ephemeral: true,
        };
      }
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
      if (error instanceof InsufficientShares) {
        return {
          content: `You only have **${error.have}** share(s) of **${error.symbol}**, can't sell ${error.want}.`,
          ephemeral: true,
        };
      }
      throw error;
    }
  },
});
