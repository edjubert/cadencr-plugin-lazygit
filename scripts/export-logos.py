#!/usr/bin/env python3
"""Export the PNG size ladder from logos/logo.svg."""

from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)


def main():
    renderer = shutil.which("rsvg-convert")
    if renderer is None:
        sys.exit("rsvg-convert is required. On macOS: brew install librsvg")

    source = ROOT / "logos" / "logo.svg"
    destination = ROOT / "logos"
    for size in SIZES:
        subprocess.run(
            [
                renderer,
                "--width", str(size),
                "--height", str(size),
                "--output", str(destination / f"logo-{size}.png"),
                str(source),
            ],
            check=True,
        )
    print(f"Exported {len(SIZES)} PNG sizes from {source} to {destination}")


if __name__ == "__main__":
    main()
