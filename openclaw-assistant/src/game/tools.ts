import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolExecutionEngine } from "../tools/execution-engine.js";
import type { ToolRegistry } from "../tools/registry/tool-registry.js";

const execFileAsync = promisify(execFile);

type CaptureResult = {
  ok: true;
  mime: string;
  base64: string;
  width: number;
  height: number;
};

function isWindows() {
  return os.platform() === "win32";
}

function toNumberOrUndefined(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function pngDims(pngBytes: Buffer) {
  const mod = (await import("pngjs")) as any;
  const png = mod.PNG.sync.read(pngBytes);
  return { width: Number(png.width), height: Number(png.height) };
}

async function encodeMockPngBase64(params?: { width?: number; height?: number; rgba?: [number, number, number, number] }) {
  const mod = (await import("pngjs")) as any;
  const PNG = mod.PNG;
  const width = Math.max(1, Math.floor(toNumberOrUndefined(params?.width) ?? 2));
  const height = Math.max(1, Math.floor(toNumberOrUndefined(params?.height) ?? 2));
  const rgba = params?.rgba ?? [0, 0, 0, 255];
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
  const bytes = PNG.sync.write(png);
  return { mime: "image/png", base64: bytes.toString("base64"), width, height };
}

async function captureScreen(input: Record<string, any>): Promise<CaptureResult | { ok: false; error: string }> {
  if (input?.mock === true) {
    const img = await encodeMockPngBase64({
      width: input?.width,
      height: input?.height,
      rgba:
        Array.isArray(input?.rgba) && input.rgba.length === 4
          ? (input.rgba as [number, number, number, number])
          : undefined,
    });
    return { ok: true, ...img };
  }

  try {
    const mod = (await import("screenshot-desktop")) as any;
    const screenshotDesktop = typeof mod.default === "function" ? mod.default : mod;
    const screen = toNumberOrUndefined(input?.displayId ?? input?.screen);
    const format = String(input?.format ?? "png").toLowerCase() === "jpg" ? "jpg" : "png";
    const img: Buffer = await screenshotDesktop({ format, ...(typeof screen === "number" ? { screen } : {}) });
    const mime = format === "jpg" ? "image/jpeg" : "image/png";
    const dims = format === "png" ? await pngDims(img) : { width: 0, height: 0 };
    return { ok: true, mime, base64: img.toString("base64"), width: dims.width, height: dims.height };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "");
    if (/Cannot find package|Cannot find module/i.test(msg)) return { ok: false, error: "missing_dependency:screenshot-desktop" };
    return { ok: false, error: `capture_failed:${msg.slice(0, 200)}` };
  }
}

async function readPngFromBase64(base64: string) {
  const mod = (await import("pngjs")) as any;
  const bytes = Buffer.from(base64, "base64");
  const png = mod.PNG.sync.read(bytes);
  return { png, width: Number(png.width), height: Number(png.height) };
}

function clampInt(n: number, min: number, max: number) {
  const v = Math.floor(n);
  return Math.max(min, Math.min(max, v));
}

async function detectObjects(input: Record<string, any>) {
  const current = String(input?.imageBase64 ?? input?.currentImageBase64 ?? input?.base64 ?? "");
  const previous = String(input?.previousImageBase64 ?? input?.prevImageBase64 ?? "");
  if (!current) return { ok: false, error: "missing_image" };

  let cur;
  let prev;
  try {
    cur = await readPngFromBase64(current);
    if (previous) prev = await readPngFromBase64(previous);
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "");
    if (/Cannot find package|Cannot find module/i.test(msg)) return { ok: false, error: "missing_dependency:pngjs" };
    return { ok: false, error: `decode_failed:${msg.slice(0, 200)}` };
  }

  if (!prev || prev.width !== cur.width || prev.height !== cur.height) {
    return { ok: true, boxes: [], diffScore: 0 };
  }

  const step = clampInt(toNumberOrUndefined(input?.step) ?? 2, 1, 16);
  const threshold = clampInt(toNumberOrUndefined(input?.threshold) ?? 40, 1, 255);
  const w = cur.width;
  const h = cur.height;
  const a = cur.png.data as Uint8Array;
  const b = prev.png.data as Uint8Array;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let changed = 0;
  let sampled = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (w * y + x) << 2;
      const dr = Math.abs(a[idx] - b[idx]);
      const dg = Math.abs(a[idx + 1] - b[idx + 1]);
      const db = Math.abs(a[idx + 2] - b[idx + 2]);
      const d = (dr + dg + db) / 3;
      sampled += 1;
      if (d > threshold) {
        changed += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const diffScore = sampled > 0 ? changed / sampled : 0;
  if (maxX < 0 || maxY < 0) return { ok: true, boxes: [], diffScore };

  const pad = clampInt(toNumberOrUndefined(input?.pad) ?? step, 0, 64);
  const x0 = clampInt(minX - pad, 0, w - 1);
  const y0 = clampInt(minY - pad, 0, h - 1);
  const x1 = clampInt(maxX + pad, 0, w - 1);
  const y1 = clampInt(maxY + pad, 0, h - 1);
  return {
    ok: true,
    boxes: [{ label: "change", x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, score: diffScore }],
    diffScore,
  };
}

