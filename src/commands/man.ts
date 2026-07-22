import type { Message, MessageReplyOptions } from "discord.js";
import { usd } from "../format.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";
import { InsufficientFunds, type Trading } from "../trading.js";

type ManReply =
  | { readonly embeds: NonNullable<MessageReplyOptions["embeds"]> }
  | { readonly content: string; readonly ephemeral: true };

const buyMan = async (
  userId: string,
  trading: Trading,
  requestId?: string,
): Promise<ManReply> => {
  try {
    const order = await trading.buy(userId, "MAN", 1, requestId);

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
  } catch (error) {
    if (error instanceof UnknownSymbol) {
      return {
        content: `Couldn't find a stock with symbol **${error.symbol}**.`,
        ephemeral: true,
      };
    }
    if (error instanceof PriceUnavailable) {
      return {
        content: `Couldn't fetch a price for **${error.symbol}** right now. Try again shortly.`,
        ephemeral: true,
      };
    }
    if (error instanceof InsufficientFunds) {
      return {
        content: `Not enough cash: that costs ${usd(error.needCents)} but you only have ${usd(error.haveCents)}.`,
        ephemeral: true,
      };
    }
    throw error;
  }
};

export const handleManMessage = async (message: Message, trading: Trading) => {
  if (message.author.bot || message.content.toLowerCase() !== "man") return;

  const response = await buyMan(message.author.id, trading, message.id);
  await message.reply(
    "embeds" in response
      ? { embeds: response.embeds, allowedMentions: { parse: [] } }
      : { content: response.content, allowedMentions: { parse: [] } },
  );
};
