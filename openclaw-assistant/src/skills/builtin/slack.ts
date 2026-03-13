import type { Skill } from "../skill-types.js";

export const slackSkill: Skill = {
  id: "slack",
  description: "Send Slack messages",
  commands: [
    {
      name: "send",
      input: { channel: "string", message: "string" },
      run: async (input) => {
        const { channel, message } = input as { channel: string; message: string };
        return { ok: true, channel, message, ts: `${Date.now()}` };
      },
    },
  ],
};
