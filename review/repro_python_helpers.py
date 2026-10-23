"""Synthetic review harness (2026-10-23) for the two bundled Python helpers' CLI-only options.

Everything happens in a new temporary directory. Run from the repository root:
    python -I review/repro_python_helpers.py
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERIFY = ROOT / "skills/reference-to-web-toy/scripts/verify_static_artifact.py"
DELIVERY = ROOT / "skills/asset-delivery/scripts/delivery_manifest.py"


def run(*args):
    p = subprocess.run([sys.executable, "-I", *map(str, args)], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def record(case, observed, expectation):
    print(json.dumps({"id": case, "observed": observed, "expectation": expectation}, ensure_ascii=False))


with tempfile.TemporaryDirectory(prefix="designer-review-py-") as tmp:
    tmp = Path(tmp)
    site = tmp / "site"
    site.mkdir()
    (site / "index.html").write_text("<!doctype html><script>let a=1</script>", encoding="utf-8")
    (site / "app.js").write_text("console.log(1)", encoding="utf-8")

    # 1. A baseline receipt whose JSON is valid but not an object -> uncaught AttributeError.
    for label, content in (("list", "[]"), ("string", '"PASS"'), ("number", "1")):
        bad = tmp / f"baseline-{label}.json"
        bad.write_text(content, encoding="utf-8")
        out = tmp / f"receipt-{label}.json"
        code, stdout, stderr = run(VERIFY, "--root", site, "--baseline-receipt", bad, "--out", out)
        record(f"verify-malformed-baseline-{label}",
               {"exit": code, "stdout_json": stdout.strip()[:60], "traceback": "Traceback" in stderr,
                "last_error_line": stderr.strip().splitlines()[-1] if stderr.strip() else "",
                "receipt_written": out.exists()},
               "Expected a FAIL receipt like other malformed inputs; observed traceback and no receipt")

    # 2. Baseline comparison is descriptive: changed script/assets still PASS.
    first = tmp / "first.json"
    run(VERIFY, "--root", site, "--asset", "app.js", "--out", first)
    (site / "index.html").write_text("<!doctype html><script>let a=2</script>", encoding="utf-8")
    (site / "app.js").write_text("console.log(2)", encoding="utf-8")
    code, stdout, _ = run(VERIFY, "--root", site, "--asset", "app.js", "--baseline-receipt", first)
    receipt = json.loads(stdout)
    record("verify-baseline-differs-still-pass",
           {"exit": code, "status": receipt["status"], "comparison": {k: v for k, v in receipt["baseline_comparison"].items()
                                                                      if k.endswith("equal")}},
           "Intended per receipt 'meaning': descriptive only; callers must read *_equal fields")

    # 3. delivery_manifest: malformed baselines are refused with exit 2 (not reported as match).
    folder = tmp / "folder"
    folder.mkdir()
    (folder / "a.txt").write_text("A", encoding="utf-8")
    cases = {
        "list": [],
        "bool-bytes": {"schema_version": 1, "file_count": 1, "total_bytes": 1,
                       "entries": [{"path": "a.txt", "bytes": True, "sha256": "0" * 64}]},
        "count-lie": {"schema_version": 1, "file_count": 0, "total_bytes": 0,
                      "entries": [{"path": "a.txt", "bytes": 1, "sha256": "0" * 64}]},
        "case-dup": {"schema_version": 1, "file_count": 2, "total_bytes": 2,
                     "entries": [{"path": "a.txt", "bytes": 1, "sha256": "0" * 64},
                                 {"path": "A.txt", "bytes": 1, "sha256": "0" * 64}]},
        "traversal": {"schema_version": 1, "file_count": 1, "total_bytes": 1,
                      "entries": [{"path": "../a.txt", "bytes": 1, "sha256": "0" * 64}]},
    }
    for label, baseline in cases.items():
        path = tmp / f"manifest-{label}.json"
        path.write_text(json.dumps(baseline), encoding="utf-8")
        code, stdout, _ = run(DELIVERY, folder, "--compare", path)
        record(f"manifest-malformed-baseline-{label}", {"exit": code, "status": json.loads(stdout).get("status")},
               "exit 2 / status=error")

    # 4. ZIP edge cases for the inventory used by asset_inventory/asset_compare.
    dup = tmp / "dup.zip"
    with zipfile.ZipFile(dup, "w") as z:
        z.writestr("a.txt", "A")
        z.writestr("A.TXT", "B")
    code, stdout, _ = run(DELIVERY, dup)
    record("manifest-zip-case-collision", {"exit": code, "error": json.loads(stdout).get("error")}, "Refused")
    crc = tmp / "crc.zip"
    with zipfile.ZipFile(crc, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("a.txt", "AAAA")
    data = bytearray(crc.read_bytes())
    data[data.index(b"AAAA")] = ord("B")
    crc.write_bytes(bytes(data))
    code, stdout, _ = run(DELIVERY, crc)
    record("manifest-zip-crc-corruption", {"exit": code, "error": json.loads(stdout).get("error")}, "Refused")
    code, stdout, _ = run(VERIFY, "--root", site, "--zip", crc)
    record("verify-zip-crc-corruption", {"exit": code, "status": json.loads(stdout)["status"]}, "FAIL")
