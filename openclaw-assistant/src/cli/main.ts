import "dotenv/config";
import { getRuntime } from "../runtime-singleton.js";
import { sanitizeInput } from "../security/input-sanitizer.js";

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const value = argv[i + 1] ?? "";
      args.set(key, value);
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const message = sanitizeInput(args.get("message") ?? "");
const sessionId = args.get("session") ?? "session:default";
const userId = args.get("user") ?? "user:local";
const channel = args.get("channel") ?? "cli";

if (!message) {
  process.stderr.write("Use --message <text>\n");
  process.exit(1);
}

const { gateway } = await getRuntime();
const response = await gateway.handleMessage({
  sessionId,
  userId,
  channel,
  modality: "text",
  text: message,
});

process.stdout.write(`${response.text}\n`);
