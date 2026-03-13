# Master Review (todo3.md) — Aplicação no ia-assistant

## Passo 1 — Análise da Arquitetura

- Data plane: gateway HTTP/WS, orquestração (coordinator), task execution (queue + worker pool), workflows.
- Control plane: autonomia (autonomy controller), governança/policy, observabilidade, learning loop.
- Pontos de acoplamento: runtime centraliza a inicialização e wiring de tudo; loops autônomos dependem do mesmo processo que serve HTTP.

## Passo 2 — Qualidade de Código

- Melhorias aplicadas: padronização de permissões e papéis (user/admin/service), timers com unref/stop, redução de estados implícitos em DAG.
- Dívida remanescente: contratos de tipos ainda aceitam `any` em alguns pontos (workflow actions e gateway metadata), e faltam invariantes fortes em torno de payload.

## Passo 3 — Identificação de Riscos

- Segurança:
  - Gateway sem auth era risco crítico; agora há Bearer auth opcional + rate limit.
  - Coordinator com `*` era risco; removido e substituído por permissões por agente.
- Concorrência:
  - Redis PubSub “subscribe/unsubscribe por chamada” era frágil; substituído por subscriber único e waiters.
  - Claim não-atômico era risco de perda; agora usa processing list + ack e reaper.
- Performance:
  - In-memory queue com sort O(n) substituída por heap + set.

## Passo 4 — Melhorias de Arquitetura

- Segregação de papéis (service role) e enforcement de permissões.
- Robustez de filas (Redis: processing + reaper; InMemory: heap).
- Pipeline DAG correto (inputs por dependsOn e rastreamento por stepId).

## Passo 5 — Expansão do Sistema

- Adicionada automação `data_collection` com paralelismo em workflow.
- Dashboard suporta smoke test e observabilidade leve.

## Passo 6 — Código e Integração

- Implementações aplicadas diretamente no runtime, gateway, filas, DAG e workflows.
- Testes adicionados para autenticação do gateway.

## Passo 7 — Roadmap Técnico

- Curto prazo (1–2 semanas):
  - Reaper mais forte para Redis (limite adaptativo, métricas e logs estruturados).
  - Consolidar Policy Service único e audit log (sem duplicação de guardrails).
- Médio prazo (1–2 meses):
  - Separar control plane (autonomia) do data plane (gateway/orchestrator) por processo/serviço.
  - Introduzir storage persistente para backlog de autonomia e histórico de execução.
- Longo prazo (3–6 meses):
  - Broker de eventos e workers distribuídos por capacidade.
  - Eval harness determinístico para regressões (policy + tool routing + safety).

## Passo 8 — Visão Futura

- Evolução para “AI OS” com:
  - Control plane autônomo (governança, experimentos, remediação)
  - Data plane escalável (execução distribuída + observabilidade)
  - Knowledge-as-code (artefatos versionados, promoção/rollback)

