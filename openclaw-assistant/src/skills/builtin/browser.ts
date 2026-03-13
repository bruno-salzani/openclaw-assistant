import type { Skill } from "../skill-types.js";

export const browserSkill: Skill = {
  id: "browser",
  description: "Web browser for searching and reading content",
  commands: [
    {
      name: "search",
      input: { query: "string" },
      run: async (input) => {
        const { query } = input as { query: string };
        // Mock search results (Tavily/Google API placeholder)
        return [
          { title: "Result 1", url: "https://example.com/1", snippet: "Description for " + query },
          { title: "Result 2", url: "https://example.com/2", snippet: "Another result" },
        ];
      },
    },
    {
      name: "read",
      input: { url: "string" },
      run: async (input) => {
        const { url } = input as { url: string };
        return { url, content: "Main content extracted from the page..." };
      },
    },
  ],
};
