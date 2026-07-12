"""Evaluate bank parsers against ground-truth fixtures.

Usage (from apps/api):
  python -m scripts.eval_extraction
  python -m scripts.eval_extraction --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.accuracy import run_eval  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Atlas extraction accuracy report")
    parser.add_argument("--json", action="store_true", help="Print JSON only")
    args = parser.parse_args()
    report = run_eval()
    if args.json:
        print(json.dumps(report, indent=2))
        return
    print("Atlas extraction accuracy report")
    print("=" * 40)
    for row in report["fixtures"]:
        print(
            f"{row['fixture']:10}  F1={row['f1']:.0%}  "
            f"P={row['precision']:.0%} R={row['recall']:.0%}  "
            f"bank={'OK' if row['bank_ok'] else 'MISS'}  "
            f"({row['matched']}/{row['expected_count']} matched, "
            f"{row['predicted_count']} predicted)"
        )
    s = report["summary"]
    print("-" * 40)
    print(
        f"Avg F1={s.get('avg_f1', 0):.0%}  precision={s.get('avg_precision', 0):.0%}  "
        f"recall={s.get('avg_recall', 0):.0%}  "
        f"banks={s.get('banks_detected_ok', 0)}/{s.get('fixture_count', 0)}"
    )
    print(
        f"Sellable parser bar (≥95% F1 all banks): "
        f"{'PASS' if s.get('sellable_bar') else 'NOT YET'}"
    )


if __name__ == "__main__":
    main()
