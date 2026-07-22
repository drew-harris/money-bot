import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationCommandOptionType } from "discord.js";
import { toCents } from "./commands/pay.js";
import { commands } from "./commands.js";

test("exports the complete slash command payload", () => {
  assert.deepEqual(
    commands.map(({ name }) => name),
    [
      "balance",
      "buy",
      "man",
      "sell",
      "liquidate",
      "baltop",
      "pay",
      "price",
      "stockinfo",
    ],
  );
  const pay = commands.find(({ name }) => name === "pay")?.data;
  assert.deepEqual(
    pay?.options?.map(({ name, type, required }) => ({ name, type, required })),
    [
      { name: "user", type: ApplicationCommandOptionType.User, required: true },
      {
        name: "amount",
        type: ApplicationCommandOptionType.Number,
        required: true,
      },
    ],
  );
});

test("converts exact dollar values to integer cents", () => {
  assert.equal(toCents(25.5), 2_550);
  assert.equal(toCents(0.001), Number.NaN);
  assert.equal(toCents(Number.POSITIVE_INFINITY), Number.NaN);
});
