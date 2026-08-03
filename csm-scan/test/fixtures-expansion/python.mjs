// T226 topic fixture — Python (api-and-data).
//
// Carries the "API + data + deployment + governance + assurance + privacy +
// dynamic" theme. Every file below is deliberately chosen so the production
// pipeline reports a specific, assertable fact:
//   - FastAPI literal routes (positive API) plus one dynamic route variable
//     (unverified DYNAMIC diagnostic).
//   - SQLAlchemy models with an explicit ForeignKey (positive data entities,
//     keys, relations, and a declaration-backed ER edge) and one relationship
//     without an FK (NAME_ONLY diagnostic, no fabricated edge).
//   - A click CLI tree (positive API cli_command).
//   - An Alembic migration (positive data migration).
//   - A Dockerfile + Compose (positive deployment images/services).
//   - CODEOWNERS + ADR + CONTRIBUTING (positive governance ownership/decision/
//     contribution).
//   - pyproject.toml + requirements.txt (positive assurance manifests).
//   - importlib dynamic import (dynamic construct).
//   - Privacy canaries that must never reach findings or NORMS.md: an email, a
//     secret token, and a URL with embedded credentials.
//   - `from src.models import User` so the architecture import graph has a
//     real internal edge.

export const files = {
  'pyproject.toml': `[project]
name = "t226-py"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = ["fastapi", "sqlalchemy"]
`,
  'requirements.txt': 'httpx>=0.27\n',
  'src/api/app.py': [
    'from src.models import User',
    'from src.cli import deploy',
    '',
    '@app = FastAPI()',
    "BASE = '/api/v1'",
    '@app.get(BASE)',
    'def root(): ...',
    "@app.get('/api/items')",
    'def items(): ...',
    "@app.post('/api/items')",
    'def create(): ...',
    "@app.get('/api/items/{item_id}')",
    'def get_one(item_id: int): ...',
    '@app.get(ENDPOINT_VAR)',
    'def dynamic(): ...',
    '',
  ].join('\n'),
  'src/models.py': [
    'from sqlalchemy import Column, Integer, String, ForeignKey',
    'from sqlalchemy.orm import relationship',
    '',
    'class Base: pass',
    '',
    "class Team(Base):",
    "    __tablename__ = 'teams'",
    '    id = Column(Integer, primary_key=True)',
    '    name = Column(String)',
    '',
    "class User(Base):",
    "    __tablename__ = 'users'",
    '    id = Column(Integer, primary_key=True)',
    '    name = Column(String)',
    "    team_id = Column(Integer, ForeignKey('teams.id'))",
    '',
    'class Player(Base):',
    "    __tablename__ = 'players'",
    '    id = Column(Integer, primary_key=True)',
    "    team = relationship('Team')",
    '',
  ].join('\n'),
  'src/cli.py': [
    'import click',
    '@click.command()',
    'def deploy(): ...',
    '',
  ].join('\n'),
  'src/loader.py': "import importlib\nmod = importlib.import_module('plugins.' + name)\n",
  'src/config.py': 'API_TOKEN = "t226-py-super-secret-token-value-42"\n',
  'src/creds.py': "DB_URL = 'https://user:pass@db.example.test/primary'\n",
  'migrations/versions/0001_init.py': [
    'revision = "0001"',
    'down_revision = None',
    '',
  ].join('\n'),
  'Dockerfile': [
    'FROM python:3.12',
    'WORKDIR /app',
    'COPY . .',
    'CMD ["uvicorn", "src.api.app:app"]',
    '',
  ].join('\n'),
  'docker-compose.yml': [
    'services:',
    '  api:',
    '    build: .',
    '    ports:',
    '      - "8000:8000"',
    '  db:',
    '    image: postgres:16',
    '',
  ].join('\n'),
  '.github/CODEOWNERS': '* @platform\n',
  'docs/adr/0001-architecture.md': [
    '# ADR 0001',
    '',
    '## Status',
    '',
    'Accepted',
    '',
    '## Context',
    '',
    'We choose a modular layout.',
    '',
  ].join('\n'),
  'CONTRIBUTING.md': 'Thanks for contributing.\n',
  'README.md': [
    '# t226-py',
    '',
    'Contact alice.smith@example.test for access.',
    '',
  ].join('\n'),
  'tests/test_api.py': 'def test_root():\n    assert True\n',
};
