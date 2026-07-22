import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  type InteractionReplyOptions,
  MediaGalleryBuilder,
  MessageFlags,
  SectionBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type User,
} from "discord.js";
import { usd } from "./format.js";
import type { PriceHistory } from "./prices.js";
import type {
  ActivityItem,
  FilledOrder,
  OrderPreview,
  Portfolio,
  TransferPreview,
  TransferReceipt,
} from "./trading.js";

export type MessageView = InteractionReplyOptions;

export const componentId = (...parts: ReadonlyArray<string | number>) =>
  ["v1", ...parts.map((part) => encodeURIComponent(String(part)))].join(":");

export const parseComponentId = (value: string) => {
  const [version, ...parts] = value.split(":");
  if (version !== "v1") return undefined;
  return parts.map((part) => decodeURIComponent(part));
};

const relativeTime = (date: Date) =>
  `<t:${Math.floor(date.getTime() / 1000)}:R>`;

const signedUsd = (cents: number) =>
  `${cents >= 0 ? "+" : "-"}${usd(Math.abs(cents))}`;

const signedPercent = (changeCents: number, basisCents: number) =>
  basisCents === 0
    ? "0.00%"
    : `${changeCents >= 0 ? "+" : "-"}${((Math.abs(changeCents) / basisCents) * 100).toFixed(2)}%`;

const v2 = (
  container: ContainerBuilder,
  options: Omit<MessageView, "components" | "flags"> = {},
): MessageView => ({
  ...options,
  components: [container],
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: options.allowedMentions ?? { parse: [] },
});

const button = (
  label: string,
  id: string,
  style: ButtonStyle = ButtonStyle.Secondary,
) => new ButtonBuilder().setLabel(label).setCustomId(id).setStyle(style);

export const welcomeView = (user: User): MessageView => {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# Paper trading, without the paperwork\n<@${user.id}>, start with **$10,000.00** in simulated cash and build a portfolio using current US market prices.`,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(user.displayAvatarURL({ size: 256 }))
            .setDescription(`${user.username}'s Discord avatar`),
        ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "Trades use whole shares and fill as market orders at the latest available price. Your portfolio, completed trades, and global rank are public; order drafts and errors stay private.",
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          "Start trading",
          componentId("profile", "start", user.id),
          ButtonStyle.Primary,
        ),
        button("Browse a stock", componentId("stock", "search")),
      ),
    );
  return v2(container);
};

