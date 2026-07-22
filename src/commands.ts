import {
  ApplicationCommandType,
  type AutocompleteInteraction,
  type ButtonInteraction,
  ContextMenuCommandBuilder,
  type Interaction,
  type InteractionEditReplyOptions,
  InteractionContextType,
  type InteractionUpdateOptions,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  SlashCommandBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type User,
} from "discord.js";
import { renderPortfolioAllocation, renderStockChart } from "./charts.js";
import type { CommandServices } from "./command-lib.js";
import {
  type HistoryRange,
  PriceUnavailable,
  UnknownSymbol,
} from "./prices.js";
import {
  AccountNotFound,
  InsufficientFunds,
  InsufficientShares,
  IntentExpired,
  IntentNotFound,
  IntentUnavailable,
  InvalidPaymentAmount,
  InvalidQuantity,
  NoHoldings,
  RecipientNotStarted,
  SamePaymentRecipient,
  type OrderSide,
} from "./trading.js";
import {
  activityView,
  componentId,
  filledOrderView,
  leaderboardView,
  liquidationReceiptView,
  managePortfolioView,
  type MessageView,
  noticeView,
  orderPreviewView,
  parseComponentId,
  portfolioView,
  privateMessage,
  stockView,
  transferPreviewView,
  transferReceiptView,
  welcomeView,
} from "./views.js";

const portfolioCommand = new SlashCommandBuilder()
  .setName("portfolio")
  .setDescription("Open a trader's interactive portfolio")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("Trader whose portfolio to open")
      .setRequired(false),
  );

const stockCommand = new SlashCommandBuilder()
  .setName("stock")
  .setDescription("Open a live stock quote and interactive chart")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
  .addStringOption((option) =>
    option
      .setName("symbol")
      .setDescription("Company name or ticker symbol")
      .setAutocomplete(true)
      .setRequired(true),
  );

const tradeCommand = new SlashCommandBuilder()
  .setName("trade")
  .setDescription("Prepare a market order for review")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);

for (const side of ["buy", "sell"] as const) {
  tradeCommand.addSubcommand((subcommand) =>
    subcommand
      .setName(side)
      .setDescription(
        `${side === "buy" ? "Buy" : "Sell"} shares at the latest market price`,
      )
      .addStringOption((option) =>
        option
          .setName("symbol")
          .setDescription("Company name or ticker symbol")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("quantity")
          .setDescription("Whole number of shares")
          .setMinValue(1)
          .setRequired(true),
      ),
  );
}

const leaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Open the global paper-trading rankings")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM);

const viewPortfolioCommand = new ContextMenuCommandBuilder()
  .setName("View portfolio")
  .setType(ApplicationCommandType.User)
  .setContexts(InteractionContextType.Guild);

const sendCashCommand = new ContextMenuCommandBuilder()
  .setName("Send cash")
  .setType(ApplicationCommandType.User)
  .setContexts(InteractionContextType.Guild);

const builders = [
  portfolioCommand,
  stockCommand,
  tradeCommand,
  leaderboardCommand,
  viewPortfolioCommand,
  sendCashCommand,
] as const;

export const commands = builders.map((builder) => ({
  name: builder.name,
  data: builder.toJSON(),
}));

export const toCents = (amount: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) return Number.NaN;
  const [whole, fraction = ""] = amount.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : Number.NaN;
};

const edit = (
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  view: MessageView,
) =>
  interaction.editReply({
    ...view,
    attachments: [],
  } as InteractionEditReplyOptions);

const asEdit = (view: MessageView) => view as InteractionEditReplyOptions;
const asUpdate = (view: MessageView) => view as InteractionUpdateOptions;

