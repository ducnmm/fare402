/** Decode the x402 PAYMENT-REQUIRED header on a 402 response. */

export type PaymentQuote = {
  amount?: string;
  asset?: string;
  network?: string;
  payTo?: string;
  feePayer?: string;
};

export function quoteFrom402(response: Response): PaymentQuote | null {
  const header = response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("payment-required");
  if (!header) return null;
  try {
    const json = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: Array<{
        amount?: string;
        asset?: string;
        network?: string;
        payTo?: string;
        extra?: { feePayer?: string };
      }>;
    };
    const first = json.accepts?.[0];
    if (!first) return null;
    return {
      amount: first.amount,
      asset: first.asset,
      network: first.network,
      payTo: first.payTo,
      feePayer: first.extra?.feePayer,
    };
  } catch {
    return null;
  }
}
