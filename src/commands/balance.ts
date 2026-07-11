import { command, input } from "../command-lib.js";
import { embedDescription, usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";

// Shows a user's cash, every position valued at the current market price,
// and total net worth. Everyone starts at $10,000 the first time they trade.
export const balance = command({
  name: "balance",
  description: "Show a user's cash, holdings, and net worth",
  inputs: {
    user: input.user("User whose portfolio to show", { required: false }),
    ephemeral: input.boolean("Only show the result to you", {
      required: false,
    }),
  },
  defer: { ephemeral: ({ ephemeral }) => ephemeral ?? false },
  execute: async ({ user, ephemeral }, { caller, trading }) => {
    try {
      const portfolioUser = user ?? caller;
      const p = await trading.portfolio(portfolioUser.id);

      const holdings = p.positions.length
        ? p.positions
            .map(
              (pos) =>
                `**${pos.symbol}** — ${pos.quantity} @ ${usd(pos.priceCents)} = ${usd(pos.valueCents)}`,
            )
            .join("\n")
        : "_No positions yet. Use `/buy` to get started._";

      return {
        ephemeral: ephemeral ?? false,
        embeds: [
          {
            title: `${portfolioUser.username}'s portfolio`,
            color: 0x5865f2,
            description: embedDescription(holdings),
            fields: [
              {
                name: "Cash",
                value: usd(p.cashCents),
                inline: true,
              },
              {
                name: "Net worth",
                value: usd(p.netWorthCents),
                inline: true,
              },
            ],
          },
        ],
      };
    } catch (error) {
      if (error instanceof UnknownSymbol) {
        return {
          content: `One of your holdings (**${error.symbol}**) couldn't be priced right now. Try again shortly.`,
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
