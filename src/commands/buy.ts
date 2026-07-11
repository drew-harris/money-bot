import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";
import { InsufficientFunds, InvalidQuantity } from "../trading.js";

export const buy = command({
  name: "buy",
  description: "Buy shares of a stock at the current market price",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
    quantity: input.integer("Number of shares to buy"),
  },
  defer: true,
  execute: async ({ symbol, quantity }, { caller, trading }) => {
    try {
      const order = await trading.buy(caller.id, symbol, quantity);

      return {
        embeds: [
          {
            title: "✅ Order filled",
            color: 0x57f287,
            description: `Bought **${order.quantity}** ${order.symbol} @ ${usd(order.priceCents)}`,
            fields: [
              { name: "Total cost", value: usd(order.costCents), inline: true },
              { name: "Cash left", value: usd(order.cashCents), inline: true },
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
      if (error instanceof InsufficientFunds) {
        return {
          content: `Not enough cash: that costs ${usd(error.needCents)} but you only have ${usd(error.haveCents)}.`,
          ephemeral: true,
        };
      }
      throw error;
    }
  },
});
