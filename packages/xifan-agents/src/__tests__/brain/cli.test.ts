import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../brain/contract-negotiator.js', () => ({
  negotiateContract: vi.fn(),
}));

const mockChatCompletion = vi.fn();
vi.mock('../../brain/llm-client.js', () => ({
  chatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
}));

const mockRunSprint = vi.fn();
vi.mock('../../brain/sprint-loop.js', () => ({
  runSprint: (...args: unknown[]) => mockRunSprint(...args),
}));

import { buildSprintContract, createGenerator, main, parseArgs } from '../../brain/cli.js';
import { negotiateContract } from '../../brain/contract-negotiator.js';
import { createDefaultRubric } from '../../brain/types.js';

const mockNegotiateContract = vi.mocked(negotiateContract);

describe('brain/cli', () => {
  afterEach(() => {
    delete process.env['XIFAN_DISABLE_CONTRACT'];
    vi.clearAllMocks();
  });

  it('parses positional task and max-iter flag', () => {
    const parsed = parseArgs(['node', 'cli.ts', 'fix login', '--max-iter', '3']);
    expect(parsed.task).toBe('fix login');
    expect(parsed.maxIter).toBe(3);
    expect(parsed.sessionId).toMatch(/^sprint-/);
  });

  it('parses --task flag', () => {
    const parsed = parseArgs(['node', 'cli.ts', '--task', 'deploy service']);
    expect(parsed.task).toBe('deploy service');
    expect(parsed.maxIter).toBe(5); // default
  });

  it('exits with code 1 when no task is provided', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockStderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => parseArgs(['node', 'cli.ts'])).toThrow('exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    mockStderr.mockRestore();
  });

  it('builds fallback contract when contract negotiation is disabled', async () => {
    process.env['XIFAN_DISABLE_CONTRACT'] = '1';

    const contract = await buildSprintContract('Fix auth bug', 4, createDefaultRubric());

    expect(contract.taskDescription).toBe('Fix auth bug');
    expect(contract.maxIterations).toBe(4);
    expect(contract.acceptanceCriteria).toHaveLength(0);
    expect(contract.negotiationRounds).toBe(0);
    expect(mockNegotiateContract).not.toHaveBeenCalled();
  });

  it('delegates to contract negotiation when ablation flag is not set', async () => {
    const negotiated = {
      sprintId: 'sp-negotiated',
      taskDescription: 'Fix auth bug',
      acceptanceCriteria: [],
      maxIterations: 2,
      qualityRubric: createDefaultRubric(),
      negotiationRounds: 1,
      frozenAt: new Date().toISOString(),
    };
    mockNegotiateContract.mockResolvedValueOnce(negotiated);

    const contract = await buildSprintContract('Fix auth bug', 4, createDefaultRubric());

    expect(mockNegotiateContract).toHaveBeenCalledOnce();
    expect(contract).toBe(negotiated);
  });
});

describe('createGenerator', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns a function that calls chatCompletion without feedback', async () => {
    mockChatCompletion.mockResolvedValueOnce({ content: 'generated code' });
    const gen = createGenerator('build login page');
    const result = await gen('');
    expect(result).toBe('generated code');
    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.stringContaining('build login page') }),
        ]),
      }),
    );
  });

  it('includes feedback in prompt when provided', async () => {
    mockChatCompletion.mockResolvedValueOnce({ content: 'improved code' });
    const gen = createGenerator('build login page');
    await gen('add error handling');
    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining('add error handling') }),
        ]),
      }),
    );
  });
});

describe('main', () => {
  afterEach(() => {
    delete process.env['XIFAN_DISABLE_CONTRACT'];
    vi.clearAllMocks();
  });

  it('runs full sprint pipeline and exits 0 on convergence', async () => {
    process.env['XIFAN_DISABLE_CONTRACT'] = '1';
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Provide argv with task
    const origArgv = process.argv;
    process.argv = ['node', 'cli.ts', '--task', 'test task', '--max-iter', '1'];

    mockRunSprint.mockResolvedValueOnce({
      iterations: 1,
      converged: true,
      durationMs: 1234,
      finalScores: {
        verdict: 'pass',
        weightedTotal: 8.5,
        scores: new Map([['correctness', 9], ['readability', 8]]),
        feedback: 'Looks good',
        evidence: ['test passed'],
      },
    });

    await expect(main()).rejects.toThrow('exit');
    expect(mockExit).toHaveBeenCalledWith(0);

    process.argv = origArgv;
    mockExit.mockRestore();
    mockLog.mockRestore();
  });

  it('exits 1 when sprint does not converge', async () => {
    process.env['XIFAN_DISABLE_CONTRACT'] = '1';
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const origArgv = process.argv;
    process.argv = ['node', 'cli.ts', 'failing task'];

    mockRunSprint.mockResolvedValueOnce({
      iterations: 5,
      converged: false,
      durationMs: 5000,
      finalScores: {
        verdict: 'fail',
        weightedTotal: 3.0,
        scores: new Map([['correctness', 3]]),
        feedback: 'Needs work',
        evidence: [],
      },
    });

    await expect(main()).rejects.toThrow('exit');
    expect(mockExit).toHaveBeenCalledWith(1);

    process.argv = origArgv;
    mockExit.mockRestore();
    mockLog.mockRestore();
  });
});
