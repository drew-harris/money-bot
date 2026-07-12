import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type Message,
  MessageFlags,
  MessageFlagsBitField,
  type MessageFlagsResolvable,
  REST,
  Routes,
  SlashCommandBuilder,
  type User,
} from "discord.js";
import type { Prices } from "./prices.js";
import type { Trading } from "./trading.js";

export type Embed = NonNullable<InteractionReplyOptions["embeds"]>[number];
export type Reply = InteractionReplyOptions & { readonly ephemeral?: boolean };
export type ReplyResult = string | Reply;

const resolveReplyFlags = (flags: InteractionReplyOptions["flags"]) =>
  MessageFlagsBitField.resolve((flags ?? 0) as MessageFlagsResolvable);

export interface CommandServices {
  readonly prices: Prices;
  readonly trading: Trading;
}

export type MessageHandler = (
  message: Message,
  services: CommandServices,
) => Promise<void>;

interface Input<V> {
  readonly optionType: ApplicationCommandOptionType;
  readonly description: string;
  readonly required: boolean;
  readonly read: (interaction: ChatInputCommandInteraction, name: string) => V;
}

const makeInput = <V>(
  optionType: ApplicationCommandOptionType,
  read: (
    interaction: ChatInputCommandInteraction,
    name: string,
    required: boolean,
  ) => V | undefined,
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
      read: (interaction, name) => read(interaction, name, required),
    };
  }
  return build;
};

export const input = {
  string: makeInput<string>(
    ApplicationCommandOptionType.String,
    (ix, name, required) => ix.options.getString(name, required) ?? undefined,
  ),
  integer: makeInput<number>(
    ApplicationCommandOptionType.Integer,
    (ix, name, required) => ix.options.getInteger(name, required) ?? undefined,
  ),
  number: makeInput<number>(
    ApplicationCommandOptionType.Number,
    (ix, name, required) => ix.options.getNumber(name, required) ?? undefined,
  ),
  boolean: makeInput<boolean>(
    ApplicationCommandOptionType.Boolean,
    (ix, name, required) => ix.options.getBoolean(name, required) ?? undefined,
  ),
  user: makeInput<User>(
    ApplicationCommandOptionType.User,
    (ix, name, required) => ix.options.getUser(name, required) ?? undefined,
  ),
} as const;

type InputsRecord = Record<string, Input<unknown>>;
type InputValues<I extends InputsRecord> = {
  [K in keyof I]: I[K] extends Input<infer V> ? V : never;
};

export interface CommandContext extends CommandServices {
  readonly caller: User;
  readonly interaction: ChatInputCommandInteraction;
}

interface DeferConfig<I extends InputsRecord> {
  readonly ephemeral?: boolean | ((inputs: InputValues<I>) => boolean);
}

export interface CommandConfig<I extends InputsRecord> {
  readonly name: string;
  readonly description: string;
  readonly inputs?: I;
  readonly defer?: boolean | DeferConfig<I>;
  readonly execute: (
    inputs: InputValues<I>,
    context: CommandContext,
  ) => Promise<ReplyResult>;
}

export interface Command {
  readonly name: string;
  readonly data: ReturnType<SlashCommandBuilder["toJSON"]>;
  readonly handle: (
    interaction: ChatInputCommandInteraction,
    services: CommandServices,
  ) => Promise<void>;
}

const replyOptions = (reply: ReplyResult): InteractionReplyOptions => {
  const value: Reply = typeof reply === "string" ? { content: reply } : reply;
  const { ephemeral, flags, allowedMentions, ...rest } = value;
  return {
    ...rest,
    allowedMentions: allowedMentions ?? { parse: [] },
    ...(ephemeral || flags !== undefined
      ? {
          flags:
            resolveReplyFlags(flags) | (ephemeral ? MessageFlags.Ephemeral : 0),
        }
      : {}),
  };
};

const sendReply = async (
  interaction: ChatInputCommandInteraction,
  reply: ReplyResult,
) => {
  const options = replyOptions(reply);
  const resolvedFlags = resolveReplyFlags(options.flags);
  const ephemeral = (resolvedFlags & MessageFlags.Ephemeral) !== 0;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply(options);
    return;
  }
  if (interaction.deferred && interaction.ephemeral !== ephemeral) {
    await interaction.deleteReply();
    await interaction.followUp(options);
    return;
  }
  const { flags: _, ...editOptions } = options;
  void _;
  const editableFlags =
    resolvedFlags & (MessageFlags.SuppressEmbeds | MessageFlags.IsComponentsV2);
  await interaction.editReply({
    ...editOptions,
    ...(editableFlags ? { flags: editableFlags } : {}),
  } as InteractionEditReplyOptions);
};

