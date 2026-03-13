export type GoapPredicate = string;

export type GoapState = Set<GoapPredicate>;

export type GoapAction = {
  id: string;
  cost: number;
  pre: GoapPredicate[];
  add: GoapPredicate[];
  del?: GoapPredicate[];
  step: {
    id: string;
    type: "research" | "execute" | "analyze";
    dependsOn?: string[];
    payload?: Record<string, unknown>;
    priority?: "low" | "medium" | "high";
  };
};

export type GoapPlan = {
  ok: boolean;
  objective: string;
  steps: GoapAction["step"][];
  actions: string[];
  reason?: string;
};

function keyOf(state: GoapState) {
  return [...state].sort().join("|");
}

function satisfied(state: GoapState, goal: GoapPredicate[]) {
  for (const g of goal) if (!state.has(g)) return false;
  return true;
}

function missingCount(state: GoapState, goal: GoapPredicate[]) {
  let n = 0;
  for (const g of goal) if (!state.has(g)) n += 1;
  return n;
}

function applyAction(state: GoapState, action: GoapAction): GoapState {
  const next = new Set(state);
  for (const d of action.del ?? []) next.delete(d);
  for (const a of action.add) next.add(a);
  return next;
}

function canApply(state: GoapState, action: GoapAction) {
  for (const p of action.pre) if (!state.has(p)) return false;
  return true;
}

function parseObjectiveSignals(objective: string) {
  const t = String(objective ?? "").toLowerCase();
  const wantsCalendar = t.includes("calendar") || t.includes("agenda") || t.includes("schedule");
  const wantsFinance = t.includes("invoice") || t.includes("finance") || t.includes("fatura");
  const wantsExecution =
    wantsCalendar ||
    wantsFinance ||
    t.includes("execut") ||
    t.includes("run") ||
    t.includes("aplicar") ||
    t.includes("implement") ||
    t.includes("refator") ||
    t.includes("fix") ||
    t.includes("bug");
  const wantsResearch =
    t.includes("pesquis") ||
    t.includes("research") ||
    t.includes("analis") ||
    t.includes("compare") ||
    t.includes("benchmark") ||
    !wantsExecution;
  return { wantsCalendar, wantsFinance, wantsExecution, wantsResearch };
}

function buildDomain(params: { objective: string; contextText?: string }) {
  const objective = String(params.objective ?? "");
  const { wantsCalendar, wantsFinance, wantsExecution, wantsResearch } = parseObjectiveSignals(objective);

  const actions: GoapAction[] = [];
  actions.push({
    id: "research.primary",
    cost: 1,
    pre: [],
    add: ["did_research", "has_context"],
    step: {
      id: "r1",
      type: "research",
      dependsOn: [],
      payload: { query: objective },
      priority: "high",
    },
  });
  actions.push({
    id: "analyze",
    cost: 1,
    pre: ["has_context"],
    add: ["did_analyze"],
    step: { id: "a1", type: "analyze", dependsOn: [], payload: { method: "goap" }, priority: "medium" },
  });

  if (wantsCalendar) {
    actions.push({
      id: "execute.calendar.list",
      cost: 2,
      pre: ["has_context"],
      add: ["did_execute"],
      step: {
        id: "e1",
        type: "execute",
        dependsOn: [],
        payload: { toolName: "calendar.list", args: "next week" },
        priority: "high",
      },
    });
  } else if (wantsFinance) {
    actions.push({
      id: "execute.postgres.invoices",
      cost: 3,
      pre: ["has_context"],
      add: ["did_execute"],
      step: {
        id: "e1",
        type: "execute",
        dependsOn: [],
        payload: { toolName: "postgres.query", args: "SELECT * FROM invoices LIMIT 5" },
        priority: "high",
      },
    });
  } else if (wantsExecution) {
    actions.push({
      id: "execute.generic",
      cost: 4,
      pre: ["has_context"],
      add: ["did_execute"],
      step: {
        id: "e1",
        type: "execute",
        dependsOn: [],
        payload: { toolName: "browser.search", args: objective },
        priority: "medium",
      },
    });
  }

  const goal: GoapPredicate[] = ["did_analyze"];
  if (wantsResearch) goal.push("did_research");
  if (wantsExecution) goal.push("did_execute");
  return { actions, goal };
}

export function planGoap(params: { objective: string; contextText?: string }): GoapPlan {
  const objective = String(params.objective ?? "").trim();
  if (!objective) return { ok: false, objective: "", steps: [], actions: [], reason: "missing_objective" };

  const domain = buildDomain({ objective, contextText: params.contextText });
  const start: GoapState = new Set();
  if (params.contextText && String(params.contextText).trim()) start.add("has_context");

  const open: Array<{
    state: GoapState;
    g: number;
    f: number;
    plan: GoapAction[];
  }> = [{ state: start, g: 0, f: missingCount(start, domain.goal), plan: [] }];
  const best = new Map<string, number>([[keyOf(start), 0]]);

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const node = open.shift()!;
    if (satisfied(node.state, domain.goal)) {
      const actions = node.plan;
      const steps: GoapAction["step"][] = [];
      const idByIndex: string[] = [];
      for (const a of actions) {
        const idx = steps.length;
        const stepId = a.step.id || `s${idx + 1}`;
        idByIndex.push(stepId);
        const dependsOn = idx === 0 ? [] : [idByIndex[idx - 1]!];
        steps.push({ ...a.step, id: stepId, dependsOn: a.step.dependsOn ?? dependsOn });
      }
      const byId = new Map(steps.map((s) => [s.id, s]));
      for (const s of steps) {
        const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
        if (s.type === "analyze" && deps.length === 0 && byId.has("r1")) s.dependsOn = ["r1"];
        if (s.type === "execute" && deps.length === 0 && byId.has("r1")) s.dependsOn = ["r1"];
        if (s.type === "analyze" && byId.has("e1")) s.dependsOn = Array.from(new Set([...(s.dependsOn ?? []), "e1"]));
      }
      return { ok: true, objective, steps, actions: actions.map((a) => a.id) };
    }

    for (const action of domain.actions) {
      if (!canApply(node.state, action)) continue;
      const nextState = applyAction(node.state, action);
      const nextG = node.g + action.cost;
      const k = keyOf(nextState);
      const prevBest = best.get(k);
      if (typeof prevBest === "number" && prevBest <= nextG) continue;
      best.set(k, nextG);
      const h = missingCount(nextState, domain.goal);
      open.push({ state: nextState, g: nextG, f: nextG + h, plan: [...node.plan, action] });
    }
  }

  return { ok: false, objective, steps: [], actions: [], reason: "no_plan" };
}

