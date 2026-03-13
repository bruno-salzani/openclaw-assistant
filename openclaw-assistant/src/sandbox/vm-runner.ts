import vm from "node:vm";

export type VmRunResult =
  | { ok: true; output: any; stdout: string }
  | { ok: false; error: string; stdout: string };

export async function runJsInVm(params: {
  code: string;
  input?: unknown;
  timeoutMs?: number;
}): Promise<VmRunResult> {
  const stdout: string[] = [];
  const sandbox = {
    input: params.input,
    console: {
      log: (...args: any[]) => stdout.push(args.map((a) => String(a)).join(" ")),
    },
  };
  const context = vm.createContext(sandbox);
  const wrapped = `(async (input) => { ${String(params.code || "")}\n })`;
  try {
    const script = new vm.Script(wrapped, { filename: "sandbox.vm.js" });
    const fn = script.runInContext(context, { timeout: params.timeoutMs ?? 2000 }) as any;
    const output = await Promise.resolve(fn(sandbox.input));
    let normalized: any = output;
    try {
      normalized = JSON.parse(JSON.stringify(output));
    } catch {}
    return { ok: true, output: normalized, stdout: stdout.join("\n") };
  } catch (err) {
    return { ok: false, error: String((err as any)?.message ?? err), stdout: stdout.join("\n") };
  }
}
