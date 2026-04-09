import { describe, expect, it } from 'vitest';

import { countTokens, estimateTextTokens } from '../token-counter.js';
import type { LLMMessage, LLMTool } from '../types.js';

describe('estimateTextTokens', () => {
  it('estimates tokens based on character count / 4', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('abcd')).toBe(1);
    expect(estimateTextTokens('hello world')).toBe(3); // ceil(11/4) = 3
  });
});

describe('countTokens', () => {
  it('counts tokens for a simple string-content message', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hello world' },
    ];
    const count = countTokens(messages);
    // MESSAGE_OVERHEAD(4) + role(ceil(4/4)=1) + content(ceil(11/4)=3) = 8
    expect(count).toBe(8);
  });

  it('counts tokens for message with array content parts', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: 'world' },
        ],
      },
    ];
    const count = countTokens(messages);
    // MESSAGE_OVERHEAD(4) + role(ceil(9/4)=3) + text1(ceil(5/4)=2) + text2(ceil(5/4)=2) = 11
    expect(count).toBe(11);
  });

  it('counts tokens for message with tool_calls', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"README.md"}',
            },
          },
        ],
      },
    ];
    const count = countTokens(messages);
    // MESSAGE_OVERHEAD(4) + role(3) + content('')=0 + name(ceil(9/4)=3) + args(ceil(20/4)=5) = 15
    expect(count).toBe(15);
  });

  it('counts tokens for tool role message with tool_call_id', () => {
    const messages: LLMMessage[] = [
      {
        role: 'tool',
        content: 'file content here',
        tool_call_id: 'tc-1',
      },
    ];
    const count = countTokens(messages);
    // MESSAGE_OVERHEAD(4) + role(ceil(4/4)=1) + content(ceil(17/4)=5) + tool_call_id(ceil(4/4)=1) = 11
    expect(count).toBe(11);
  });

  it('counts tokens with tool definitions', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hi' },
    ];
    const tools: LLMTool[] = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from disk',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ];
    const count = countTokens(messages, tools);
    // message tokens + tool tokens + 12 overhead
    expect(count).toBeGreaterThan(12);
  });

  it('counts tokens for multiple messages and multiple tools', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'test' },
      { role: 'assistant', content: 'response' },
    ];
    const tools: LLMTool[] = [
      {
        type: 'function',
        function: {
          name: 'tool_a',
          description: 'desc a',
          parameters: { type: 'object' },
        },
      },
      {
        type: 'function',
        function: {
          name: 'tool_b',
          description: 'desc b',
          parameters: { type: 'object' },
        },
      },
    ];
    const count = countTokens(messages, tools);
    expect(count).toBeGreaterThan(0);
  });

  it('handles message with null content', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: null },
    ];
    const count = countTokens(messages);
    // MESSAGE_OVERHEAD(4) + role(3) = 7 (null content doesn't match string or array branches)
    expect(count).toBe(7);
  });
});
