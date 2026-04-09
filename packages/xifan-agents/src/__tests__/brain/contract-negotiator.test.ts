import { afterEach, describe, expect, it, vi } from 'vitest';
import { negotiateContract, parseContractResponse } from '../../brain/contract-negotiator.js';
import { createDefaultRubric } from '../../brain/types.js';

vi.mock('../../brain/llm-client.js', () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from '../../brain/llm-client.js';
const mockChat = vi.mocked(chatCompletion);

describe('parseContractResponse', () => {
  it('parses valid JSON into SprintContract', () => {
    const json = JSON.stringify({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'Tests pass', testMethod: 'shell_command', testCommand: 'npm test', expectedOutcome: 'exit 0' },
      ],
      maxIterations: 3,
    });
    const contract = parseContractResponse(json, 'Fix auth bug', createDefaultRubric());
    expect(contract.acceptanceCriteria).toHaveLength(1);
    expect(contract.maxIterations).toBe(3);
    expect(contract.sprintId).toMatch(/^sp-/);
    expect(contract.frozenAt).toBeTruthy();
  });

  it('defaults to empty criteria when acceptanceCriteria is not an array', () => {
    const json = JSON.stringify({ maxIterations: 2 });
    const contract = parseContractResponse(json, 'task', createDefaultRubric());
    expect(contract.acceptanceCriteria).toEqual([]);
  });

  it('caps maxIterations at 10', () => {
    const json = JSON.stringify({ acceptanceCriteria: [], maxIterations: 99 });
    const contract = parseContractResponse(json, 'task', createDefaultRubric());
    expect(contract.maxIterations).toBe(10);
  });
});

describe('negotiateContract', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns a valid SprintContract from LLM', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        acceptanceCriteria: [
          { id: 'ac-1', description: 'Email validation works', testMethod: 'shell_command', expectedOutcome: 'tests pass' },
        ],
        maxIterations: 4,
      }),
      usage: { promptTokens: 300, completionTokens: 150 },
    });

    const contract = await negotiateContract('Add email validation');
    expect(contract.taskDescription).toBe('Add email validation');
    expect(contract.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('returns default contract on LLM failure', async () => {
    mockChat.mockRejectedValueOnce(new Error('timeout'));

    const contract = await negotiateContract('Fix broken tests');
    expect(contract.taskDescription).toBe('Fix broken tests');
    expect(contract.maxIterations).toBe(5);
    expect(contract.acceptanceCriteria).toHaveLength(0);
  });
});
