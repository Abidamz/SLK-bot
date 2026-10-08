#!/usr/bin/env python3
"""Read screenshots as text, for agents (or humans) that cannot see images.

Why this exists
---------------
Image attachments do not always reach the agent's workspace, and not every
model serving a turn can process images. When that happens, screenshots can
still be reviewed by putting the files somewhere the agent can pull them
(committed to a git branch works, since github.com is reachable), then running
this script to turn them into text.

It is a fallback, not a replacement for vision. Photographs and charts are
poorly served by OCR; flat UI text, terminal output and chat messages (which is
what SLK alerts are) work well.

What it does
------------
Runs RapidOCR (ONNX, CPU-only) over each image and prints the detected lines
with their positions, so the reading order can be reconstructed.

First run creates .ocrvenv/ at the repo root and installs pillow,
opencv-python-headless and rapidocr-onnxruntime from PyPI (~15-60 s depending
on network). Nothing is written inside the repo except that venv, which is
gitignored. opencv-python-headless is used deliberately: the regular build
needs libGL.so.1, which is not installable without root and apt.

Usage
-----
    python3 scripts/ocr_screens.py shot.png [more.png ...]
    python3 scripts/ocr_screens.py --dir path/to/folder
    python3 scripts/ocr_screens.py --dir . --ext png,jpg

Requires: python3 with venv available, and network access to pypi.org on the
first run only.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = REPO_ROOT / ".ocrvenv"
VENV_PYTHON = VENV_DIR / "bin" / "python"

# rapidocr-onnxruntime depends on opencv-python, which imports libGL.so.1 —
# not installable without root/apt. So install rapidocr first, remove the
# GL build it drags in, then install the headless build. Order matters: a
# single combined pip install lets opencv-python win and cv2 fails to import.
DEPS_FIRST = ["pillow", "rapidocr-onnxruntime"]
DEPS_HEADLESS = ["opencv-python-headless"]


def running_in_venv() -> bool:
    return Path(sys.prefix).resolve() == VENV_DIR.resolve()


def ensure_venv() -> None:
    if not VENV_DIR.exists():
        print(f"[ocr] creating venv at {VENV_DIR}", file=sys.stderr)
        subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)

    # Probe both: a venv can exist with cv2 broken by a bad opencv build.
    probe = subprocess.run(
        [str(VENV_PYTHON), "-c", "import cv2, rapidocr_onnxruntime"],
        capture_output=True,
    )
    if probe.returncode != 0:
        print(f"[ocr] installing {', '.join(DEPS_FIRST)} (first run only)", file=sys.stderr)
        subprocess.run(
            [str(VENV_PYTHON), "-m", "pip", "install", "--quiet", *DEPS_FIRST],
            check=True,
        )
        print("[ocr] swapping opencv-python for the headless build", file=sys.stderr)
        subprocess.run(
            [str(VENV_PYTHON), "-m", "pip", "uninstall", "-y",
             "opencv-python", "opencv-contrib-python", "opencv-contrib-python-headless"],
            check=False,
        )
        subprocess.run(
            [str(VENV_PYTHON), "-m", "pip", "install", "--quiet", *DEPS_HEADLESS],
            check=True,
        )


def collect_paths(args: list[str]) -> list[Path]:
    exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    directory: Path | None = None
    extra_exts: list[str] = []
    positional: list[str] = []

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--dir":
            i += 1
            directory = Path(args[i])
        elif a == "--ext":
            i += 1
            extra_exts = [e.strip().lower().lstrip(".") for e in args[i].split(",")]
        else:
            positional.append(a)
        i += 1

    if extra_exts:
        exts = {f".{e}" for e in extra_exts}

    paths: list[Path] = []
    if directory is not None:
        paths = sorted(
            p for p in directory.rglob("*")
            if p.is_file() and p.suffix.lower() in exts and ".ocrvenv" not in p.parts
        )
    for p in positional:
        path = Path(p)
        if path.is_dir():
            paths.extend(sorted(q for q in path.rglob("*") if q.is_file() and q.suffix.lower() in exts))
        else:
            paths.append(path)
    return paths


def main() -> int:
    if not running_in_venv():
        ensure_venv()
        # Hand over to the venv interpreter with the same arguments.
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])
        return 1  # unreachable

    from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415 (venv-only import)

    paths = collect_paths(sys.argv[1:])
    if not paths:
        print("No images given. Usage: python3 scripts/ocr_screens.py shot.png [--dir FOLDER]")
        return 2

    engine = RapidOCR()
    exit_code = 0
    for path in paths:
        print(f"\n===== {path} =====")
        if not path.exists():
            print("  (file not found)")
            exit_code = 1
            continue
        try:
            result, _ = engine(str(path))
        except Exception as err:  # noqa: BLE001 - report and keep going
            print(f"  (OCR failed: {err})")
            exit_code = 1
            continue
        if not result:
            print("  (no text detected — if this is a chart or photo, OCR is the wrong tool)")
            continue
        for box, text, confidence in result:
            y = int(min(point[1] for point in box))
            print(f"  y={y:>5}  conf={confidence:.2f}  {text}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
