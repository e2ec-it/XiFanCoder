export {
  AgentModeSchema,
  InjectionDetectionModeSchema,
  LLMDriverModeSchema,
  PolicyModeSchema,
  RuntimeConfigSchema,
  parseRuntimeConfig,
} from './runtime-config.js';

export type { RuntimeConfig } from './runtime-config.js';

export {
  createKeytarAdapter,
  discoverRuntimeConfigPaths,
  initRuntimeConfigFile,
  loadRuntimeConfig,
} from './loader.js';
export type {
  InitRuntimeConfigOptions,
  InitRuntimeConfigResult,
  RuntimeConfigLoadOptions,
  LoadedRuntimeConfig,
  RuntimeConfigOverride,
  KeytarLike,
} from './loader.js';

export {
  discoverXifanSources,
  loadXifanContext,
  mergeXifanContent,
  renderXifanVariables,
  toXifanContextBlock,
} from './xifan-injector.js';
export type {
  XifanInjectorFs,
  DiscoverXifanSourcesOptions,
  LoadXifanContextOptions,
  XifanContextLoadResult,
} from './xifan-injector.js';

export {
  assertNoPlaintextSecrets,
  detectPlaintextSecrets,
  resolveAPISecrets,
  sanitizeConfigForSerialization,
} from './secrets.js';
export type {
  KeychainAdapter,
  SecretSource,
  ResolvedSecret,
  ResolvedAPISecrets,
  ResolveSecretsOptions,
  SecretLeakFinding,
} from './secrets.js';
