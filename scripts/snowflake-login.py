"""Set the account and user of the `prompt-enhance` Snowflake connection, then log in via browser.

Usage: python3 scripts/snowflake-login.py
"""

import re
import subprocess
import sys
from pathlib import Path

CONFIG_PATH = Path.home() / ".snowflake" / "config.toml"
CONNECTION = "prompt-enhance"
SECTION = f"[connections.{CONNECTION}]"


def set_field(text: str, field: str, value: str) -> str:
    start = text.index(SECTION)
    end = text.find("\n[", start + len(SECTION))
    end = len(text) if end == -1 else end
    section = re.sub(rf'(?m)^{field} = ".*"$', lambda _: f'{field} = "{value}"', text[start:end])
    return text[:start] + section + text[end:]


def ask(label: str, pattern: str) -> str:
    value = input(f"{label}: ").strip()
    if not re.fullmatch(pattern, value):
        sys.exit(f"invalid {label.lower()}: {value!r}")
    return value


def main() -> None:
    text = CONFIG_PATH.read_text()
    if SECTION not in text:
        sys.exit(f"{SECTION} not found in {CONFIG_PATH}; run `snow connection add` first")
    account = ask("Account identifier (e.g. ABCDEFG-XY12345)", r"[A-Za-z0-9._-]+")
    user = ask("Login name", r"[A-Za-z0-9._@-]+")
    text = set_field(text, "account", account)
    text = set_field(text, "user", user)
    CONFIG_PATH.write_text(text)
    print(f"Updated {CONNECTION}; opening browser to sign in…")
    subprocess.run(["snow", "connection", "test", "--connection", CONNECTION], check=False)


if __name__ == "__main__":
    main()
