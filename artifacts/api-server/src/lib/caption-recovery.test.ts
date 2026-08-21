import assert from "node:assert/strict";
import test from "node:test";
import { recoverCaptionProcessing } from "./scheduler";

async function recoverySkipBrollFlag(): Promise<boolean | undefined> {
  let receivedSkipBroll: boolean | undefined;
  await recoverCaptionProcessing(
    {
      id: 101,
      videoUrl: "https://example.test/video.mp4",
      contentPlanId: 202,
      durationSeconds: 30,
    },
    async (_id, _url, _contentPlanId, _subtitleUrl, _durationSeconds, skipBroll) => {
      receivedSkipBroll = skipBroll;
    },
  );
  return receivedSkipBroll;
}

test("recovery skips B-roll so worker restarts cannot repeatedly call the image provider", async () => {
  assert.equal(await recoverySkipBrollFlag(), true);
});