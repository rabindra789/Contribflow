import { describe, expect, it } from 'vitest';
import {
  commandFailure,
  commandSuccess,
  createCommandError,
  isCommandError,
  isCommandResult,
  parseCommandMessage,
  type Command,
} from './contracts';

const issueUrl = 'https://github.com/octocat/Hello-World/issues/42';
const pullRequestUrl = 'https://github.com/octocat/Hello-World/pull/42';
const issueId = 'octocat/hello-world#42';

const validCommands: Command[] = [
  { type: 'GET_SNAPSHOT' },
  { type: 'SAVE_ISSUE', url: issueUrl },
  { type: 'REFRESH_ISSUE', url: issueUrl },
  { type: 'REMOVE_ISSUE', issueId },
  { type: 'SAVE_NOTE', issueId, body: 'Remember the edge cases.' },
  { type: 'DELETE_NOTE', issueId },
  { type: 'TRACK_PULL_REQUEST', url: pullRequestUrl },
  { type: 'REFRESH_PULL_REQUEST', url: pullRequestUrl },
  { type: 'REMOVE_PULL_REQUEST', pullRequestId: issueId },
];

function expectInvalid(input: unknown, code = 'invalid-command'): void {
  const result = parseCommandMessage(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.message.length).toBeGreaterThan(0);
  }
}

