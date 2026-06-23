'use strict';

function hasPathSeparator(value) {
  return /[\\/]/.test(value);
}

function platformOf(deps) {
  return (deps && deps.platform) || process.platform;
}

function hiddenOptions(platform) {
  return platform === 'win32' ? { windowsHide: true } : {};
}

function commandResolver(platform) {
  return platform === 'win32'
    ? { file: 'where', args: value => [value] }
    : { file: '/usr/bin/which', args: value => [value] };
}

function resolveAppPath(value, deps) {
  return new Promise(resolve => {
    if (!value || typeof value !== 'string') return resolve(null);
    if (hasPathSeparator(value)) return resolve(deps.fs.existsSync(value) ? value : null);
    const platform = platformOf(deps);
    const resolver = commandResolver(platform);
    deps.execFile(resolver.file, resolver.args(value), hiddenOptions(platform), (err, stdout) => {
      if (err) return resolve(null);
      const first = (stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
      resolve(first && deps.fs.existsSync(first) ? first : null);
    });
  });
}

async function launchApp(value, deps) {
  if (!value || typeof value !== 'string') return false;
  const platform = platformOf(deps);
  if (hasPathSeparator(value)) {
    const resolved = await resolveAppPath(value, deps);
    if (!resolved) return false;
    const error = await deps.shell.openPath(resolved);
    if (error && deps.log) deps.log(`openPath error: ${error}`);
    return !error;
  }
  if (platform === 'darwin') {
    deps.execFile('/usr/bin/open', ['-a', value], hiddenOptions(platform), () => {});
    return true;
  }
  const resolved = await resolveAppPath(value, deps);
  if (!resolved) return false;
  const child = deps.spawn(resolved, [], { detached: true, stdio: 'ignore', ...hiddenOptions(platform) });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}

function runShellCommand(value, deps) {
  if (!value || typeof value !== 'string') return false;
  deps.exec(value, { windowsHide: true });
  return true;
}

function lockWorkstation(deps) {
  const platform = platformOf(deps);
  if (platform === 'darwin') {
    // The old CGSession binary was removed on modern macOS. `pmset displaysleepnow` needs no special
    // permission and locks the screen when the user has "require password after sleep/screensaver" on.
    deps.execFile('/usr/bin/pmset', ['displaysleepnow'], hiddenOptions(platform), () => {});
    return true;
  }
  deps.execFile('rundll32.exe', ['user32.dll,LockWorkStation'], hiddenOptions(platform), () => {});
  return true;
}

module.exports = {
  hasPathSeparator,
  resolveAppPath,
  launchApp,
  runShellCommand,
  lockWorkstation,
};
