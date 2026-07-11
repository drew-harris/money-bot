import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { Trading } from "../trading.js";
import { catchQuoteErrors } from "./quote-errors.js";

export const buy = command({
  name: "buy",
  description: "Buy shares of a stock at the current market price",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
    quantity: input.integer("Number of shares to buy"),
  },
  execute: ({ symbol, quantity }, { caller }) =>
    Effect.gen(function* () {
      const trading = yield* Trading;
      const order = yield* trading.buy(caller.id, symbol, quantity);

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
    }).pipe(
      catchQuoteErrors(),
      Effect.catchTags({
        InvalidQuantity: () =>
          Effect.succeed({
            content: "Quantity must be a positive whole number of shares.",
            ephemeral: true,
          }),
        InsufficientFunds: (e) =>
          Effect.succeed({
            content: `Not enough cash: that costs ${usd(e.needCents)} but you only have ${usd(e.haveCents)}.`,
            ephemeral: true,
          }),
      }),
    ),
});
