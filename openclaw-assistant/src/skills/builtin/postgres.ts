import type { Skill } from "../skill-types.js";
import pkg from "pg";
const { Client } = pkg;

export const postgresSkill: Skill = {
  id: "postgres",
  description: "Execute Postgres queries",
  commands: [
    {
      name: "query",
      input: { sql: "string", params: "array" },
      run: async (input) => {
        const { sql, params } = input as { sql: string; params?: any[] };

        // Mock execution if no DB URL is present (for smoke tests)
        if (!process.env.DATABASE_URL) {
          console.warn("⚠️  Mocking Postgres query (DATABASE_URL not set)");
          return [{ mock: true, sql }];
        }

        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
          const res = await client.query(sql, params);
          return res.rows;
        } finally {
          await client.end();
        }
      },
    },
  ],
};
