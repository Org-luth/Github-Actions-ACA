import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const workflow = name => YAML.parse(read(`.github/workflows/${name}.yml`));
const require = createRequire(import.meta.url);

test('image verifies runner downloads and contains minimal non-root runtime tools', () => {
  const dockerfile = read('Dockerfile');
  const [build, runtime] = dockerfile.split('FROM ubuntu:24.04 AS runtime');
  assert(build.startsWith('FROM ubuntu:24.04 AS build'));
  assert(build.includes('sha256sum --check -'));
  assert.equal([...dockerfile.matchAll(/^ARG RUNNER_VERSION=/gm)].length, 1);
  assert.equal([...dockerfile.matchAll(/^ARG RUNNER_SHA256=/gm)].length, 1);
  assert(runtime.includes('install -d -o runner -g runner -m 0755 /home/runner/actions-runner'));
  assert(runtime.includes('COPY --from=build --chown=runner:runner /actions-runner/ ./'));
  assert(runtime.includes('COPY --chown=runner:runner --chmod=0755 runner/entrypoint.sh ./entrypoint.sh'));
  assert(runtime.includes('USER runner'));
  for (const tool of ['ca-certificates', 'curl', 'git', 'jq']) assert(runtime.includes(tool));
  assert(!/\b(sudo|docker-ce|dockerd|docker-buildx-plugin)\b/.test(runtime));
  assert(runtime.includes('LABEL owner="luth2"'));
  assert(runtime.includes('org.opencontainers.image.authors="luth2 (https://github.com/luth2)"'));
});

test('all workflow YAML is valid and has explicit permissions; Bash commands parse', () => {
  for (const file of readdirSync(new URL('.github/workflows/', root))) {
    const document = YAML.parseDocument(read(`.github/workflows/${file}`), { uniqueKeys: true });
    assert.deepEqual(document.errors, [], file);
    const configuration = document.toJS();
    assert(configuration.permissions, file);
    for (const job of Object.values(configuration.jobs)) {
      for (const step of job.steps || []) {
        if (step.run) assert.equal(spawnSync('bash', ['-n'], { input: step.run }).status, 0, file);
      }
    }
  }
});

test('releases and image publishing exclude pull request credentials', () => {
  const release = workflow('release');
  assert(release.jobs.release.if.includes("github.event_name != 'pull_request'"));
  assert.equal(release.jobs.release.steps.at(-1).env.GITHUB_TOKEN, '${{ secrets.GITHUB_TOKEN }}');
  assert.deepEqual(release.jobs.build.needs, ['check', 'release']);
  assert(release.jobs.build.if.includes("github.event_name == 'pull_request'"));
  assert(release.jobs.build.if.includes("github.ref != 'refs/heads/main'"));
  assert(release.jobs.build.steps.find(step => step.name === 'Build linux/amd64 image').run.includes('--platform linux/amd64'));
  for (const step of release.jobs.build.steps.filter(step => /Login|Publish|Prepare registry/.test(step.name || ''))) {
    assert.equal(step.if, "needs.release.outputs.version != ''");
  }
  const publish = release.jobs.build.steps.at(-1).run;
  assert(publish.includes('"$DOCKERHUB_IMAGE" "$ACR_IMAGE"'));
  assert(publish.indexOf('$repository:$RELEASE_VERSION') < publish.indexOf('$repository:latest'));
});

test('semantic release follows Conventional Commits without npm publication', async () => {
  const configuration = require('../release.config.cjs');
  const { analyzeCommits } = await import('@semantic-release/commit-analyzer');
  for (const [message, expected] of [['feat: add ACA runner', 'minor'], ['fix(deps): update runner', 'patch'], ['docs: update README', null], ['feat!: change registration\n\nBREAKING CHANGE: new credentials', 'major']]) {
    assert.equal(await analyzeCommits({}, { commits: [{ message }], logger: { log() {} } }), expected);
  }
  assert.deepEqual(configuration.branches, ['main']);
  assert.equal(configuration.tagFormat, 'v${version}');
  assert(!configuration.plugins.includes('@semantic-release/npm'));
});

