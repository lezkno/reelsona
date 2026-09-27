export function getPaidInvoiceOrderPolicy({
  eventCreated,
  lastSubscriptionEventAt,
  invoicePeriodEnd,
  currentPeriodEnd,
}: {
  eventCreated: number;
  lastSubscriptionEventAt: Date | null;
  invoicePeriodEnd: Date | null;
  currentPeriodEnd: Date | null;
}): {
  grantCredits: true;
  updateSubscriptionState: boolean;
  updatePeriodEnd: boolean;
} {
  const staleSubscriptionEvent =
    eventCreated > 0 &&
    lastSubscriptionEventAt !== null &&
    lastSubscriptionEventAt.getTime() >= eventCreated * 1000;

  const periodAdvances =
    invoicePeriodEnd !== null &&
    (currentPeriodEnd === null ||
      invoicePeriodEnd.getTime() > currentPeriodEnd.getTime());

  return {
    // Invoice-ID uniqueness, not webhook arrival order, decides whether a
    // verified paid invoice may grant credits.
    grantCredits: true,
    updateSubscriptionState: !staleSubscriptionEvent,
    updatePeriodEnd: !staleSubscriptionEvent && periodAdvances,
  };
}