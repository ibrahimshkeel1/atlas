"""Evaluate merchant/rules categorization accuracy.

Usage (from apps/api):
  python -m scripts.eval_categorization
  python -m scripts.eval_categorization --json
"""

from __future__ import annotations

import argparse
import json
import sys

from app.db.session import SessionLocal
from app.services.categorization_eval import run_categorization_eval


def main() -> int:
    parser = argparse.ArgumentParser(description="Categorization accuracy eval")
    parser.add_argument("--json", action="store_true", help="Print JSON only")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        report = run_categorization_eval(db)
    finally:
        db.close()

    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return 0

    print("Categorization eval (fixtures)")
    print(f"  fixtures:              {report['fixture_count']}")
    print(f"  before_rules_accuracy: {report['before_rules_accuracy']:.1%}")
    print(f"  after_rules_accuracy:  {report['after_rules_accuracy']:.1%}")
    print(f"  merchant_match_rate:   {report['merchant_match_rate']:.1%}")
    print(f"  other_before:          {report['other_before']}")
    print(f"  other_after:           {report['other_after']}")
    print(f"  other_reduction:       {report['other_reduction']} ({report['other_reduction_pct']:.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
