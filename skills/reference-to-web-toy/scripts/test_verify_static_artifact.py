"""Exercise real CLI/HTTP/ZIP failure modes using only task-owned fixtures."""

from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import threading
import unittest
import warnings
import zipfile


SCRIPT = Path(__file__).with_name("verify_static_artifact.py")


@contextmanager
def serve(body, on_request=None, redirect=None):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if on_request:
                on_request()
            self.send_response(302 if redirect else 200)
            if redirect:
                self.send_header("Location", redirect)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/?v=test"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="web-toy-검증-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.html = '<style>body{color:red}</style><script type="module">const x=1;</script>'.encode()
        (self.root / "index.html").write_bytes(self.html)
        (self.root / "의존.js").write_text("export const x=1;", encoding="utf-8")
        self.archive = self.root / "toy.zip"
        self.pack()

    def pack(self, changed=False, missing=False, prefix=""):
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr(prefix + "index.html", b"stale" if changed else (self.root / "index.html").read_bytes())
            if not missing:
                archive.write(self.root / "의존.js", prefix + "의존.js")

    def run_check(self, *options):
        result = subprocess.run([sys.executable, "-X", "utf8", str(SCRIPT),
                                 "--root", str(self.root), "--asset", "의존.js", *options],
                                capture_output=True, text=True, encoding="utf-8", timeout=20)
        return result, json.loads(result.stdout) if result.stdout.strip() else None

    def test_source_http_zip_and_unicode_paths(self):
        with serve(self.html) as url:
            result, receipt = self.run_check("--url", url, "--zip", str(self.archive),
                "--expected-sha", hashlib.sha256(self.html).hexdigest())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(receipt["served_entry"]["matches"])
        self.assertTrue(receipt["zip"]["all_declared_match"])
        self.assertTrue(receipt["source_unchanged_during_check"])

    def test_stale_served_entry(self):
        with serve(b"old source") as url:
            result, receipt = self.run_check("--url", url)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(receipt["served_entry"]["matches"])

    def test_changed_or_missing_zip_file(self):
        for kind in ("changed", "missing"):
            with self.subTest(kind=kind):
                self.pack(changed=kind == "changed", missing=kind == "missing")
                result, receipt = self.run_check("--zip", str(self.archive))
                self.assertEqual(result.returncode, 1)
                self.assertFalse(receipt["zip"]["all_declared_match"])

    def test_expected_source_version(self):
        result, receipt = self.run_check("--expected-sha", "0" * 64)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(receipt["expected_source_matches"])

    def test_malformed_baseline_writes_fail_receipt(self):
        _, valid = self.run_check()
        values = [[], "PASS", 1, True, None]
        values += [{**valid, "files": files} for files in [[], None, "bad", 3]]
        for index, value in enumerate(values):
            with self.subTest(value=value):
                baseline = self.root / f"bad-baseline-{index}.json"
                output = self.root / f"failure-{index}.json"
                baseline.write_text(json.dumps(value), encoding="utf-8")
                result, summary = self.run_check("--baseline-receipt", str(baseline),
                                                 "--out", str(output))
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(summary["status"], "FAIL")
                receipt = json.loads(output.read_text(encoding="utf-8"))
                self.assertEqual(receipt["status"], "FAIL")
                self.assertIn("JSON object", receipt["failures"][0])

    def test_baseline_distinguishes_css_and_runtime_changes(self):
        baseline = self.root / "baseline.json"
        result, _ = self.run_check("--out", str(baseline))
        self.assertEqual(result.returncode, 0)
        (self.root / "index.html").write_bytes(self.html.replace(b"color:red", b"color:blue"))
        result, receipt = self.run_check("--baseline-receipt", str(baseline))
        self.assertEqual(result.returncode, 0)
        comparison = receipt["baseline_comparison"]
        self.assertFalse(comparison["entry_equal"])
        self.assertTrue(comparison["script_tags_equal"])
        self.assertTrue(comparison["declared_assets_equal"])
        (self.root / "의존.js").write_text("export const x=2;", encoding="utf-8")
        _, receipt = self.run_check("--baseline-receipt", str(baseline))
        self.assertFalse(receipt["baseline_comparison"]["declared_assets_equal"])

    def test_receipt_cannot_overwrite_source(self):
        result, _ = self.run_check("--out", str(self.root / "index.html"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("Receipt was not written", result.stderr)
        self.assertEqual((self.root / "index.html").read_bytes(), self.html)

    def test_zip_prefix_and_duplicate_rejection(self):
        self.pack(prefix="app/")
        result, receipt = self.run_check("--zip", str(self.archive), "--zip-prefix", "app")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(receipt["zip"]["all_declared_match"])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.archive, "a") as archive:
                archive.writestr("app/index.html", self.html)
        result, receipt = self.run_check("--zip", str(self.archive), "--zip-prefix", "app")
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate", receipt["failures"][0])

    def test_path_and_network_boundaries(self):
        for options in (("--entry", "../outside.html"), ("--url", "https://example.com/")):
            with self.subTest(options=options):
                result, receipt = self.run_check(*options)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(receipt["status"], "FAIL")
        with serve(b"redirect", redirect="http://127.0.0.1:1/") as url:
            result, receipt = self.run_check("--url", url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("302", receipt["failures"][0])

    def test_source_changed_during_http_check(self):
        def mutate():
            (self.root / "index.html").write_bytes(b"new version")
        with serve(self.html, on_request=mutate) as url:
            result, receipt = self.run_check("--url", url)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(receipt["source_unchanged_during_check"])


    def test_invalid_deflate_produces_fail_receipt(self):
        with zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('index.html', b'A' * 2000)
            archive.write(self.root / '의존.js', '의존.js')
        raw = bytearray(self.archive.read_bytes())
        name_size, extra_size = struct.unpack_from('<HH', raw, 26)
        raw[30 + name_size + extra_size] = 7
        self.archive.write_bytes(raw)
        result, receipt = self.run_check('--zip', str(self.archive))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(receipt['status'], 'FAIL')
        self.assertIn('error', receipt['failures'][0])


if __name__ == "__main__":
    unittest.main()
