export const manifest = 'package.json';

export const files = {
  'package.json': `{
  "name": "demo-ts",
  "version": "0.1.0",
  "dependencies": {
    "typescript": "^5.0.0"
  }
}
`,
  'tsconfig.json': `{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "baseUrl": ".",
    "paths": {
      "@app/*": ["src/*"]
    },
    "declaration": true,
    "composite": true
  },
  "references": [
    { "path": "./packages/shared" }
  ],
  "include": ["src/**/*.ts"]
}
`,
  'src/index.ts': `import type { Greeting } from './types';
import { f } from '@app/util';

export function run(): Greeting {
  return f();
}
`,
  'src/util.ts': `export function f(): string {
  return 'hello';
}
`,
  'src/types.ts': `export type Greeting = string;
`,
  'src/public.d.ts': `export declare const ambientGreeting: string;
`,
  'packages/shared/tsconfig.json': `{
  "compilerOptions": {
    "composite": true,
    "declaration": true
  }
}
`,
  'packages/shared/index.ts': `export const shared = 'shared';
`,
  'eslint.config.ts': `export default [];
`,
  'src/index.spec.ts': `import { f } from './util';

describe('util', () => {
  it('f returns hello', () => {
    expect(f()).toBe('hello');
  });
});
`,
  'dist/out.js': `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
console.log('built');
`,
};