describe('command parsing', () => {
  it.each(validCommands)('accepts the $type command', (command) => {
    expect(parseCommandMessage(command)).toEqual({ ok: true, command });
  });

  it.each(validCommands)('rejects extra fields on $type', (command) => {
    expectInvalid({ ...command, extra: true });
  });

  it('rejects non-object and unknown command messages', () => {
    expectInvalid(null);
    expectInvalid([]);
    expectInvalid('GET_SNAPSHOT');
    expectInvalid(42);
    expectInvalid({});
    expectInvalid({ type: 42 });
    expectInvalid({ type: 'DROP_TABLES' });
    expectInvalid(Object.assign(new Error('boom'), { type: 'GET_SNAPSHOT' }));
  });

  it('rejects GET_SNAPSHOT with additional fields', () => {
    expectInvalid({ type: 'GET_SNAPSHOT', url: issueUrl });
  });

  it('rejects URL commands without a string url', () => {
    expectInvalid({ type: 'SAVE_ISSUE' });
    expectInvalid({ type: 'SAVE_ISSUE', url: 42 });
    expectInvalid({ type: 'REFRESH_ISSUE', url: null });
    expectInvalid({ type: 'TRACK_PULL_REQUEST', url: undefined });
    expectInvalid({ type: 'REFRESH_PULL_REQUEST', url: ['https://github.com/a/b/issues/1'] });
  });

  it('rejects unsupported or non-canonical GitHub URLs', () => {
    expectInvalid({ type: 'SAVE_ISSUE', url: 'https://example.com/octocat/Hello-World/issues/42' }, 'invalid-github-url');
    expectInvalid({ type: 'SAVE_ISSUE', url: 'http://github.com/octocat/Hello-World/issues/42' }, 'invalid-github-url');
    expectInvalid({ type: 'SAVE_ISSUE', url: 'https://github.com/octocat/Hello-World' }, 'invalid-github-url');
    expectInvalid({ type: 'SAVE_ISSUE', url: 'https://github.com/octocat/Hello-World/issues/new' }, 'invalid-github-url');
    expectInvalid({ type: 'SAVE_ISSUE', url: 'https://github.com/octocat/Hello-World/issues/not-a-number' }, 'invalid-github-url');
    expectInvalid({ type: 'TRACK_PULL_REQUEST', url: 'not a url' }, 'invalid-github-url');
  });

  it('enforces the target kind for each command', () => {
    expectInvalid({ type: 'SAVE_ISSUE', url: pullRequestUrl }, 'wrong-target-kind');
    expectInvalid({ type: 'REFRESH_ISSUE', url: pullRequestUrl }, 'wrong-target-kind');
    expectInvalid({ type: 'TRACK_PULL_REQUEST', url: issueUrl }, 'wrong-target-kind');
    expectInvalid({ type: 'REFRESH_PULL_REQUEST', url: issueUrl }, 'wrong-target-kind');
  });

  it('does not echo rejected URL input in errors', () => {
    const result = parseCommandMessage({
      type: 'SAVE_ISSUE',
      url: 'https://evil.example/secret-token/octocat/Hello-World/issues/42',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain('evil.example');
      expect(result.error.message).not.toContain('secret-token');
    }
  });

  it('rejects missing or non-canonical issue identifiers', () => {
    expectInvalid({ type: 'REMOVE_ISSUE' });
    expectInvalid({ type: 'REMOVE_ISSUE', issueId: 42 });
    expectInvalid({ type: 'REMOVE_ISSUE', issueId: 'Octocat/Hello-World#42' });
    expectInvalid({ type: 'REMOVE_ISSUE', issueId: 'octocat/hello-world#0' });
    expectInvalid({ type: 'REMOVE_ISSUE', issueId: 'octocat/hello-world#01' });
    expectInvalid({ type: 'DELETE_NOTE', issueId: 'octocat/hello world#42' });
    expectInvalid({ type: 'REMOVE_PULL_REQUEST', pullRequestId: 'octocat/hello-world#2147483648' });
  });

  it('rejects invalid note bodies', () => {
    expectInvalid({ type: 'SAVE_NOTE', issueId });
    expectInvalid({ type: 'SAVE_NOTE', issueId, body: 42 });
    expectInvalid({ type: 'SAVE_NOTE', issueId, body: '' });
    expectInvalid({ type: 'SAVE_NOTE', issueId, body: '   \n\t  ' });
    expectInvalid({ type: 'SAVE_NOTE', issueId, body: 'x'.repeat(20001) });
    expectInvalid({ type: 'SAVE_NOTE', issueId: 'invalid', body: 'note' });
    expectInvalid({ type: 'SAVE_NOTE', issueId, body: 'note', extra: true });
  });

  it('preserves note body whitespace while validating trimmed content', () => {
    const body = '  keep surrounding spaces  ';
    expect(parseCommandMessage({ type: 'SAVE_NOTE', issueId, body })).toEqual({
      ok: true,
      command: { type: 'SAVE_NOTE', issueId, body },
    });
  });

  it('produces JSON-serializable parse results', () => {
    for (const command of validCommands) {
      const parsed = parseCommandMessage(JSON.parse(JSON.stringify(command)));
      expect(parsed).toEqual({ ok: true, command });
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    }
  });
});

describe('command result helpers', () => {
  it('builds success and failure results', () => {
    expect(commandSuccess({ value: 1 })).toEqual({ ok: true, data: { value: 1 } });
    expect(commandFailure(createCommandError('not-found', 'Missing.'))).toEqual({
      ok: false,
      error: { code: 'not-found', message: 'Missing.' },
    });
  });

  it('recognizes command errors', () => {
    expect(isCommandError({ code: 'not-found', message: 'Missing.' })).toBe(true);
    expect(
      isCommandError({
        code: 'rate-limited',
        message: 'Slow down.',
        status: 429,
        retryAfterSeconds: 30,
        rateLimitResetAt: '2026-10-20T12:02:00.000Z',
      }),
    ).toBe(true);
    expect(
      isCommandError({
        code: 'storage-schema',
        message: 'Unsupported.',
        found: 3,
        supported: 1,
      }),
    ).toBe(true);

    expect(isCommandError(null)).toBe(false);
    expect(isCommandError(new Error('boom'))).toBe(false);
    expect(isCommandError({ code: 'nope', message: 'x' })).toBe(false);
    expect(isCommandError({ code: 'not-found', message: '' })).toBe(false);
    expect(isCommandError({ code: 'not-found', message: 'x', status: '429' })).toBe(false);
    expect(isCommandError({ code: 'not-found', message: 'x', rateLimitResetAt: 42 })).toBe(false);
  });

  it('recognizes command results', () => {
    expect(isCommandResult(commandSuccess(null))).toBe(true);
    expect(isCommandResult(commandFailure(createCommandError('internal', 'Broken.')))).toBe(true);
    expect(isCommandResult({ ok: true })).toBe(false);
    expect(isCommandResult({ ok: 'yes', data: 1 })).toBe(false);
    expect(isCommandResult({ ok: false, error: { code: 'internal', message: '' } })).toBe(false);
    expect(isCommandResult(null)).toBe(false);
  });
});
