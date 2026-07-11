import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { Trading } from "../trading.js";
import { catchQuoteErrors } from "./quote-errors.js";

export const sell = command({
  name: "sell",
  description: "Sell shares of a stock at the current market price",
  inputs: {
    symbol: input.string("Ticker symbol, e.g. AAPL"),
    quantity: input.integer("Number of shares to sell"),
  },
  execute: ({ symbol, quantity }, { caller }) =>
    Effect.gen(function* () {
      const trading = yield* Trading;
      const order = yield* trading.sell(caller.id, symbol, quantity);

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
    }).pipe(
      catchQuoteErrors(),
      Effect.catchTags({
        InvalidQuantity: () =>
          Effect.succeed({
            content: "Quantity must be a positive whole number of shares.",
            ephemeral: true,
          }),
        InsufficientShares: (e) =>
          Effect.succeed({
            content: `You only have **${e.have}** share(s) of **${e.symbol}**, can't sell ${e.want}.`,
            ephemeral: true,
          }),
      }),
    ),
});
