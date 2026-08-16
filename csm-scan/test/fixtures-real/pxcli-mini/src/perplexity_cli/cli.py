"""Command-line entry point."""

import click

from perplexity_cli import core


@click.command()
@click.option("--verbose", is_flag=True, help="Enable verbose output")
def main(verbose: bool) -> None:
    """Run the CLI."""
    try:
        report = core.build_report(verbose=verbose)
    except ValueError as error:
        raise click.UsageError(str(error)) from error
    click.echo(report)


if __name__ == "__main__":
    main()
