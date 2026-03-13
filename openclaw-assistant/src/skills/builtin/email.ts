import type { Skill } from "../skill-types.js";

export const emailSkill: Skill = {
  id: "email",
  description: "Send and manage emails",
  commands: [
    {
      name: "send",
      input: { to: "string", subject: "string", body: "string" },
      run: async (input) => {
        const { to, subject, body } = input as { to: string; subject: string; body: string };
        return { ok: true, to, subject, body, id: `msg_${Date.now()}` };
      },
    },
  ],
};