const errorMessage = (error: unknown) => {
  if (error instanceof AccountNotFound) {
    return "Start your Main portfolio with `/portfolio` before using this action.";
  }
  if (error instanceof RecipientNotStarted) {
    return "That user has not started a paper-trading portfolio yet.";
  }
  if (error instanceof InvalidQuantity) {
    return "Quantity must be a positive whole number of shares.";
  }
  if (error instanceof UnknownSymbol) {
    return `No supported market symbol matched **${error.symbol}**.`;
  }
  if (error instanceof PriceUnavailable) {
    return `Market data for **${error.symbol}** is unavailable right now. Try again shortly.`;
  }
  if (error instanceof InsufficientFunds) {
    return `That requires **$${(error.needCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**, but only **$${(error.haveCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}** is available.`;
  }
  if (error instanceof InsufficientShares) {
    return `Only **${error.have} ${error.symbol}** share${error.have === 1 ? " is" : "s are"} available; this order needs ${error.want}.`;
  }
  if (error instanceof InvalidPaymentAmount) {
    return "Enter a positive dollar amount with no more than two decimal places.";
  }
  if (error instanceof SamePaymentRecipient)
    return "You cannot send cash to yourself.";
  if (error instanceof IntentExpired)
    return "That review expired. Open a fresh one and confirm it again.";
  if (error instanceof IntentNotFound)
    return "That review does not belong to you or no longer exists.";
  if (error instanceof IntentUnavailable)
    return "That review has already been completed or cancelled.";
  if (error instanceof NoHoldings)
    return "There are no positions to liquidate.";
  return undefined;
};

const portfolioMessage = async (
  user: User,
  services: CommandServices,
): Promise<MessageView> => {
  const portfolio = await services.trading.portfolio(user.id);
  if (!portfolio) return welcomeView(user);
  let allocation: Buffer | undefined;
  if (portfolio.positions.length > 1) {
    try {
      allocation = await renderPortfolioAllocation(portfolio);
    } catch (error) {
      console.error("Portfolio chart failed", { userId: user.id, error });
    }
  }
  return portfolioView(user, portfolio, allocation);
};

const stockMessage = async (
  symbol: string,
  range: HistoryRange,
  services: CommandServices,
) => {
  const history = await services.prices.history(symbol, range);
  const chart = await renderStockChart(history);
  return stockView(history, chart);
};

const leaderboardMessage = async (page: number, services: CommandServices) => {
  const rows = await services.trading.leaderboard();
  return leaderboardView(
    rows.slice(page * 10, page * 10 + 10),
    page,
    rows.length,
  );
};

const orderModal = (side: OrderSide | "choose", symbol: string) => {
  const modal = new ModalBuilder()
    .setCustomId(componentId("order", "create", side, symbol))
    .setTitle("New market order");
  if (side === "choose") {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Order side")
        .setDescription("Choose whether to buy or sell shares")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId("side")
            .setRequired(true)
            .addOptions(
              new RadioGroupOptionBuilder()
                .setLabel("Buy")
                .setValue("buy")
                .setDescription("Spend cash to add shares")
                .setDefault(true),
              new RadioGroupOptionBuilder()
                .setLabel("Sell")
                .setValue("sell")
                .setDescription("Sell shares for cash"),
            ),
        ),
    );
  }
  if (!symbol) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel("Ticker symbol")
        .setDescription("For example: AAPL or MSFT")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("symbol")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(20)
            .setRequired(true),
        ),
    );
  }
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel("Quantity")
      .setDescription("Whole shares only")
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("quantity")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("1")
          .setMinLength(1)
          .setMaxLength(9)
          .setRequired(true),
      ),
  );
  return modal;
};

const stockSearchModal = () =>
  new ModalBuilder()
    .setCustomId(componentId("stock", "search-submit"))
    .setTitle("Browse a stock")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Ticker symbol")
        .setDescription("For example: AAPL or MSFT")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("symbol")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(20)
            .setRequired(true),
        ),
    );

const transferModal = (targetUserId: string) =>
  new ModalBuilder()
    .setCustomId(componentId("transfer", "create", targetUserId))
    .setTitle("Send paper cash")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Dollar amount")
        .setDescription("Use at most two decimal places")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("amount")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("25.00")
            .setMinLength(1)
            .setMaxLength(18)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Note")
        .setDescription("Optional, shown on the public receipt")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("note")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(200)
            .setRequired(false),
        ),
    );

const handleAutocomplete = async (
  interaction: AutocompleteInteraction,
  services: CommandServices,
) => {
  const query = String(interaction.options.getFocused() ?? "");
  const results = await Promise.race([
    services.prices.search(query).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, 1_800)),
  ]);
  if (!results) {
    const symbol = query.trim().toUpperCase().slice(0, 100);
    await interaction.respond(symbol ? [{ name: symbol, value: symbol }] : []);
    return;
  }
  await interaction.respond(
    results.slice(0, 25).map((result) => ({
      name: `${result.symbol} · ${result.name}`.slice(0, 100),
      value: result.symbol,
    })),
  );
};

