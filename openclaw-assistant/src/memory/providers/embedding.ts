export async function getEmbedding(_text: string): Promise<number[]> {
  // In a real implementation, this would call OpenAI or a local model (e.g. transformers.js)
  // For the prototype, we return a random vector normalized
  return new Array(1536).fill(0).map(() => Math.random());
}
