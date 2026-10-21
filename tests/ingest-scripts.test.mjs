// Windows scheduled-task scripts: scripts/run-ingest-batch.ps1 and scripts/register-auto-ingest-tasks.ps1.
//
// These are real end-to-end runs under BOTH Windows PowerShell 5.1 (powershell.exe, what Task Scheduler
// uses) and pwsh 7, against a stand-in "uv" (.cmd) that prints a warning on stderr like the real uv does.
// Nothing here touches the real artifacts/ directory or registers a real scheduled task.
// Skipped on non-Windows platforms.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-ingest-batch.ps1');
const REGISTER_SCRIPT = path.join(REPO_ROOT, 'scripts', 'register-auto-ingest-tasks.ps1');
const IS_WINDOWS = process.platform === 'win32';
const STDERR_WARNING = 'warning: stand-in uv deprecation warning on stderr';

function hostAvailable(exe) {
  const probe = spawnSync(exe, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

const HOSTS = IS_WINDOWS ? ['powershell.exe', 'pwsh'].filter(hostAvailable) : [];

function runPs(exe, scriptArgs, env = {}) {
  return spawnSync(
    exe,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ...scriptArgs],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 },
  );
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-script-test-'));
  const artifacts = path.join(dir, 'artifacts');
  const argsFile = path.join(dir, 'uv-args.txt');
  const uvPath = path.join(dir, 'uv.cmd');
  // Stand-in uv: always warns on stderr (the condition that broke PowerShell 5.1), records its arguments,
  // and fails the "ingest-batch" / "cleanup-expired-competitions" steps when asked to via env vars.
  const lines = [
    '@echo off',
    `>&2 echo ${STDERR_WARNING}`,
    '>>"%STUB_UV_ARGS_FILE%" echo %*',
    'echo %* | findstr /C:"ingest-batch" >nul',
    'if %errorlevel%==0 goto ingest',
    'echo %* | findstr /C:"cleanup-expired-competitions" >nul',
    'if %errorlevel%==0 goto cleanup',
    'exit /b 0',
    ':ingest',
    'echo ingest-batch stdout line',
    'if defined STUB_UV_INGEST_EXIT exit /b %STUB_UV_INGEST_EXIT%',
    'exit /b 0',
    ':cleanup',
    'echo cleanup stdout line',
    'if defined STUB_UV_CLEANUP_EXIT exit /b %STUB_UV_CLEANUP_EXIT%',
    'exit /b 0',
    '',
  ];
  fs.writeFileSync(uvPath, lines.join('\r\n'));
  return {
    dir,
    artifacts,
    argsFile,
    uvPath,
    env: { STUB_UV_ARGS_FILE: argsFile },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    readJson: (name) => JSON.parse(fs.readFileSync(path.join(artifacts, 'automation', name), 'utf8')),
    exists: (name) => fs.existsSync(path.join(artifacts, 'automation', name)),
    logFiles: () => {
      const logDir = path.join(artifacts, 'logs', 'auto-ingest');
      return fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
    },
    readLog: () => {
      const logDir = path.join(artifacts, 'logs', 'auto-ingest');
      return fs
        .readdirSync(logDir)
        .map((name) => fs.readFileSync(path.join(logDir, name), 'utf8'))
        .join('\n');
    },
  };
}

function runBatch(exe, sandbox, batchId, extraArgs = [], extraEnv = {}) {
  return runPs(
    exe,
    [RUN_SCRIPT, '-BatchId', batchId, '-UvPath', sandbox.uvPath, '-ArtifactsDir', sandbox.artifacts, ...extraArgs],
    { ...sandbox.env, ...extraEnv },
  );
}

test('Windows PowerShell host is available for script tests', { skip: !IS_WINDOWS }, () => {
  assert.ok(HOSTS.includes('powershell.exe'), 'powershell.exe (Windows PowerShell 5.1) must be present on Windows');
});

