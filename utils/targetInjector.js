import { Target } from '../models/Target.js';
import connectDB from './connectDB.js';

export function normalizeTargetUrl(input) {
  let raw = (input || '').trim();
  if (!raw) return null;
  const clean = raw.replace(/^@/, '');
  const match = clean.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]{3,32})$/i);
  if (!match) return null;
  return `https://t.me/${match[1]}`;
}

export const TARGET_SUBJECT_MARKER = () =>
  process.env.TARGET_SUBJECT_MARKER || '[INJECT]';

const USERNAME_HEADER_RE = /^\s*user\s*name\s*:\s*$/gim;
const TELEGRAM_LINK_RE = /^https?:\/\/t\.me\//i;
const HANDLE_RE = /^@[A-Za-z0-9_]+$/i;

export function injectTargets(text, targets, subject) {
  if (!text) return text;
  const list = (targets || []).filter(Boolean);
  if (list.length === 0) return text;

  const lines = text.split('\n');

  if (lines.some((l) => USERNAME_HEADER_RE.test(l))) {
    const headerIdx = lines.findIndex((l) => USERNAME_HEADER_RE.test(l));
    let insertAt = headerIdx + 1;
    while (insertAt < lines.length) {
      const line = lines[insertAt].trim();
      if (line === '' || TELEGRAM_LINK_RE.test(line) || HANDLE_RE.test(line)) {
        insertAt++;
        continue;
      }
      break;
    }
    lines.splice(insertAt, 0, ...list);
    return lines.join('\n');
  }

  const marker = TARGET_SUBJECT_MARKER();
  if (subject && typeof subject === 'string' && subject.includes(marker)) {
    const block = `\n\nUSERNAME:\n` + list.map((u) => `\n${u}`).join('') + '\n';
    return text + block;
  }

  return text;
}

export async function getAllTargets() {
  await connectDB();
  return await Target.listUsernames();
}