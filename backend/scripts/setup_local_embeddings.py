"""Explicitly install verified, pinned text-only EmbeddingGemma 2 ONNX artifacts.

From backend/: .venv/bin/python scripts/setup_local_embeddings.py
Use --source-dir to reuse an existing local download without network access.
Install the optional runtime separately: uv sync --extra local-retrieval.
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

# Support the documented direct script command without requiring PYTHONPATH or an installed package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.llm.local_embeddings import ARTIFACTS, MODEL, REVISION, verify_artifact

DEFAULT_DIRECTORY = Path(__file__).resolve().parents[1] / ".cache" / "embeddinggemma2"


def install(directory: Path, source_dir: Path | None = None) -> None:
    for name, (size, checksum) in ARTIFACTS.items():
        destination = directory / name
        if destination.exists():
            try:
                verify_artifact(destination, size, checksum)
                print(f"verified {name}")
                continue
            except (OSError, RuntimeError):
                pass
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(prefix=".download-", dir=destination.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "wb") as output:
                if source_dir is not None:
                    with (source_dir / name).open("rb") as source:
                        shutil.copyfileobj(source, output)
                else:
                    url = f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"
                    with urllib.request.urlopen(url, timeout=120) as source:
                        shutil.copyfileobj(source, output)
            verify_artifact(temporary, size, checksum)
            os.replace(temporary, destination)
            print(f"installed {name}")
        finally:
            temporary.unlink(missing_ok=True)
    manifest = {
        "format_version": 1,
        "model": MODEL,
        "revision": REVISION,
        "artifacts": {name: {"size": size, "sha256": checksum} for name, (size, checksum) in ARTIFACTS.items()},
    }
    fd, temporary_name = tempfile.mkstemp(prefix=".manifest-", dir=directory)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(manifest, output, indent=2)
            output.write("\n")
        os.replace(temporary, directory / "manifest.json")
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Verified {MODEL}@{REVISION} in {directory.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--source-dir", type=Path)
    args = parser.parse_args()
    install(args.model_dir.expanduser(), args.source_dir.expanduser() if args.source_dir else None)


if __name__ == "__main__":
    main()
