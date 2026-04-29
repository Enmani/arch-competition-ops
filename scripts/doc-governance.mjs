import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const GOVERNED_ROOTS = [
  'docs/roadmaps',
  'docs/goals',
  'docs/structures',
  'docs/plans',
  'docs/research',
  'docs/changelog',
];
const MARKDOWN_ROOTS = ['docs'];
const EXTRA_FILES = ['vision.md', 'AGENTS.md', 'README.md'];
const REQUIRED_FIELDS = ['title', 'status', 'updated_at'];
const ALLOWED_STATUS = new Set([
  '未实施',
  '施工中',
  '已完成',
  'draft',
  'planned',
  'in_progress',
  'done',
  'blocked',
  'archived',
]);
const FRONTMATTER_ORDER = ['title', 'vision_doc', 'goal_doc', 'structure_doc', 'status', 'updated_at', 'related_docs'];
const SPECIAL_BASENAMES = new Set(['README.md', 'AGENTS.md', '_template.md']);

main();

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  try {
    if (command === 'scan') {
      runScan(resolveFiles(args, { governedOnly: true }));
      return;
    }

    if (command === 'check-encoding') {
      runEncodingCheck(resolveFiles(args, { governedOnly: false }));
      return;
    }

    if (command === 'normalize') {
      const file = requireFileArg(args);
      normalizeFile(file, args);
      console.log(`normalized ${toPosix(file)}`);
      return;
    }

    if (command === 'set-status') {
      const file = requireFileArg(args);
      const status = String(args.status || '').trim();
      if (!ALLOWED_STATUS.has(status)) {
        throw new Error(`Unsupported status: ${status}`);
      }
      const parsed = readMarkdown(file);
      parsed.data.status = status;
      parsed.data.updated_at = today();
      writeMarkdown(file, parsed.data, parsed.body);
      console.log(`status updated ${toPosix(file)} -> ${status}`);
      return;
    }

    if (command === 'write') {
      const file = requireFileArg(args);
      const content = resolveWriteContent(args);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
      console.log(`wrote ${toPosix(file)}`);
      return;
    }

    if (command === 'rename') {
      const file = requireFileArg(args);
      const target = requireTargetArg(args);
      renameMarkdown(file, target);
      console.log(`renamed ${toPosix(file)} -> ${toPosix(target)}`);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`doc-governance.mjs

Commands:
  scan [--file <path[,path]>]
  check-encoding [--file <path[,path]>]
  normalize --file <path> [--title <title>] [--status <status>]
  set-status --file <path> --status <status>
  write --file <path> [--from-file <path>]
  rename --file <path> --to <path>
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    args[key] = value;
  }
  return args;
}

function requireFileArg(args) {
  const raw = args.file;
  if (!raw || typeof raw !== 'string') {
    throw new Error('Missing required --file <path>');
  }
  return path.resolve(ROOT, raw);
}

function requireTargetArg(args) {
  const raw = args.to;
  if (!raw || typeof raw !== 'string') {
    throw new Error('Missing required --to <path>');
  }
  return path.resolve(ROOT, raw);
}

function resolveFiles(args, { governedOnly }) {
  if (typeof args.file === 'string') {
    return args.file
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => path.resolve(ROOT, item));
  }

  const files = [];
  const roots = governedOnly ? GOVERNED_ROOTS : MARKDOWN_ROOTS;
  for (const root of roots) {
    const abs = path.resolve(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    walk(abs, files);
  }
  if (!governedOnly) {
    for (const extra of EXTRA_FILES) {
      const abs = path.resolve(ROOT, extra);
      if (fs.existsSync(abs)) files.push(abs);
    }
  }
  return files.filter((file) => file.endsWith('.md'));
}

function walk(dir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, files);
      continue;
    }
    if (entry.isFile() && abs.endsWith('.md')) {
      files.push(abs);
    }
  }
}

function runScan(files) {
  const issues = [];
  for (const file of files) {
    const rel = toPosix(file);
    const parsed = readMarkdown(file);
    if (!parsed.hasFrontmatter) {
      issues.push(`${rel}: missing frontmatter`);
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!hasValue(parsed.data[field])) {
        issues.push(`${rel}: missing required field "${field}"`);
      }
    }

    if (hasValue(parsed.data.status) && !ALLOWED_STATUS.has(parsed.data.status)) {
      issues.push(`${rel}: invalid status "${parsed.data.status}"`);
    }

    if (requiresVisionDoc(file) && !hasValue(parsed.data.vision_doc)) {
      issues.push(`${rel}: missing "vision_doc"`);
    }

    const heading = firstHeading(parsed.body);
    if (!heading) {
      issues.push(`${rel}: missing H1 heading`);
    }

    for (const key of ['vision_doc', 'goal_doc', 'structure_doc']) {
      if (hasValue(parsed.data[key])) {
        const target = path.resolve(ROOT, parsed.data[key]);
        if (!fs.existsSync(target)) {
          issues.push(`${rel}: missing referenced file "${parsed.data[key]}"`);
        }
      }
    }

    if (Array.isArray(parsed.data.related_docs)) {
      for (const item of parsed.data.related_docs) {
        const target = path.resolve(ROOT, item);
        if (!fs.existsSync(target)) {
          issues.push(`${rel}: missing related doc "${item}"`);
        }
      }
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) console.error(issue);
    throw new Error(`doc scan failed with ${issues.length} issue(s)`);
  }

  console.log(`doc scan passed for ${files.length} file(s)`);
}

function runEncodingCheck(files) {
  const issues = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('\uFFFD')) {
      issues.push(`${toPosix(file)}: found replacement character`);
    }
  }
  if (issues.length > 0) {
    for (const issue of issues) console.error(issue);
    throw new Error(`encoding check failed with ${issues.length} issue(s)`);
  }
  console.log(`encoding check passed for ${files.length} file(s)`);
}

function normalizeFile(file, args) {
  const parsed = readMarkdown(file);
  const title = typeof args.title === 'string' ? args.title : firstHeading(parsed.body) || titleFromFile(file);
  const status = typeof args.status === 'string' ? args.status : parsed.data.status || '未实施';
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Unsupported status: ${status}`);
  }

  parsed.data.title = title;
  parsed.data.status = status;
  parsed.data.updated_at = today();

  if (requiresVisionDoc(file) && !hasValue(parsed.data.vision_doc)) {
    parsed.data.vision_doc = 'vision.md';
  }

  writeMarkdown(file, parsed.data, parsed.body);
}

