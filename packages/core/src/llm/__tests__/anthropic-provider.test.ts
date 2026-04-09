import { describe, expect, it } from 'vitest';

import {
  AnthropicStreamParser,
  fromAnthropicResponse,
} from '../converters/from-anthropic.js';
import { toAnthropicRequest } from '../converters/to-anthropic.js';
import type { LLMRequest } from '../types.js';

describe('anthropic provider contract', () => {
  it('converts unified request into anthropic request payload', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      systemPrompt: 'system policy',
      tool_choice: 'required',
      maxTokens: 256,
      messages: [
        { role: 'system', content: 'legacy-system' },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"README.md","meta":{"depth":2}}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool-1',
          name: 'read_file',
          content: '# title',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'read file',
            parameters: { type: 'object' },
          },
        },
      ],
    };

    const payload = toAnthropicRequest(request);
    expect(payload.system).toBe('system policy');
    expect(payload.tool_choice).toEqual({ type: 'any' });
    expect(payload.messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(payload.messages[1]?.role).toBe('assistant');
    expect(
      Array.isArray(payload.messages[1]?.content) &&
        payload.messages[1]?.content[0]?.type === 'tool_use' &&
        payload.messages[1]?.content[0]?.input,
    ).toBeTruthy();
    expect(payload.messages[2]?.role).toBe('user');
  });

  it('extracts usage and finish reason from non-stream anthropic response', () => {
    const converted = fromAnthropicResponse(
      {
        content: [
          { type: 'text', text: 'done' },
        ],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 12,
          output_tokens: 5,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 1,
        },
        id: 'resp-1',
      },
      33,
    );

    expect(converted.finishReason).toBe('stop');
    expect(converted.usage).toEqual({
      promptTokens: 12,
      completionTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
    });
    expect(converted.requestId).toBe('resp-1');
  });

  it('assembles streaming events into internal stream chunks', () => {
    const parser = new AnthropicStreamParser();
    const chunks = [
      ...parser.processEvent({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tc-1', name: 'read_file' },
      }),
      ...parser.processEvent({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"path":"' },
      }),
      ...parser.processEvent({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: 'README.md"}' },
      }),
      ...parser.processEvent({
        type: 'message_delta',
        usage: { input_tokens: 9, output_tokens: 2 },
      }),
      ...parser.processEvent({ type: 'message_stop' }),
    ];

    const toolHeaders = chunks.filter((chunk) => chunk.type === 'tool_use_delta');
    const stop = chunks.find((chunk) => chunk.type === 'message_stop');
    expect(toolHeaders.length).toBeGreaterThan(0);
    expect(stop).toEqual({
      type: 'message_stop',
      finishReason: 'stop',
      usage: {
        promptTokens: 9,
        completionTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });

  it('converts user message with array content', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'part one' },
            { type: 'text', text: 'part two' },
          ],
        },
      ],
    };

    const payload = toAnthropicRequest(request);
    const firstMsg = payload.messages[0];
    expect(Array.isArray(firstMsg?.content)).toBe(true);
    if (Array.isArray(firstMsg?.content)) {
      expect(firstMsg.content).toHaveLength(2);
      expect(firstMsg.content[0]).toEqual({ type: 'text', text: 'part one' });
    }
  });

  it('converts user message with non-string non-array content to empty string', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'user', content: null },
      ],
    };

    const payload = toAnthropicRequest(request);
    expect(payload.messages[0]?.content).toBe('');
  });

  it('converts assistant message with array content text blocks', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        },
      ],
    };

    const payload = toAnthropicRequest(request);
    const msg = payload.messages[0];
    expect(Array.isArray(msg?.content)).toBe(true);
    if (Array.isArray(msg?.content)) {
      expect(msg.content).toHaveLength(2);
    }
  });

  it('converts assistant message with empty content and tool_calls to tool_use blocks only', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'tc-1',
              type: 'function',
              function: { name: 'tool1', arguments: '{}' },
            },
          ],
        },
      ],
    };

    const payload = toAnthropicRequest(request);
    const msg = payload.messages[0];
    expect(Array.isArray(msg?.content)).toBe(true);
  });

  it('safeParseJson returns empty object for invalid JSON', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'assistant',
          content: 'text',
          tool_calls: [
            {
              id: 'tc-1',
              type: 'function',
              function: { name: 'tool1', arguments: 'not-json' },
            },
          ],
        },
      ],
    };

    const payload = toAnthropicRequest(request);
    const msg = payload.messages[0];
    if (Array.isArray(msg?.content)) {
      const toolUse = msg.content.find((b) => 'type' in b && b.type === 'tool_use');
      expect(toolUse).toBeDefined();
      if (toolUse && 'input' in toolUse) {
        expect(toolUse.input).toEqual({});
      }
    }
  });

  it('safeParseJson returns empty object for non-object JSON (e.g. array)', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'assistant',
          content: 'text',
          tool_calls: [
            {
              id: 'tc-1',
              type: 'function',
              function: { name: 'tool1', arguments: '[1,2,3]' },
            },
          ],
        },
      ],
    };

    const payload = toAnthropicRequest(request);
    const msg = payload.messages[0];
    if (Array.isArray(msg?.content)) {
      const toolUse = msg.content.find((b) => 'type' in b && b.type === 'tool_use');
      if (toolUse && 'input' in toolUse) {
        expect(toolUse.input).toEqual({});
      }
    }
  });

  it('toAnthropicToolChoice returns none for none, auto for auto and default', () => {
    // none
    const noneReq: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: {} } }],
      tool_choice: 'none',
    };
    const nonePayload = toAnthropicRequest(noneReq);
    expect(nonePayload.tool_choice).toEqual({ type: 'none' });

    // auto
    const autoReq: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: {} } }],
      tool_choice: 'auto',
    };
    const autoPayload = toAnthropicRequest(autoReq);
    expect(autoPayload.tool_choice).toEqual({ type: 'auto' });
  });

  it('toAnthropicToolChoice returns undefined when no tools', () => {
    const req: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      tool_choice: 'required',
    };
    const payload = toAnthropicRequest(req);
    expect(payload.tool_choice).toBeUndefined();
  });

  it('converts assistant with single text to simplified string content', () => {
    const request: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'assistant', content: 'simple text only' },
      ],
    };

    const payload = toAnthropicRequest(request);
    expect(payload.messages[0]?.content).toBe('simple text only');
  });

  it('passes temperature and stream options', () => {
    const req: LLMRequest = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
    };
    const payload = toAnthropicRequest(req, true);
    expect(payload.temperature).toBe(0.7);
    expect(payload.stream).toBe(true);
  });

  it('handles message_stop without prior usage event', () => {
    const parser = new AnthropicStreamParser();
    const chunks = [
      ...parser.processEvent({ type: 'message_stop' }),
    ];

    expect(chunks).toEqual([
      {
        type: 'message_stop',
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    ]);
  });

  it('fromAnthropicResponse converts tool_use blocks', () => {
    const converted = fromAnthropicResponse(
      {
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'a.ts' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 10 },
      },
      50,
    );

    expect(converted.finishReason).toBe('tool_use');
    expect(converted.message.tool_calls).toHaveLength(1);
    expect(converted.message.tool_calls?.[0]?.function.name).toBe('read_file');
    expect(converted.message.content).toBeNull();
  });

  it('fromAnthropicResponse maps max_tokens and stop_sequence reasons', () => {
    const maxTokens = fromAnthropicResponse(
      {
        content: [{ type: 'text', text: 'partial' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      10,
    );
    expect(maxTokens.finishReason).toBe('max_tokens');

    const stopSeq = fromAnthropicResponse(
      {
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'stop_sequence',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      10,
    );
    expect(stopSeq.finishReason).toBe('stop');

    const nullReason = fromAnthropicResponse(
      {
        content: [{ type: 'text', text: 'done' }],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      10,
    );
    expect(nullReason.finishReason).toBe('stop');
  });

  it('fromAnthropicResponse maps cache tokens', () => {
    const converted = fromAnthropicResponse(
      {
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      },
      1,
    );
    expect(converted.usage.cacheReadTokens).toBe(0);
    expect(converted.usage.cacheWriteTokens).toBe(0);
  });

  it('stream parser handles text_delta events', () => {
    const parser = new AnthropicStreamParser();
    const chunks = [
      ...parser.processEvent({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello' },
      }),
    ];

    expect(chunks).toEqual([{ type: 'text_delta', delta: 'hello' }]);
  });

  it('stream parser handles content_block_stop to reset state', () => {
    const parser = new AnthropicStreamParser();
    // Start a tool use block
    parser.processEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tc-1', name: 'tool' },
    });
    // Stop it
    const stopChunks = parser.processEvent({ type: 'content_block_stop' });
    expect(stopChunks).toEqual([]);

    // input_json_delta after stop should produce nothing (no active tool)
    const deltaChunks = parser.processEvent({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"a":1}' },
    });
    expect(deltaChunks).toEqual([]);
  });

  it('stream parser ignores unknown event types', () => {
    const parser = new AnthropicStreamParser();
    const chunks = parser.processEvent({ type: 'ping' });
    expect(chunks).toEqual([]);
  });

  it('stream parser handles content_block_start with no block', () => {
    const parser = new AnthropicStreamParser();
    const chunks = parser.processEvent({ type: 'content_block_start' });
    expect(chunks).toEqual([]);
  });

  it('stream parser handles content_block_start with text block type', () => {
    const parser = new AnthropicStreamParser();
    const chunks = parser.processEvent({
      type: 'content_block_start',
      content_block: { type: 'text' },
    });
    expect(chunks).toEqual([]);
  });

  it('stream parser handles content_block_delta with no delta', () => {
    const parser = new AnthropicStreamParser();
    const chunks = parser.processEvent({ type: 'content_block_delta' });
    expect(chunks).toEqual([]);
  });

  it('stream parser handles message_delta with usage', () => {
    const parser = new AnthropicStreamParser();
    const chunks = parser.processEvent({
      type: 'message_delta',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    });
    expect(chunks).toEqual([]);

    // Now message_stop should include the saved usage
    const stopChunks = parser.processEvent({ type: 'message_stop' });
    expect(stopChunks).toEqual([{
      type: 'message_stop',
      finishReason: 'stop',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
      },
    }]);
  });
});