const handleButton = async (
  interaction: ButtonInteraction,
  services: CommandServices,
) => {
  const parts = parseComponentId(interaction.customId);
  if (!parts) {
    await interaction.reply(
      privateMessage("That control is no longer supported."),
    );
    return;
  }
  const [area, action, first, second, third] = parts;
  let deferredReply = false;
  try {
    if (area === "profile" && action === "start") {
      if (first !== interaction.user.id) {
        await interaction.reply(
          privateMessage("Only the trader named on that card can start it."),
        );
        return;
      }
      await interaction.deferUpdate();
      services.trading.start(interaction.user.id);
      await edit(
        interaction,
        await portfolioMessage(interaction.user, services),
      );
      return;
    }
    if (area === "stock" && action === "search") {
      await interaction.showModal(stockSearchModal());
      return;
    }
    if (area === "stock" && action === "open" && first) {
      deferredReply = true;
      await interaction.deferReply();
      await interaction.editReply(
        asEdit(await stockMessage(first, "1D", services)),
      );
      return;
    }
    if (area === "order" && action === "open") {
      if (!services.trading.profile(interaction.user.id)) {
        await interaction.reply(
          privateMessage(
            "Start your portfolio with `/portfolio` before placing an order.",
          ),
        );
        return;
      }
      const side = first === "buy" || first === "sell" ? first : "choose";
      await interaction.showModal(orderModal(side, second ?? ""));
      return;
    }
    if (area === "order" && action === "confirm" && first) {
      await interaction.deferUpdate();
      const filled = await services.trading.confirmOrder(
        interaction.user.id,
        first,
      );
      if (filled.replayed) {
        await edit(
          interaction,
          noticeView(
            "Order already filled",
            "This confirmation was already processed; no second trade was placed.",
            0x3ba55d,
          ),
        );
        return;
      }
      try {
        await interaction.followUp(
          filledOrderView(interaction.user.id, filled),
        );
        await edit(
          interaction,
          noticeView(
            "Order filled",
            "A receipt was posted to the channel.",
            0x3ba55d,
          ),
        );
      } catch (error) {
        console.error("Failed to publish filled order receipt", {
          orderId: filled.id,
          error,
        });
        await edit(
          interaction,
          noticeView(
            "Order filled",
            "The trade completed, but its public receipt could not be posted.",
            0xfaa61a,
          ),
        );
      }
      return;
    }
    if (area === "order" && action === "cancel" && first) {
      services.trading.cancelOrder(interaction.user.id, first);
      await interaction.update(
        asUpdate(noticeView("Order cancelled", "No shares or cash moved.")),
      );
      return;
    }
    if (area === "transfer" && action === "confirm" && first) {
      await interaction.deferUpdate();
      const receipt = services.trading.confirmTransfer(
        interaction.user.id,
        first,
      );
      if (receipt.replayed) {
        await edit(
          interaction,
          noticeView(
            "Transfer already complete",
            "This confirmation was already processed; no additional cash moved.",
            0x3ba55d,
          ),
        );
        return;
      }
      try {
        await interaction.followUp(
          transferReceiptView(interaction.user.id, receipt),
        );
        await edit(
          interaction,
          noticeView(
            "Transfer complete",
            "A receipt was posted to the channel.",
            0x3ba55d,
          ),
        );
      } catch (error) {
        console.error("Failed to publish transfer receipt", {
          transferId: receipt.id,
          error,
        });
        await edit(
          interaction,
          noticeView(
            "Transfer complete",
            "The cash moved, but its public receipt could not be posted.",
            0xfaa61a,
          ),
        );
      }
      return;
    }
    if (area === "transfer" && action === "cancel" && first) {
      services.trading.cancelTransfer(interaction.user.id, first);
      await interaction.update(
        asUpdate(noticeView("Transfer cancelled", "No cash moved.")),
      );
      return;
    }
    if (area === "portfolio" && action === "mine") {
      deferredReply = true;
      await interaction.deferReply();
      await interaction.editReply(
        asEdit(await portfolioMessage(interaction.user, services)),
      );
      return;
    }
    if (area === "portfolio" && action === "refresh" && first) {
      await interaction.deferUpdate();
      const target = await interaction.client.users.fetch(first);
      await edit(interaction, await portfolioMessage(target, services));
      return;
    }
    if (area === "portfolio" && action === "activity" && first) {
      const page = Math.max(0, Number(second) || 0);
      await interaction.deferUpdate();
      const target = await interaction.client.users.fetch(first);
      const items = services.trading.activity(target.id, page * 10, 11);
      await edit(interaction, activityView(target, items, page));
      return;
    }
    if (area === "portfolio" && action === "manage" && first) {
      if (first !== interaction.user.id) {
        await interaction.reply(
          privateMessage("Only the portfolio owner can manage it."),
        );
        return;
      }
      await interaction.deferUpdate();
      const portfolio = await services.trading.portfolio(first);
      if (!portfolio) throw new AccountNotFound();
      await edit(interaction, managePortfolioView(interaction.user, portfolio));
      return;
    }
    if (area === "portfolio" && action === "liquidate-preview" && first) {
      if (first !== interaction.user.id) {
        await interaction.reply(
          privateMessage("Only the portfolio owner can do that."),
        );
        return;
      }
      await interaction.deferUpdate();
      const portfolio = await services.trading.portfolio(first);
      if (!portfolio) throw new AccountNotFound();
      await edit(
        interaction,
        managePortfolioView(interaction.user, portfolio, true),
      );
      return;
    }
    if (area === "portfolio" && action === "liquidate-confirm" && first) {
      if (first !== interaction.user.id) {
        await interaction.reply(
          privateMessage("Only the portfolio owner can do that."),
        );
        return;
      }
      if (!second || !third || Number(third) <= Date.now()) {
        throw new IntentExpired();
      }
      await interaction.deferUpdate();
      const result = await services.trading.liquidate(first, second);
      await edit(interaction, liquidationReceiptView(first, result));
      return;
    }
    if (area === "leaderboard" && action === "page") {
      await interaction.deferUpdate();
      await edit(
        interaction,
        await leaderboardMessage(Math.max(0, Number(first) || 0), services),
      );
      return;
    }
    await interaction.reply(
      privateMessage("That control is no longer available."),
    );
  } catch (error) {
    const message = errorMessage(error);
    if (!message) throw error;
    if (interaction.deferred) {
      if (deferredReply) {
        await interaction.deleteReply();
        await interaction.followUp(privateMessage(message));
      } else if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
        await edit(
          interaction,
          noticeView("Action unavailable", message, 0xed4245),
        );
      } else {
        await interaction.followUp(privateMessage(message));
      }
    } else if (!interaction.replied) {
      await interaction.reply(privateMessage(message));
    }
  }
};

