export const manifest = "package.json";

export const files = {
  "package.json": `{
  "name": "demo",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "workspaces": [
    "packages/*"
  ],
  "dependencies": {
    "express": "^4.18.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  },
  "scripts": {
    "test": "jest"
  }
}
`,
  "src/index.js": `import { greet } from './util.js';


export function run() {
  return greet();
}
`,
  "src/util.js": `export function greet() {
  return 'hello';
}
`,
  "src/index.test.js": `import { greet } from './util.js';

test('greet returns hello', () => {
  expect(greet()).toBe('hello');
});
`,
  "src/util.spec.js": `import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from './util.js';

test('greet returns hello with node:test', () => {
  assert.equal(greet(), 'hello');
});
`,
  "packages/app/package.json": `{
  "name": "@demo/app",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js"
}
`,
  "packages/app/src/index.js": `import { workspaceGreeting } from '@demo/shared';

export const message = workspaceGreeting;
`,
  "packages/shared/package.json": `{
  "name": "@demo/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js"
}
`,
  "packages/shared/src/index.js": `export const workspaceGreeting = 'workspace hello';
`,
  "eslint.config.ts": `export default [];
`,
  ".eslintrc.json": `{
  "env": {
    "node": true,
    "es2022": true
  },
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  }
}
`,
  "node_modules/x/index.js": `module.exports = 'noise';
`,
  "dist/bundle.js": `!function(){console.log('built')}();
`,
};

const parityPackage = {
  ...JSON.parse(files["package.json"]),
  engines: { node: ">=20" },
};

export const parityFiles = {
  ...files,
  "package.json": `${JSON.stringify(parityPackage, null, 2)}\n`,
  "bun.lock": `lockfileVersion = 1
`,
};