export const portfolioView = (
  user: User,
  portfolio: Portfolio,
  allocation?: Buffer,
): MessageView => {
  const marketValueCents = portfolio.positions.reduce(
    (sum, position) => sum + (position.valueCents ?? 0),
    0,
  );
  const costBasisCents = portfolio.positions.reduce(
    (sum, position) => sum + position.costBasisCents,
    0,
  );
  const gainLossCents = marketValueCents - costBasisCents;
  const accent =
    gainLossCents > 0 ? 0x3ba55d : gainLossCents < 0 ? 0xed4245 : 0x5865f2;
  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# ${portfolio.profileName} portfolio\n<@${user.id}> · **${usd(portfolio.netWorthCents)} net worth**${portfolio.partial ? " · Some positions could not be priced" : ""}`,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(user.displayAvatarURL({ size: 256 }))
            .setDescription(`${user.username}'s Discord avatar`),
        ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Cash**  ${usd(portfolio.cashCents)}\n**Holdings**  ${usd(marketValueCents)}\n**Total return**  ${signedUsd(gainLossCents)} (${signedPercent(gainLossCents, costBasisCents)})`,
      ),
    );

  if (portfolio.positions.length) {
    const positionText = portfolio.positions
      .slice(0, 10)
      .map((position) => {
        const value =
          position.valueCents === null
            ? "price unavailable"
            : usd(position.valueCents);
        const result =
          position.gainLossCents === null
            ? "return unavailable"
            : `${signedUsd(position.gainLossCents)} (${signedPercent(position.gainLossCents, position.costBasisCents)})`;
        return `**${position.symbol}** · ${position.quantity} share${position.quantity === 1 ? "" : "s"} · ${value}\n${result}`;
      })
      .join("\n\n");
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${positionText}${portfolio.positions.length > 10 ? `\n\n*${portfolio.positions.length - 10} more positions available in the selector.*` : ""}`,
      ),
    );
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(componentId("position", "view", user.id))
          .setPlaceholder("Inspect a position")
          .addOptions(
            portfolio.positions.slice(0, 25).map((position) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(position.symbol)
                .setValue(position.symbol)
                .setDescription(
                  `${position.quantity} share${position.quantity === 1 ? "" : "s"} · ${position.valueCents === null ? "unpriced" : usd(position.valueCents)}`,
                ),
            ),
          ),
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "No positions yet. Open an order ticket or browse a stock to make the first trade.",
      ),
    );
  }

  const files: Array<AttachmentBuilder> = [];
  if (allocation && portfolio.positions.length > 1) {
    const filename = `portfolio-${portfolio.profileId}.png`;
    files.push(new AttachmentBuilder(allocation, { name: filename }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) =>
        item
          .setURL(`attachment://${filename}`)
          .setDescription(
            `Allocation of ${portfolio.profileName}: ${portfolio.positions.map((position) => `${position.symbol} ${position.valueCents === null ? "unpriced" : usd(position.valueCents)}`).join(", ")}`,
          ),
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(
        "New order",
        componentId("order", "open", "choose", ""),
        ButtonStyle.Primary,
      ),
      button("Activity", componentId("portfolio", "activity", user.id, 0)),
      button("Refresh", componentId("portfolio", "refresh", user.id)),
      button(
        "Manage",
        componentId("portfolio", "manage", user.id),
        ButtonStyle.Danger,
      ),
    ),
  );
  return v2(container, files.length ? { files } : {});
};

export const stockView = (
  history: PriceHistory,
  chart: Buffer,
): MessageView => {
  const { quote } = history;
  const change = quote.changeCents;
  const accent =
    change === null || change === 0
      ? 0x5865f2
      : change > 0
        ? 0x3ba55d
        : 0xed4245;
  const filename = `chart-${quote.symbol}-${history.range}.png`;
  const externalUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}/`;
  const rangeSelect = new StringSelectMenuBuilder()
    .setCustomId(componentId("stock", "range", quote.symbol))
    .setPlaceholder(`Chart range: ${history.range}`)
    .addOptions(
      (["1D", "1W", "1M", "3M", "1Y"] as const).map((range) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(range)
          .setValue(range)
          .setDefault(range === history.range),
      ),
    );
  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${quote.symbol} · ${quote.name ?? "Market quote"}\n**${usd(quote.priceCents)} ${quote.currency}**${change === null ? "" : ` · ${signedUsd(change)} (${quote.changePercent?.toFixed(2) ?? "0.00"}%)`}\n${[quote.exchange, quote.marketState].filter(Boolean).join(" · ") || "Market details unavailable"} · Updated ${relativeTime(quote.asOf)}`,
      ),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) =>
        item
          .setURL(`attachment://${filename}`)
          .setDescription(
            `${history.range} price chart for ${quote.symbol}, currently ${usd(quote.priceCents)}${change === null ? "" : `, ${signedUsd(change)} over the previous close`}`,
          ),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        rangeSelect,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          "Buy",
          componentId("order", "open", "buy", quote.symbol),
          ButtonStyle.Success,
        ),
        button(
          "Sell",
          componentId("order", "open", "sell", quote.symbol),
          ButtonStyle.Danger,
        ),
        new ButtonBuilder()
          .setLabel("Yahoo Finance")
          .setStyle(ButtonStyle.Link)
          .setURL(externalUrl),
      ),
    );
  return v2(container, {
    files: [new AttachmentBuilder(chart, { name: filename })],
  });
};

