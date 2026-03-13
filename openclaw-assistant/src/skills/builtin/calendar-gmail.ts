import type { Skill } from "../skill-types.js";

export const calendarSkill: Skill = {
  id: "calendar",
  description: "Manage Google Calendar",
  commands: [
    {
      name: "list",
      input: { timeRange: "string" },
      run: async (input) => {
        const { timeRange: _timeRange } = input as { timeRange: string };
        return {
          ok: true,
          events: [
            { id: "evt_1", title: "Team Meeting", start: "2026-03-11T10:00:00Z" },
            { id: "evt_2", title: "Project Review", start: "2026-03-11T14:00:00Z" },
          ],
        };
      },
    },
    {
      name: "create_event",
      input: { title: "string", start: "string", end: "string" },
      run: async (input) => {
        const { title, start } = input as { title: string; start: string };
        return { ok: true, id: `evt_${Date.now()}`, message: `Created event ${title} at ${start}` };
      },
    },
  ],
};

export const gmailSkill: Skill = {
  id: "gmail",
  description: "Manage Gmail",
  commands: [
    {
      name: "search",
      input: { query: "string" },
      run: async (input) => {
        const { query: _query } = input as { query: string };
        return {
          ok: true,
          threads: [
            { id: "msg_1", subject: "Invoice March", from: "finance@company.com" },
            { id: "msg_2", subject: "Weekly Update", from: "boss@company.com" },
          ],
        };
      },
    },
    {
      name: "send",
      input: { to: "string", subject: "string", body: "string" },
      run: async (input) => {
        const { to, subject } = input as { to: string; subject: string };
        return {
          ok: true,
          id: `msg_${Date.now()}`,
          message: `Sent email to ${to} subject ${subject}`,
        };
      },
    },
  ],
};
