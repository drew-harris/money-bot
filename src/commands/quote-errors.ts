import { Effect } from "effect";
import type { Reply } from "../command-lib.js";
import { PriceUnavailable, UnknownSymbol } from "../prices.js";

type QuoteError = UnknownSymbol | PriceUnavailable;

export interface QuoteErrorMessages {
  readonly unknownSymbol?: (symbol: string) => string;
  readonly priceUnavailable?: (symbol: string) => string;
}

const isQuoteError = (error: unknown): error is QuoteError =>
  error instanceof UnknownSymbol || error instanceof PriceUnavailable;

const defaultMessages = {
  unknownSymbol: (symbol: string) =>
    `Couldn't find a stock with symbol **${symbol}**.`,
  priceUnavailable: (symbol: string) =>
    `Couldn't fetch a price for **${symbol}** right now. Try again shortly.`,
} as const;

/** Recover stock quote failures with a consistent ephemeral Discord reply. */
export const catchQuoteErrors =
  (messages: QuoteErrorMessages = {}) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchIf(
        (error: E): error is E & QuoteError => isQuoteError(error),
        (error) => {
          const content =
            error._tag === "UnknownSymbol"
              ? (messages.unknownSymbol ?? defaultMessages.unknownSymbol)(
                  error.symbol,
                )
              : (messages.priceUnavailable ?? defaultMessages.priceUnavailable)(
                  error.symbol,
                );

          return Effect.succeed<Reply>({ content, ephemeral: true });
        },
      ),
    );
