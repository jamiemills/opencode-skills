import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve as pathResolve } from 'node:path';

function safeExec(cmd, cwd, fallback = '') {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
  } catch {
    return fallback;
  }
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function listSourceFiles(repoPath) {
  const exts = [
    'js', 'mjs', 'cjs', 'jsx',
    'ts', 'mts', 'cts', 'tsx',
    'py', 'go', 'rs', 'rb', 'java', 'kt', 'swift', 'scala',
  ];
  const glob = exts.map((e) => `--glob '*.${e}'`).join(' ');
  const ignore =
    "--glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' " +
    "--glob '!.next' --glob '!coverage' --glob '!__pycache__' --glob '!target' " +
    "--glob '!vendor' --glob '!.venv' --glob '!venv'";
  const out = safeExec(`rg --files ${glob} ${ignore} 2>/dev/null || true`, repoPath);
  return out ? out.split('\n').filter(Boolean) : [];
}

function parseImports(filePath, repoPath) {
  const ext = filePath.split('.').pop().toLowerCase();
  let pattern;

  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'].includes(ext)) {
    pattern = "from ['\"]\\.\\.?/[^'\"]*['\"]|require\\(['\"]\\.\\.?/[^'\"]*['\"]\\)|import\\(['\"]\\.\\.?/[^'\"]*['\"]\\)";
  } else if (ext === 'py') {
    pattern = "from \\.|import \\.";
  } else if (['go', 'rs'].includes(ext)) {
    pattern = null;
  } else {
    pattern = null;
  }

  if (!pattern) {
    const out = safeExec(`rg -n "${pattern}" "${filePath}" 2>/dev/null`, repoPath);
    if (!out) return [];
    const imports = [];
    for (const line of out.split('\n').filter(Boolean)) {
      const match = line.match(/from ['"]([^'"]+)['"]/);
      if (match) {
        imports.push(match[1]);
      }
    }
    return imports;
  }

  const out = safeExec(`rg -n '${pattern}' '${filePath}' 2>/dev/null`, repoPath);
  if (!out) return [];
  const imports = [];
  for (const line of out.split('\n').filter(Boolean)) {
    let match = line.match(/from ['"]([^'"]+)['"]/);
    if (!match) match = line.match(/require\(['"]([^'"]+)['"]\)/);
    if (!match) match = line.match(/import\(['"]([^'"]+)['"]\)/);
    if (match) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function resolveRelativeImport(fromFile, importPath, repoPath) {
  const fromDir = dirname(join(repoPath, fromFile));
  const raw = join(fromDir, importPath);
  const exts = [
    '', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
    '/index.js', '/index.mjs', '/index.ts', '/index.tsx',
  ];
  for (const ext of exts) {
    const candidate = raw + ext;
    if (existsSync(candidate)) {
      return relative(repoPath, candidate);
    }
  }
  return relative(repoPath, raw);
}

function buildImportGraph(repoPath) {
  const files = listSourceFiles(repoPath);
  const graph = {};
  const reverseGraph = {};

  for (const file of files) {
    graph[file] = [];
    reverseGraph[file] = reverseGraph[file] || [];
  }

  const importRe = /from ['"]\.\.?\/[^'"]*['"]|require\(['"]\.\.?\/[^'"]*['"]\)/g;
  for (const file of files) {
    const ext = file.split('.').pop().toLowerCase();
    if (!['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py'].includes(ext)) continue;
    try {
      const content = readFileSync(join(repoPath, file), 'utf-8');
      const matches = content.match(importRe);
      if (!matches) continue;
      for (const m of matches) {
        const pathMatch = m.match(/['"](\.[^'"]+)['"]/);
        if (!pathMatch) continue;
        const resolved = resolveRelativeImport(file, pathMatch[1], repoPath);
        if (resolved && files.includes(resolved)) {
          if (!graph[file].includes(resolved)) {
            graph[file].push(resolved);
          }
          if (!reverseGraph[resolved].includes(file)) {
            reverseGraph[resolved].push(file);
          }
        }
      }
    } catch {
    }
  }

  return { graph, reverseGraph, allFiles: files };
}

function identifyLayers(repoPath, graph, reverseGraph, allFiles) {
  const pkg = readJSON(join(repoPath, 'package.json'));

  const entryDirs = ['src', 'scripts', 'bin', 'cmd', 'app', 'main'];
  const libDirs = ['lib', 'src/lib', 'pkg', 'internal', 'core', 'services', 'utils', 'common'];
  const sharedPatterns = ['util', 'helper', 'common', 'shared', 'types', 'constants', 'config'];

  const entryPoints = allFiles.filter((f) => {
    if (pkg?.main && f === pkg.main) return true;
    if (pkg?.bin && Object.values(pkg.bin).includes(f)) return true;
    if (f.endsWith('/index.js') || f.endsWith('/index.ts') || f.endsWith('/index.mjs')) return true;
    const parts = f.split('/');
    const top = parts[0];
    if (entryDirs.includes(top) && parts.length <= 2) return true;
    if (f.match(/(^|\/)(cli|main|app|index|server)\./)) return true;
    return false;
  });

  const depsOf = (f) => (graph[f] || []).length;
  const importedBy = (f) => (reverseGraph[f] || []).length;

  const libModules = allFiles.filter((f) => {
    if (entryPoints.includes(f)) return false;
    const parts = f.split('/');
    const top = parts[0];
    return libDirs.some((d) => f.startsWith(d + '/'));
  });

  const shared = allFiles.filter((f) => {
    if (entryPoints.includes(f) || libModules.includes(f)) return false;
    const name = f.split('/').pop().toLowerCase();
    return sharedPatterns.some((p) => name.includes(p)) || importedBy(f) >= 3;
  });

  const rest = allFiles.filter((f) => !entryPoints.includes(f) && !libModules.includes(f) && !shared.includes(f));

  return {
    entryPoints: entryPoints.slice(0, 10),
    libModules: libModules.slice(0, 20),
    shared: shared.slice(0, 15),
    rest: rest.slice(0, 10),
    totalFiles: allFiles.length,
    totalEdges: Object.values(graph).reduce((sum, deps) => sum + deps.length, 0),
  };
}

function generateAsciiGraph(layers) {
  const lines = [];
  const w = 64;
  const pad = (s, width) => {
    if (s.length > width - 2) return s;
    return s + ' '.repeat(width - 2 - s.length);
  };

  const box = (label, items) => {
    const result = [];
    result.push(`┌${'─'.repeat(w - 2)}┐`);
    result.push(`│  ${pad(label, w)} │`);
    if (items.length > 0) {
      const shown = items.slice(0, 8);
      for (const item of shown) {
        const name = item.split('/').pop();
        result.push(`│    ${pad(name, w - 2)} │`);
      }
      if (items.length > shown.length) {
        result.push(`│    ${pad(`... +${items.length - shown.length} more`, w - 2)} │`);
      }
    } else {
      result.push(`│    ${pad('(none detected)', w - 2)} │`);
    }
    result.push(`└${'─'.repeat(w - 2)}┘`);
    return result;
  };

  if (layers.entryPoints.length > 0) {
    lines.push(...box('Entry Points', layers.entryPoints));
    if (layers.libModules.length > 0 || layers.shared.length > 0) {
      lines.push(`${' '.repeat(Math.floor(w / 2) - 2)}│`);
      lines.push(`${' '.repeat(Math.floor(w / 2) - 2)}▼`);
    }
  }

  if (layers.libModules.length > 0) {
    const subBoxes = [];
    const chunkSize = 8;
    for (let i = 0; i < layers.libModules.length; i += chunkSize) {
      const chunk = layers.libModules.slice(i, i + chunkSize);
      const result = [];
      result.push(`┌${'─'.repeat(28)}┐`);
      result.push(`│ ${pad('Core Modules', 28)} │`);
      for (const item of chunk) {
        const name = item.split('/').pop();
        result.push(`│   ${pad(name, 26)} │`);
      }
      result.push(`└${'─'.repeat(28)}┘`);
      subBoxes.push(result);
    }

    if (subBoxes.length === 1) {
      const boxLines = subBoxes[0];
      const leftPad = Math.floor((w - 30) / 2);
      for (const bl of boxLines) {
        lines.push(' '.repeat(leftPad) + bl);
      }
    } else if (subBoxes.length === 2) {
      const maxLines = Math.max(subBoxes[0].length, subBoxes[1].length);
      for (let i = 0; i < maxLines; i++) {
        const l1 = subBoxes[0][i] || ' '.repeat(30);
        const l2 = subBoxes[1][i] || ' '.repeat(30);
        lines.push(`   ${l1}   ${l2}`);
      }
    } else {
      for (const sb of subBoxes) {
        const leftPad = Math.floor((w - 30) / 2);
        for (const bl of sb.slice(0, 3)) {
          lines.push(' '.repeat(leftPad) + bl);
        }
        lines.push(' '.repeat(leftPad) + `│ ... (${sb.length - 3} more entries) │`.padEnd(30, '─'));
      }
    }

    if (layers.shared.length > 0) {
      lines.push(`${' '.repeat(Math.floor(w / 2) - 2)}│`);
      lines.push(`${' '.repeat(Math.floor(w / 2) - 2)}▼`);
    }
  }

  if (layers.shared.length > 0) {
    lines.push(...box('Shared Utilities', layers.shared));
  }

  if (layers.rest.length > 0) {
    lines.push(`${' '.repeat(Math.floor(w / 2) - 2)}│`);
    lines.push(`${' '.repeat(Math.floor(w / 2) - 2)}▼`);
    lines.push(...box('Other Modules', layers.rest));
  }

  if (lines.length === 0) {
    return '_(No module graph detected — insufficient source files for analysis)_';
  }

  return lines.join('\n');
}

function escapeMermaid(s) {
  return String(s).replace(/["()]/g, '').replace(/[\[\]<>]/g, '');
}

function generateC4Context(repoName, pkg, layers) {
  const name = escapeMermaid(pkg?.name || repoName);
  const desc = escapeMermaid(pkg?.description || 'Application');
  const dbFromDeps = detectDatabases(pkg);
  const apiFromDeps = detectExternalApis(pkg);

  const lines = [];
  lines.push('C4Context');
  lines.push(`  title System Context — ${repoName}`);
  lines.push('  Person(user, "User", "Interacts with the system")');

  if (existsSync(join(layers._repoPath || '', 'Dockerfile'))) {
    lines.push(`  System(app, "${name}", "${desc}")`);
  } else {
    const framework = detectFramework(pkg) || 'Node.js';
    lines.push(`  System(app, "${name}", "${desc}")`);
  }

  if (dbFromDeps.length > 0) {
    for (const db of dbFromDeps.slice(0, 2)) {
      lines.push(`  System_Ext(${db.id}, "${db.label}", "${db.desc}")`);
    }
  } else {
    lines.push('  System_Ext(fs, "File System", "Local files and config")');
  }

  if (apiFromDeps.length > 0) {
    for (const api of apiFromDeps.slice(0, 2)) {
      lines.push(`  System_Ext(${api.id}, "${api.label}", "${api.desc}")`);
    }
  }

  lines.push('  Rel(user, app, "Uses")');
  if (dbFromDeps.length > 0) {
    for (const db of dbFromDeps.slice(0, 2)) {
      lines.push(`  Rel(app, ${db.id}, "${db.relation}")`);
    }
  } else {
    lines.push('  Rel(app, fs, "Reads/Writes")');
  }
  if (apiFromDeps.length > 0) {
    for (const api of apiFromDeps.slice(0, 2)) {
      lines.push(`  Rel(app, ${api.id}, "${api.relation}")`);
    }
  }

  return '```mermaid\n' + lines.join('\n') + '\n```';
}

function generateC4Container(repoName, pkg, layers) {
  const name = escapeMermaid(pkg?.name || repoName);
  const desc = escapeMermaid(pkg?.description || 'Application');
  const dbFromDeps = detectDatabases(pkg);

  const lines = [];
  lines.push('C4Container');
  lines.push(`  title Containers — ${repoName}`);

  if (layers.entryPoints.length > 0) {
    const epNames = layers.entryPoints.slice(0, 3).map((f) => f.split('/').pop().replace(/\.[^.]+$/, ''));
    const epLabel = epNames.join(', ');
    lines.push(`  Container(entry, "Entry Points", "Node.js", "${escapeMermaid(epLabel)}")`);
  }

  if (layers.libModules.length > 0) {
    const count = layers.libModules.length;
    lines.push(`  Container(lib, "Core Modules", "Node.js", "${count} modules")`);
  }

  if (layers.shared.length > 0) {
    const count = layers.shared.length;
    lines.push(`  Container(shared, "Shared Utilities", "Node.js", "${count} modules")`);
  }

  if (dbFromDeps.length > 0) {
    for (const db of dbFromDeps.slice(0, 2)) {
      lines.push(`  ContainerDb(${db.id}, "${db.label}", "${db.desc}")`);
    }
  } else {
    lines.push('  ContainerDb(fs, "File System", "Local storage")');
  }

  if (layers.entryPoints.length > 0 && layers.libModules.length > 0) {
    lines.push('  Rel(entry, lib, "Uses")');
  }
  if (layers.libModules.length > 0 && layers.shared.length > 0) {
    lines.push('  Rel(lib, shared, "Uses")');
  }
  if (layers.entryPoints.length > 0 && layers.shared.length > 0) {
    lines.push('  Rel(entry, shared, "Uses")');
  }

  return '```mermaid\n' + lines.join('\n') + '\n```';
}

function generateC4Component(repoName, pkg, layers) {
  const lines = [];
  lines.push('C4Component');

  const mainModule = layers.libModules.length > 0
    ? dirnameRelative(layers.libModules[0])
    : layers.entryPoints.length > 0
      ? dirnameRelative(layers.entryPoints[0])
      : 'src';

  lines.push(`  title Components — ${mainModule}/`);

  const shownModules = layers.libModules.slice(0, 8);
  const shownShared = layers.shared.slice(0, 5);

  for (let i = 0; i < shownModules.length; i++) {
    const mod = shownModules[i];
    const cName = mod.replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
    const label = mod.split('/').pop().replace(/\.[^.]+$/, '');
    lines.push(`  Component(${cName}, "${escapeMermaid(label)}", "${escapeMermaid(mod)}")`);
  }

  for (let i = 0; i < shownShared.length; i++) {
    const mod = shownShared[i];
    const cName = mod.replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
    const label = mod.split('/').pop().replace(/\.[^.]+$/, '');
    lines.push(`  Component(${cName}, "${escapeMermaid(label)}", "${escapeMermaid(mod)}")`);
  }

  for (let i = 0; i < shownModules.length; i++) {
    for (let j = i + 1; j < Math.min(i + 2, shownModules.length); j++) {
      const a = shownModules[i].replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
      const b = shownModules[j].replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');
      lines.push(`  Rel(${a}, ${b}, "May use")`);
    }
  }

  return '```mermaid\n' + lines.join('\n') + '\n```';
}

function dirnameRelative(file) {
  if (!file) return '';
  const idx = file.lastIndexOf('/');
  return idx >= 0 ? file.slice(0, idx) : '';
}

function extractExports(repoPath, files, maxFiles = 5) {
  const allExports = [];
  for (const file of files.slice(0, maxFiles)) {
    const ext = file.split('.').pop().toLowerCase();
    if (!['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'].includes(ext)) continue;

    try {
      const fullPath = join(repoPath, file);
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      const exports = [];
      for (const line of lines) {
        let m;

        m = line.match(/export\s+(async\s+)?function\s+(\w+)/);
        if (m) { exports.push({ kind: 'function', name: m[2] }); continue; }

        m = line.match(/export\s+(async\s+)?class\s+(\w+)/);
        if (m) { exports.push({ kind: 'class', name: m[2] }); continue; }

        m = line.match(/export\s+(const|let|var)\s+(\w+)\s*=/);
        if (m) { exports.push({ kind: 'variable', name: m[2] }); continue; }

        m = line.match(/export\s+(type|interface)\s+(\w+)/);
        if (m) { exports.push({ kind: 'type', name: m[2] }); continue; }

        m = line.match(/export\s+enum\s+(\w+)/);
        if (m) { exports.push({ kind: 'enum', name: m[2] }); continue; }

        m = line.match(/export\s+default\s+(async\s+)?function\s+(\w+)/);
        if (m) { exports.push({ kind: 'default-function', name: m[2] }); continue; }

        m = line.match(/export\s+default\s+class\s+(\w+)/);
        if (m) { exports.push({ kind: 'default-class', name: m[2] }); continue; }

        m = line.match(/module\.exports\s*=\s*(\w+)/);
        if (m) { exports.push({ kind: 'cjs-export', name: m[1] }); continue; }
      }

      if (exports.length > 0) {
        allExports.push({ file, exports: exports.slice(0, 12) });
      }
    } catch {}
  }

  return allExports;
}

function generateC4Code(repoName, pkg, layers) {
  const repoPath = layers._repoPath || '';
  if (!repoPath) return '_(No source path available for code-level diagram)_';

  const modules = [...layers.coreModules || layers.libModules || [], ...layers.shared || []].slice(0, 3);
  if (modules.length === 0) return '_(No modules detected for code-level diagram)_';

  const exports = extractExports(repoPath, modules, 3);
  if (exports.length === 0 || exports.every((e) => e.exports.length === 0)) {
    return '_(No exports detected for code-level diagram)_';
  }

  const lines = [];
  lines.push('C4Code');

  for (const mod of exports) {
    const simpleName = mod.file.split('/').pop().replace(/\.[^.]+$/, '');
    const cName = mod.file.replace(/[/.]/g, '_').replace(/^_+|_+$/g, '');

    lines.push(`  title ${escapeMermaid(simpleName)} — ${repoName}`);
    lines.push(`  Component(${cName}, "${escapeMermaid(simpleName)}", "${escapeMermaid(mod.file)}")`);

    let funcCount = 0;
    for (const exp of mod.exports.slice(0, 10)) {
      const expId = `${cName}_${exp.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
      const iconMap = {
        'function': 'F',
        'class': 'C',
        'variable': 'V',
        'type': 'T',
        'enum': 'E',
        'default-function': 'DF',
        'default-class': 'DC',
        'cjs-export': 'X',
      };
      const icon = iconMap[exp.kind] || '?';
      lines.push(`  ${exp.kind === 'class' || exp.kind === 'default-class' ? 'Class' : 'Func'}(${expId}, "${escapeMermaid(exp.name)}", "${icon}")`);
      lines.push(`  BiRel(${cName}, ${expId}, "exports")`);
      funcCount++;
    }

    if (mod.exports.length > funcCount) {
      lines.push(`  Func(${cName}_more, "... ${mod.exports.length - funcCount} more", "…")`);
      lines.push(`  BiRel(${cName}, ${cName}_more, "exports")`);
    }
  }

  return '```mermaid\n' + lines.join('\n') + '\n```';
}

function detectDatabases(pkg) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const dbs = [];
  const dbPackages = {
    pg: { label: 'PostgreSQL', desc: 'Relational database', rel: 'Queries' },
    mysql: { label: 'MySQL', desc: 'Relational database', rel: 'Queries' },
    mysql2: { label: 'MySQL', desc: 'Relational database', rel: 'Queries' },
    sqlite3: { label: 'SQLite', desc: 'Embedded database', rel: 'Reads/Writes' },
    'better-sqlite3': { label: 'SQLite', desc: 'Embedded database', rel: 'Reads/Writes' },
    mongodb: { label: 'MongoDB', desc: 'Document database', rel: 'Queries' },
    mongoose: { label: 'MongoDB', desc: 'Document database', rel: 'Queries' },
    redis: { label: 'Redis', desc: 'In-memory cache', rel: 'Caches' },
    ioredis: { label: 'Redis', desc: 'In-memory cache', rel: 'Caches' },
    '@prisma/client': { label: 'Database (Prisma)', desc: 'ORM-managed', rel: 'Reads/Writes' },
    typeorm: { label: 'Database (TypeORM)', desc: 'ORM-managed', rel: 'Reads/Writes' },
    drizzle: { label: 'Database (Drizzle)', desc: 'ORM-managed', rel: 'Reads/Writes' },
    knex: { label: 'Database (Knex)', desc: 'SQL builder', rel: 'Queries' },
  };
  for (const [pkgName, info] of Object.entries(dbPackages)) {
    if (deps[pkgName]) {
      dbs.push({
        id: pkgName.replace(/[^a-z0-9]/gi, ''),
        label: info.label,
        desc: info.desc,
        relation: info.rel,
      });
    }
  }
  return dbs;
}

function detectExternalApis(pkg) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const apis = [];
  const apiPackages = {
    '@anthropic-ai/sdk': { label: 'Anthropic API', desc: 'AI provider', rel: 'Calls' },
    openai: { label: 'OpenAI API', desc: 'AI provider', rel: 'Calls' },
    axios: { label: 'HTTP APIs', desc: 'External services', rel: 'Calls' },
    'node-fetch': { label: 'HTTP APIs', desc: 'External services', rel: 'Calls' },
    got: { label: 'HTTP APIs', desc: 'External services', rel: 'Calls' },
    undici: { label: 'HTTP APIs', desc: 'External services', rel: 'Calls' },
    'google-cloud': { label: 'GCP', desc: 'Cloud services', rel: 'Calls' },
    'aws-sdk': { label: 'AWS', desc: 'Cloud services', rel: 'Calls' },
    '@aws-sdk/client': { label: 'AWS', desc: 'Cloud services', rel: 'Calls' },
    'slack-bolt': { label: 'Slack', desc: 'Messaging platform', rel: 'Sends' },
    '@slack/web-api': { label: 'Slack', desc: 'Messaging platform', rel: 'Calls' },
    stripe: { label: 'Stripe', desc: 'Payment processing', rel: 'Calls' },
    'github-api': { label: 'GitHub API', desc: 'Version control', rel: 'Calls' },
    octokit: { label: 'GitHub API', desc: 'Version control', rel: 'Calls' },
  };
  for (const [pkgName, info] of Object.entries(apiPackages)) {
    if (deps[pkgName]) {
      apis.push({
        id: pkgName.replace(/[^a-z0-9]/gi, ''),
        label: info.label,
        desc: info.desc,
        relation: info.rel,
      });
    }
  }
  return apis;
}

function detectFramework(pkg) {
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const names = Object.keys(deps);
  if (names.includes('next')) return 'Next.js';
  if (names.includes('react')) return 'React';
  if (names.includes('vue')) return 'Vue';
  if (names.includes('express')) return 'Express';
  if (names.includes('fastify')) return 'Fastify';
  return null;
}

export async function scan(repoPath, overview) {
  const pkg = readJSON(join(repoPath, 'package.json'));
  const { graph, reverseGraph, allFiles } = buildImportGraph(repoPath);

  const layers = identifyLayers(repoPath, graph, reverseGraph, allFiles);
  layers._repoPath = repoPath;

  const asciiGraph = generateAsciiGraph(layers);
  const c4Context = generateC4Context(
    repoPath.split('/').filter(Boolean).pop() || 'repo',
    pkg,
    layers,
  );
  const c4Container = generateC4Container(
    repoPath.split('/').filter(Boolean).pop() || 'repo',
    pkg,
    layers,
  );
  const c4Component = generateC4Component(
    repoPath.split('/').filter(Boolean).pop() || 'repo',
    pkg,
    layers,
  );
  const c4Code = generateC4Code(
    repoPath.split('/').filter(Boolean).pop() || 'repo',
    pkg,
    layers,
  );

  const signal = allFiles.length > 20 ? 'high' : allFiles.length > 5 ? 'medium' : 'low';

  return {
    dimension: 'architecture',
    signal,
    findings: {
      modules: allFiles,
      layers,
      asciiGraph,
      c4Context,
      c4Container,
      c4Component,
      c4Code,
      importGraph: { graph, reverseGraph },
    },
  };
}
