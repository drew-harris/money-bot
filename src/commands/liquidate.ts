import { command } from "../command-lib.js";
import { embedDescription, usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";
import { NoHoldings } from "../trading.js";

export const liquidate = command({
  name: "liquidate",
  description: "Immediately sell every stock you hold at current market prices",
  defer: true,
  execute: async (_, { caller, trading }) => {
    try {
      const liquidation = await trading.liquidate(caller.id);
      const sold = liquidation.orders
        .map(
          (order) =>
            `**${order.quantity}** ${order.symbol} @ ${usd(order.priceCents)}`,
        )
        .join("\n");

      return {
        embeds: [
          {
            title: "All positions liquidated",
            color: 0xed4245,
            description: embedDescription(sold),
            fields: [
              {
                name: "Total proceeds",
                value: usd(liquidation.proceedsCents),
                inline: true,
              },
              {
                name: "Cash now",
                value: usd(liquidation.cashCents),
                inline: true,
              },
            ],
          },
        ],
      };
    } catch (error) {
      if (error instanceof NoHoldings) {
        return {
          content: "You don't have any stocks to liquidate.",
          ephemeral: true,
        };
      }
      if (error instanceof UnknownSymbol) {
        return {
          content: `Couldn't find a stock with symbol **${error.symbol}**. No positions were sold.`,
          ephemeral: true,
        };
      }
      if (error instanceof PriceUnavailable) {
        return {
          content: `Couldn't fetch a price for **${error.symbol}** right now. No positions were sold.`,
          ephemeral: true,
        };
      }
      throw error;
    }
  },
});
