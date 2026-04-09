export { TaskStateMachine } from './task-state.js';
export { detectPromptInjection, sanitizeBlockedContent, defaultInjectionRules } from './injection-detector.js';
export { buildAgentContext } from './context-builder.js';
export { AgentLoop } from './loop.js';
export { SubAgentManager, createSubAgentToolDefinition } from './sub-agent-manager.js';

export type {
  TaskStatus,
  TaskItem,
  ContinueGuardInput,
  ContinueGuardResult,
} from './task-state.js';
export type {
  InjectionDetectionMode,
  InjectionSource,
  InjectionSeverity,
  InjectionRule,
  InjectionFinding,
  DetectInjectionOptions,
  InjectionDetectionResult,
} from './injection-detector.js';
export type {
  AgentMessageRole,
  OutputStylePreset,
  AgentMessage,
  ToolResultInput,
  InjectionWarning,
  BuildAgentContextInput,
  BuildAgentContextResult,
  HistoryCompressionOptions,
} from './context-builder.js';
export type {
  AgentLoopOptions,
  AgentLoopRunInput,
  AgentLoopRunResult,
  AgentToolCallExecution,
  AgentLoopDeps,
} from './loop.js';
export type {
  SubAgentTaskInput,
  SubAgentTaskResult,
  SubAgentActiveTask,
  SubAgentManagerDeps,
} from './sub-agent-manager.js';
