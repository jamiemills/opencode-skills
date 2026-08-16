.PHONY: lint test audit build publish

lint:
	ruff check src tests

test:
	pytest

audit:
	pip-audit

build:
	python -m build

publish: build
	python -m twine upload dist/*
