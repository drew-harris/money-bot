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

Dotenv.config({ quiet: false });

const Commands = commandsLayer([balance, buy, sell, price]);

const MainLive = Commands.pipe(
  Layer.provide(Trading.Default),
  Layer.provide(Layer.mergeAll(DatabaseLive, Prices.Default)),
);

NodeRuntime.runMain(Layer.launch(MainLive));