function renameMarkdown(file, target) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing source file: ${toPosix(file)}`);
  }
  if (fs.existsSync(target)) {
    throw new Error(`Target already exists: ${toPosix(target)}`);
  }
  const fromRel = toPosix(file);
  const toRel = toPosix(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(file, target);
  rewriteReferences(fromRel, toRel);
}

function rewriteReferences(fromRel, toRel) {
  const files = resolveFiles({}, { governedOnly: false });
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes(fromRel)) continue;
    fs.writeFileSync(file, content.split(fromRel).join(toRel), 'utf8');
  }
}

function resolveWriteContent(args) {
  if (typeof args['from-file'] === 'string') {
    return fs.readFileSync(path.resolve(ROOT, args['from-file']), 'utf8');
  }
  return fs.readFileSync(0, 'utf8');
}

function readMarkdown(file) {
  const content = fs.readFileSync(file, 'utf8');
  return splitFrontmatter(content);
}

function splitFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { hasFrontmatter: false, data: {}, body: normalized.trimStart() };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { hasFrontmatter: false, data: {}, body: normalized };
  }
  const raw = normalized.slice(4, end);
  const body = normalized.slice(end + 5).trimStart();
  return { hasFrontmatter: true, data: parseFrontmatter(raw), body };
}

function parseFrontmatter(raw) {
  const data = {};
  const lines = raw.split('\n');
  let currentArrayKey = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('  - ') && currentArrayKey) {
      if (!Array.isArray(data[currentArrayKey])) data[currentArrayKey] = [];
      data[currentArrayKey].push(unquote(line.slice(4).trim()));
      continue;
    }
    currentArrayKey = null;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!value) {
      data[key] = [];
      currentArrayKey = key;
      continue;
    }
    data[key] = unquote(value.trim());
  }
  return data;
}

function writeMarkdown(file, data, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const orderedKeys = [];
  for (const key of FRONTMATTER_ORDER) {
    if (key in data) orderedKeys.push(key);
  }
  for (const key of Object.keys(data)) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }
  const lines = ['---'];
  for (const key of orderedKeys) {
    const value = data[key];
    if (!hasValue(value)) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
      continue;
    }
    lines.push(`${key}: ${formatScalar(value)}`);
  }
  lines.push('---', '', body.trimStart(), '');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

function requiresVisionDoc(file) {
  const rel = toPosix(file);
  const base = path.basename(file);
  if (SPECIAL_BASENAMES.has(base)) return false;
  return ['docs/roadmaps/', 'docs/goals/', 'docs/structures/', 'docs/plans/'].some((prefix) => rel.startsWith(prefix));
}

function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function titleFromFile(file) {
  return path
    .basename(file, '.md')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function formatScalar(value) {
  return /[:#]/.test(String(value)) ? JSON.stringify(String(value)) : String(value);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toPosix(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}