function normalizeKey(keyRaw: unknown) {
  const key = String(keyRaw ?? "").trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  if (/^[a-z0-9]$/.test(lower)) return lower;
  if (lower === "enter" || lower === "return") return "{ENTER}";
  if (lower === "tab") return "{TAB}";
  if (lower === "space") return " ";
  if (lower === "esc" || lower === "escape") return "{ESC}";
  if (lower === "up") return "{UP}";
  if (lower === "down") return "{DOWN}";
  if (lower === "left") return "{LEFT}";
  if (lower === "right") return "{RIGHT}";
  if (/^f([1-9]|1[0-2])$/.test(lower)) return `{${lower.toUpperCase()}}`;
  return null;
}

function normalizeModifiers(mods: unknown) {
  if (!Array.isArray(mods)) return "";
  const m = mods.map((x) => String(x).toLowerCase());
  const ctrl = m.includes("ctrl") || m.includes("control") ? "^" : "";
  const alt = m.includes("alt") ? "%" : "";
  const shift = m.includes("shift") ? "+" : "";
  return `${ctrl}${alt}${shift}`;
}

async function pressKey(input: Record<string, any>) {
  if (input?.dryRun === true) {
    return { ok: true, dryRun: true, input };
  }
  if (!isWindows()) return { ok: false, error: "unsupported_platform" };

  const k = normalizeKey(input?.key);
  if (!k) return { ok: false, error: "invalid_key" };
  const mods = normalizeModifiers(input?.modifiers);
  const repeat = clampInt(toNumberOrUndefined(input?.repeat) ?? 1, 1, 50);
  const delayMs = clampInt(toNumberOrUndefined(input?.delayMs) ?? 0, 0, 2000);
  const seq = `${mods}${k}`;

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ws = New-Object -ComObject WScript.Shell",
    `for ($i = 0; $i -lt ${repeat}; $i++) {`,
    `  $ws.SendKeys('${seq.replace(/'/g, "''")}')`,
    delayMs > 0 ? `  Start-Sleep -Milliseconds ${delayMs}` : "",
    "}",
  ]
    .filter(Boolean)
    .join(";");

  await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
  return { ok: true };
}

async function mouseMove(input: Record<string, any>) {
  if (input?.dryRun === true) {
    return { ok: true, dryRun: true, input };
  }
  if (!isWindows()) return { ok: false, error: "unsupported_platform" };

  const x = toNumberOrUndefined(input?.x);
  const y = toNumberOrUndefined(input?.y);
  if (typeof x !== "number" || typeof y !== "number") return { ok: false, error: "missing_coordinates" };

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class NativeMouse {\n  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);\n}\n'@ | Out-Null",
    `[NativeMouse]::SetCursorPos(${Math.floor(x)}, ${Math.floor(y)}) | Out-Null`,
  ].join(";");
  await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
  return { ok: true };
}

