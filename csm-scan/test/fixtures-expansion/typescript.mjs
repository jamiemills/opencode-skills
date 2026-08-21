// T226 topic fixture — TypeScript (reflection, data, deployment).
//
// Carries the "API + reflection/dynamic + data + deployment" theme:
//   - A NestJS decorator route (positive API) plus `Reflect.getMetadata`
//     reflection and an `import()` dynamic import (dynamic constructs).
//   - Prisma schema with an explicit `@relation(fields, references)` (positive
//     data entities, keys, relation, and a declaration-backed ER edge).
//   - Terraform declarations (positive deployment resources).
//   - package.json + tsconfig.json (assurance manifest).
//   - No governance artifacts (negative governance case -> not_detected).
//   - A password canary that must never reach findings or NORMS.md.
//   - A relative `./app.service` import so the architecture import graph has a
//     real internal edge.

export const files = {
  "package.json": JSON.stringify({
    name: "t226-ts",
    version: "0.1.0",
    type: "module",
    dependencies: { "@nestjs/core": "^10.0.0" },
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, target: "ES2020", module: "commonjs" },
    include: ["src"],
  }),
  "src/app.controller.ts": [
    "import { AppService } from './app.service';",
    "@Get('/api/health')",
    "health() {}",
    "",
  ].join("\n"),
  "src/app.service.ts": [
    "@Injectable()",
    "export class AppService {",
    "  constructor() {",
    '    Reflect.getMetadata("design:paramtypes", this);',
    "  }",
    '  getHello() { return "hello"; }',
    "}",
    "",
  ].join("\n"),
  "src/dynamic.ts":
    "export async function load(name: string) {\n  const mod = await import('./feature/' + name);\n  return mod;\n}\n",
  "prisma/schema.prisma": [
    "datasource db {",
    '  provider = "postgresql"',
    "}",
    "",
    "model Account {",
    "  id      Int    @id @default(autoincrement())",
    "  ownerId Int",
    "  owner   Owner  @relation(fields: [ownerId], references: [id])",
    "}",
    "",
    "model Owner {",
    "  id       Int       @id @default(autoincrement())",
    "  accounts Account[]",
    "}",
    "",
  ].join("\n"),
  "infra/main.tf": [
    'resource "aws_db_instance" "primary" {',
    '  engine = "postgres"',
    "}",
    "",
    'resource "aws_s3_bucket" "assets" {',
    '  bucket = "t226-assets"',
    "}",
    "",
  ].join("\n"),
  "README.md": "deploy admin password is TSFixturePassw0rd!\n",
};
