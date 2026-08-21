export const manifest = "pyproject.toml";

export const files = {
  "pyproject.toml": `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "demo"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = ["click", "rich"]

[dependency-groups]
dev = ["pytest>=8", "mypy>=1.10"]

[project.scripts]
demo = "demo.cli:main"

[tool.ruff]
line-length = 100

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.setuptools.packages.find]
where = ["src"]
`,
  "src/demo/__init__.py": ``,
  "requirements.txt": `httpx>=0.27
typing-extensions>=4.10
`,
  "src/demo/cli.py": `from .core import greet
from demo.parts import (
    alpha,
    beta,
)
from acme.plugins import loader


def main():
    message = f"{greet()} {alpha.NAME} {beta.NAME} {loader.NAME}"
    print(message)


if __name__ == "__main__":
    main()
`,
  "src/demo/core.py": `def greet():
    """Return the fixture greeting."""
    try:
        return "hello"
    except Exception as exc:
        raise RuntimeError("greet failed") from exc


class Greeter:
    """Create greetings for fixture callers."""

    def render(self):
        """Render a greeting."""
        return greet()
`,
  "src/demo/parts/__init__.py": ``,
  "src/demo/parts/alpha.py": `NAME = "alpha"
`,
  "src/demo/parts/beta.py": `NAME = "beta"
`,
  "src/acme/marker.py": `NAMESPACE = "acme"
`,
  "src/acme/plugins/loader.py": `NAME = "namespace"
`,
  "tests/test_core.py": `from demo.core import greet


def test_greet():
    assert greet() == "hello"
`,
  ".hypothesis/constants/abc123": `noise
`,
};
