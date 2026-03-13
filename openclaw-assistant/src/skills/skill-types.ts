export type SkillCommand = {
  name: string;
  input: Record<string, string>; // Schema definition (simplified)
  run: (input: unknown, ctx?: unknown) => Promise<unknown>;
};

export type Skill = {
  id: string;
  description: string;
  commands: SkillCommand[];
  init?: () => Promise<void>;
};
