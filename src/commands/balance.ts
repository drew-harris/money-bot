import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import { Trading } from "../trading.js";

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
    execute: ({ user, ephemeral }, { caller }) =>
        Effect.gen(function* () {
            const trading = yield* Trading;
            const portfolioUser = user ?? caller;
            const p = yield* trading.portfolio(portfolioUser.id);

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
                        description: holdings,
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
