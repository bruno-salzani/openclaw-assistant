# Arquitetura (IA Assistant)

## Visão Geral

```mermaid
flowchart LR
  UI[UI (Next.js)] -->|/api/chat| GW[CoreGateway (HTTP/WS)]
  GW --> ORCH[AgentOrchestrator]
  ORCH --> COORD[CoordinatorAgent]
  COORD --> PLANNER[PlannerAgent]
  COORD --> RESEARCH[ResearchAgent]
  COORD --> EXEC[ExecutorAgent]
  COORD --> REVIEW[ReviewerAgent]
  COORD --> Q[TaskQueue]
  Q --> W[Workers]
  W --> TOOLS[ToolExecutionEngine]
  W --> MEM[MemorySystem]
  COORD --> GOV[Policy/Governance]
```

## Lifecycle do Agente

```mermaid
stateDiagram-v2
  [*] --> init
  init --> plan
  plan --> execute
  execute --> review
  review --> finalize
  execute --> error
  review --> error
  error --> [*]
  finalize --> [*]
```

## Fluxo de Memória (RAG)

```mermaid
flowchart TD
  U[User Prompt] --> CTX[AgentContextBuilder]
  CTX --> HIST[History]
  CTX --> RET[Retrieval: semantic + keyword]
  RET --> RR[Rerank]
  RR --> CT[Context Text]
  CT --> PL[Planner/Coordinator]
```

## Reasoning Flow

```mermaid
flowchart TD
  P[Perception] --> R[Reasoning]
  R --> PL[Planning]
  PL --> EX[Execution]
  EX --> RF[Reflection]
  RF --> L[Learning]
```

