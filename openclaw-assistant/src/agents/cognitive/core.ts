import type { AgentDeps } from "../agent-deps.js";
import { IntentClassifier } from "./intent.js";
import { GoalManager } from "./goal-manager.js";
import { LearningSystem } from "./learning.js";
import { SelfImprovementEngine } from "../../evolution/self-improvement.js";
import { SkillGenerator } from "../../evolution/skill-generator.js";
import { ArchitectureEvolutionEngine } from "../../evolution/architecture.js";
import { StrategyLibrary } from "../../evolution/strategy-library.js";
import { ExperimentationEngine } from "../../evolution/experimentation.js";
import { ResourceManager } from "../../evolution/resource-manager.js";
import { KnowledgeExpansionSystem } from "../../evolution/knowledge-expansion.js";
import { EnvironmentManager } from "../../evolution/environment-manager.js";
import { TranslationIntelligence } from "../../posthuman/translation.js";
import { PostHumanCognitiveLayer } from "../../posthuman/cognitive.js";
import { MetaIntelligenceLayer } from "../../posthuman/meta-intelligence.js";
import { UniversalKnowledgeSystem } from "../../posthuman/universal-knowledge.js";
import { MultiRealityEngine } from "../../posthuman/multi-reality.js";
import { KnowledgeDiscoveryEngine } from "../../posthuman/knowledge-discovery.js";

export type SystemContext = {
  currentGoal?: string;
  pendingTasks: number;
  environment: Record<string, unknown>;
  systemState: "idle" | "busy" | "maintenance";
};

import { AgentFactory, CustomAgentSpec } from "../factory.js";
import type { Agent } from "../types.js";

export class CognitiveCore {
  private readonly intentClassifier: IntentClassifier;

  private readonly goalManager: GoalManager;

  private readonly learningSystem: LearningSystem;

  private readonly selfImprovement: SelfImprovementEngine;

  private readonly skillGenerator: SkillGenerator;

  private readonly architectureEvolution: ArchitectureEvolutionEngine;

  private readonly agentFactory: AgentFactory;

  private readonly strategyLibrary: StrategyLibrary;

  private readonly experimentation: ExperimentationEngine;

  private readonly resourceManager: ResourceManager;

  private readonly knowledgeExpansion: KnowledgeExpansionSystem;

  private readonly environmentManager: EnvironmentManager;

  private readonly translationIntelligence: TranslationIntelligence;

  private readonly postHumanCognitive: PostHumanCognitiveLayer;

  private readonly metaIntelligence: MetaIntelligenceLayer;

  private readonly universalKnowledge: UniversalKnowledgeSystem;

  private readonly multiReality: MultiRealityEngine;

  private readonly knowledgeDiscovery: KnowledgeDiscoveryEngine;

  private context: SystemContext;

  constructor(private readonly deps: AgentDeps) {
    this.intentClassifier = new IntentClassifier(deps);
    this.goalManager = new GoalManager(deps);
    this.learningSystem = new LearningSystem(deps);
    this.selfImprovement = new SelfImprovementEngine(deps);
    this.skillGenerator = new SkillGenerator(deps);
    this.architectureEvolution = new ArchitectureEvolutionEngine(deps);
    this.agentFactory = new AgentFactory(deps);
    this.strategyLibrary = new StrategyLibrary(deps);
    this.experimentation = new ExperimentationEngine(deps);
    this.resourceManager = new ResourceManager(deps);
    this.knowledgeExpansion = new KnowledgeExpansionSystem(deps);
    this.environmentManager = new EnvironmentManager(deps);
    this.translationIntelligence = new TranslationIntelligence(deps);
    this.postHumanCognitive = new PostHumanCognitiveLayer(deps);
    this.metaIntelligence = new MetaIntelligenceLayer(deps, this.postHumanCognitive);
    this.universalKnowledge = new UniversalKnowledgeSystem(deps);
    this.multiReality = new MultiRealityEngine(deps);
    this.knowledgeDiscovery = new KnowledgeDiscoveryEngine(deps);
    this.context = {
      pendingTasks: 0,
      environment: { calendar_loaded: true }, // Mock environment
      systemState: "idle",
    };
  }

