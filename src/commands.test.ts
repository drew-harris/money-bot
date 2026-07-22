import assert from "node:assert/strict";
import test from "node:test";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  MessageFlags,
} from "discord.js";
import { commands, handleInteraction, toCents } from "./commands.js";
import { UnknownSymbol } from "./prices.js";
import { componentId, parseComponentId, welcomeView } from "./views.js";

test("exports the redesigned application command surface", () => {
  assert.deepEqual(
    commands.map(({ name }) => name),
    [
      "portfolio",
      "stock",
      "trade",
      "leaderboard",
      "View portfolio",
      "Send cash",
    ],
  );
  const trade = commands.find(({ name }) => name === "trade")?.data;
  assert.equal(trade?.type, ApplicationCommandType.ChatInput);
  assert.deepEqual(
    trade?.options?.map(({ name, type }) => ({ name, type })),
    [
      { name: "buy", type: ApplicationCommandOptionType.Subcommand },
      { name: "sell", type: ApplicationCommandOptionType.Subcommand },
    ],
  );
  assert.equal(
    commands.find(({ name }) => name === "Send cash")?.data.type,
    ApplicationCommandType.User,
  );
});

test("parses exact dollar values to integer cents", () => {
  assert.equal(toCents("25.5"), 2_550);
  assert.equal(toCents("25.50"), 2_550);
  assert.equal(toCents("0.001"), Number.NaN);
  assert.equal(toCents("nope"), Number.NaN);
});

test("component IDs round-trip and welcome uses Components V2", () => {
  const id = componentId("order", "confirm", "an:id/with spaces");
  assert.deepEqual(parseComponentId(id), [
    "order",
    "confirm",
    "an:id/with spaces",
  ]);
  const view = welcomeView({
    id: "alice",
    username: "Alice",
    displayAvatarURL: () => "https://example.com/avatar.png",
  } as never);
  assert.equal(view.flags, MessageFlags.IsComponentsV2);
  assert.equal(view.components?.length, 1);
});

test("a failed public stock lookup removes loading and replies privately", async () => {
  const calls: Array<[string, unknown?]> = [];
  const interaction = {
    id: "interaction-1",
    user: { id: "alice" },
    commandName: "stock",
    options: { getString: () => "MISSING" },
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isUserContextMenuCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferReply: async () => {
      calls.push(["deferReply"]);
    },
    editReply: async (value: unknown) => {
      calls.push(["editReply", value]);
    },
    deleteReply: async () => {
      calls.push(["deleteReply"]);
    },
    followUp: async (value: unknown) => {
      calls.push(["followUp", value]);
    },
  };
  await handleInteraction(
    interaction as never,
    {
      prices: {
        history: async () => {
          throw new UnknownSymbol("MISSING");
        },
      },
    } as never,
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ["deferReply", "deleteReply", "followUp"],
  );
  assert.equal(
    (calls[2]?.[1] as { flags?: MessageFlags }).flags,
    MessageFlags.Ephemeral,
  );
});

test("a replayed order confirmation does not publish another receipt", async () => {
  const calls: Array<[string, unknown?]> = [];
  const interaction = {
    id: "interaction-2",
    user: { id: "alice" },
    customId: componentId("order", "confirm", "order-1"),
    message: { flags: { has: () => true } },
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isUserContextMenuCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: async () => {
      calls.push(["deferUpdate"]);
    },
    editReply: async (value: unknown) => {
      calls.push(["editReply", value]);
    },
    followUp: async (value: unknown) => {
      calls.push(["followUp", value]);
    },
  };
  await handleInteraction(
    interaction as never,
    {
      trading: {
        confirmOrder: async () => ({
          id: "order-1",
          side: "buy",
          symbol: "AAPL",
          quantity: 1,
          priceCents: 10_000,
          totalCents: 10_000,
          cashCents: 990_000,
          replayed: true,
        }),
      },
    } as never,
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ["deferUpdate", "editReply"],
  );
});
