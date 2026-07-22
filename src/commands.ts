import { balance } from "./commands/balance.js";
import { buy } from "./commands/buy.js";
import { leaderboard } from "./commands/leaderboard.js";
import { liquidate } from "./commands/liquidate.js";
import { man } from "./commands/man.js";
import { pay } from "./commands/pay.js";
import { positions } from "./commands/positions.js";
import { price } from "./commands/price.js";
import { sell } from "./commands/sell.js";
import { stockinfo } from "./commands/stockinfo.js";

export const commands = [
  balance,
  buy,
  man,
  sell,
  liquidate,
  leaderboard,
  pay,
  positions,
  price,
  stockinfo,
] as const;
