import type { MemorySystem } from "../memory/memory-system.js";
import type { KnowledgeGraph, Entity, Relationship } from "../knowledge-graph/graph.js";
import type { TaskQueue } from "../tasks/task-queue.js";
import type { Task, TaskResult } from "../tasks/task-types.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import { hybridSearch } from "../memory/retrieval/hybrid-search.js";
import { rerank } from "../memory/retrieval/reranker.js";
import { buildRetrievalContext } from "../memory/retrieval/context-builder.js";

export type ContextMessage = { role: string; content: string };

export type BuiltContext = {
  history: ContextMessage[];
  semantic: Array<{ content: string; score?: number }>;
  knowledge: Entity[];
  knowledgeEdges: Relationship[];
  toolResults: Array<{ taskId: string; type: string; outputText: string }>;
  contextText: string;
  llmMessages: ContextMessage[];
};

function safeString(v: unknown, max = 4000) {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

function normalizeChatRole(role: string) {
  const r = String(role || "").toLowerCase();
  if (r === "assistant") return "assistant";
  return "user";
}

function stringifyToolOutput(output: unknown, max = 4000) {
  if (typeof output === "string") return output.slice(0, max);
  if (output && typeof output === "object" && "text" in (output as any))
    return safeString((output as any).text, max);
  try {
    return JSON.stringify(output).slice(0, max);
  } catch {
    return String(output).slice(0, max);
  }
}

function toHistoryMessages(items: any[]): ContextMessage[] {
  const out: ContextMessage[] = [];
  for (const it of items) {
    const meta = it && typeof it === "object" ? (it as any).metadata : undefined;
    const role = typeof meta?.role === "string" ? normalizeChatRole(meta.role) : "user";
    const content =
      typeof it === "object" && it && "content" in it ? safeString((it as any).content, 8000) : "";
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

function selectToolResults(
  snapshot: { tasks: Task[]; results: TaskResult[] },
  sessionId: string,
  limit: number
) {
  const resultsById = new Map(snapshot.results.map((r) => [r.taskId, r]));
  const tasks = snapshot.tasks.filter((t) => t.sessionId === sessionId).slice(0, limit);
  const out: Array<{ taskId: string; type: string; outputText: string }> = [];
  for (const t of tasks) {
    const r = resultsById.get(t.taskId);
    if (!r || !r.ok) continue;
    out.push({
      taskId: t.taskId,
      type: t.type,
      outputText: stringifyToolOutput((r.output as any)?.text ?? r.output, 6000),
    });
  }
  return out;
}

export class AgentContextBuilder {
  constructor(
    private readonly deps: {
      memory: Pick<MemorySystem, "search" | "getSessionContext">;
      graph: KnowledgeGraph;
      queue: Pick<TaskQueue, "snapshot">;
      llm?: LLMProvider;
    }
  ) {}

  async buildContext(params: {
    sessionId: string;
    query: string;
    userId?: string;
    workspaceId?: string;
    historyLimit?: number;
    semanticLimit?: number;
    knowledgeLimit?: number;
    toolLimit?: number;
  }): Promise<BuiltContext> {
    const historyLimit = params.historyLimit ?? 12;
    const semanticLimit = params.semanticLimit ?? 6;
    const knowledgeLimit = params.knowledgeLimit ?? 6;
    const toolLimit = params.toolLimit ?? 10;

    const retrievalEnabled = process.env.IA_ASSISTANT_MEMORY_RETRIEVAL_INTELLIGENCE === "1";
    const [historyRaw, semanticRaw, snapshot] = await Promise.all([
      this.deps.memory.getSessionContext(params.sessionId),
      retrievalEnabled
        ? (async () => {
            const hits = await hybridSearch({
              memory: this.deps.memory,
              query: params.query,
              limit: semanticLimit,
              workspaceId: params.workspaceId,
              userId: params.userId,
            });
            const ranked = await rerank({
              llm: this.deps.llm,
              query: params.query,
              hits,
              limit: semanticLimit,
            });
            return ranked;
          })()
        : this.deps.memory.search(params.query, {
            limit: semanticLimit,
            workspaceId: params.workspaceId,
            userId: params.userId,
          }),
      this.deps.queue.snapshot(80),
    ]);

    const history = toHistoryMessages(historyRaw).slice(-historyLimit);
    const semantic = semanticRaw.map((m: any) => ({
      content: safeString(m?.content, 2000),
      score: typeof m?.score === "number" ? m.score : undefined,
    }));
    const knowledge = await this.deps.graph.searchEntities(params.query, knowledgeLimit, {
      workspaceId: params.workspaceId,
    });
    const knowledgeEdges = (
      await Promise.all(
        knowledge.map((e) =>
          this.deps.graph.listEdgesFrom(e.id, {
            workspaceId: params.workspaceId,
            limit: 6,
          })
        )
      )
    )
      .flat()
      .slice(0, knowledgeLimit * 6);
    const edgeNodeIds = Array.from(
      new Set(knowledgeEdges.flatMap((e) => [e.source, e.target]).map(String))
    );
    const edgeNodes = await this.deps.graph.getNodesByIds(edgeNodeIds, {
      workspaceId: params.workspaceId,
    });
    const edgeNodesById = new Map(edgeNodes.map((n) => [n.id, n]));
    const toolResults = selectToolResults(snapshot, params.sessionId, toolLimit);

    const sections: string[] = [];
    if (history.length > 0) {
      sections.push(
        ["[Conversation History]", ...history.map((m) => `${m.role}: ${m.content}`)].join("\n")
      );
    }
    if (semantic.length > 0) {
      if (retrievalEnabled) {
        const ctx = buildRetrievalContext({ hits: semanticRaw as any });
        sections.push(ctx.contextText);
      } else {
        sections.push(
          [
            "[Semantic Memory]",
            ...semantic.map(
              (m, i) => `#${i + 1}${m.score != null ? ` (score=${m.score})` : ""}: ${m.content}`
            ),
          ].join("\n")
        );
      }
    }
    if (knowledge.length > 0) {
      sections.push(
        [
          "[Relevant Knowledge]",
          ...knowledge.map(
            (e) => `${e.type}:${e.id} ${e.name} ${JSON.stringify(e.properties ?? {})}`
          ),
        ].join("\n")
      );
    }
    if (knowledgeEdges.length > 0) {
      sections.push(
        [
          "[Knowledge Relations]",
          ...knowledgeEdges.map((r) => {
            const s = edgeNodesById.get(r.source);
            const t = edgeNodesById.get(r.target);
            const sLabel = s ? `${s.type}:${s.name}` : r.source;
            const tLabel = t ? `${t.type}:${t.name}` : r.target;
            return `${sLabel} -[${r.type}]-> ${tLabel}`;
          }),
        ].join("\n")
      );
    }
    if (toolResults.length > 0) {
      sections.push(
        [
          "[Recent Tool Results]",
          ...toolResults.map((t) => `${t.type} ${t.taskId}: ${t.outputText}`),
        ].join("\n")
      );
    }

    const llmMessages: ContextMessage[] = [];
    if (sections.length > 0) {
      llmMessages.push({ role: "system", content: sections.join("\n\n").slice(0, 24_000) });
    }
    llmMessages.push(...history);

    return {
      history,
      semantic,
      knowledge,
      knowledgeEdges,
      toolResults,
      contextText: sections.join("\n\n"),
      llmMessages,
    };
  }
}
