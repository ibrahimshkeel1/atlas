# Private bank-eval fixtures

Place redacted real statements here. PDFs and expected JSON under this tree are **gitignored**.

```
private/
  meezan/
    2026-06-client-a/
      meta.json
      expected.json
      statement.pdf
  hbl/…
  ubl/…
```

`meta.json` example:

```json
{
  "bank": "meezan",
  "statement_id": "2026-06-client-a",
  "privacy": "private",
  "source": "redacted_real",
  "notes": "Redacted closing statement — do not commit"
}
```

Never store unredacted customer data in git. Prefer an external path via `ATLAS_BANK_EVAL_PRIVATE_DIR` for laptop copies of private fixtures.
