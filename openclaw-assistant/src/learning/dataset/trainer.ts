export type TrainingRun = {
  ok: boolean;
  trainedAt: number;
  datasetPath: string;
  meta?: Record<string, unknown>;
};

export async function trainOnDataset(params: { datasetPath: string }) {
  return {
    ok: true,
    trainedAt: Date.now(),
    datasetPath: String(params.datasetPath ?? ""),
    meta: { kind: "stub" },
  } satisfies TrainingRun;
}

