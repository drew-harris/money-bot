/** Format integer cents as a US dollar string, e.g. 1234567 -> "$12,345.67". */
export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const embedDescription = (text: string) =>
  text.length <= 4096 ? text : `${text.slice(0, 4093)}...`;
