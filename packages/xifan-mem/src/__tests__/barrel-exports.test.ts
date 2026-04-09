import { describe, expect, it } from 'vitest';

describe('barrel exports', () => {
  it('src/index.ts re-exports all modules', async () => {
    const mod = await import('../index.js');
    expect(mod.MemoryDatabaseManager).toBeDefined();
    expect(mod.MemoryManager).toBeDefined();
    expect(mod.XifanMemoryMcpServer).toBeDefined();
    expect(mod.ObservationGenerator).toBeDefined();
    expect(mod.SummaryGenerator).toBeDefined();
    expect(mod.QueueProcessor).toBeDefined();
    expect(mod.stripPrivateTags).toBeDefined();
  });

  it('src/db/index.ts re-exports db stores', async () => {
    const mod = await import('../db/index.js');
    expect(mod.MemoryDatabaseManager).toBeDefined();
    expect(mod.MemSessionStore).toBeDefined();
    expect(mod.ObservationStore).toBeDefined();
    expect(mod.SessionSummaryStore).toBeDefined();
    expect(mod.UserPromptStore).toBeDefined();
    expect(mod.QueueStore).toBeDefined();
  });

  it('src/llm/index.ts re-exports llm modules', async () => {
    const mod = await import('../llm/index.js');
    expect(mod.ObservationGenerator).toBeDefined();
    expect(mod.SummaryGenerator).toBeDefined();
    expect(mod.OBSERVATION_SYSTEM_PROMPT).toBeDefined();
    expect(mod.SUMMARY_SYSTEM_PROMPT).toBeDefined();
    expect(mod.parseObservationXml).toBeDefined();
    expect(mod.parseSummaryXml).toBeDefined();
  });

  it('src/privacy/index.ts re-exports privacy filter', async () => {
    const mod = await import('../privacy/index.js');
    expect(mod.stripPrivateTags).toBeDefined();
  });

  it('src/queue/index.ts re-exports queue processor', async () => {
    const mod = await import('../queue/index.js');
    expect(mod.QueueProcessor).toBeDefined();
  });

  it('src/manager/index.ts re-exports memory manager', async () => {
    const mod = await import('../manager/index.js');
    expect(mod.MemoryManager).toBeDefined();
  });
});
