# IA Assistant — visão e arquitetura (local-first)

Este documento descreve como evoluir o **IA Assistant** para um **AI Personal Operating System** local-first, modular e extensível, inspirado no OpenClaw, mas com foco em:

- multi-agent com isolamento
- memória de longo prazo com governança
- automações reais e auditáveis
- skills prontas e marketplace
- observabilidade e segurança por padrão
- ciclo de auto-evolução com rollback

## Fatos observados no repositório (base atual)

- Gateway HTTP/WS com auth, validação e rate-limit: `src/gateway/http-server.ts`  
  Evidência: `ia-assistant/src/gateway/http-server.ts`
- Control plane do assistente (sessões, role, encaminhamento para orquestrador): `src/gateway/core-gateway.ts`  
  Evidência: `ia-assistant/src/gateway/core-gateway.ts`
- Execução de ferramentas com permissões, policy e circuit breaker: `src/tools/execution-engine.ts`  
  Evidência: `ia-assistant/src/tools/execution-engine.ts`
- Policy engine para risco/confirmations + emissão de eventos: `src/security/policy-service.ts`  
  Evidência: `ia-assistant/src/security/policy-service.ts`
- Fila + workers + retry: `src/tasks/*` (in-memory e redis)  
  Evidência: `ia-assistant/src/tasks/worker-pool.ts`, `ia-assistant/src/tasks/redis-queue.ts`
- Memória com Redis (curto prazo), Postgres (longo prazo) e Qdrant (semântica): `src/memory/memory-system.ts`
- Autonomia (autoscaling, shaping, backpressure e self-improvement/self-test): `src/autonomy/controller.ts`
- Loop de evolução (planner/taskgen/reviewer/tester/gitops/memory/loop): `src/evolver/*`

## Hipóteses mínimas para “AI OS” local-first

- Latência previsível e isolamento: tarefas pesadas vão para fila; ferramentas perigosas passam por governança.
- “Pensar sozinho” significa rodar um ciclo de observar → propor → executar → medir → aprender, sempre com rollback e auditoria.
- O assistente precisa de contratos estáveis entre módulos, plugins, versionamento e telemetria.

## Arquitetura alvo (componentes)

### 1) Control Plane (Gateway)

Responsável por: autenticação, sessões, roteamento de mensagens, ingestão de eventos e API de observabilidade.

### 2) Orquestração Multi-Agent

Responsável por: decompor intenção em tarefas, executar pipeline (DAG quando útil), agregar resultados e produzir resposta final.

### 3) Data Plane (Ferramentas e Skills)

Responsável por: executar ações com isolamento, permissões e auditoria.

### 4) Memória (curto, longo, semântica) + Governança

Responsável por: armazenamento e recuperação com controles (tipo, TTL, privacidade, retenção).

### 5) Automations (Workflows + Triggers)

Responsável por: automações reprodutíveis e observáveis disparadas por eventos/cron.

### 6) Autonomia (autoscaling, shaping, self-improvement, self-test)

Responsável por: manter o sistema saudável sem intervenção humana.

### 7) Self-Evolving Dev System (Evolver)

Responsável por: gerar melhorias de engenharia de forma controlada (tarefas → patches → review → testes → aplicar/rollback → memória).

