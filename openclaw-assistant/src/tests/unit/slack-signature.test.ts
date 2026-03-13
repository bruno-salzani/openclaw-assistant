import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../../channels/slack.js";

test("verifySlackSignature: valida assinatura v0", async () => {
  const signingSecret = "secret";
  const timestamp = "1700000000";
  const body = "token=ignore&team_id=T1&user_id=U1&command=%2Fopenclaw&text=hello";
  const base = `v0:${timestamp}:${body}`;
  const sig = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  assert.equal(verifySlackSignature({ signingSecret, timestamp, signature: sig, body }), true);
  assert.equal(
    verifySlackSignature({ signingSecret, timestamp, signature: "v0=bad", body }),
    false
  );
});