  async perceive(input: string, _modality: string) {
    const now = Date.now();
    const env = this.context.environment as any;
    // Proactive: detectar padrões a cada 60s
    if ((env.lastLearningCheck ?? 0) + 60_000 < now) {
      await this.learningSystem.detectPatterns("current_user");
      env.lastLearningCheck = now;
    }
    // Self-Improvement: a cada 120s
    if ((env.lastSelfImprove ?? 0) + 120_000 < now) {
      const insights = await this.selfImprovement.analyzePerformance();
      for (const insight of insights) {
        if (insight.type === "new_skill_needed") {
          await this.skillGenerator.generateSkill(
            String(insight.action.skill_name),
            String(insight.action.description)
          );
        } else {
          await this.selfImprovement.applyOptimization(insight);
        }
      }
      env.lastSelfImprove = now;
      // Architecture Evolution: a cada 5min
      if ((env.lastArchEvolution ?? 0) + 300_000 < now) {
        await this.architectureEvolution.evolve();
        env.lastArchEvolution = now;
      }
      // Conhecimento (Curiosidade): a cada 10min
      if ((env.lastKnowledgeExpansion ?? 0) + 600_000 < now) {
        await this.knowledgeExpansion.autoExpand();
        env.lastKnowledgeExpansion = now;
      }
    }

    // 1. Intent Classification
    const intent = await this.intentClassifier.classify(input);

    // Resource Management Check
    const complexity = intent.confidence > 0.8 ? "low" : "high";
    const modelTier = this.resourceManager.selectModel(complexity, "medium");
    this.context.environment.model_tier = modelTier;
    // Environment Selection
    const targetEnv = this.environmentManager.select(intent);
    this.context.environment.target_env = targetEnv;
    // Reality Selection
    const targetReality = this.multiReality.select(intent);
    this.context.environment.reality = targetReality;

    const internal = this.translationIntelligence.translateIn(input);
    const reasoning = this.postHumanCognitive.run(internal);
    this.context.environment.reasoning_mode = reasoning.mode;
    if (reasoning.mode === "emergent") {
      const topic = internal.concepts.slice(0, 3).join(" ");
      await this.universalKnowledge.search(topic);
      const discovery = await this.knowledgeDiscovery.discover(topic);
      await this.deps.memory.add("event", "discovery_cycle", {
        topic,
        findings: JSON.stringify(discovery.findings),
      });
    }
    // Meta-Intelligence: a cada 15min
    if ((env.lastKernelDesign ?? 0) + 900_000 < now) {
      await this.metaIntelligence.designNewCognitiveKernel();
      env.lastKernelDesign = now;
    }

    // 2. Context Update & Goal Management
    let activeGoal = this.context.currentGoal;
    let newAgent: Agent | undefined;

    if (intent.type === "schedule_management") {
      const goal = await this.goalManager.createGoal("Organize Schedule", "productivity");
      this.context.currentGoal = goal.id;
      activeGoal = goal.id;
    } else if (intent.type === "financial_management") {
      const goal = await this.goalManager.createGoal("Manage Finances", "finance");
      this.context.currentGoal = goal.id;
      activeGoal = goal.id;
    } else if (intent.type === "unknown" || (intent.confidence < 0.5 && input.length > 10)) {
      // 2.1 Dynamic Agent Creation
      // If intent is unknown or low confidence, try to create a specialist agent
      const spec: CustomAgentSpec = {
        id: `specialist-${Date.now()}`,
        role: "automation", // Default role, could be inferred
        capabilities: ["web.search", "files.read"], // Default capabilities
        systemPrompt: `You are a specialist agent created to handle: ${input}`,
      };
      newAgent = this.agentFactory.createAgent(spec);
      await this.deps.memory.add("event", "Created new specialist agent", {
        agentId: spec.id,
        trigger: input,
      });
    }

    // Persist Context
    await this.deps.memory.add("short-term", JSON.stringify(this.context), {
      type: "system_context",
    });

    // 4. Decision Making (Return Strategy)
    return {
      intent,
      context: { ...this.context },
      goal: activeGoal ? this.goalManager.getGoal(activeGoal) : undefined,
      strategy: this.decideStrategy(intent),
      newAgent,
    };
  }

  translateOut(payload: unknown): string {
    return this.translationIntelligence.translateOut(payload);
  }

  private decideStrategy(intent: any) {
    const bestStrategy = this.strategyLibrary.selectBestStrategy(intent, this.context);

    // Experimentation Hook (A/B Testing)
    if (bestStrategy === "planning") {
      const expId = this.experimentation.createExperiment(
        "planning_depth",
        ["deep", "quick"],
        ["time"]
      );
      const variant = this.experimentation.selectVariant(expId);
      // In a real system, we would modify the strategy params based on variant
      // For now, we just log it
      this.deps.memory.add("event", `Experiment variant selected: ${variant}`, { expId });
    }

    return bestStrategy;
  }
}
