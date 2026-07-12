# Atlas bank statement evaluation fixtures

Measure Meezan / HBL / UBL parsers against **labeled** statements before adding more banks.

## Layout

```
bank-eval/
  expected.schema.json
  public/                 # safe to commit (synthetic or fully redacted)
    {meezan|hbl|ubl}/
      {statement_id}/
        meta.json
        expected.json     # ground truth (see schema)
        statement.pdf     # preferred
        statement.txt     # allowed for CI when PDF is bulky
  private/                # NEVER commit PDFs or unredacted JSON
    {bank}/{statement_id}/…
```

## Expected JSON

See `expected.schema.json`. Minimal example:

```json
{
  "bank_name": "Meezan",
  "statement_id": "001-synthetic",
  "source": "synthetic",
  "privacy": "public",
  "currency": "PKR",
  "closing_balance": "48249.50",
  "transactions": [
    {
      "transaction_date": "2026-06-01",
      "description": "IBFT Incoming Fund Transfer",
      "debit": null,
      "credit": "13290.00",
      "balance": "45000.00"
    }
  ]
}
```

## Privacy rules

- Do **not** commit real customer PDFs, account numbers, CNICs, or unredacted descriptions.
- Put real (redacted) statements under `private/` — gitignored.
- Or set `ATLAS_BANK_EVAL_PRIVATE_DIR` to an external folder outside the repo.
- Public fixtures may be synthetic or aggressively redacted only.

## Adding a real statement

1. Redact the PDF (mask account #, name, IBAN, phone).
2. Create `private/meezan/2026-06-redacted/{statement.pdf,expected.json,meta.json}`.
3. Fill `expected.json` by hand or from a trusted export — this is the ground truth.
4. Run:

```bash
cd apps/api && source .venv/bin/activate
python scripts/evaluate_bank_parser.py --include-private
```

## Pakistan bank coverage

Atlas catalogs scheduled, Islamic, foreign, specialized, microfinance, and digital banks for **detection**. Dedicated parsers + fixtures today: **Meezan, HBL, UBL**.

See `GET /api/v1/banks` or the Eval UI “Pakistan banks” section. Add labeled fixtures under `public/{slug}/…` before enabling a new dedicated parser.

```bash
# from repo root
python scripts/evaluate_bank_parser.py

# or from apps/api
python scripts/evaluate_bank_parser.py --json
```

CI runs **public** fixtures only.