test('retry publication only reuses a published stable latest release on the same commit', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const source = read('scripts/release.mjs').replace(/^import .*;\n/gm, '');
  const execute = new AsyncFunction('semanticRelease', 'appendFileSync', 'execFileSync', 'fetch', 'process', 'console', source);
  async function run({ result = false, tags = '', latest = tags, release = { draft: false, prerelease: false }, ok = true } = {}) {
    const outputs = [];
    await execute(async () => result, (file, content) => outputs.push(content),
      (command, args) => args.includes('--points-at') ? tags : latest,
      async () => ({ ok, status: ok ? 200 : 404, json: async () => release }),
      { env: { GITHUB_OUTPUT: 'test-output', GITHUB_REPOSITORY: 'Org-luth/Github-Actions-ACA', GITHUB_TOKEN: 'test-only' } },
      { log() {} });
    return outputs.join('');
  }
  assert.equal(await run(), 'version=\n');
  assert.equal(await run({ result: { nextRelease: { version: '1.0.0' } } }), 'version=1.0.0\n');
  assert.equal(await run({ tags: 'v1.0.0' }), 'version=1.0.0\n');
  await assert.rejects(run({ tags: 'v1.0.0\nv2.0.0' }), /Multiple/);
  await assert.rejects(run({ tags: 'v1.0.0', latest: 'v2.0.0' }), /older/);
  await assert.rejects(run({ tags: 'v1.0.0', release: { draft: true } }), /stable/);
  await assert.rejects(run({ tags: 'v1.0.0', ok: false }), /HTTP 404/);
});

test('runner updates require a unique stable asset, only change build arguments and cannot downgrade', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const script = workflow('update-runner').jobs.update.steps.find(step => step.id === 'runner').with.script;
  const execute = new AsyncFunction('github', 'core', 'require', script);
  const original = read('Dockerfile');
  let content = original;
  const writes = [];
  async function run(release) {
    await execute({ rest: { repos: { getLatestRelease: async () => ({ data: release }) } } },
      { setOutput() {} },
      name => {
        assert.equal(name, 'node:fs');
        return { readFileSync: () => content, writeFileSync: (file, updated) => { assert.equal(file, 'Dockerfile'); content = updated; writes.push(updated); } };
      });
  }
  const release = { tag_name: 'v99.0.0', draft: false, prerelease: false, assets: [{ name: 'actions-runner-linux-x64-99.0.0.tar.gz', state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` }] };
  for (const invalid of [
    { ...release, draft: true }, { ...release, prerelease: true },
    { ...release, tag_name: 'invalid' }, { ...release, assets: [] },
    { ...release, assets: [{ ...release.assets[0], digest: null }] },
    { ...release, assets: [...release.assets, ...release.assets] },
  ]) await assert.rejects(run(invalid));
  assert.equal(writes.length, 0);
  await run(release);
  assert.equal(writes.length, 1);
  assert.equal(content.replace(/^ARG RUNNER_(VERSION|SHA256)=.*$/gm, ''), original.replace(/^ARG RUNNER_(VERSION|SHA256)=.*$/gm, ''));
  await run(release);
  assert.equal(writes.length, 1);
  await assert.rejects(run({ ...release, tag_name: 'v98.0.0', assets: release.assets.map(asset => ({ ...asset, name: asset.name.replace('99.0.0', '98.0.0') })) }), /downgrade/);
});

test('PR automation assigns luth2 without checking out untrusted PR code', () => {
  const assign = workflow('assign-pr');
  assert(assign.on.pull_request_target);
  assert(!assign.jobs.assign.steps.some(step => /checkout/.test(step.uses || '')));
  assert(assign.jobs.assign.steps[0].with.script.includes("assignees: ['luth2']"));
  const updatePR = workflow('update-runner').jobs.update.steps.at(-1).with;
  assert.equal(updatePR.assignees, 'luth2');
  assert(updatePR['commit-message'].startsWith('fix(deps):'));
  for (const update of YAML.parse(read('.github/dependabot.yml')).updates) assert.deepEqual(update.assignees, ['luth2']);
  assert.equal(read('.dockerignore').trim(), '*\n!Dockerfile\n!runner/\n!runner/entrypoint.sh');
});

test('documentation builds both languages and overview metadata meets Docker Hub limits', () => {
  const build = spawnSync(process.execPath, ['scripts/build-docs.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const html = read('docs/_site/index.html');
  assert(html.startsWith('<!doctype html>'));
  for (const section of ['id="english" lang="en"', 'id="deutsch" lang="de"', 'runnerScope=org', 'GH_URL', 'GITHUB_PAT']) assert(html.includes(section));
  assert(read('docs/_site/style.css').includes('overflow-wrap: anywhere'));
  const overview = workflow('dockerhub-overview').jobs.overview.steps.at(-1).with;
  assert(overview.repository.endsWith('/github-actions-runner-aca'));
  assert(overview['short-description'].length <= 100);
  assert(Buffer.byteLength(read('README.md')) < 25000);
  assert.equal(workflow('pages').jobs.publish.permissions.pages, 'write');
});