import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "discord.js";
import { handleManMessage } from "./commands/man.js";
import type { Trading } from "./trading.js";

const trading = (buy: Trading["buy"]): Trading => ({ buy }) as Trading;

test("an exact man message buys one MAN share and replies with the order embed", async () => {
  const calls: Array<unknown> = [];
  const replies: Array<unknown> = [];
  const message = {
    id: "message-1",
    author: { id: "alice", bot: false },
    content: "man",
    reply: async (reply: unknown) => {
      replies.push(reply);
    },
  } as unknown as Message;

  await handleManMessage(
    message,
    trading(async (...args) => {
      calls.push(args);
      return {
        symbol: "MAN",
        quantity: 1,
        priceCents: 4_250,
        costCents: 4_250,
        cashCents: 995_750,
      };
    }),
  );

  assert.deepEqual(calls, [["alice", "MAN", 1, "message-1"]]);
  assert.deepEqual(replies, [
    {
      embeds: [
        {
          title: "✅ Order filled",
          color: 0x57f287,
          description: "Bought **1** MAN @ $42.50",
          fields: [
            { name: "Total cost", value: "$42.50", inline: true },
            { name: "Cash left", value: "$9,957.50", inline: true },
          ],
        },
      ],
      allowedMentions: { parse: [] },
    },
  ]);
});

test("the man message match rejects messages with any other content", async () => {
  let purchases = 0;
  const service = trading(async () => {
    purchases++;
    throw new Error("should not purchase");
  });

  for (const content of [" man", "man ", "man!", "a man", "woman"]) {
    await handleManMessage(
      {
        author: { id: "alice", bot: false },
        content,
      } as Message,
      service,
    );
  }

  assert.equal(purchases, 0);
});