export const orderPreviewView = (preview: OrderPreview): MessageView => {
  const resultingCash =
    preview.side === "buy"
      ? preview.cashCents - preview.estimatedTotalCents
      : preview.cashCents + preview.estimatedTotalCents;
  const resultingShares =
    preview.side === "buy"
      ? preview.shares + preview.quantity
      : preview.shares - preview.quantity;
  const container = new ContainerBuilder()
    .setAccentColor(preview.side === "buy" ? 0x3ba55d : 0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Review ${preview.side} order\n**${preview.side === "buy" ? "Buy" : "Sell"} ${preview.quantity} ${preview.symbol}** at an estimated **${usd(preview.quotedPriceCents)} per share**\n\n**Estimated total**  ${usd(preview.estimatedTotalCents)}\n**Cash after fill**  ${usd(resultingCash)}\n**Shares after fill**  ${resultingShares}\n\nThis market order uses a fresh price when confirmed and expires ${relativeTime(preview.expiresAt)}.`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          "Confirm order",
          componentId("order", "confirm", preview.id),
          preview.side === "buy" ? ButtonStyle.Success : ButtonStyle.Danger,
        ),
        button("Cancel", componentId("order", "cancel", preview.id)),
      ),
    );
  return v2(container);
};

export const filledOrderView = (
  userId: string,
  order: FilledOrder,
): MessageView => {
  const container = new ContainerBuilder()
    .setAccentColor(order.side === "buy" ? 0x3ba55d : 0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Order filled\n<@${userId}> ${order.side === "buy" ? "bought" : "sold"} **${order.quantity} ${order.symbol}** at **${usd(order.priceCents)}** per share.\n\n**${order.side === "buy" ? "Total cost" : "Proceeds"}**  ${usd(order.totalCents)}\n**Cash balance**  ${usd(order.cashCents)}`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("View stock", componentId("stock", "open", order.symbol)),
        button("View portfolio", componentId("portfolio", "mine")),
      ),
    );
  return v2(container);
};

export const transferPreviewView = (preview: TransferPreview): MessageView => {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Review cash transfer\nSend **${usd(preview.cents)}** to <@${preview.toUserId}>?\n\n**Cash after transfer**  ${usd(preview.senderCashCents - preview.cents)}${preview.note ? `\n**Note**  ${preview.note}` : ""}\n\nThis transfer expires ${relativeTime(preview.expiresAt)}.`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          "Confirm transfer",
          componentId("transfer", "confirm", preview.id),
          ButtonStyle.Success,
        ),
        button("Cancel", componentId("transfer", "cancel", preview.id)),
      ),
    );
  return v2(container);
};

export const transferReceiptView = (
  fromUserId: string,
  receipt: TransferReceipt,
): MessageView => {
  const container = new ContainerBuilder()
    .setAccentColor(0x3ba55d)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Cash transferred\n<@${fromUserId}> sent **${usd(receipt.cents)}** to <@${receipt.toUserId}>.${receipt.note ? `\n> ${receipt.note}` : ""}\n\n**Sender cash balance**  ${usd(receipt.senderCashCents)}`,
      ),
    );
  return v2(container, {
    allowedMentions: { users: [receipt.toUserId] },
  });
};

export const activityView = (
  user: User,
  activity: ReadonlyArray<ActivityItem>,
  page: number,
): MessageView => {
  const visibleActivity = activity.slice(0, 10);
  const lines = visibleActivity.length
    ? visibleActivity
        .map((item) => {
          if (item.kind === "trade") {
            return `**${item.side === "buy" ? "Bought" : "Sold"} ${item.quantity} ${item.symbol}** at ${usd(item.priceCents)} · ${relativeTime(item.createdAt)}`;
          }
          const direction = item.kind === "transfer_sent" ? "Sent" : "Received";
          const counterparty = item.counterpartyUserId
            ? ` <@${item.counterpartyUserId}>`
            : "";
          return `**${direction} ${usd(item.cents)}**${counterparty} · ${relativeTime(item.createdAt)}${item.note ? `\n> ${item.note}` : ""}`;
        })
        .join("\n\n")
    : "No activity on this page.";
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# <@${user.id}>'s activity\n${lines}`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          "Previous",
          componentId("portfolio", "activity", user.id, Math.max(0, page - 1)),
        ).setDisabled(page === 0),
        button(
          "Next",
          componentId("portfolio", "activity", user.id, page + 1),
        ).setDisabled(activity.length <= 10),
        button(
          "Back to portfolio",
          componentId("portfolio", "refresh", user.id),
        ),
      ),
    );
  return v2(container);
};

