import { lstat, opendir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { PLUGIN_LIMITS, PluginSchemaError, validatePlugins } from './schema.mjs';

export class PluginLoaderError extends TypeError {
  constructor(code, message) {
    super(`Plugin loading failed: ${message}`);
    this.name = 'PluginLoaderError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PluginLoaderError(code, message);
}

function contained(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

async function metadata(path, kind) {
  try {
    return await lstat(path);
  } catch {
    fail('FILESYSTEM', `${kind} could not be inspected`);
  }
}

async function canonical(path, kind) {
  try {
    return await realpath(path);
  } catch {
    fail('FILESYSTEM', `${kind} could not be resolved`);
  }
}

async function directory(path, kind) {
  const info = await metadata(path, kind);
  if (info.isSymbolicLink()) fail('SYMLINK', `${kind} must not be a symbolic link`);
  if (!info.isDirectory()) fail('INVALID_LAYOUT', `${kind} must be a directory`);
  return info;
}

async function scanNames(path, kind, limit) {
  let dir;
  try {
    dir = await opendir(path);
  } catch {
    fail('FILESYSTEM', `${kind} could not be enumerated`);
  }
  const names = [];
  try {
    while (names.length < limit) {
      let entry;
      try {
        entry = await dir.read();
      } catch {
        fail('FILESYSTEM', `${kind} could not be enumerated`);
      }
      if (entry === null) return names;
      names.push(entry.name);
    }
    return names;
  } finally {
    try {
      await dir.close();
    } catch {
      // enumeration already consumed or failed; the error is reported above
    }
  }
}

function ensureDirect(parent, child, kind) {
  if (relative(parent, child).split(sep).length !== 1 || !contained(parent, child)) {
    fail('CONTAINMENT', `${kind} is outside its trusted direct parent`);
  }
}

async function readPluginFile(pluginRoot, pluginsRealRoot) {
  const children = await scanNames(pluginRoot, 'plugin directory', 2);
  if (children.length !== 1 || children[0] !== 'plugin.json') {
    fail('INVALID_LAYOUT', 'plugin directory must contain only direct plugin.json');
  }
  const file = join(pluginRoot, 'plugin.json');
  ensureDirect(pluginRoot, file, 'plugin file');
  const before = await metadata(file, 'plugin file');
  if (before.isSymbolicLink()) fail('SYMLINK', 'plugin file must not be a symbolic link');
  if (!before.isFile()) fail('INVALID_LAYOUT', 'plugin file must be a regular file');
  if (before.size > PLUGIN_LIMITS.fileBytes) fail('FILE_TOO_LARGE', 'plugin file exceeds the byte limit');
  const realFile = await canonical(file, 'plugin file');
  if (!contained(pluginsRealRoot, realFile) || realFile !== file) {
    fail('CONTAINMENT', 'plugin file is outside the trusted plugin root');
  }
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    fail('FILESYSTEM', 'plugin file could not be read');
  }
  if (bytes.length > PLUGIN_LIMITS.fileBytes) fail('FILE_TOO_LARGE', 'plugin file exceeds the byte limit');
  const after = await metadata(file, 'plugin file');
  const realAfter = await canonical(file, 'plugin file');
  if (after.isSymbolicLink() || !after.isFile() || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || realAfter !== realFile) {
    fail('FILESYSTEM_CHANGED', 'plugin file changed while it was being read');
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('MALFORMED_JSON', 'plugin file is not valid JSON');
  }
}

export async function loadPlugins({ skillRoot } = {}) {
  if (typeof skillRoot !== 'string' || skillRoot.length === 0 || skillRoot.includes('\0')
      || !isAbsolute(skillRoot) || resolve(skillRoot) !== skillRoot) {
    fail('INVALID_ROOT', 'skillRoot must be a normalized absolute path');
  }
  await directory(skillRoot, 'skill root');
  const realSkillRoot = await canonical(skillRoot, 'skill root');
  if (realSkillRoot !== skillRoot) fail('SYMLINK', 'skill root must not traverse symbolic links');

  const pluginsRoot = join(skillRoot, 'plugins');
  ensureDirect(skillRoot, pluginsRoot, 'plugin root');
  let pluginsInfo;
  try {
    pluginsInfo = await lstat(pluginsRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return validatePlugins([]);
    fail('FILESYSTEM', 'plugin root could not be inspected');
  }
  if (pluginsInfo.isSymbolicLink()) fail('SYMLINK', 'plugin root must not be a symbolic link');
  if (!pluginsInfo.isDirectory()) fail('INVALID_LAYOUT', 'plugin root must be a directory');
  const pluginsRealRoot = await canonical(pluginsRoot, 'plugin root');
  if (!contained(realSkillRoot, pluginsRealRoot) || pluginsRealRoot !== pluginsRoot) {
    fail('CONTAINMENT', 'plugin root is outside the trusted skill root');
  }

  const pluginNames = (await scanNames(pluginsRoot, 'plugin root', PLUGIN_LIMITS.plugins + 1))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (pluginNames.length > PLUGIN_LIMITS.plugins) fail('PLUGIN_LIMIT', 'plugin count exceeds the limit');

  const loaded = [];
  for (const name of pluginNames) {
    const pluginRoot = join(pluginsRoot, name);
    ensureDirect(pluginsRoot, pluginRoot, 'plugin directory');
    await directory(pluginRoot, 'plugin directory');
    const realPluginRoot = await canonical(pluginRoot, 'plugin directory');
    if (!contained(pluginsRealRoot, realPluginRoot) || realPluginRoot !== pluginRoot) {
      fail('CONTAINMENT', 'plugin directory is outside the trusted plugin root');
    }
    const parsed = await readPluginFile(pluginRoot, pluginsRealRoot);
    let plugin;
    try {
      [plugin] = validatePlugins([parsed]);
    } catch (error) {
      if (error instanceof PluginSchemaError) fail(error.code, 'plugin schema validation failed');
      throw error;
    }
    if (name !== plugin.id) fail('DIRECTORY_ID_MISMATCH', 'plugin directory name must equal its identifier');
    loaded.push(plugin);
  }

  try {
    return validatePlugins(loaded);
  } catch (error) {
    if (error instanceof PluginSchemaError) fail(error.code, 'plugin registry validation failed');
    throw error;
  }
}
