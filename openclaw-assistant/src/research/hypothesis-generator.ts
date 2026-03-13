export type Hypothesis = { id: string; text: string };

function normId(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function generateHypotheses(params: { topic: string; max?: number }): Hypothesis[] {
  const topic = String(params.topic ?? "").trim();
  if (!topic) return [];
  const max = Math.max(1, Math.min(8, Number(params.max ?? 4)));
  const base = [
    `Novos papers/lançamentos em ${topic} mudam práticas em 3 meses`,
    `Reduções de custo em ${topic} correlacionam com adoção em SMBs`,
    `Modelos menores podem superar modelos maiores em tarefas específicas de ${topic}`,
    `Riscos de segurança (prompt injection/tool misuse) em ${topic} estão subestimados`,
  ];
  return base.slice(0, max).map((t, i) => ({ id: normId(t) || `h${i + 1}`, text: t }));
}

