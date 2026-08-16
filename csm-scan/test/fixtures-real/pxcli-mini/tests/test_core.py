"""Core model tests."""

import pytest

from perplexity_cli.core import Report


def test_report_defaults() -> None:
    report = Report(title="t")
    assert report.verbose is False


def test_report_requires_title() -> None:
    with pytest.raises(ValueError):
        Report(title="")