export const managePortfolioView = (
  user: User,
  portfolio: Portfolio,
  confirm = false,
): MessageView => {
  const expiresAt = new Date(Date.now() + 2 * 60_000);
  const estimated = portfolio.positions.reduce(
    (sum, position) => sum + (position.valueCents ?? 0),
    0,
  );
  const positions = portfolio.positions
    .map(
      (position) =>
        `**${position.quantity} ${position.symbol}** · ${position.valueCents === null ? "price unavailable" : usd(position.valueCents)}`,
    )
    .join("\n");
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${confirm ? "Confirm liquidation" : "Manage portfolio"}\n${positions || "There are no positions to liquidate."}\n\n**Estimated proceeds**  ${usd(estimated)}${portfolio.partial ? "\nSome positions cannot currently be priced, so liquidation is unavailable." : ""}${confirm ? `\n\nThis will immediately sell this exact set of positions using fresh market prices. Confirmation expires ${relativeTime(expiresAt)}.` : ""}`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          confirm ? "Sell every position" : "Liquidate portfolio",
          componentId(
            "portfolio",
            confirm ? "liquidate-confirm" : "liquidate-preview",
            user.id,
            ...(confirm
              ? [portfolio.holdingsVersion, expiresAt.getTime()]
              : []),
          ),
          ButtonStyle.Danger,
        ).setDisabled(portfolio.positions.length === 0 || portfolio.partial),
        button("Back", componentId("portfolio", "refresh", user.id)),
      ),
    );
  return v2(container);
};

export const liquidationReceiptView = (
  userId: string,
  result: Awaited<ReturnType<import("./trading.js").Trading["liquidate"]>>,
): MessageView => {
  const sales = result.orders
    .map(
      (order) =>
        `**${order.quantity} ${order.symbol}** at ${usd(order.priceCents)} · ${usd(order.proceedsCents)}`,
    )
    .join("\n");
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Portfolio liquidated\n<@${userId}> sold every position.\n\n${sales}\n\n**Total proceeds**  ${usd(result.proceedsCents)}\n**Cash balance**  ${usd(result.cashCents)}`,
      ),
    );
  return v2(container);
};

export const leaderboardView = (
  rows: ReadonlyArray<{
    userId: string;
    netWorthCents: number;
    partial: boolean;
  }>,
  page: number,
  total: number,
): MessageView => {
  const rankings = rows.length
    ? rows
        .map(
          (row, index) =>
            `**${page * 10 + index + 1}.** <@${row.userId}> · **${usd(row.netWorthCents)}**${row.partial ? " estimated" : ""}`,
        )
        .join("\n")
    : "No ranked traders yet. Complete a trade to join the board.";
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Global leaderboard\n${rankings}\n\nPage ${page + 1} · ${total} ranked trader${total === 1 ? "" : "s"}`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(
          "Previous",
          componentId("leaderboard", "page", Math.max(0, page - 1)),
        ).setDisabled(page === 0),
        button(
          "Next",
          componentId("leaderboard", "page", page + 1),
        ).setDisabled((page + 1) * 10 >= total),
        button("My portfolio", componentId("portfolio", "mine")),
      ),
    );
  return v2(container);
};

export const privateMessage = (content: string): MessageView => ({
  content,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
});

export const noticeView = (
  title: string,
  content: string,
  accentColor = 0x5865f2,
): MessageView =>
  v2(
    new ContainerBuilder()
      .setAccentColor(accentColor)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${title}\n${content}`),
      ),
  );
