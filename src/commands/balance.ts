import { Effect } from "effect";
import { command } from "../command-lib.js";
import { usd } from "../format.js";
import { Trading } from "../trading.js";

// Shows the caller's cash, every position valued at the current market price,
// and total net worth. Everyone starts at $10,000 the first time they trade.
export const balance = command({
  name: "balance",
  description: "Show your cash, holdings, and net worth",
  execute: (_inputs, { caller }) =>
    Effect.gen(function* () {
      const trading = yield* Trading;
      const p = yield* trading.portfolio(caller.id);

      const holdings = p.positions.length
        ? p.positions
            .map(
              (pos) =>
                `**${pos.symbol}** — ${pos.quantity} @ ${usd(pos.priceCents)} = ${usd(pos.valueCents)}`,
            )
            .join("\n")
        : "_No positions yet. Use `/buy` to get started._";

      return {
        embeds: [
          {
            title: `${caller.username}'s portfolio`,
            color: 0x5865f2,
            description: holdings,
            fields: [
              { name: "Cash", value: usd(p.cashCents), inline: true },
              { name: "Net worth", value: usd(p.netWorthCents), inline: true },
            ],
          },
        ],
      };
    }).pipe(
      Effect.catchTags({
        UnknownSymbol: (e) =>
          Effect.succeed({
            content: `One of your holdings (**${e.symbol}**) couldn't be priced right now. Try again shortly.`,
            ephemeral: true,
          }),
        PriceUnavailable: (e) =>
          Effect.succeed({
            content: `Couldn't fetch a price for **${e.symbol}** right now. Try again shortly.`,
            ephemeral: true,
          }),
      }),
    ),
});