const handleSelect = async (
  interaction: StringSelectMenuInteraction,
  services: CommandServices,
) => {
  const parts = parseComponentId(interaction.customId);
  if (!parts) {
    await interaction.reply(
      privateMessage("That selector is no longer supported."),
    );
    return;
  }
  const [area, action, first] = parts;
  try {
    if (area === "stock" && action === "range" && first) {
      await interaction.deferUpdate();
      await edit(
        interaction,
        await stockMessage(
          first,
          interaction.values[0] as HistoryRange,
          services,
        ),
      );
      return;
    }
    if (area === "position" && action === "view") {
      await interaction.deferUpdate();
      await edit(
        interaction,
        await stockMessage(interaction.values[0]!, "1D", services),
      );
      return;
    }
    await interaction.reply(
      privateMessage("That selector is no longer available."),
    );
  } catch (error) {
    const message = errorMessage(error);
    if (!message) throw error;
    if (interaction.deferred) {
      await interaction.followUp(privateMessage(message));
    } else {
      await interaction.reply(privateMessage(message));
    }
  }
};

const handleModal = async (
  interaction: ModalSubmitInteraction,
  services: CommandServices,
) => {
  const parts = parseComponentId(interaction.customId);
  if (!parts) {
    await interaction.reply(
      privateMessage("That form is no longer supported."),
    );
    return;
  }
  const [area, action, first, second] = parts;
  const publicDefer = area === "stock" && action === "search-submit";
  try {
    if (area === "order" && action === "create" && first) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const side =
        first === "choose"
          ? (interaction.fields.getRadioGroup("side", true) as OrderSide)
          : (first as OrderSide);
      const symbol = second || interaction.fields.getTextInputValue("symbol");
      const rawQuantity = interaction.fields.getTextInputValue("quantity");
      const quantity = /^\d+$/.test(rawQuantity)
        ? Number(rawQuantity)
        : Number.NaN;
      const preview = await services.trading.prepareOrder(
        interaction.user.id,
        side,
        symbol,
        quantity,
      );
      await edit(interaction, orderPreviewView(preview));
      return;
    }
    if (area === "stock" && action === "search-submit") {
      await interaction.deferReply();
      const symbol = interaction.fields.getTextInputValue("symbol");
      await interaction.editReply(
        asEdit(await stockMessage(symbol, "1D", services)),
      );
      return;
    }
    if (area === "transfer" && action === "create" && first) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const amount = toCents(interaction.fields.getTextInputValue("amount"));
      const note = interaction.fields.getTextInputValue("note");
      const preview = services.trading.prepareTransfer(
        interaction.user.id,
        first,
        amount,
        note,
      );
      await edit(interaction, transferPreviewView(preview));
      return;
    }
    await interaction.reply(
      privateMessage("That form is no longer available."),
    );
  } catch (error) {
    const message = errorMessage(error);
    if (!message) throw error;
    if (interaction.deferred) {
      if (publicDefer) {
        await interaction.deleteReply();
        await interaction.followUp(privateMessage(message));
      } else {
        await edit(
          interaction,
          noticeView("Cannot continue", message, 0xed4245),
        );
      }
    } else {
      await interaction.reply(privateMessage(message));
    }
  }
};

