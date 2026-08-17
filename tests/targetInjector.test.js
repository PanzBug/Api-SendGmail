import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  injectTargets,
  normalizeTargetUrl
} from '../utils/targetInjector.js';

const TARGETS = [
  'https://t.me/A',
  'https://t.me/B'
];

describe('normalizeTargetUrl', () => {
  it('parses full t.me url', () => {
    assert.equal(normalizeTargetUrl('https://t.me/username123'), 'https://t.me/username123');
  });
  it('parses username without scheme', () => {
    assert.equal(normalizeTargetUrl('t.me/username123'), 'https://t.me/username123');
  });
  it('parses @ username', () => {
    assert.equal(normalizeTargetUrl('@username123'), null);
  });
  it('rejects invalid / too short', () => {
    assert.equal(normalizeTargetUrl('https://t.me/ab'), null);
    assert.equal(normalizeTargetUrl('not-a-url'), null);
    assert.equal(normalizeTargetUrl(''), null);
  });
});

describe('injectTargets', () => {
  it('appends targets after existing usernames under USERNAME: header', () => {
    const body = `Dear Team,\n\nUSERNAME:\n\nhttps://t.me/existing\n\nRegards.`;
    const result = injectTargets(body, TARGETS, 'x');
    const idxExisting = result.indexOf('https://t.me/existing');
    const idxA = result.indexOf('https://t.me/A');
    const idxB = result.indexOf('https://t.me/B');
    assert.ok(idxExisting !== -1);
    assert.ok(idxA !== -1);
    assert.ok(idxB !== -1);
    assert.ok(idxExisting < idxA, 'targets should appear after existing usernames');
    assert.ok(idxA < idxB);
  });;

  it('appends after existing @handles under username: header', () => {
    const body = `Hello\nusername:\n@existing\nbye`;
    const result = injectTargets(body, TARGETS, 'x');
    assert.match(
      result,
      /username:\s*\n@existing\s*\nhttps:\/\/t\.me\/A\s*\nhttps:\/\/t\.me\/B\s*\nbye/
    );
  });

  it('injects at end when subject contains marker [INJECT]', () => {
    const body = 'plain body without header';
    const result = injectTargets(body, TARGETS, 'Report [INJECT] now');
    assert.ok(result.startsWith('plain body'));
    assert.match(result, /USERNAME:\s*\nhttps:\/\/t\.me\/A\s*\nhttps:\/\/t\.me\/B/);
  });

  it('returns unchanged when no header and no subject marker', () => {
    const body = 'nothing to inject here';
    const result = injectTargets(body, TARGETS, 'regular subject');
    assert.equal(result, body);
  });

  it('returns unchanged when targets empty', () => {
    const body = 'USERNAME:\nfoo';
    assert.equal(injectTargets(body, [], 'x'), body);
  });
});