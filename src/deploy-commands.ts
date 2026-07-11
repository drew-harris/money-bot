import { deployCommands } from "./command-lib.js";
import { commands } from "./commands.js";
import { requiredEnvironment } from "./config.js";

await deployCommands(
  commands,
  requiredEnvironment("DISCORD_BOT_TOKEN"),
  requiredEnvironment("DISCORD_CLIENT_ID"),
);
