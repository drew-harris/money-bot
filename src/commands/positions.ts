import { command } from "../command-lib.js";
import { embedDescription, usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";

const signedUsd = (cents: number) => {
  if (cents === 0) return usd(0);
  return `${cents > 0 ? "+" : "-"}${usd(Math.abs(cents))}`;
};

const signedPercent = (changeCents: number, basisCents: number) => {
  if (changeCents === 0) return "0.00%";
  const percent = (Math.abs(changeCents) / basisCents) * 100;
  return `${changeCents > 0 ? "+" : "-"}${percent.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
};

export const positions = command({
  name: "positions",
  description: "Show your holdings and their gains or losses",
  defer: true,
  execute: async (_, { caller, trading }) => {
    try {
      const portfolio = await trading.portfolio(caller.id);
      const marketValueCents = portfolio.positions.reduce(
        (total, position) => total + position.valueCents,
        0,
      );
      const costBasisCents = portfolio.positions.reduce(
        (total, position) => total + position.costBasisCents,
        0,
      );
      const gainLossCents = marketValueCents - costBasisCents;
      const description = portfolio.positions.length
        ? portfolio.positions
            .map(
              (position) =>
                `**${position.symbol}** - **${position.quantity} share${position.quantity === 1 ? "" : "s"}** @ ${usd(position.priceCents)} = **${usd(position.valueCents)}**\nCost basis: ${usd(position.costBasisCents)} | Return: **${signedUsd(position.gainLossCents)} (${signedPercent(position.gainLossCents, position.costBasisCents)})**`,
            )
            .join("\n\n")
        : "_No positions yet. Use `/buy` to get started._";

      return {
        embeds: [
          {
            title: `${caller.username}'s positions`,
            color:
              gainLossCents > 0
                ? 0x57f287
                : gainLossCents < 0
                  ? 0xed4245
                  : 0x5865f2,
            description: embedDescription(description),
            ...(portfolio.positions.length
              ? {
                  fields: [
                    {
                      name: "Cost basis",
                      value: usd(costBasisCents),
                      inline: true,
                    },
                    {
                      name: "Market value",
                      value: usd(marketValueCents),
                      inline: true,
                    },
                    {
                      name: "Total return",
                      value: `${signedUsd(gainLossCents)} (${signedPercent(gainLossCents, costBasisCents)})`,
                      inline: true,
                    },
                  ],
                }
              : {}),
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
