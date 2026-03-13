export type SandboxLimits = {
  cpuMs: number;
  memoryMb: number;
  timeoutMs: number;
};

export type SandboxResult<T> = {
  ok: boolean;
  output?: T;
  error?: string;
};

export async function runInSandbox<T>(
  fn: () => Promise<T>,
  limits: SandboxLimits
): Promise<SandboxResult<T>> {
  // In a real implementation, this would spawn a Docker container or Firecracker VM.
  // For the prototype, we use a simple timeout wrapper and try-catch.

  const timer = new Promise<never>((_, reject) => {
    const handle = setTimeout(() => reject(new Error("Sandbox timeout")), limits.timeoutMs);
    if (typeof handle.unref === "function") handle.unref();
  });

  try {
    const output = await Promise.race([fn(), timer]);
    return { ok: true, output };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
