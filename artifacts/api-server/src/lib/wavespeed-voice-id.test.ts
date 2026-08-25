import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidWavespeedVoiceId } from "./wavespeed.js";

test("accepts a provider-valid WaveSpeed custom voice id", () => {
  assert.equal(isValidWavespeedVoiceId("WsV1723657890123abc123"), true);
});

test("rejects request ids, empty outputs, and malformed custom voice ids", () => {
  assert.equal(isValidWavespeedVoiceId(""), false);
  assert.equal(isValidWavespeedVoiceId("12345678"), false);
  assert.equal(isValidWavespeedVoiceId("voiceonly"), false);
  assert.equal(isValidWavespeedVoiceId(null), false);
  assert.equal(isValidWavespeedVoiceId({ id: "WsV123456" }), false);
});