"""Shared helper for test files that need a fresh, fully-isolated import of
../app.py.

Why this exists: app.py's state (the Flask app, the SQLAlchemy engine/DB
file path, the background volta-sync cron thread, audit-log file handlers)
is bound at import time to the process's current working directory. Each
test file wants its own scratch tempdir/DB so tests in different files can't
see each other's data.

That works when each file runs in its own process (`python -m unittest
tests.test_x`), but `python -m unittest discover` loads every test file in
ONE process — and `import app` is cached by `sys.modules['app']`
process-wide, so only the very first file to import it actually executes
app.py; every later file's `import app as ohmapp` silently returns that
first file's already-initialized app/DB, and they collide (e.g. duplicate
'WorkerA' usernames -> UNIQUE constraint failures, leaves/entries leaking
across files' row-count assertions, a cron thread started by an earlier
file tripping a later file's "cron did not start" check).

`load_fresh_app(prefix)` forces a real re-execution of app.py in a brand
new tempdir every time it's called, so isolation holds in both a
single-file run and under `discover`.
"""
import atexit
import logging
import os
import shutil
import sys
import tempfile


def load_fresh_app(prefix):
    """Import a fresh copy of app.py with cwd pointed at a new tempdir.

    Returns the freshly executed `app` module. The tempdir is cleaned up at
    process exit.
    """
    orig_cwd = os.getcwd()
    test_dir = tempfile.mkdtemp(prefix=prefix)
    atexit.register(shutil.rmtree, test_dir, ignore_errors=True)

    # No test file wants a real background thread running during its
    # assertions — only test_volta_sync.py exercises that logic, and it
    # does so by calling process_volta_sync_queue()/_try_claim_volta_sync_run
    # directly, never by relying on the auto-started thread. setdefault (not
    # a plain assignment) so a file that deliberately wants it enabled could
    # still opt back in before calling load_fresh_app.
    os.environ.setdefault('OHM_DISABLE_VOLTA_CRON', '1')

    # app.py's own sys.modules cache is what breaks discover — drop it so
    # the import below re-executes the module from scratch instead of
    # returning whichever test file happened to import it first.
    sys.modules.pop('app', None)

    # Audit-log handlers are attached to loggers named 'audit.<category>',
    # which are process-wide singletons keyed by name — logging.getLogger
    # doesn't care which module asked for them. Re-running app.py alone
    # does NOT reset them, so a stale handler from a previous tempdir would
    # silently keep collecting this file's audit log writes. Detach so
    # app.py's _audit_logger() attaches a fresh handler for the new tempdir.
    for name in list(logging.Logger.manager.loggerDict):
        if name.startswith('audit.'):
            lg = logging.getLogger(name)
            for handler in lg.handlers[:]:
                handler.close()
                lg.removeHandler(handler)

    os.chdir(test_dir)
    try:
        import app as ohmapp  # noqa: E402 — must import with cwd=test_dir
    finally:
        os.chdir(orig_cwd)
    return ohmapp
