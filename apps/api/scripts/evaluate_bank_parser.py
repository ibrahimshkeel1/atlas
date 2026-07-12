#!/usr/bin/env python3
"""Evaluate Meezan / HBL / UBL bank parsers against labeled fixtures.

Usage (from apps/api):
  python scripts/evaluate_bank_parser.py
  python scripts/evaluate_bank_parser.py --json
  python scripts/evaluate_bank_parser.py --include-private
  python scripts/evaluate_bank_parser.py --ci

From repo root:
  python scripts/evaluate_bank_parser.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.services.bank_parser_eval import (  # noqa: E402
    ci_thresholds_ok,
    format_human_report,
    run_bank_parser_eval,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Atlas bank statement parser evaluation (Meezan/HBL/UBL)"
    )
    parser.add_argument(
        "--include-private",
        action="store_true",
        help="Include gitignored private/ fixtures and ATLAS_BANK_EVAL_PRIVATE_DIR",
    )
    parser.add_argument(
        "--bank",
        action="append",
        dest="banks",
        choices=["meezan", "hbl", "ubl"],
        help="Limit to one or more banks (repeatable)",
    )
    parser.add_argument("--json", action="store_true", help="Print full JSON report")
    parser.add_argument(
        "--ci",
        action="store_true",
        help="Exit non-zero if public fixture thresholds fail (CI gate)",
    )
    parser.add_argument(
        "--min-recall",
        type=float,
        default=0.95,
        help="CI minimum transaction recall (default 0.95)",
    )
    parser.add_argument(
        "--min-amount-accuracy",
        type=float,
        default=0.95,
        help="CI minimum amount accuracy (default 0.95)",
    )
    args = parser.parse_args()

    # CI never loads private customer fixtures
    include_private = bool(args.include_private) and not args.ci

    report = run_bank_parser_eval(
        include_private=include_private,
        banks=args.banks,
    )

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print(format_human_report(report))
        print()
        priv = "public+private" if include_private else "public only"
        print(
            f"({report['statement_count']} statements · {priv} · "
            f"{report['fixture_root']})"
        )

    if args.ci:
        ok, reasons = ci_thresholds_ok(
            report,
            min_recall=args.min_recall,
            min_amount_accuracy=args.min_amount_accuracy,
        )
        if not ok:
            print("\nCI gate FAILED:", file=sys.stderr)
            for r in reasons:
                print(f"  - {r}", file=sys.stderr)
            return 1
        print("\nCI gate PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
