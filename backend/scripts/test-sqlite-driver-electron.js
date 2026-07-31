const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

if (process.env.KHA_SQLITE_ELECTRON_CHILD === '1') {
  require('./test-sqlite-driver');
} else {
  const electron = process.platform === 'win32'
    ? path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'electron.cmd')
    : path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'electron');
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kha-electron-sqlite-')), 'report.json');
  const result = spawnSync(electron, [__filename], {
    cwd: path.resolve(__dirname, '..', '..'),
    // Electron executes this script with its embedded Node runtime. This is
    // the runtime used by the packaged backend, not the system Node binary.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', KHA_SQLITE_ELECTRON_CHILD: '1', KHA_SQLITE_DRIVER_OUTPUT: output },
    encoding: 'utf8',
    timeout: 30000,
    shell: process.platform === 'win32',
  });
  try {
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `Electron exited with ${result.status}`);
    if (!fs.existsSync(output)) throw new Error('Electron did not produce the SQLite driver report');
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (!report.electron) throw new Error('SQLite driver was not executed by Electron runtime');
    console.log(JSON.stringify(report));
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
}
