// Documentation scan: `node scripts/doc-governance.mjs scan [--root <dir>] [--stale-days <n>] [--strict]`
//
// Checks every Markdown file under docs/ plus AGENTS.md for:
//   1. frontmatter with title, status and a real ISO updated_at date;
//   2. a status from the single vocabulary documented in docs/plans/README.md;
//   3. frontmatter paths (vision_doc, goal_doc, structure_doc, related_docs) that exist;
//   4. relative Markdown links ([text](path)) that resolve to an existing file;
//   5. staleness: a doc with status "in-progress" whose updated_at is older than --stale-days
//      (default 60). Staleness is a warning; with --strict it fails the scan.
// Errors exit with code 1. The script rewrites nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = new Set(['draft', 'not-started', 'in-progress', 'done', 'archived']);
const REQUIRED_FIELDS = ['title', 'status', 'updated_at'];
const PATH_FIELDS = ['vision_doc', 'goal_doc', 'structure_doc'];
const ROOT_FILES = ['AGENTS.md'];
const DAY_MS = 24 * 60 * 60 * 1000;

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, files);
    else if (entry.isFile() && abs.endsWith('.md')) files.push(abs);
  }
}

function unquote(value) {
  const quoted = /^(["']).*\1$/.test(value);
  return quoted ? value.slice(1, -1) : value;
}

// Minimal frontmatter reader: `key: value` scalars and `key:` followed by `  - item` lists.
function parseMarkdown(content) {
  const text = content.replace(/\r\n/g, '\n');
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  if (end === -1) return { data: null, body: text };
  const data = {};
  let listKey = null;
  for (const line of text.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    if (listKey && line.startsWith('  - ')) {
      data[listKey].push(unquote(line.slice(4).trim()));
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    listKey = value ? null : key;
    data[key] = value ? unquote(value.trim()) : [];
  }
  return { data, body: text.slice(end + 5) };
}

function relativeLinks(body) {
  const withoutCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const targets = [];
  for (const match of withoutCode.matchAll(/\[[^\]\n]*\]\(([^)\s]+)[^)]*\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) targets.push(target);
  }
  return targets;
}

function collectFiles(root) {
  const files = [];
  const docs = path.join(root, 'docs');
  if (fs.existsSync(docs)) walk(docs, files);
  for (const name of ROOT_FILES) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) files.push(abs);
  }
  return files;
}

export function scan(root, { staleDays = 60, now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const files = collectFiles(root);
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const { data, body } = parseMarkdown(fs.readFileSync(file, 'utf8'));
    if (!data) {
      errors.push(`${rel}: missing frontmatter`);
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!data[field]) errors.push(`${rel}: missing "${field}"`);
    }
    if (data.status && !STATUSES.has(data.status)) {
      errors.push(`${rel}: invalid status "${data.status}" (allowed: ${[...STATUSES].join(', ')})`);
    }
    const updated = /^\d{4}-\d{2}-\d{2}$/.test(data.updated_at ?? '') ? Date.parse(data.updated_at) : NaN;
    if (data.updated_at && Number.isNaN(updated)) {
      errors.push(`${rel}: updated_at "${data.updated_at}" is not an ISO date (YYYY-MM-DD)`);
    } else if (data.status === 'in-progress' && now - updated > staleDays * DAY_MS) {
      warnings.push(`${rel}: in-progress but updated_at ${data.updated_at} is over ${staleDays} days old`);
    }
    const referenced = [...PATH_FIELDS.map((key) => data[key]).filter(Boolean), ...(data.related_docs ?? [])];
    for (const target of referenced) {
      if (!fs.existsSync(path.resolve(root, target))) errors.push(`${rel}: referenced file not found "${target}"`);
    }
    for (const target of relativeLinks(body)) {
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
      if (!fs.existsSync(resolved)) errors.push(`${rel}: broken link "${target}"`);
    }
  }
  return { files: files.length, errors, warnings };
}

function parseArgs(argv) {
  const args = { command: argv[0], root: process.cwd(), staleDays: 60, strict: false };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = path.resolve(argv[++i] ?? '');
    else if (argv[i] === '--stale-days') args.staleDays = Number(argv[++i]);
    else if (argv[i] === '--strict') args.strict = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== 'scan' || !Number.isFinite(args.staleDays)) {
    console.error('usage: node scripts/doc-governance.mjs scan [--root <dir>] [--stale-days <n>] [--strict]');
    process.exitCode = 2;
    return;
  }
  const { files, errors, warnings } = scan(args.root, { staleDays: args.staleDays });
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  const failed = errors.length > 0 || (args.strict && warnings.length > 0);
  console.log(`doc scan ${failed ? 'failed' : 'passed'}: ${files} file(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