for (const exe of HOSTS) {
  test(`[${exe}] every .ps1 in the repo parses`, () => {
    const files = [
      path.join(REPO_ROOT, 'dev-port.ps1'),
      ...fs
        .readdirSync(path.join(REPO_ROOT, 'scripts'))
        .filter((name) => name.endsWith('.ps1'))
        .map((name) => path.join(REPO_ROOT, 'scripts', name)),
    ];
    const command =
      '$bad = 0; foreach ($f in $env:PS_FILES.Split("|")) { $t = $null; $e = $null; ' +
      '[void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e); ' +
      'foreach ($err in $e) { $bad++; "$f :: $($err.Message) :: line $($err.Extent.StartLineNumber)" } }; exit $bad';
    const result = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      env: { ...process.env, PS_FILES: files.join('|') },
    });
    assert.equal(result.status, 0, `parse errors:\n${result.stdout}${result.stderr}`);
  });

  test(`[${exe}] stderr warnings do not abort the run; success writes last-success.json`, () => {
    const sandbox = makeSandbox();
    try {
      const result = runBatch(exe, sandbox, 'official_daytime', ['-LimitPerSource', '5', '-FailFast']);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

      const uvCalls = fs.readFileSync(sandbox.argsFile, 'utf8').trim().split(/\r?\n/);
      assert.equal(uvCalls.length, 2, `expected cleanup + ingest, got: ${uvCalls.join(' | ')}`);
      assert.match(uvCalls[0], /^run arch-competition-ops cleanup-expired-competitions$/);
      assert.match(uvCalls[1], /^run arch-competition-ops ingest-batch --batch-id official_daytime --limit-per-source 5 --fail-fast$/);

      const log = sandbox.readLog();
      assert.ok(log.includes(STDERR_WARNING), 'stderr text must be captured in the log as plain text');
      assert.ok(!/NativeCommandError|CategoryInfo/.test(log), 'log must not contain PowerShell error-record decoration');
      assert.match(log, /\[OK\] Batch official_daytime completed/);

      const logName = sandbox.logFiles()[0];
      assert.match(logName, /^official_daytime-\d{8}\.log$/, 'one log per batch per day');

      const success = sandbox.readJson('last-success.json');
      assert.equal(success.batch_id, 'official_daytime');
      assert.equal(success.exit_code, 0);
      assert.equal(sandbox.exists('last-failure.json'), false);
    } finally {
      sandbox.cleanup();
    }
  });

  test(`[${exe}] non-zero ingest exit code writes last-failure.json and is returned`, () => {
    const sandbox = makeSandbox();
    try {
      const result = runBatch(exe, sandbox, 'secondary_nightly', [], { STUB_UV_INGEST_EXIT: '3' });
      assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);

      const failure = sandbox.readJson('last-failure.json');
      assert.equal(failure.batch_id, 'secondary_nightly');
      assert.equal(failure.exit_code, 3);
      assert.ok(failure.failed_steps.some((step) => step.step === 'ingest-batch' && step.exit_code === 3));
      assert.ok(fs.existsSync(failure.log_path), 'log_path must point at the real log file');
      assert.ok(Array.isArray(failure.tail) && failure.tail.some((line) => line.includes('ingest-batch stdout line')));
      assert.equal(typeof failure.event_log, 'string', 'event log outcome is recorded even when skipped');
      assert.equal(sandbox.exists('last-success.json'), false);

      // The cleanup step ran first and the stderr warning did not prevent the ingest step from running.
      const uvCalls = fs.readFileSync(sandbox.argsFile, 'utf8').trim().split(/\r?\n/);
      assert.equal(uvCalls.length, 2);
    } finally {
      sandbox.cleanup();
    }
  });

  test(`[${exe}] cleanup failure is recorded but ingestion still runs`, () => {
    const sandbox = makeSandbox();
    try {
      const result = runBatch(exe, sandbox, 'official_daytime', [], { STUB_UV_CLEANUP_EXIT: '4' });
      assert.equal(result.status, 4, `${result.stdout}\n${result.stderr}`);
      const failure = sandbox.readJson('last-failure.json');
      assert.deepEqual(
        failure.failed_steps.map((step) => step.step),
        ['cleanup-expired-competitions'],
      );
      const uvCalls = fs.readFileSync(sandbox.argsFile, 'utf8').trim().split(/\r?\n/);
      assert.equal(uvCalls.length, 2, 'ingest-batch must still be invoked after a failed cleanup');
    } finally {
      sandbox.cleanup();
    }
  });

  test(`[${exe}] success clears last-failure.json only for the same batch`, () => {
    const sandbox = makeSandbox();
    try {
      assert.equal(runBatch(exe, sandbox, 'secondary_nightly', [], { STUB_UV_INGEST_EXIT: '2' }).status, 2);
      assert.equal(sandbox.readJson('last-failure.json').batch_id, 'secondary_nightly');

      assert.equal(runBatch(exe, sandbox, 'official_daytime').status, 0);
      assert.equal(sandbox.exists('last-failure.json'), true, 'a different batch succeeding must not hide the failure');

      assert.equal(runBatch(exe, sandbox, 'secondary_nightly').status, 0);
      assert.equal(sandbox.exists('last-failure.json'), false, 'the failed batch succeeding clears the marker');
      assert.equal(sandbox.readJson('last-success.json').batch_id, 'secondary_nightly');
    } finally {
      sandbox.cleanup();
    }
  });

  test(`[${exe}] logs older than -LogRetentionDays are removed`, () => {
    const sandbox = makeSandbox();
    try {
      const logDir = path.join(sandbox.artifacts, 'logs', 'auto-ingest');
      fs.mkdirSync(logDir, { recursive: true });
      const oldLog = path.join(logDir, 'official_daytime-20200101.log');
      const freshLog = path.join(logDir, 'official_daytime-20991231.log');
      fs.writeFileSync(oldLog, 'old');
      fs.writeFileSync(freshLog, 'fresh');
      const longAgo = new Date(Date.now() - 40 * 24 * 3600 * 1000);
      fs.utimesSync(oldLog, longAgo, longAgo);

      assert.equal(runBatch(exe, sandbox, 'official_daytime', ['-LogRetentionDays', '30']).status, 0);
      assert.equal(fs.existsSync(oldLog), false);
      assert.equal(fs.existsSync(freshLog), true);
    } finally {
      sandbox.cleanup();
    }
  });

  test(`[${exe}] missing uv is reported as a failure, not a crash`, () => {
    const sandbox = makeSandbox();
    try {
      const result = runPs(exe, [
        RUN_SCRIPT,
        '-BatchId',
        'official_daytime',
        '-UvPath',
        path.join(sandbox.dir, 'does-not-exist.cmd'),
        '-ArtifactsDir',
        sandbox.artifacts,
      ]);
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const failure = sandbox.readJson('last-failure.json');
      assert.deepEqual(
        failure.failed_steps.map((step) => step.step),
        ['locate-uv'],
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test(`[${exe}] register script -WhatIf builds hardened task settings without registering`, () => {
    const prefix = `arch-test-${process.pid}-${Date.now()}`;
    const sandbox = makeSandbox();
    try {
      const install = runPs(exe, [REGISTER_SCRIPT, '-Action', 'Install', '-WhatIf', '-TaskPrefix', prefix]);
      assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);
      const lines = install.stdout.split(/\r?\n/).filter((line) => line.includes('logon='));
      assert.equal(lines.length, 3, `expected the original 3-task schedule:\n${install.stdout}`);
      for (const line of lines) {
        assert.match(line, /logon=S4U/);
        assert.match(line, /limit=PT2H/);
        assert.match(line, /multiple=IgnoreNew/);
        assert.match(line, /startWhenAvailable=True/);
        assert.match(line, /networkOnly=True/);
        assert.match(line, /restart=2x\/PT10M/);
      }
      assert.ok(!install.stdout.includes('[OK] Registered'), 'WhatIf must not register anything');

      // Show with a prefix nobody registered proves nothing leaked, and exercises the last-failure display.
      fs.mkdirSync(path.join(sandbox.artifacts, 'automation'), { recursive: true });
      fs.writeFileSync(
        path.join(sandbox.artifacts, 'automation', 'last-failure.json'),
        JSON.stringify({
          failed_at: '2026-10-21T02:30:00+00:00',
          batch_id: 'secondary_nightly',
          exit_code: 3,
          log_path: 'x.log',
          tail: ['boom line'],
        }),
      );
      const show = runPs(exe, [REGISTER_SCRIPT, '-Action', 'Show', '-TaskPrefix', prefix, '-ArtifactsDir', sandbox.artifacts]);
      assert.equal(show.status, 0, `${show.stdout}\n${show.stderr}`);
      assert.equal((show.stdout.match(/:: missing/g) || []).length, 3);
      assert.match(show.stdout, /\[FAIL\] last-failure: batch=secondary_nightly exit=3/);
      assert.match(show.stdout, /boom line/);
    } finally {
      sandbox.cleanup();
    }
  });
}
