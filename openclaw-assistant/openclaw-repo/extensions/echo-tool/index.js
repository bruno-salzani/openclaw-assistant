export default {
  name: "echo-tool",
  description: "Echo input (marketplace demo)",
  permissions: ["filesystem.read"],
  async execute(input) {
    return { ok: true, input };
  },
};

