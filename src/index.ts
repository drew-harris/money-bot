import { NodeRuntime } from "@effect/platform-node";
import * as Dotenv from "dotenv";
import { Layer } from "effect";
import { commandsLayer } from "./command-lib.js";
import { balance } from "./commands/balance.js";
import { buy } from "./commands/buy.js";
import { price } from "./commands/price.js";
import { sell } from "./commands/sell.js";
import { DatabaseLive } from "./db.js";
import { Prices } from "./prices.js";
import { Trading } from "./trading.js";

Dotenv.config({ quiet: true });

// Register every command here. To add one, write it in src/commands/ and add it
// to this list — nothing else in this file needs to change.
const Commands = commandsLayer([balance, buy, sell, price]);

// Wire the commands to the services they use:
//   - Trading: account/buy/sell/portfolio logic
//   - DatabaseLive: SQLite + Drizzle (runs migrations on startup)
//   - Prices: live stock quotes
// Trading itself needs the database and prices, so they're provided beneath it.
const MainLive = Commands.pipe(
  Layer.provide(Trading.Default),
  Layer.provide(Layer.mergeAll(DatabaseLive, Prices.Default)),
);

NodeRuntime.runMain(Layer.launch(MainLive));