const addOption = (
  builder: SlashCommandBuilder,
  name: string,
  definition: Input<unknown>,
) => {
  const configure = <
    T extends {
      setName(name: string): T;
      setDescription(description: string): T;
      setRequired(required: boolean): T;
    },
  >(
    option: T,
  ) =>
    option
      .setName(name)
      .setDescription(definition.description)
      .setRequired(definition.required);
  switch (definition.optionType) {
    case ApplicationCommandOptionType.String:
      builder.addStringOption(configure);
      break;
    case ApplicationCommandOptionType.Integer:
      builder.addIntegerOption(configure);
      break;
    case ApplicationCommandOptionType.Number:
      builder.addNumberOption(configure);
      break;
    case ApplicationCommandOptionType.Boolean:
      builder.addBooleanOption(configure);
      break;
    case ApplicationCommandOptionType.User:
      builder.addUserOption(configure);
      break;
    default:
      throw new Error(
        `Unsupported command option type: ${definition.optionType}`,
      );
  }
};

export const command = <I extends InputsRecord = Record<never, never>>(
  config: CommandConfig<I>,
): Command => {
  const inputs = (config.inputs ?? {}) as I;
  const builder = new SlashCommandBuilder()
    .setName(config.name)
    .setDescription(config.description);
  for (const [name, definition] of Object.entries(inputs)) {
    addOption(builder, name, definition);
  }

  return {
    name: config.name,
    data: builder.toJSON(),
    handle: async (interaction, services) => {
      try {
        const values: Record<string, unknown> = {};
        for (const [name, definition] of Object.entries(inputs)) {
          values[name] = definition.read(interaction, name);
        }
        const typedValues = values as InputValues<I>;
        if (config.defer) {
          const defer = typeof config.defer === "object" ? config.defer : {};
          const ephemeral =
            typeof defer.ephemeral === "function"
              ? defer.ephemeral(typedValues)
              : (defer.ephemeral ?? false);
          await interaction.deferReply({
            ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
          });
        }
        const reply = await config.execute(typedValues, {
          ...services,
          caller: interaction.user,
          interaction,
        });
        await sendReply(interaction, reply);
      } catch (error) {
        console.error("Command failed", {
          command: interaction.commandName,
          interactionId: interaction.id,
          userId: interaction.user.id,
          error,
        });
        try {
          await sendReply(interaction, {
            content: "Something went wrong running that command.",
            ephemeral: true,
          });
        } catch (replyError) {
          console.error("Failed to send command error response", {
            interactionId: interaction.id,
            error: replyError,
          });
        }
      }
    },
  };
};

export const createDiscordClient = (
  commands: ReadonlyArray<Command>,
  services: CommandServices,
  messageHandler?: MessageHandler,
) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      ...(messageHandler
        ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
        : []),
    ],
  });
  const commandsByName = new Map(commands.map((item) => [item.name, item]));
  const activeHandlers = new Set<Promise<void>>();
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const definition = commandsByName.get(interaction.commandName);
    if (!definition) {
      void interaction
        .reply({
          content: "That command is no longer available.",
          flags: MessageFlags.Ephemeral,
        })
        .catch((error) =>
          console.error("Failed to reject unknown command", {
            interactionId: interaction.id,
            error,
          }),
        );
      return;
    }
    const handler = definition.handle(interaction, services);
    activeHandlers.add(handler);
    void handler.finally(() => activeHandlers.delete(handler));
  });
  if (messageHandler) {
    client.on(Events.MessageCreate, (message) => {
      const handler = messageHandler(message, services).catch((error) => {
        console.error("Message handler failed", {
          messageId: message.id,
          userId: message.author.id,
          error,
        });
      });
      activeHandlers.add(handler);
      void handler.finally(() => activeHandlers.delete(handler));
    });
  }
  client.on(Events.Error, (error) =>
    console.error("Discord client error", error),
  );
  client.on(Events.ShardError, (error, shardId) =>
    console.error("Discord shard error", { shardId, error }),
  );
  client.once(Events.ClientReady, (readyClient) => {
    console.info(`Discord ready as ${readyClient.user.tag}`);
  });
  return {
    client,
    drain: async () => {
      await Promise.allSettled(activeHandlers);
    },
  };
};

export const deployCommands = async (
  commands: ReadonlyArray<Command>,
  token: string,
  clientId: string,
) => {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: commands.map(({ data }) => data),
  });
  console.info(`Deployed ${commands.length} global commands`);
};
