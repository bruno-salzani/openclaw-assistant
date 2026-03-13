## Eval / Benchmark

Este diretório contém datasets e relatórios de avaliação (accuracy/latency/tool success).

### Dataset

- `eval/datasets/*.jsonl`: JSON Lines de casos no formato:

```json
{"id":"case-1","prompt":"...","assertions":{"mustContain":["..."]},"expect":{"minToolAttempts":1}}
```

### Rodar

```bash
npm run eval
npm run eval -- --dataset eval/datasets/sample.jsonl --limit 100
```

### Relatórios

- `eval/reports/report-*.json`: saída estruturada com métricas agregadas e resultados por caso.

