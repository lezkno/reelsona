import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScriptForTTS } from "./heygen.js";

test("replaces common English marketing terms in Spanish TTS payloads", () => {
  const result = normalizeScriptForTTS(
    "Convierte cada lead en más leads con tu landing page y mejora el engagement.",
    "es",
  );

  assert.equal(
    result,
    "Convierte cada cliente potencial en más clientes potenciales con tu página de aterrizaje y mejora la interacción.",
  );
});

test("does not translate marketing terms when the script is in English", () => {
  const result = normalizeScriptForTTS("Turn every lead into a customer.", "en");
  assert.equal(result, "Turn every lead into a customer.");
});