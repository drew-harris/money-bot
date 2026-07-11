import { command, input } from "../command-lib.js";
import { usd } from "../format.js";
import {
  InsufficientFunds,
  InvalidPaymentAmount,
  SamePaymentRecipient,
} from "../trading.js";

export const toCents = (amount: number) => {
  const cents = Math.round(amount * 100);
  return Number.isFinite(amount) && Math.abs(amount * 100 - cents) < 1e-8
    ? cents
    : Number.NaN;
};

export const pay = command({
  name: "pay",
  description: "Transfer cash to another user",
  inputs: {
    user: input.user("User to pay"),
    amount: input.number("Dollar amount to transfer, e.g. 25.50"),
  },
  execute: async ({ user, amount }, { caller, trading }) => {
    try {
      const payment = await trading.pay(caller.id, user.id, toCents(amount));

      return {
        embeds: [
          {
            title: "Payment sent",
            color: 0x57f287,
            description: `Sent **${usd(payment.cents)}** to <@${user.id}>.`,
            fields: [
              {
                name: "Cash left",
                value: usd(payment.senderCashCents),
                inline: true,
              },
            ],
          },
        ],
      };
    } catch (error) {
      if (error instanceof InvalidPaymentAmount) {
        return {
          content:
            "Amount must be a positive dollar value with at most two decimal places.",
          ephemeral: true,
        };
      }
      if (error instanceof SamePaymentRecipient) {
        return { content: "You can't pay yourself.", ephemeral: true };
      }
      if (error instanceof InsufficientFunds) {
        return {
          content: `Not enough cash: you're sending ${usd(error.needCents)} but only have ${usd(error.haveCents)}.`,
          ephemeral: true,
        };
      }
      throw error;
    }
  },
});
