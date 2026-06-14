import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { SqliteDrizzle } from "../db.js";
import { balances } from "../schema.js";

// Inputs + a service: an optional user argument, and a database read.
export const balance = command({
  name: "balance",
  description: "Check a balance",
  inputs: {
    user: input.user("Whose balance to check (defaults to you)", {
      required: false,
    }),
  },
  execute: ({ user }, { caller }) =>
    Effect.gen(function* () {
      const db = yield* SqliteDrizzle;
      const target = user ?? caller;

      const rows = yield* db
        .select()
        .from(balances)
        .where(eq(balances.userId, target.id));

      const amount = rows[0]?.balance ?? 0;
      return `${target.username} has $${amount}`;
    }),
});
