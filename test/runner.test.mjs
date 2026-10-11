import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = readFileSync(new URL('../runner/entrypoint.sh', import.meta.url), 'utf8');

function run(overrides = {}, stale = false) {
  const directory = mkdtempSync(join(tmpdir(), 'aca-runner-test-'));
  mkdirSync(join(directory, 'bin'));
  const executable = (path, content) => writeFileSync(join(directory, path), content, { mode: 0o755 });
  executable('entrypoint.sh', source);
  executable('bin/curl', `#!/usr/bin/env bash
set -eu
[[ -z "\${GITHUB_PAT+x}" ]]
authorization="$(cat)"
[[ "$authorization" == 'header = "Authorization: Bearer test-only-pat"' ]]
printf '%s\\n' "$@" > curl-args
if [[ "\${HTTP_FAILURE:-0}" == 1 ]]; then exit 22; fi
printf '%s' "$RESPONSE"
`);
  executable('config.sh', `#!/usr/bin/env bash
set -eu
[[ -z "\${GITHUB_PAT+x}" ]]
printf '%s\\n' "$@" > config-args
exit "\${CONFIG_EXIT:-0}"
`);
  executable('run.sh', `#!/usr/bin/env bash
set -eu
[[ -z "\${GITHUB_PAT+x}" ]]
printf 'RUNNER_STARTED\\n'
exit "\${RUN_EXIT:-0}"
`);
  if (stale) writeFileSync(join(directory, '.runner'), '{}');
  const environment = {
    PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
    GH_URL: 'https://github.com/Org-luth',
    GITHUB_PAT: 'test-only-pat',
    RUNNER_NAME: 'aca-test',
    RESPONSE: '{"token":"registration-test-token"}',
    ...overrides,
  };
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete environment[name];
  }
  try {
    const result = spawnSync('bash', [join(directory, 'entrypoint.sh')], { cwd: directory, env: environment, encoding: 'utf8' });
    const read = path => {
      try { return readFileSync(join(directory, path), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    };
    return { ...result, configuration: read('config-args'), request: read('curl-args') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('startup registers an organization runner for one job without exposing the PAT to child processes', () => {
  assert.equal(spawnSync('bash', ['-n'], { input: source }).status, 0);
  const result = run({ RUNNER_GROUP: 'Trusted CI', RUNNER_LABELS: 'aca,org-luth' });
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes('RUNNER_STARTED'));
  assert(result.request.includes('https://api.github.com/orgs/Org-luth/actions/runners/registration-token'));
  assert(!result.request.includes('test-only-pat'));
  for (const argument of ['--ephemeral', '--disableupdate', '--unattended', '--runnergroup', 'Trusted CI', 'aca,org-luth']) {
    assert(result.configuration.split('\n').includes(argument), argument);
  }
  assert(!result.configuration.includes('--replace'));
  assert(!result.stdout.includes('registration-test-token'));
});

test('startup rejects missing credentials, repository URLs, invalid names and stale registrations', () => {
  for (const overrides of [
    { GH_URL: undefined }, { GITHUB_PAT: undefined },
    { GH_URL: 'https://github.com/Org-luth/repository' },
    { GH_URL: 'https://attacker.example/Org-luth' },
    { GITHUB_PAT: 'test-only-pat\nheader = other' },
    { RUNNER_NAME: 'invalid name' }, { RUNNER_LABELS: 'aca, invalid' },
  ]) {
    const result = run(overrides);
    assert.notEqual(result.status, 0);
    assert.equal(result.configuration, '');
    assert.equal(result.request, '');
  }
  const stale = run({}, true);
  assert.notEqual(stale.status, 0);
  assert.equal(stale.request, '');
});

test('HTTP and JSON failures cannot reach runner configuration', () => {
  for (const overrides of [{ HTTP_FAILURE: '1' }, { RESPONSE: '{"token":null}' }, { RESPONSE: '{}' }, { RESPONSE: '{"token":""}' }, { RESPONSE: 'invalid JSON' }]) {
    const result = run(overrides);
    assert.notEqual(result.status, 0);
    assert.equal(result.configuration, '');
    assert(!result.stdout.includes('RUNNER_STARTED'));
  }
});

test('registration and runner failures preserve their exit status', () => {
  const registration = run({ CONFIG_EXIT: '17' });
  assert.equal(registration.status, 17);
  assert(!registration.stdout.includes('RUNNER_STARTED'));
  assert.equal(run({ RUN_EXIT: '23' }).status, 23);
});

test('runner names are generated when not supplied', () => {
  const result = run({ RUNNER_NAME: undefined });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.configuration, /--name\naca-[A-Za-z0-9._-]+\n/);
});