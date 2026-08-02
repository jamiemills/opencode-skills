import { execSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { statSync } from 'node:fs';

function safeExec(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

function countFiles(repoPath) {
  const output = safeExec(
    `rg --files --no-ignore --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!.next' 2>/dev/null || true`,
    repoPath,
  );
  const files = output.trim().split('\n').filter(Boolean);
  const counts = {};
  for (const f of files) {
    const ext = f.includes('.') ? f.split('.').pop().toLowerCase() : 'no-ext';
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return { counts, total: files.length };
}

function buildTree(repoPath) {
  const maxDepth = 4;
  const output = safeExec(
    `find . -maxdepth ${maxDepth} \\( -name node_modules -o -name .git -o -name dist -o -name build -o -name .next -o -name coverage -o -name __pycache__ \\) -prune -o -print 2>/dev/null | sort`,
    repoPath,
  );

  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return '';

  const childrenMap = new Map();
  for (const line of lines) {
    const parts = line.split('/');
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join('/');
      if (!childrenMap.has(key)) {
        childrenMap.set(key, []);
      }
      if (i + 1 < parts.length) {
        const child = parts.slice(0, i + 2).join('/');
        const children = childrenMap.get(key);
        if (!children.includes(child)) {
          children.push(child);
        }
      }
    }
  }

  function render(key, prefix) {
    const children = childrenMap.get(key);
    if (!children || children.length === 0) return '';
    let out = '';
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isLast = i === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childName = child.includes('/') ? child.split('/').pop() : child;
      const isDir = childrenMap.has(child) && childrenMap.get(child).length > 0;
      const displayName = isDir ? `${childName}/` : childName;
      out += `${prefix}${connector}${displayName}\n`;
      if (isDir) {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        out += render(child, childPrefix);
      }
    }
    return out;
  }

  const rootName = repoPath.split('/').filter(Boolean).pop();
  let tree = `${rootName}/\n`;
  tree += render('.', '');
  return tree.trimEnd();
}

function topLevelDirs(repoPath) {
  const output = safeExec(
    `find . -maxdepth 1 -type d -not -path '*/\\.*' -not -path '.' | sort`,
    repoPath,
  );
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((d) => d.replace(/^\.\//, ''));
}

export async function scan(repoPath, overview) {
  const { counts, total } = countFiles(repoPath);
  const tree = buildTree(repoPath);
  const topDirs = topLevelDirs(repoPath);

  let depth = 0;
  const treeLines = tree.split('\n');
  for (const line of treeLines) {
    const indent = line.search(/\S/) / 4;
    if (indent > depth) depth = indent;
  }

  const signal = total > 100 ? 'high' : total > 20 ? 'medium' : 'low';

  return {
    dimension: 'structure',
    signal,
    findings: {
      tree,
      fileCounts: counts,
      totalFiles: total,
      topDirs,
      depth,
    },
  };
}
