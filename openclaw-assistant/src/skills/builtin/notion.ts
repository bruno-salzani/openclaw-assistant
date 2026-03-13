import type { Skill } from "../skill-types.js";

export const notionSkill: Skill = {
  id: "notion",
  description: "Notion integration for notes and databases",
  commands: [
    {
      name: "create_page",
      input: { parentId: "string", title: "string", content: "string" },
      run: async (input) => {
        const {
          parentId: _parentId,
          title: _title,
          content: _content,
        } = input as {
          parentId: string;
          title: string;
          content: string;
        };
        return { ok: true, pageId: "page-123", url: "https://notion.so/page-123" };
      },
    },
    {
      name: "search",
      input: { query: "string" },
      run: async (input) => {
        const { query: _query } = input as { query: string };
        return [
          { id: "page-1", title: "Meeting Notes" },
          { id: "page-2", title: "Project Plan" },
        ];
      },
    },
  ],
};
