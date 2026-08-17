/**
 * Feature access matrix — backend (server-side) enforcement.
 * Verifies canUseFeature() against the 5-state × key-feature matrix
 * defined in Bloque 6B spec §16.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { canUseFeature, type Feature } from "../lib/feature-access.js"

const ALL_FEATURES: Feature[] = [
  "strategic_analysis",
  "content_plan",
  "generate_reel",
  "use_public_avatar",
  "create_avatar",
  "create_look",
  "clone_voice",
  "caption_studio",
  "broll",
  "publish",
  "schedule",
  "autopilot",
  "buy_topup",
]

describe("canUseFeature — server-side access matrix", () => {
  it("null plan (no_active_plan): cannot use any feature", () => {
    for (const f of ALL_FEATURES) {
      assert.strictEqual(canUseFeature(null, f), false, `null should block "${f}"`)
    }
  })

  it("basic plan: can use all features except autopilot", () => {
    for (const f of ALL_FEATURES) {
      if (f === "autopilot") {
        assert.strictEqual(canUseFeature("basic", f), false, `basic should block "${f}"`)
      } else {
        assert.strictEqual(canUseFeature("basic", f), true, `basic should allow "${f}"`)
      }
    }
  })

  it("pro plan: can use all features including autopilot", () => {
    for (const f of ALL_FEATURES) {
      assert.strictEqual(canUseFeature("pro", f), true, `pro should allow "${f}"`)
    }
  })

  it("founder plan: can use all features including autopilot", () => {
    for (const f of ALL_FEATURES) {
      assert.strictEqual(canUseFeature("founder", f), true, `founder should allow "${f}"`)
    }
  })
})
