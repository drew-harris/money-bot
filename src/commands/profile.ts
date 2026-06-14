import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { command, input } from "../command-lib.js";
import { SqliteDrizzle } from "../db.js";
import { balances } from "../schema.js";

// A rich response: instead of a string, return an object with embeds (and here,
// an ephemeral flag). Every Discord message field is available and typed.
export const profile = command({
  name: "profile",
  description: "Show a money profile as an embed",
  inputs: {
    user: input.user("Whose profile to show (defaults to you)", {
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
      const row = rows[0];

      return {
        ephemeral: true,
        embeds: [
          {
            title: `${target.username}'s profile`,
            color: 0x57f287,
            fields: [
              { name: "Balance", value: `$${row?.balance ?? 0}`, inline: true },
              {
                name: "Last updated",
                value: row
                  ? `<t:${Math.floor(row.updatedAt.getTime() / 1000)}:R>`
                  : "never",
                inline: true,
              },
            ],
          },
        ],
      };
    }),
});
