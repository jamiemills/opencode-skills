// T226 topic fixture — JavaScript (events, data, deployment, dynamic).
//
// Carries the "API events + data + deployment + dynamic import + privacy"
// theme:
//   - Express literal routes plus an `emitter.emit` event (positive API route
//     and event) and one `process.env` route (unverified DYNAMIC diagnostic).
//   - `import('./plugins/' + name)` dynamic import (dynamic construct).
//   - Prisma schema with an explicit `@relation(fields, references)` (positive
//     data entities, keys, relation, and a declaration-backed ER edge).
//   - Dockerfile + Kubernetes Deployment (positive deployment images,
//     resource, service).
//   - package.json + package-lock.json (positive assurance manifest and lock).
//   - CI workflow (positive operations) and no governance artifacts (negative
//     governance case: complete search, no evidence -> not_detected).
//   - Privacy canaries: two token strings that must never reach findings or
//     NORMS.md.
//   - `import { KEY } from './secret.js'` so the architecture import graph has
//     a real internal edge.

export const files = {
  'package.json': JSON.stringify({
    name: 't226-js',
    version: '0.1.0',
    type: 'module',
    dependencies: { express: '^4.18.0' },
  }),
  'package-lock.json': '{ "name": "t226-js", "lockfileVersion": 3, "packages": {} }\n',
  'src/app.js': [
    "import { KEY } from './secret.js';",
    "import { run } from './dynamic.js';",
    "const USERS = '/api/users';",
    'app.get(USERS, handler);',
    "app.post('/api/users', create);",
    "app.get('/api/users/:id', read);",
    "emitter.emit('user.created');",
    'app.get(process.env.ROUTE, handler);',
    '',
  ].join('\n'),
  'src/dynamic.js': "export async function load(name) {\n  const mod = await import('./plugins/' + name);\n  return mod;\n}\n",
  'src/secret.js': 'export const KEY = "ghp_js_secret_fixture_token_99";\n',
  'prisma/schema.prisma': [
    'datasource db {',
    '  provider = "postgresql"',
    '}',
    '',
    'model User {',
    '  id     Int    @id @default(autoincrement())',
    '  email  String @unique',
    '  posts  Post[]',
    '}',
    '',
    'model Post {',
    '  id      Int    @id @default(autoincrement())',
    '  userId  Int',
    '  author  User   @relation(fields: [userId], references: [id])',
    '}',
    '',
  ].join('\n'),
  'Dockerfile': 'FROM node:20\nWORKDIR /app\nCOPY . .\nCMD ["node", "src/index.js"]\n',
  'k8s/deployment.yaml': [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: api',
    'spec:',
    '  template:',
    '    spec:',
    '      containers:',
    '        - name: api',
    '          image: registry.example/worker:1.2.3',
    '',
  ].join('\n'),
  '.github/workflows/ci.yml': [
    'name: ci',
    'on: [push]',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
  ].join('\n'),
  'README.md': 'token=js-fixture-token-abc\n',
};
