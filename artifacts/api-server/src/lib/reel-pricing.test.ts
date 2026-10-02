import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateReelCredits,
  premiumWanSeconds,
  resolveAvatarQuality,
  computeReelCreditCost,
  estimateDurationFromScript,
  PREMIUM_CREDITS_PER_WAN_SECOND,
} from "./reel-pricing";

const sentence = (n: number) => Array.from({ length: n }, () => "palabra").join(" ") + ".";
/** Script of `words` words in sentences of 10–14 words (like generated scripts). */
function script(words: number): string {
  const out: string[] = [];
  let left = words;
  let k = 0;
  while (left > 0) {
    const n = Math.min(left, [12, 10, 14, 11][k++ % 4]!);
    out.push(sentence(n));
    left -= n;
  }
  return out.join(" ");
}

test("standard keeps today's price: 50 credits per 30 s, min 15", () => {
  assert.equal(estimateReelCredits(script(150), "standard"), 100); // 60 s reel
  assert.equal(estimateReelCredits(script(75), "standard"), 50); // 30 s
  assert.equal(estimateReelCredits("Hola.", "standard"), 17); // min 10 s → 17
  assert.equal(computeReelCreditCost(estimateDurationFromScript(script(150))), 100);
});

test("premium charges 1.5 credits per second requested from WAN (scene-aware)", () => {
  const s60 = script(150);
  const seconds = premiumWanSeconds(s60);
  assert.equal(seconds, 77); // 5 scenes for a 60 s reel
  assert.equal(estimateReelCredits(s60, "premium"), Math.ceil(seconds * PREMIUM_CREDITS_PER_WAN_SECOND));
  assert.equal(estimateReelCredits(s60, "premium"), 116);
  assert.equal(estimateReelCredits(script(75), "premium"), 60); // 30 s → 3 scenes, 40 s of WAN
});

test("more scenes cost more credits in premium", () => {
  assert.ok(estimateReelCredits(script(200), "premium") > estimateReelCredits(script(150), "premium"));
  assert.ok(estimateReelCredits(script(150), "premium") > estimateReelCredits(script(150), "standard"));
});

test("premium price keeps a margin at 480p for every paid plan", () => {
  // WaveSpeed WAN 3.0 480p with the account's 5 % discount, Stripe ~3 %.
  const COST_PER_WAN_SECOND = 0.05 * 0.95;
  const usdPerCredit = { basic: 29 / 400, pro: 97 / 1500, topup600: 35 / 600, founder: 697 / 12 / 1500 };
  for (const words of [50, 100, 150, 200]) {
    const s = script(words);
    const cost = premiumWanSeconds(s) * COST_PER_WAN_SECOND;
    const credits = estimateReelCredits(s, "premium");
    for (const [plan, usd] of Object.entries(usdPerCredit)) {
      const revenue = credits * usd * 0.97;
      assert.ok(revenue > cost, `${plan} loses money on a ${words}-word premium reel`);
      if (plan !== "founder") assert.ok((revenue - cost) / revenue > 0.4, `${plan} margin below 40 %`);
    }
  }
});

test("quality resolution: per-reel override → account default → standard", () => {
  assert.equal(resolveAvatarQuality("premium", "standard"), "premium");
  assert.equal(resolveAvatarQuality(null, "premium"), "premium");
  assert.equal(resolveAvatarQuality(undefined, undefined), "standard");
  assert.equal(resolveAvatarQuality("bogus", "also-bogus"), "standard");
});

test("the frontend live estimate matches the server price for normal scripts", async () => {
  // Pure module shared by convention (artifacts/content-pilot/src/lib/reel-credits.ts).
  const modulePath = new URL("../../../content-pilot/src/lib/reel-credits.ts", import.meta.url).href;
  const ui = (await import(modulePath)) as { estimateReelCredits: (s: string) => { standard: number; premium: number } };
  for (const words of [10, 40, 75, 120, 150, 200]) {
    const s = script(words);
    assert.deepEqual(ui.estimateReelCredits(s), {
      standard: estimateReelCredits(s, "standard"),
      premium: estimateReelCredits(s, "premium"),
    }, `mismatch for ${words} words`);
  }
});
