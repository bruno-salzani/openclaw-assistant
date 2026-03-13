import { execFile } from "node:child_process";

export type DockerRunResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; error: string; stdout: string; stderr: string };

export async function runShellInDocker(params: {
  command: string;
  timeoutMs?: number;
  image?: string;
}): Promise<DockerRunResult> {
  const image =
    params.image ?? String(process.env.IA_ASSISTANT_SANDBOX_DOCKER_IMAGE ?? "alpine:3.20");
  const timeoutMs = params.timeoutMs ?? 10_000;
  const args = ["run", "--rm", image, "sh", "-lc", params.command];
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            error: String((err as any)?.message ?? err),
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
          });
          return;
        }
        resolve({ ok: true, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    );
  });
}
