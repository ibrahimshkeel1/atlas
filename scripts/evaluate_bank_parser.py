#!/usr/bin/env python3
"""Repo-root entrypoint for bank parser evaluation.

Delegates to apps/api/scripts/evaluate_bank_parser.py so either works:

  python scripts/evaluate_bank_parser.py
  cd apps/api && python scripts/evaluate_bank_parser.py
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "apps" / "api" / "scripts" / "evaluate_bank_parser.py"

if not SCRIPT.exists():
    print(f"Missing evaluator: {SCRIPT}", file=sys.stderr)
    raise SystemExit(2)

sys.argv[0] = str(SCRIPT)
runpy.run_path(str(SCRIPT), run_name="__main__")
