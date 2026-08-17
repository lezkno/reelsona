/**
 * Frontend access control matrix.
 * Verifies canUseFeature() and hasActivePlan() against the
 * 5-state × key-feature matrix defined in Bloque 6B spec §16.
 */

import { describe, it, expect } from "vitest"
import { canUseFeature, hasActivePlan, type AccessState, type Feature } from "../access"

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

describe("canUseFeature — frontend access matrix", () => {
  it("admin: can use all features", () => {
    for (const f of ALL_FEATURES) {
      expect(canUseFeature("admin", f), `admin should allow "${f}"`).toBe(true)
    }
  })

  it("no_active_plan: cannot use any feature", () => {
    for (const f of ALL_FEATURES) {
      expect(canUseFeature("no_active_plan", f), `no_active_plan should block "${f}"`).toBe(false)
    }
  })

  it("active_basic: can use all features except autopilot", () => {
    for (const f of ALL_FEATURES) {
      if (f === "autopilot") {
        expect(canUseFeature("active_basic", f), `active_basic should block "${f}"`).toBe(false)
      } else {
        expect(canUseFeature("active_basic", f), `active_basic should allow "${f}"`).toBe(true)
      }
    }
  })

  it("active_pro: can use all features including autopilot", () => {
    for (const f of ALL_FEATURES) {
      expect(canUseFeature("active_pro", f), `active_pro should allow "${f}"`).toBe(true)
    }
  })

  it("active_founder: can use all features including autopilot", () => {
    for (const f of ALL_FEATURES) {
      expect(canUseFeature("active_founder", f), `active_founder should allow "${f}"`).toBe(true)
    }
  })
})

describe("hasActivePlan", () => {
  it("returns false for no_active_plan", () => {
    expect(hasActivePlan("no_active_plan")).toBe(false)
  })

  it("returns true for admin and all active plan states", () => {
    const activeStates: AccessState[] = ["admin", "active_basic", "active_pro", "active_founder"]
    for (const s of activeStates) {
      expect(hasActivePlan(s), `should be true for "${s}"`).toBe(true)
    }
  })
})
