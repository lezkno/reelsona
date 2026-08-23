/**
 * Pure payment-webhook decisions.
 *
 * Keeping these decisions side-effect free makes the payment guardrails
 * testable without a live Stripe account or a database transaction.
 */

export function resolveVerifiedPlanSlug(
  metadataPlanSlug: string,
  configuredPlanSlug: string | null | undefined,
): string {
  return configuredPlanSlug ?? metadataPlanSlug;
}

export function resolveVerifiedCreditAmount(
  metadataCredits: number,
  configuredCredits: number | null | undefined,
): number {
  return configuredCredits ?? metadataCredits;
}

export function isTopupAmountValid(
  amountReceived: number,
  configuredAmountCents: number,
): boolean {
  return amountReceived === configuredAmountCents;
}