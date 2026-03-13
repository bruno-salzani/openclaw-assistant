export default {
  name: "web-search",
  description: "Search the internet (demo)",
  permissions: ["network.read"],
  async execute(input) {
    const query = String(input?.query ?? "");
    if (!query.trim()) return { ok: false, error: "query is required" };
    return { ok: true, query, echo: true };
  },
};

