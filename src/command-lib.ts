/**
 * command-lib — a tiny façade over dfx for declaring Discord slash commands.
 *
 * To add a command you describe four things and nothing else:
 *
 *   - name:        what users type after "/"
 *   - description: shown in Discord's command picker
 *   - inputs:      (optional) the typed arguments the command accepts
 *   - execute:     an Effect that receives the parsed inputs and returns a reply
 *
 * Everything below those four — option-type integers, the response envelope,
 * reading raw option values, the gateway connection, and the Effect layers —
 * is handled in this file. A command author never imports `dfx` directly.
 *
 * Minimal example:
 *
 *   export const ping = command({
 *     name: "ping",
 *     description: "Check the bot is alive",
 *     execute: () => Effect.succeed("Pong!"),
 *   })
 *
 * With inputs and a service (see commands/ for more):
 *
 *   export const greet = command({
 *     name: "greet",
 *     description: "Greet someone",
 *     inputs: { who: input.string("Who to greet") },
 *     execute: ({ who }) => Effect.succeed(`Hello, ${who}!`),
 *   })
 */
import { NodeHttpClient, NodeSocket } from "@effect/platform-node";
import { Discord, DiscordConfig, Ix } from "dfx";
import type { DiscordGateway } from "dfx/DiscordGateway";
import type { DiscordREST } from "dfx/DiscordREST";
import type { CommandHelper } from "dfx/Interactions/commandHelper";
import { DiscordLive, runIx } from "dfx/gateway";
import { Config, Effect, HashMap, Layer, Option } from "effect";

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

/** A single rich embed. Has typed `title`, `description`, `color`, `fields`, ... */
export type Embed = Discord.RichEmbed;

/**
 * A reply with full control over the message: `content`, `embeds`, `components`,
 * `attachments`, `poll`, `tts`, etc. — every field Discord accepts, fully typed.
 * Return a plain string instead when you only need text.
 *
 *   return {
 *     embeds: [{ title: "Balance", description: "$100", color: 0x57f287 }],
 *     ephemeral: true,
 *   }
 */
export interface Reply extends Discord.IncomingWebhookInteractionRequest {
  /**
   * When true, only the user who ran the command can see the reply. Sugar for
   * the Discord ephemeral message flag; combine freely with `content`/`embeds`.
   */
  readonly ephemeral?: boolean;
}

/** What an `execute` may return: plain text, or a {@link Reply} for more control. */
export type ReplyResult = string | Reply;

// Discord message flag marking a reply as ephemeral (visible only to the caller).
const EPHEMERAL_FLAG = 1 << 6;

