"""Shared pytest fixtures."""

import pytest


@pytest.fixture
def sample_report() -> str:
    """Return a sample report title."""
    return "pxcli report"
