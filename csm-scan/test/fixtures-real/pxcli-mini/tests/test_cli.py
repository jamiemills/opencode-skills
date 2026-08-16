"""CLI behavior tests."""

from perplexity_cli import core


def test_build_report_default() -> None:
    assert core.build_report() == "pxcli report"


def test_build_report_verbose() -> None:
    assert core.build_report(verbose=True) == "pxcli report"
