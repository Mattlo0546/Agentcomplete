"""Prompt for a secret without echoing it and store it in the project's .env.

Usage: python3 scripts/set-secret.py GEMINI_API_KEY
"""

import getpass
import os
import re
import sys
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def set_secret(name: str, value: str) -> None:
    text = ENV_PATH.read_text() if ENV_PATH.exists() else ""
    line = f"{name}={value}"
    pattern = re.compile(rf"^{re.escape(name)}=.*$", re.MULTILINE)
    text = pattern.sub(lambda _: line, text) if pattern.search(text) else text.rstrip("\n") + f"\n{line}\n"
    ENV_PATH.write_text(text)
    os.chmod(ENV_PATH, 0o600)


def main() -> None:
    if len(sys.argv) != 2 or not re.fullmatch(r"[A-Z][A-Z0-9_]*", sys.argv[1]):
        sys.exit("usage: set-secret.py ENV_VAR_NAME")
    value = getpass.getpass(f"{sys.argv[1]}: ").strip()
    if not value:
        sys.exit("empty value, nothing saved")
    set_secret(sys.argv[1], value)
    print(f"{sys.argv[1]} saved to {ENV_PATH.name}")


if __name__ == "__main__":
    main()