async function mouseClick(input: Record<string, any>) {
  if (input?.dryRun === true) {
    return { ok: true, dryRun: true, input };
  }
  if (!isWindows()) return { ok: false, error: "unsupported_platform" };

  const button = String(input?.button ?? "left").toLowerCase() === "right" ? "right" : "left";
  const double = input?.double === true;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class NativeMouse {\n  [DllImport(\"user32.dll\")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);\n  public const int LEFTDOWN = 0x0002;\n  public const int LEFTUP = 0x0004;\n  public const int RIGHTDOWN = 0x0008;\n  public const int RIGHTUP = 0x0010;\n}\n'@ | Out-Null",
    ...(button === "left"
      ? ["[NativeMouse]::mouse_event([NativeMouse]::LEFTDOWN,0,0,0,0)", "[NativeMouse]::mouse_event([NativeMouse]::LEFTUP,0,0,0,0)"]
      : ["[NativeMouse]::mouse_event([NativeMouse]::RIGHTDOWN,0,0,0,0)", "[NativeMouse]::mouse_event([NativeMouse]::RIGHTUP,0,0,0,0)"]),
    ...(double
      ? button === "left"
        ? ["[NativeMouse]::mouse_event([NativeMouse]::LEFTDOWN,0,0,0,0)", "[NativeMouse]::mouse_event([NativeMouse]::LEFTUP,0,0,0,0)"]
        : ["[NativeMouse]::mouse_event([NativeMouse]::RIGHTDOWN,0,0,0,0)", "[NativeMouse]::mouse_event([NativeMouse]::RIGHTUP,0,0,0,0)"]
      : []),
  ].join(";");
  await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
  return { ok: true };
}

async function gameGetState(input: Record<string, any>) {
  const cap = await captureScreen({ ...input, mock: input?.mock === true });
  if (!cap.ok) return cap;
  const det = input?.previousImageBase64 ? await detectObjects({ imageBase64: cap.base64, previousImageBase64: input.previousImageBase64 }) : { ok: true, boxes: [], diffScore: 0 };
  return {
    ok: true,
    ts: Date.now(),
    screen: { width: cap.width, height: cap.height, mime: cap.mime, base64: cap.base64 },
    perception: det,
  };
}

async function gameTakeAction(input: Record<string, any>) {
  const action = input?.action ?? input;
  const kind = String(action?.kind ?? action?.type ?? "").trim();
  if (kind === "press_key") return pressKey(action);
  if (kind === "mouse_move") return mouseMove(action);
  if (kind === "mouse_click") return mouseClick(action);
  return { ok: false, error: "unknown_action" };
}

async function gameGetReward(input: Record<string, any>) {
  const diffScore = toNumberOrUndefined(input?.diffScore ?? input?.perception?.diffScore) ?? 0;
  const idlePenalty = toNumberOrUndefined(input?.idlePenalty) ?? -1;
  const activityReward = toNumberOrUndefined(input?.activityReward) ?? 1;
  const r = diffScore > 0.01 ? activityReward : idlePenalty;
  return { ok: true, reward: r, diffScore };
}

async function gameReset(input: Record<string, any>) {
  return { ok: true, reset: true, ...("reason" in (input ?? {}) ? { reason: input.reason } : {}) };
}

export function registerGameTools(params: { tools: ToolExecutionEngine; registry?: ToolRegistry }) {
  const { tools, registry } = params;

  registry?.register({
    name: "screen.capture",
    description: "Captura a tela (screenshot) e retorna PNG/JPEG em base64",
    permissions: ["screen.capture"],
    riskLevel: "medium",
  });
  tools.registerTool("screen.capture", async (input) => captureScreen(input));

  registry?.register({
    name: "screen.detect_objects",
    description: "Detecção simples por diferença entre frames (retorna bounding boxes de mudanças)",
    permissions: ["screen.detect_objects"],
    riskLevel: "low",
  });
  tools.registerTool("screen.detect_objects", async (input) => detectObjects(input));

  registry?.register({
    name: "keyboard.press",
    description: "Pressiona uma tecla via SendKeys (Windows) ou dryRun",
    permissions: ["keyboard.press"],
    riskLevel: "high",
  });
  tools.registerTool("keyboard.press", async (input) => pressKey(input));

  registry?.register({
    name: "mouse.move",
    description: "Move o cursor do mouse para (x,y) (Windows) ou dryRun",
    permissions: ["mouse.move"],
    riskLevel: "high",
  });
  tools.registerTool("mouse.move", async (input) => mouseMove(input));

  registry?.register({
    name: "mouse.click",
    description: "Clique do mouse (left/right) (Windows) ou dryRun",
    permissions: ["mouse.click"],
    riskLevel: "high",
  });
  tools.registerTool("mouse.click", async (input) => mouseClick(input));

  registry?.register({
    name: "game.get_state",
    description: "Observa o estado do jogo: screenshot + percepção simples",
    permissions: ["game.get_state"],
    riskLevel: "medium",
  });
  tools.registerTool("game.get_state", async (input) => gameGetState(input));

  registry?.register({
    name: "game.take_action",
    description: "Executa uma ação do jogo (press_key/mouse_move/mouse_click)",
    permissions: ["game.take_action"],
    riskLevel: "high",
  });
  tools.registerTool("game.take_action", async (input) => gameTakeAction(input));

  registry?.register({
    name: "game.get_reward",
    description: "Avalia um reward simples baseado em atividade visual (diffScore)",
    permissions: ["game.get_reward"],
    riskLevel: "low",
  });
  tools.registerTool("game.get_reward", async (input) => gameGetReward(input));

  registry?.register({
    name: "game.reset",
    description: "Reseta o ambiente (placeholder; geralmente requer intervenção no jogo)",
    permissions: ["game.reset"],
    riskLevel: "medium",
  });
  tools.registerTool("game.reset", async (input) => gameReset(input));
}
