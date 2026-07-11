import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { commandsLayer } from "./command-lib.js";
import { balance } from "./commands/balance.js";
import { buy } from "./commands/buy.js";
import { liquidate } from "./commands/liquidate.js";
import { price } from "./commands/price.js";
import { sell } from "./commands/sell.js";
import { stockinfo } from "./commands/stockinfo.js";
import { DatabaseLive } from "./db.js";
import { Prices } from "./prices.js";
import { Trading } from "./trading.js";

const Commands = commandsLayer([
  balance,
  buy,
  sell,
  liquidate,
  price,
  stockinfo,
]);

const MainLive = Commands.pipe(
  Layer.provide(Trading.Default),
  Layer.provide(Layer.mergeAll(DatabaseLive, Prices.Default)),
);

NodeRuntime.runMain(Layer.launch(MainLive));
