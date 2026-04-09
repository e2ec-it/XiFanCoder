import { describe, expect, it } from 'vitest';

import * as cliExports from '../index.js';

describe('cli public exports', () => {
  it('re-exports main entry points', () => {
    expect(typeof cliExports.parseCliArgs).toBe('function');
    expect(typeof cliExports.executeCommand).toBe('function');
    expect(typeof cliExports.executeCommandDetailed).toBe('function');
    expect(typeof cliExports.runSingleTask).toBe('function');
    expect(typeof cliExports.startRepl).toBe('function');
    expect(typeof cliExports.createInitialReplState).toBe('function');
    expect(typeof cliExports.createDefaultSlashRouter).toBe('function');
    expect(typeof cliExports.SlashCommandRouter).toBe('function');
    expect(typeof cliExports.updateUsageSummary).toBe('function');
  });
});
