import { createDiscordClient } from "./command-lib.js";
import { handleManMessage } from "./commands/man.js";
import { commands, handleInteraction } from "./commands.js";
import { requiredEnvironment } from "./config.js";
import { openDatabase } from "./db.js";
import { createPrices } from "./prices.js";
import { createTrading } from "./trading.js";

const main = async () => {
  const token = requiredEnvironment("DISCORD_BOT_TOKEN");
  const database = openDatabase();
  const prices = createPrices();
  const trading = createTrading(database.db, prices);
  const discord = createDiscordClient(
    commands,
    { prices, trading },
    handleInteraction,
    (message) => handleManMessage(message, trading),
  );
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Shutting down after ${signal}`);
    try {
      await discord.client.destroy();
      await discord.drain();
    } finally {
      database.close();
    }
  };

  const onSignal = (signal: NodeJS.Signals) => {
    void shutdown(signal).catch((error) => {
      console.error("Graceful shutdown failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  try {
    await discord.client.login(token);
  } catch (error) {
    database.close();
    throw error;
  }
};

main().catch((error: unknown) => {
  console.error("Bot failed to start", error);
  process.exitCode = 1;
});
