import { command } from "../command-lib.js";
import { usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";
import { InsufficientFunds } from "../trading.js";

export const man = command({
  name: "man",
  description: "Buy one share of MAN at the current market price",
  defer: true,
  execute: async (_, { caller, trading }) => {
    try {
      const order = await trading.buy(caller.id, "MAN", 1);

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
