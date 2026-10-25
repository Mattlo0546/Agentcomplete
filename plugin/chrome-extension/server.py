#!/usr/bin/env python3
"""Launch the repository backend through local extension transport/provider glue.

Requires the existing backend virtualenv. The supplied key stays in memory;
.runtime.json contains only a short-lived loopback transport capability.
"""
from pathlib import Path
import json
import os
import secrets
import socket
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]


def main():
    import shutil
    for cache in ROOT.rglob('__pycache__'):
        if cache.is_dir() and not cache.is_symlink():
            shutil.rmtree(cache)
    if sys.version_info < (3, 12):
        raise SystemExit('Run this launcher with backend/.venv/bin/python (Python 3.12+).')
    try:
        import uvicorn
        from backend_adapter import create_local_app
    except ImportError:
        raise SystemExit('Run this launcher with the existing backend/.venv/bin/python runtime.') from None
    key = os.environ.pop('OPENAI_API_KEY', '')
    if not key.startswith('sk-'):
        raise SystemExit('OPENAI_API_KEY is required in the process environment.')
    model = os.environ.get('OPENAI_MODEL', 'gpt-4.1-mini')
    token = secrets.token_urlsafe(32)
    app = create_local_app(key, token, model)
    config_path = ROOT / '.runtime.json'
    if config_path.is_symlink():
        raise SystemExit('Refusing a symlink runtime config.')
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', 0))
    listener.listen(128)
    fd = os.open(config_path, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as config:
        json.dump({'url': f'http://127.0.0.1:{listener.getsockname()[1]}', 'token': token}, config)
    config_path.chmod(0o600)
    try:
        uvicorn.Server(uvicorn.Config(app, access_log=False, log_level='warning')).run(sockets=[listener])
    finally:
        listener.close()
        if config_path.exists() and not config_path.is_symlink():
            try:
                if json.loads(config_path.read_text()).get('token') == token:
                    config_path.unlink()
            except (ValueError, OSError):
                pass


if __name__ == '__main__':
    main()
