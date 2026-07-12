"""CLI: run and print Atlas internal evaluation.

  python -m scripts.eval_dashboard
  python -m scripts.eval_dashboard --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal  # noqa: E402
from app.services.eval_dashboard import run_and_persist_eval, serialize_run  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Atlas internal evaluation dashboard run")
    parser.add_argument("--json", action="store_true", help="Print JSON")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        run = run_and_persist_eval(db, source="cli")
        payload = serialize_run(run, include_details=True)
        if args.json:
            print(json.dumps(payload, indent=2, default=str))
            return

        print("Atlas internal evaluation")
        print(f"  status: {payload['status']}")
        print(f"  statements_tested: {payload['extraction']['statements_tested']}")
        recall = payload["extraction"]["transaction_recall"]
        print(f"  transaction_recall: {recall if recall is not None else 'n/a'}")
        print(f"  missing_rows: {payload['extraction']['missing_rows']}")
        print(f"  wrong_amounts: {payload['extraction']['wrong_amounts']}")
        print(f"  wrong_dates: {payload['extraction']['wrong_dates']}")
        print(f"  category_accuracy: {payload['categorization']['category_accuracy']}")
        print(f"  other_percentage: {payload['categorization']['other_percentage']}")
        print(f"  review_percentage: {payload['categorization']['review_percentage']}")
        print(
            f"  balance match/mismatch/unknown: "
            f"{payload['reconciliation']['balance_matches']}/"
            f"{payload['reconciliation']['balance_mismatches']}/"
            f"{payload['reconciliation']['balance_unknown']}"
        )
        print(
            f"  OCR / AI fallback / failures: "
            f"{payload['processing']['ocr_usage_count']}/"
            f"{payload['processing']['ai_fallback_count']}/"
            f"{payload['processing']['failure_count']}"
        )
        print(f"  parsers: {payload['processing']['parser_counts']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
