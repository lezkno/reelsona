---
name: OpenAPI codegen and Zod compatibility
description: The current OpenAPI generator can emit a Zod integer helper that is unavailable in the workspace Zod version.
---

The generated Zod client may need a compatibility correction for integer schemas, changing the emitted integer helper to the equivalent `zod.number().int()` form before library typechecking.

**Why:** The generator and the installed Zod major version currently disagree on the integer helper API, so an otherwise valid OpenAPI change can fail the generated-library build.

**How to apply:** After running API codegen, run the library typecheck and inspect generated integer fields before validating API and frontend consumers.