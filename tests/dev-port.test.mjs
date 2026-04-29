import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = new URL('../', import.meta.url);
const TARGET_PORT = 3400;

function getExcludedRange(port) {
  const result = spawnSync(
    'netsh',
    ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr || 'netsh failed');

  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s*(\*)?\s*$/);
    if (!match) {
      continue;
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    if (port >= start && port <= end) {
      return { start, end, administered: Boolean(match[3]) };
    }
  }

  return null;
}

test('dev-port surfaces excluded port ranges as startup failures', (t) => {
  const excludedRange = getExcludedRange(TARGET_PORT);
  if (!excludedRange) {
    t.skip(`Port ${TARGET_PORT} is not excluded on this machine`);
    return;
  }

  const result = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', '.\\dev-port.ps1', 'up'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );

  assert.notEqual(
    result.status,
    0,
    `Expected non-zero exit code when port ${TARGET_PORT} is excluded`,
  );

  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /excluded TCP port range/i);
  assert.match(output, new RegExp(`${excludedRange.start}\\s*-\\s*${excludedRange.end}`));
});
