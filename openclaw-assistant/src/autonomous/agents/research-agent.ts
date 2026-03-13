import type { AutonomousAgent } from "../types.js";
import { analyzeResults, designExperiments, generateHypotheses } from "../../research/index.js";

function parseQueries(raw: string) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export function buildResearchAgent(): AutonomousAgent {
  return {
    id: "autonomous_research_agent",
    description: "Pesquisa continuamente e registra conhecimento em memória + grafo",
    triggers: [{ kind: "cron", expression: "0 */1 * * *" }],
    run: async (deps, ctx) => {
      if (!deps.tools.hasTool("browser.search")) return;

      const workspaceId = ctx.workspaceId ?? "ws:system";
      const perms = deps.permissions ? deps.permissions.getPermissions("automation_agent", workspaceId) : [];
      const queries = parseQueries(
        process.env.IA_ASSISTANT_AUTONOMOUS_RESEARCH_QUERIES ?? "AI agents,LLM safety"
      );

      for (const q of queries) {
        const loopEnabled = process.env.IA_ASSISTANT_AUTONOMOUS_RESEARCH_LOOP === "1";
        if (loopEnabled) {
          const hypotheses = generateHypotheses({ topic: q, max: 4 });
          const experiments = designExperiments({ hypotheses, max: 8 });
          const results: Array<{ experimentId: string; output: any }> = [];
          for (const e of experiments) {
            if (e.kind === "web_search") {
              try {
                const out = await deps.tools.execute(
                  "browser.search",
                  { query: e.query },
                  {
                    userRole: "service",
                    permissions: perms,
                    sandbox: true,
                    timeout: 20_000,
                    source: "autonomous.research.loop",
                    workspaceId,
                  }
                );
                results.push({ experimentId: e.id, output: out });
              } catch (err: any) {
                results.push({ experimentId: e.id, output: { error: String(err?.message ?? err) } });
              }
            } else if (e.kind === "ab_test" && deps.tools.hasTool("experiments.ab_test")) {
              try {
                const out = await deps.tools.execute(
                  "experiments.ab_test",
                  {
                    prompts: e.prompts,
                    variantA: { id: "A", system: "Responda de forma concisa." },
                    variantB: { id: "B", system: "Responda com mais detalhes e riscos." },
                    workspaceId,
                  },
                  { userRole: "service", permissions: perms, sandbox: true, timeout: 60_000, source: "autonomous.research.loop", workspaceId }
                );
                results.push({ experimentId: e.id, output: out });
              } catch (err: any) {
                results.push({ experimentId: e.id, output: { error: String(err?.message ?? err) } });
              }
            }
          }
          const findings = await analyzeResults({
            llm: deps.llm,
            topic: q,
            experiments,
            results,
          });
          const content = JSON.stringify({ topic: q, hypotheses, experiments, findings });
          await deps.memory.add("long-term", content, {
            type: "autonomous_research_loop",
            query: q,
            workspaceId,
          });
          if (typeof (deps.graph as any)?.ingestText === "function") {
            try {
              await (deps.graph as any).ingestText(`Topic: ${q}\n${content}`, {
                workspaceId,
                llm: deps.llm,
                source: "autonomous_research_loop",
              });
            } catch {}
          }
          deps.bus?.emit("autonomous.research.loop.completed", { query: q, findings: findings.length });
          continue;
        }
        let out: any;
        try {
          out = await deps.tools.execute(
            "browser.search",
            { query: q },
            {
              userRole: "service",
              permissions: perms,
              sandbox: true,
              timeout: 20_000,
              source: "autonomous.research",
              workspaceId,
            }
          );
        } catch (err: any) {
          await deps.memory.add("event", "autonomous_research_search_failed", {
            query: q,
            workspaceId,
            error: String(err?.message ?? err),
          });
          continue;
        }

        const content = JSON.stringify({ query: q, output: out });
        await deps.memory.add("long-term", content, {
          type: "autonomous_research",
          query: q,
          workspaceId,
        });

        if (typeof (deps.graph as any)?.ingestText === "function") {
          try {
            await (deps.graph as any).ingestText(`Query: ${q}\n${content}`, {
              workspaceId,
              llm: deps.llm,
              source: "autonomous_research",
            });
          } catch {}
        }

        deps.bus?.emit("autonomous.research.ingested", { query: q });
      }
    },
  };
}
