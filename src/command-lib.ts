import {
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  type Message,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";
import type { Prices } from "./prices.js";
import type { Trading } from "./trading.js";

export interface CommandServices {
  readonly prices: Prices;
  readonly trading: Trading;
}

export interface ApplicationCommand {
  readonly name: string;
  readonly data: object;
}

export type InteractionHandler = (
  interaction: Interaction,
  services: CommandServices,
) => Promise<void>;

export type MessageHandler = (
  message: Message,
  services: CommandServices,
) => Promise<void>;

const reportInteractionError = async (
  interaction: Interaction,
  error: unknown,
) => {
  console.error("Interaction failed", {
    interactionId: interaction.id,
    userId: interaction.user.id,
    error,
  });
  try {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]);
    } else if (interaction.isRepliable()) {
      const response = {
        content: "Something went wrong. Please try that again.",
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.deferred && interaction.ephemeral === true) {
        await interaction.editReply({ content: response.content });
      } else if (interaction.deferred && interaction.ephemeral === false) {
        await interaction.deleteReply();
        await interaction.followUp(response);
      } else if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  } catch (replyError) {
    console.error("Failed to send interaction error", {
      interactionId: interaction.id,
      error: replyError,
    });
  }
};

export const createDiscordClient = (
  commands: ReadonlyArray<ApplicationCommand>,
  services: CommandServices,
  handleInteraction: InteractionHandler,
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
  const commandNames = new Set(commands.map(({ name }) => name));
  const activeHandlers = new Set<Promise<void>>();

  client.on(Events.InteractionCreate, (interaction) => {
    if (
      (interaction.isCommand() || interaction.isAutocomplete()) &&
      !commandNames.has(interaction.commandName)
    ) {
      if (interaction.isAutocomplete()) {
        void interaction.respond([]).catch((error) =>
          console.error("Failed to reject unknown autocomplete command", {
            interactionId: interaction.id,
            error,
          }),
        );
      } else {
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
      }
      return;
    }
    const handler = handleInteraction(interaction, services).catch((error) =>
      reportInteractionError(interaction, error),
    );
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
  commands: ReadonlyArray<ApplicationCommand>,
  token: string,
  clientId: string,
) => {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: commands.map(({ data }) => data),
  });
  console.info(`Deployed ${commands.length} global commands`);
};
