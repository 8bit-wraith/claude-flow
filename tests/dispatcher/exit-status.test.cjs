const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Run the real dispatcher copied into a disposable package. Only its selected
// CLI is replaced; no dependencies, agent runtime or npx commands are invoked.
function dispatch(script, runtime) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatcher-regression-'));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.mkdirSync(path.join(root, 'src/cli'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../../bin/claude-flow.js'), path.join(root, 'bin/claude-flow.js'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', version: '0.0.0' }));
    const runtimeBin = path.join(root, 'runtime-bin');
    fs.mkdirSync(runtimeBin);
    fs.symlinkSync(process.execPath, path.join(runtimeBin, 'node'));
    if (runtime === 'node') {
      fs.writeFileSync(path.join(root, 'src/cli/simple-cli.js'), script);
    } else {
      fs.writeFileSync(path.join(root, 'src/cli/simple-cli.ts'), '// synthetic CLI placeholder');
      // An isolated PATH guarantees that the npx case cannot invoke real npx
      // or download packages, and that tsx is absent for the fallback case.
      fs.writeFileSync(path.join(runtimeBin, runtime),
        `#!${process.execPath}\nconsole.log(${JSON.stringify('fixture-runtime:' + runtime)});\n${script}`, { mode: 0o755 });
    }
    return spawnSync(process.execPath, [path.join(root, 'bin/claude-flow.js'), 'synthetic'], {
      timeout: 10000, encoding: 'utf8', env: { ...process.env, PATH: runtimeBin }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
// Executable fixture files and POSIX signals exercise macOS/Linux behavior.
for (const runtime of ['node', 'tsx', 'npx']) {
  for (const [name, script, expected] of [
    ['success', 'process.exit(0);', 0],
    ['nonzero exit', 'process.exit(7);', 7],
    ['signal termination', "process.kill(process.pid, 'SIGTERM');", 1],
  ]) {
    test(`${runtime}: ${name}`, { skip: process.platform === 'win32' }, () => {
      const result = dispatch(script, runtime);
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, expected, result.stderr);
      if (runtime !== 'node') assert.match(result.stdout, new RegExp(`fixture-runtime:${runtime}`));
      if (runtime === 'npx') assert.match(result.stderr, /tsx execution failed/);
    });
  }
}
