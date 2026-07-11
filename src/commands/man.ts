import { Effect } from "effect";
import { command } from "../command-lib.js";
import { usd } from "../format.js";
import { Trading } from "../trading.js";

export const man = command({
  name: "man",
  description: "Buy one share of MAN at the current market price",
  execute: (_, { caller }) =>
    Effect.gen(function* () {
      const trading = yield* Trading;
      const order = yield* trading.buy(caller.id, "MAN", 1);

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
        InsufficientFunds: (e) =>
          Effect.succeed({
            content: `Not enough cash: that costs ${usd(e.needCents)} but you only have ${usd(e.haveCents)}.`,
            ephemeral: true,
          }),
      }),
    ),
});