const toResponse = (
  reply: ReplyResult,
): Discord.CreateInteractionResponseRequest => {
  const data: Discord.IncomingWebhookInteractionRequest =
    typeof reply === "string"
      ? { content: reply }
      : (() => {
          // Fold our `ephemeral` sugar into the real `flags` bitfield, leaving
          // every other Discord field (embeds, components, ...) untouched.
          const { ephemeral, flags, ...rest } = reply;
          return ephemeral || flags != null
            ? { ...rest, flags: (flags ?? 0) | (ephemeral ? EPHEMERAL_FLAG : 0) }
            : rest;
        })();
  return Ix.response({
    type: Discord.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
    data,
  });
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A single command argument. You never construct these directly — use the
 * {@link input} helpers (`input.string(...)`, `input.user(...)`, ...).
 */
export interface Input<out V> {
  readonly optionType: Discord.ApplicationCommandOptionType;
  readonly description: string;
  readonly required: boolean;
  /** Reads this argument's value out of an incoming interaction. */
  readonly read: (ix: CommandHelper<any>, name: string) => V;
}

// Discord delivers every option value as a string; we parse per input type.
const rawValue = (ix: CommandHelper<any>, name: string): string | undefined =>
  Option.getOrUndefined(HashMap.get(ix.optionsMap, name));

// Builds an `input.*` helper. The overloads make a value required by default and
// `V | undefined` when `{ required: false }` is passed, so `execute`'s argument
// types stay accurate without the author thinking about it.
const makeInput = <V>(
  optionType: Discord.ApplicationCommandOptionType,
  parse: (ix: CommandHelper<any>, name: string) => V | undefined,
) => {
  function build(description: string): Input<V>;
  function build(description: string, options: { required: true }): Input<V>;
  function build(
    description: string,
    options: { required: false },
  ): Input<V | undefined>;
  function build(
    description: string,
    options?: { required?: boolean },
  ): Input<V | undefined> {
    const required = options?.required ?? true;
    return {
      optionType,
      description,
      required,
      read: (ix, name) => parse(ix, name),
    };
  }
  return build;
};

/** Typed argument builders for the `inputs` of a {@link command}. */
export const input = {
  /** A text argument. */
  string: makeInput<string>(
    Discord.ApplicationCommandOptionType.STRING,
    (ix, name) => rawValue(ix, name),
  ),
  /** A whole-number argument. */
  integer: makeInput<number>(
    Discord.ApplicationCommandOptionType.INTEGER,
    (ix, name) => {
      const value = rawValue(ix, name);
      return value === undefined ? undefined : Number(value);
    },
  ),
  /** A decimal-number argument. */
  number: makeInput<number>(
    Discord.ApplicationCommandOptionType.NUMBER,
    (ix, name) => {
      const value = rawValue(ix, name);
      return value === undefined ? undefined : Number(value);
    },
  ),
  /** A true/false argument. */
  boolean: makeInput<boolean>(
    Discord.ApplicationCommandOptionType.BOOLEAN,
    (ix, name) => {
      const value = rawValue(ix, name);
      return value === undefined ? undefined : value === "true";
    },
  ),
  /** A Discord user argument; resolves to the full user object. */
  user: makeInput<Discord.UserResponse>(
    Discord.ApplicationCommandOptionType.USER,
    (ix, name) =>
      Option.getOrUndefined(
        // `resolve`'s typed overloads need the literal command shape (which this
        // generic façade doesn't carry), so we read it dynamically here.
        (ix as any).resolve(name, (id: string, data: Discord.InteractionDataResolved) =>
          data.users?.[id],
        ),
      ),
  ),
} as const;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type InputsRecord = Record<string, Input<any>>;

// Turns an `inputs` record into the `{ name: value }` object passed to execute.
type InputValues<I extends InputsRecord> = {
  [K in keyof I]: I[K] extends Input<infer V> ? V : never;
};

/** Per-interaction context passed to `execute` alongside the parsed inputs. */
export interface CommandContext {
  /** The Discord user who ran the command. */
  readonly caller: Discord.UserResponse;
  /** The raw interaction, for advanced use. */
  readonly interaction: Discord.APIInteraction;
}

export interface CommandConfig<I extends InputsRecord, E, R> {
  /** The slash command name (what users type after "/"). */
  readonly name: string;
  /** Shown in Discord's command picker. */
  readonly description: string;
  /** The typed arguments this command accepts. Omit for a command with none. */
  readonly inputs?: I;
  /**
   * Runs when the command is invoked. Receives the parsed {@link inputs} and a
   * {@link CommandContext}. Return a string (or {@link Reply}) to reply, or yield
   * any service (e.g. the database) from the surrounding Effect.
   */
  readonly execute: (
    inputs: InputValues<I>,
    context: CommandContext,
  ) => Effect.Effect<ReplyResult, E, R>;
}

/** Declare a slash command. Pass the result to {@link commandsLayer}. */
export const command = <I extends InputsRecord = {}, E = never, R = never>(
  config: CommandConfig<I, E, R>,
) => {
  const inputs = (config.inputs ?? {}) as I;
  const options = Object.entries(inputs).map(([name, def]) => ({
    type: def.optionType,
    name,
    description: def.description,
    required: def.required,
  }));

  const handle = (ix: CommandHelper<any>) => {
    const values: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(inputs)) {
      values[name] = def.read(ix, name);
    }
    const caller = (ix.interaction.member?.user ??
      ix.interaction.user)! as Discord.UserResponse;
    return config
      .execute(values as InputValues<I>, {
        caller,
        interaction: ix.interaction,
      })
      .pipe(Effect.map(toResponse));
  };

  return Ix.global(
    {
      name: config.name,
      description: config.description,
      ...(options.length > 0 ? { options } : {}),
    } as Discord.ApplicationCommandCreateRequest,
    handle,
  );
};

// ---------------------------------------------------------------------------
// Wiring (handled for you)
// ---------------------------------------------------------------------------

// The Discord gateway + REST connection, configured from DISCORD_BOT_TOKEN.
const DiscordLayer = DiscordLive.pipe(
  Layer.provide([
    DiscordConfig.layerConfig({
      token: Config.redacted("DISCORD_BOT_TOKEN"),
    }),
    NodeHttpClient.layerUndici,
    NodeSocket.layerWebSocketConstructor,
  ]),
);

/**
 * Builds the layer that registers every command and runs the bot. Any services
 * your commands' `execute` functions use (e.g. the database) remain required
 * inputs of this layer — provide them where you launch it (see index.ts).
 */
export const commandsLayer = <R, E>(
  commands: ReadonlyArray<Ix.InteractionDefinition<R, E>>,
) => {
  const interactions = Effect.suspend(() => {
    // The builder is plain data; its precise generics aren't worth threading
    // through here, so we keep this glue loose and restore the honest type on
    // the way out (the handler requirements `R` are what callers must satisfy).
    let builder: any = Ix.builder;
    for (const definition of commands) {
      builder = builder.add(definition);
    }
    // Log any failure from a handler instead of letting it crash the bot.
    const logFailures = (effect: Effect.Effect<void, any, any>) =>
      Effect.catchAllCause(effect, (cause) =>
        Effect.logError("Interaction handler failed", cause),
      );
    return (runIx as any)(logFailures)(builder) as Effect.Effect<
      never,
      never,
      R | DiscordGateway | DiscordREST
    >;
  });

  return Layer.scopedDiscard(Effect.forkScoped(interactions)).pipe(
    Layer.provide(DiscordLayer),
  );
};
