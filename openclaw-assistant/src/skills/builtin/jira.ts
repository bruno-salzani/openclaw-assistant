import type { Skill } from "../skill-types.js";

export const jiraSkill: Skill = {
  id: "jira",
  description: "Jira integration for managing tickets",
  commands: [
    {
      name: "create_ticket",
      input: { project: "string", summary: "string", description: "string" },
      run: async (input) => {
        const {
          project,
          summary: _summary,
          description: _description,
        } = input as {
          project: string;
          summary: string;
          description: string;
        };
        // Mock API call
        return {
          ok: true,
          key: `${project}-101`,
          url: `https://jira.example.com/browse/${project}-101`,
        };
      },
    },
    {
      name: "get_ticket",
      input: { key: "string" },
      run: async (input) => {
        const { key } = input as { key: string };
        return { key, summary: "Fix bug", status: "In Progress", assignee: "user1" };
      },
    },
  ],
};
