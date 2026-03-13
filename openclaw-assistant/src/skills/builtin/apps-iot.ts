import type { Skill } from "../skill-types.js";

export const appsSkill: Skill = {
  id: "apps",
  description: "Control user applications",
  commands: [
    {
      name: "launch",
      input: { app: "string" },
      run: async (input) => {
        const { app } = input as { app: string };
        // In a real implementation, this would use OS-specific commands (open, start, etc.)
        return { ok: true, message: `Launching ${app}...` };
      },
    },
    {
      name: "close",
      input: { app: "string" },
      run: async (input) => {
        const { app } = input as { app: string };
        return { ok: true, message: `Closing ${app}...` };
      },
    },
  ],
};

export const iotSkill: Skill = {
  id: "iot",
  description: "Control IoT devices",
  commands: [
    {
      name: "set_light",
      input: { device: "string", state: "string" },
      run: async (input) => {
        const { device, state } = input as { device: string; state: string };
        return { ok: true, message: `Setting ${device} to ${state}` };
      },
    },
  ],
};