export const handleInteraction = async (
  interaction: Interaction,
  services: CommandServices,
) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction, services);
    return;
  }
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "portfolio") {
      const user = interaction.options.getUser("user") ?? interaction.user;
      await interaction.deferReply();
      await interaction.editReply(
        asEdit(await portfolioMessage(user, services)),
      );
      return;
    }
    if (interaction.commandName === "stock") {
      await interaction.deferReply();
      try {
        await interaction.editReply(
          asEdit(
            await stockMessage(
              interaction.options.getString("symbol", true),
              "1D",
              services,
            ),
          ),
        );
      } catch (error) {
        const message = errorMessage(error);
        if (!message) throw error;
        await interaction.deleteReply();
        await interaction.followUp(privateMessage(message));
      }
      return;
    }
    if (interaction.commandName === "trade") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const preview = await services.trading.prepareOrder(
          interaction.user.id,
          interaction.options.getSubcommand(true) as OrderSide,
          interaction.options.getString("symbol", true),
          interaction.options.getInteger("quantity", true),
        );
        await interaction.editReply(asEdit(orderPreviewView(preview)));
      } catch (error) {
        const message = errorMessage(error);
        if (!message) throw error;
        await interaction.editReply(
          asEdit(noticeView("Cannot prepare order", message, 0xed4245)),
        );
      }
      return;
    }
    if (interaction.commandName === "leaderboard") {
      await interaction.deferReply();
      await interaction.editReply(
        asEdit(await leaderboardMessage(0, services)),
      );
      return;
    }
  }
  if (interaction.isUserContextMenuCommand()) {
    if (interaction.commandName === "View portfolio") {
      await interaction.deferReply();
      await interaction.editReply(
        asEdit(await portfolioMessage(interaction.targetUser, services)),
      );
      return;
    }
    if (interaction.commandName === "Send cash") {
      if (!services.trading.profile(interaction.user.id)) {
        await interaction.reply(
          privateMessage(
            "Start your portfolio with `/portfolio` before sending cash.",
          ),
        );
        return;
      }
      if (!services.trading.profile(interaction.targetUser.id)) {
        await interaction.reply(
          privateMessage(
            "That user has not started a paper-trading portfolio yet.",
          ),
        );
        return;
      }
      if (interaction.targetUser.id === interaction.user.id) {
        await interaction.reply(
          privateMessage("You cannot send cash to yourself."),
        );
        return;
      }
      await interaction.showModal(transferModal(interaction.targetUser.id));
      return;
    }
  }
  if (interaction.isButton()) {
    await handleButton(interaction, services);
    return;
  }
  if (interaction.isStringSelectMenu()) {
    await handleSelect(interaction, services);
    return;
  }
  if (interaction.isModalSubmit()) {
    await handleModal(interaction, services);
  }
};
