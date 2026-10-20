"""Local folder/ZIP identity and refusal checks; standard library only."""
import hashlib
import json
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import unittest
import warnings
import zipfile

SCRIPT = Path(__file__).with_name("delivery_manifest.py")


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="delivery-check-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "handoff"
        (self.stage / "art").mkdir(parents=True)
        (self.stage / "art" / "image.bin").write_bytes(b"original artwork")
        (self.stage / "readme.txt").write_text("Editable source included", encoding="utf-8")
        self.archive = self.root / "handoff.zip"
        self.baseline = self.root / "baseline.json"
        result, manifest = self.run_tool(self.stage)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.baseline.write_text(json.dumps(manifest), encoding="utf-8")

    def run_tool(self, target, *args):
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", str(SCRIPT), str(target),
                                 *map(str, args)], capture_output=True, text=True,
                                encoding="utf-8", timeout=10)
        return result, json.loads(result.stdout)

    def pack(self):
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in self.stage.rglob("*"):
                if path.is_file():
                    archive.write(path, path.relative_to(self.stage).as_posix())

    def test_folder_zip_identity_and_read_only(self):
        before = {str(p): p.read_bytes() for p in self.stage.rglob("*") if p.is_file()}
        self.pack()
        result, receipt = self.run_tool(self.archive, "--compare", self.baseline)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(receipt["comparison"]["match"])
        self.assertEqual(receipt["file_count"], 2)
        self.assertEqual(receipt["archive_sha256"], hashlib.sha256(self.archive.read_bytes()).hexdigest())
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.stage.rglob("*") if p.is_file()})

    def test_reports_missing_extra_and_changed(self):
        (self.stage / "readme.txt").unlink()
        (self.stage / "extra.txt").write_bytes(b"added")
        (self.stage / "art" / "image.bin").write_bytes(b"changed")
        self.pack()
        result, receipt = self.run_tool(self.archive, "--compare", self.baseline)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(receipt["comparison"], {"match": False, "missing": ["readme.txt"],
                         "extra": ["extra.txt"], "changed": ["art/image.bin"]})

    def test_unsafe_and_case_colliding_archives(self):
        for names in [("../outside.txt",), ("A.txt", "a.txt"), ("same.txt", "same.txt")]:
            with self.subTest(names=names), warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(self.archive, "w") as archive:
                    for name in names:
                        archive.writestr(name, b"test")
                result, receipt = self.run_tool(self.archive)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(receipt["status"], "error")

    def test_corrupt_member_is_rejected(self):
        marker = b"unique-uncompressed-content-12345"
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("asset.bin", marker)
        raw = self.archive.read_bytes()
        self.archive.write_bytes(raw.replace(marker, b"X" + marker[1:], 1))
        result, receipt = self.run_tool(self.archive)
        self.assertEqual(result.returncode, 2)
        self.assertIn("CRC", receipt["error"])

    def test_invalid_baseline_and_missing_target(self):
        self.baseline.write_text('{"schema_version":1,"entries":[]}', encoding="utf-8")
        result, receipt = self.run_tool(self.stage, "--compare", self.baseline)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(receipt["status"], "error")
        result, _ = self.run_tool(self.root / "absent")
        self.assertEqual(result.returncode, 2)


    def test_utf16_baseline_with_unicode_names(self):
        (self.stage / '설명.txt').write_text('unicode', encoding='utf-8')
        _, manifest = self.run_tool(self.stage)
        self.baseline.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-16')
        result, receipt = self.run_tool(self.stage, '--compare', self.baseline)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(receipt['comparison']['match'])

    def test_invalid_deflate_returns_json_error(self):
        with zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('broken.bin', b'A' * 2000)
        raw = bytearray(self.archive.read_bytes())
        name_size, extra_size = struct.unpack_from('<HH', raw, 26)
        raw[30 + name_size + extra_size] = 7
        self.archive.write_bytes(raw)
        result, receipt = self.run_tool(self.archive)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(receipt['status'], 'error')

    def test_ancestor_alias_allowed_target_and_child_links_refused(self):
        alias = self.root / 'alias'
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except OSError as error:
            self.skipTest('Host does not permit directory symlinks: ' + str(error))
        result, _ = self.run_tool(alias / 'handoff')
        self.assertEqual(result.returncode, 0)
        result, _ = self.run_tool(alias)
        self.assertEqual(result.returncode, 2)
        child = self.stage / 'linked.txt'
        child.symlink_to(self.stage / 'readme.txt')
        result, _ = self.run_tool(self.stage)
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
