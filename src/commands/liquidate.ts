import { Effect } from "effect";
import { command } from "../command-lib.js";
import { usd } from "../format.js";
import { Trading } from "../trading.js";
import { catchQuoteErrors } from "./quote-errors.js";

export const liquidate = command({
  name: "liquidate",
  description: "Immediately sell every stock you hold at current market prices",
  execute: (_, { caller }) =>
    Effect.gen(function* () {
      const trading = yield* Trading;
      const liquidation = yield* trading.liquidate(caller.id);
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
            description: sold,
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
    }).pipe(
      catchQuoteErrors({
        unknownSymbol: (symbol) =>
          `Couldn't find a stock with symbol **${symbol}**. No positions were sold.`,
        priceUnavailable: (symbol) =>
          `Couldn't fetch a price for **${symbol}** right now. No positions were sold.`,
      }),
      Effect.catchTags({
        NoHoldings: () =>
          Effect.succeed({
            content: "You don't have any stocks to liquidate.",
            ephemeral: true,
          }),
      }),
    ),
});
