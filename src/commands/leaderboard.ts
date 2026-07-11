import { Effect } from "effect";
import { command } from "../command-lib.js";
import { usd } from "../format.js";
import { Trading } from "../trading.js";

export const leaderboard = command({
  name: "leaderboard",
  description: "Show every trader ranked by net worth",
  execute: () =>
    Effect.gen(function* () {
      const trading = yield* Trading;
      const traders = yield* trading.leaderboard();
      const rankings = traders.length
        ? traders
            .map(
              (trader, index) =>
                `**${index + 1}.** <@${trader.userId}> — ${usd(trader.netWorthCents)}`,
            )
            .join("\n")
        : "_No traders yet. Use `/buy` to get started._";

      return {
        embeds: [
          {
            title: "Net worth leaderboard",
            color: 0x5865f2,
            description: rankings,
          },
        ],
      };
    }).pipe(
      Effect.catchTags({
        UnknownSymbol: (e) =>
          Effect.succeed({
            content: `One of the holdings (**${e.symbol}**) couldn't be priced right now. Try again shortly.`,
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
