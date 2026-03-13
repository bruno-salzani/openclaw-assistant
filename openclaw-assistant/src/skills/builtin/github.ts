import type { Skill } from "../skill-types.js";

export const githubSkill: Skill = {
  id: "github",
  description: "GitHub integration for managing issues and PRs",
  commands: [
    {
      name: "create_issue",
      input: { title: "string", body: "string", repo: "string" },
      run: async (input) => {
        const {
          title: _title,
          body: _body,
          repo,
        } = input as {
          title: string;
          body: string;
          repo: string;
        };
        // In a real implementation, this would use Octokit
        return { ok: true, issue_number: 123, url: `https://github.com/${repo}/issues/123` };
      },
    },
    {
      name: "list_prs",
      input: { repo: "string" },
      run: async (input) => {
        const { repo: _repo } = input as { repo: string };
        return [
          { number: 1, title: "Fix bug", author: "user1" },
          { number: 2, title: "Add feature", author: "user2" },
        ];
      },
    },
  ],
};
