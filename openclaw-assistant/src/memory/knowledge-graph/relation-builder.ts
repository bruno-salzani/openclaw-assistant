import type { LLMProvider } from "../../llm/llm-provider.js";
import type { ExtractedEntity, ExtractedRelation } from "./entity-extractor.js";
import { extractGraphFacts } from "./entity-extractor.js";

export async function buildRelations(params: {
  text: string;
  entities?: ExtractedEntity[];
  llm?: LLMProvider;
}): Promise<ExtractedRelation[]> {
  const facts = await extractGraphFacts({ text: params.text, llm: params.llm });
  if (!Array.isArray(facts.relations)) return [];
  return facts.relations;
}

