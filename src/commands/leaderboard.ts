import { command } from "../command-lib.js";
import { embedDescription, usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";

export const leaderboard = command({
  name: "leaderboard",
  description: "Show every trader ranked by net worth",
  defer: true,
  execute: async (_, { trading }) => {
    try {
      const traders = await trading.leaderboard();
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
            description: embedDescription(rankings),
          },
        ],
      };
    } catch (error) {
      if (error instanceof UnknownSymbol) {
        return {
          content: `One of the holdings (**${error.symbol}**) couldn't be priced right now. Try again shortly.`,
          ephemeral: true,
        };
      }
      if (error instanceof PriceUnavailable) {
        return {
          content: `Couldn't fetch a price for **${error.symbol}** right now. Try again shortly.`,
          ephemeral: true,
        };
      }
      throw error;
    }
  },
});
