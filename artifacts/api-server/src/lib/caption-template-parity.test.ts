import assert from "node:assert/strict";
import test from "node:test";

import {
  ASS_TEMPLATE_PARITY,
  BROWSER_CAPTION_TEMPLATES,
  hasAssParityCoverage,
} from "@workspace/caption-templates";

test("every shipped Browser template has an explicit Render Fast V2 parity classification", () => {
  assert.equal(hasAssParityCoverage(), true);
  assert.equal(Object.keys(ASS_TEMPLATE_PARITY).length, BROWSER_CAPTION_TEMPLATES.length);
  for (const template of BROWSER_CAPTION_TEMPLATES) {
    const parity = ASS_TEMPLATE_PARITY[template.id];
    assert.ok(parity, `${template.id} has a parity entry`);
    if (parity.level === "limited") {
      assert.ok(parity.limitations.length > 0, `${template.id} describes its limitation`);
    }
  }
});