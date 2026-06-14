import { NodeRuntime } from "@effect/platform-node";
import * as Dotenv from "dotenv";
import { Layer } from "effect";
import { commandsLayer } from "./command-lib.js";
import { balance } from "./commands/balance.js";
import { hello } from "./commands/hello.js";
import { profile } from "./commands/profile.js";
import { DatabaseLive } from "./db.js";

Dotenv.config({ quiet: true });

// Register every command here. To add one, write it in src/commands/ and add it
// to this list — nothing else in this file needs to change.
const Commands = commandsLayer([hello, balance, profile]);

// Provide the services the commands use (the database, which also runs
// migrations on startup) and launch the bot.
const MainLive = Commands.pipe(Layer.provide(DatabaseLive));

NodeRuntime.runMain(Layer.launch(MainLive));
