# Arquitetura — Auditoria e Melhorias Aplicadas

## Principais Problemas Encontrados

- Gateway público sem autenticação e rate limiting.
- Permissões inconsistentes (coordinator com `*`, permissões passadas manualmente).
- Autonomia enfileirando tarefas como `admin`.
- Executor de DAG com associação stepId→taskId incorreta.
- RedisTaskQueue sem claim/ack atômicos; espera via PubSub frágil.
- InMemoryQueue com ordenação O(n) e dedup lenta.

## Correções Aplicadas

- Auth + Rate limit no Gateway; proteção de `/metrics`, `/dashboard`, `/v1/*` (admin).
- Enforcement centralizado de permissões e exigência em `ToolExecutionEngine` (inclui `workflow.*`).
- Papel `service` introduzido; AutonomyController não usa `admin`.
- DAG executor corrigido (inputs por `dependsOn`; indexação por `stepId`).
- Redis: processing list com `RPOPLPUSH` + `LREM` no ack; subscriber único com mapa de waiters.
- InMemory: heap de prioridade + set para dedup O(1) e claim eficiente.

## Próximos Passos Recomendados

- Reaper de `processing` (retornar tasks ao `pending` após timeout).
- Policy Service único (consolida guardrails/governança/permissions) e audit log.
- Broker de eventos (NATS/Kafka) para escalar além do bus em memória.
- Persistência de backlog de autonomia e experimentos (Postgres).

