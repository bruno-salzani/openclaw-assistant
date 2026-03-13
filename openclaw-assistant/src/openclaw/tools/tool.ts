export interface OpenClawTool {
  name: string;
  description: string;
  permissions: string[];
  schema?: Record<string, unknown>;
  execute(input: any): Promise<any>;
}
