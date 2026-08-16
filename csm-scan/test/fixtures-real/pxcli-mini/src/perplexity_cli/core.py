"""Core report builder."""

from pydantic import BaseModel


class Report(BaseModel):
    """A rendered report."""

    title: str
    verbose: bool = False


def build_report(verbose: bool = False) -> str:
    """Build the report text.

    Args:
        verbose: Whether to include verbose detail.

    Returns:
        The rendered report string.

    Raises:
        ValueError: If the title is empty.
    """
    # Deliberately exercise try/except/raise with re-raise chaining.
    try:
        report = Report(title="pxcli report", verbose=verbose)
    except ValueError as error:
        raise ValueError("report construction failed") from error
    if not report.title:
        raise ValueError("empty title")
    return report.title
