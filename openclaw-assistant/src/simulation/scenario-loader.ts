import fs from "node:fs";
import path from "node:path";

export type ScenarioTask = {
  text: string;
  userRole?: "user" | "admin" | "service";
  channel?: string;
};

export type Scenario = {
  name: string;
  tasks: ScenarioTask[];
};

function stripComments(line: string) {
  const i = line.indexOf("#");
  return i >= 0 ? line.slice(0, i) : line;
}

function parseYamlScalar(raw: string) {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function parseYamlScenario(text: string): Scenario {
  const lines = String(text ?? "")
    .split(/\r?\n/g)
    .map((l) => stripComments(l))
    .map((l) => l.replace(/\t/g, "  "))
    .filter((l) => l.trim().length > 0);

  let name = "scenario";
  const tasks: ScenarioTask[] = [];
  let inTasks = false;
  let current: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inTasks) {
      const m = trimmed.match(/^name\s*:\s*(.+)$/);
      if (m) {
        name = parseYamlScalar(m[1]);
        continue;
      }
      if (trimmed === "tasks:" || trimmed.startsWith("tasks:")) {
        inTasks = true;
        continue;
      }
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (current && typeof current.text === "string") tasks.push(current as ScenarioTask);
      const rest = trimmed.slice(2);
      if (rest.includes(":")) {
        current = {};
        const [k, ...vs] = rest.split(":");
        current[String(k).trim()] = parseYamlScalar(vs.join(":"));
      } else {
        current = { text: parseYamlScalar(rest) };
      }
      continue;
    }

    const kv = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
    if (kv && current) {
      current[String(kv[1]).trim()] = parseYamlScalar(kv[2]);
    }
  }

  if (current && typeof current.text === "string") tasks.push(current as ScenarioTask);

  const normalized = tasks
    .map((t) => ({
      text: String((t as any).text ?? "").trim(),
      userRole:
        (t as any).userRole === "admin" || (t as any).userRole === "service"
          ? (t as any).userRole
          : (t as any).userRole === "user"
            ? "user"
            : undefined,
      channel: typeof (t as any).channel === "string" ? String((t as any).channel) : undefined,
    }))
    .filter((t) => Boolean(t.text));

  return { name: String(name || "scenario"), tasks: normalized };
}

export function loadScenarioFromFile(filePath: string): Scenario {
  const p = path.resolve(filePath);
  const raw = fs.readFileSync(p, "utf-8");
  if (p.endsWith(".json")) {
    const parsed = JSON.parse(raw) as any;
    const name = typeof parsed?.name === "string" ? parsed.name : "scenario";
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    return {
      name: String(name),
      tasks: tasks
        .map((t: any) => ({
          text: String(t?.text ?? t ?? "").trim(),
          userRole: t?.userRole === "admin" || t?.userRole === "service" ? t.userRole : "user",
          channel: typeof t?.channel === "string" ? String(t.channel) : undefined,
        }))
        .filter((t: ScenarioTask) => Boolean(t.text)),
    };
  }
  return parseYamlScenario(raw);
}

