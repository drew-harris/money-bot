import sharp from "sharp";
import type { PriceHistory } from "./prices.js";
import type { Portfolio } from "./trading.js";

const WIDTH = 1_000;
const HEIGHT = 420;
const chartCache = new Map<string, Promise<Buffer>>();

const escapeXml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&apos;",
        '"': "&quot;",
      })[character]!,
  );

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents >= 100_000 ? 0 : 2,
  }).format(cents / 100);

const remember = (key: string, render: () => Promise<Buffer>) => {
  const existing = chartCache.get(key);
  if (existing) return existing;
  const value = render().catch((error) => {
    chartCache.delete(key);
    throw error;
  });
  chartCache.set(key, value);
  if (chartCache.size > 100) {
    chartCache.delete(chartCache.keys().next().value!);
  }
  return value;
};

export const renderStockChart = (history: PriceHistory) => {
  const closes = history.points.map(({ closeCents }) => closeCents);
  const values = closes.length ? closes : [history.quote.priceCents];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(1, Math.round((high - low) * 0.08));
  const min = low - padding;
  const max = high + padding;
  const plotLeft = 70;
  const plotRight = 950;
  const plotTop = 105;
  const plotBottom = 345;
  const x = (index: number) =>
    plotLeft +
    (values.length === 1
      ? (plotRight - plotLeft) / 2
      : (index / (values.length - 1)) * (plotRight - plotLeft));
  const y = (value: number) =>
    plotBottom -
    ((value - min) / Math.max(1, max - min)) * (plotBottom - plotTop);
  const line = values
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`)
    .join(" ");
  const area = `${line} L${x(values.length - 1)},${plotBottom} L${x(0)},${plotBottom} Z`;
  const positive = (history.quote.changeCents ?? 0) >= 0;
  const accent = positive ? "#3ba55d" : "#ed4245";
  const change = history.quote.changeCents;
  const changeText =
    change === null
      ? "Change unavailable"
      : `${change >= 0 ? "+" : "-"}${usd(Math.abs(change))} (${history.quote.changePercent?.toFixed(2) ?? "0.00"}%)`;
  const key = [
    "stock",
    history.quote.symbol,
    history.range,
    history.quote.priceCents,
    values.length,
    values.at(-1),
  ].join(":");

  return remember(key, async () => {
    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${accent}" stop-opacity="0.34"/>
            <stop offset="1" stop-color="${accent}" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <rect width="1000" height="420" rx="22" fill="#111318"/>
        <text x="48" y="51" fill="#f2f3f5" font-family="Arial, sans-serif" font-size="28" font-weight="700">${escapeXml(history.quote.symbol)} · ${history.range}</text>
        <text x="48" y="85" fill="#b5bac1" font-family="Arial, sans-serif" font-size="18">${escapeXml(changeText)}</text>
        <text x="952" y="57" text-anchor="end" fill="#f2f3f5" font-family="Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(usd(history.quote.priceCents))}</text>
        ${[0, 1, 2, 3]
          .map((step) => {
            const rowY = plotTop + (step / 3) * (plotBottom - plotTop);
            const value = max - (step / 3) * (max - min);
            return `<line x1="${plotLeft}" x2="${plotRight}" y1="${rowY}" y2="${rowY}" stroke="#2b2d31" stroke-width="1"/><text x="60" y="${rowY + 5}" text-anchor="end" fill="#80848e" font-family="Arial, sans-serif" font-size="13">${escapeXml(usd(Math.round(value)))}</text>`;
          })
          .join("")}
        <path d="${area}" fill="url(#area)"/>
        <path d="${line}" fill="none" stroke="${accent}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(values.length - 1)}" cy="${y(values.at(-1)!)}" r="6" fill="${accent}"/>
        <text x="48" y="391" fill="#80848e" font-family="Arial, sans-serif" font-size="15">Prices from Yahoo Finance · ${escapeXml(history.quote.asOf.toLocaleString("en-US", { timeZone: "UTC" }))} UTC</text>
      </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  });
};

const ALLOCATION_COLORS = [
  "#5865f2",
  "#3ba55d",
  "#faa61a",
  "#eb459e",
  "#00a8fc",
  "#9b84ee",
];

export const renderPortfolioAllocation = (portfolio: Portfolio) => {
  const valued = portfolio.positions
    .filter(
      (position): position is typeof position & { valueCents: number } =>
        position.valueCents !== null && position.valueCents > 0,
    )
    .sort((a, b) => b.valueCents - a.valueCents);
  const total = valued.reduce((sum, position) => sum + position.valueCents, 0);
  const key = `portfolio:${portfolio.profileId}:${valued.map((position) => `${position.symbol}:${position.valueCents}`).join(",")}`;
  return remember(key, async () => {
    const radius = 112;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const arcs = valued
      .map((position, index) => {
        const fraction = total === 0 ? 0 : position.valueCents / total;
        const length = fraction * circumference;
        const arc = `<circle cx="205" cy="205" r="${radius}" fill="none" stroke="${ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]}" stroke-width="44" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 205 205)"/>`;
        offset += length;
        return arc;
      })
      .join("");
    const legend = valued
      .slice(0, 6)
      .map((position, index) => {
        const rowY = 105 + index * 46;
        const percent = total === 0 ? 0 : (position.valueCents / total) * 100;
        return `<rect x="430" y="${rowY - 15}" width="18" height="18" rx="5" fill="${ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]}"/><text x="464" y="${rowY}" fill="#f2f3f5" font-family="Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(position.symbol)}</text><text x="920" y="${rowY}" text-anchor="end" fill="#b5bac1" font-family="Arial, sans-serif" font-size="18">${escapeXml(usd(position.valueCents))} · ${percent.toFixed(1)}%</text>`;
      })
      .join("");
    const svg = `
      <svg width="1000" height="410" viewBox="0 0 1000 410" xmlns="http://www.w3.org/2000/svg">
        <rect width="1000" height="410" rx="22" fill="#111318"/>
        <text x="48" y="52" fill="#f2f3f5" font-family="Arial, sans-serif" font-size="28" font-weight="700">Portfolio allocation</text>
        <circle cx="205" cy="205" r="${radius}" fill="none" stroke="#2b2d31" stroke-width="44"/>
        ${arcs}
        <text x="205" y="197" text-anchor="middle" fill="#b5bac1" font-family="Arial, sans-serif" font-size="16">HOLDINGS</text>
        <text x="205" y="232" text-anchor="middle" fill="#f2f3f5" font-family="Arial, sans-serif" font-size="27" font-weight="700">${escapeXml(usd(total))}</text>
        ${legend}
      </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  });
};
