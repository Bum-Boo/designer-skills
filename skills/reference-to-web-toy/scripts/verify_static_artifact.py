#!/usr/bin/env python3
"""Compare a static app's files, served entry and ZIP without changing the app."""

import argparse
import hashlib
import ipaddress
import json
from pathlib import Path, PurePosixPath
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib


def sha(data):
    return hashlib.sha256(data).hexdigest().upper()


def relative_name(value):
    name = value.replace("\\", "/")
    path = PurePosixPath(name)
    if not name or path.is_absolute() or any(p in ("..", ".") for p in name.split("/")):
        raise ValueError(f"Unsafe relative path: {value}")
    if any(":" in p for p in path.parts):
        raise ValueError(f"Unsafe relative path: {value}")
    return path.as_posix()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def served_bytes(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("URL must be loopback HTTP or HTTPS")
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise ValueError("URL must not contain credentials or a fragment")
    host = parsed.hostname
    if host.lower() == "localhost":
        addresses = {a[4][0] for a in socket.getaddrinfo(host, parsed.port or 80)}
        if not addresses or not all(ipaddress.ip_address(a).is_loopback for a in addresses):
            raise ValueError("localhost did not resolve exclusively to loopback")
    else:
        try:
            if not ipaddress.ip_address(host).is_loopback:
                raise ValueError("URL must use a loopback address")
        except ValueError as exc:
            raise ValueError("URL must use a loopback address") from exc
    # Ignore system proxy settings; a local check must stay local.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={"Accept-Encoding": "identity"})
    with opener.open(request, timeout=10) as response:
        return response.read(), response.status


def verify(args):
    receipt = {
        "schema": "reference-to-web-toy/static-artifact-v1",
        "status": "FAIL",
        "failures": [],
        "limits": [
            "Only the entry and explicitly declared assets are checked.",
            "File equality does not verify interaction, appearance or review approval.",
        ],
    }
    try:
        root = Path(args.root).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Root must be a directory")
        entry = relative_name(args.entry)
        assets = list(dict.fromkeys(relative_name(a) for a in args.asset))
        names = list(dict.fromkeys([entry, *assets]))
        files = {}
        initial = {}
        for name in names:
            path = (root / name).resolve(strict=True)
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError(f"Declared file is outside root or not a file: {name}")
            data = path.read_bytes()
            initial[name] = (path, data)
            files[name] = {"sha256": sha(data), "bytes": len(data)}
        source = initial[entry][1]
        scripts = [sha(m.group()) for m in re.finditer(
            rb"<script\b[^>]*>[\s\S]*?</script\s*>", source, re.IGNORECASE)]
        receipt.update(root=str(root), entry=entry, files=files,
                       source_sha256=sha(source), script_tag_sha256=scripts)
        if args.expected_sha:
            expected = args.expected_sha.upper()
            if not re.fullmatch(r"[0-9A-F]{64}", expected):
                raise ValueError("Expected SHA must be 64 hexadecimal characters")
            receipt["expected_source_matches"] = expected == sha(source)
            if not receipt["expected_source_matches"]:
                receipt["failures"].append("Entry differs from the expected source SHA")
        if args.url:
            body, status = served_bytes(args.url)
            matches = body == source
            receipt["served_entry"] = {"url": args.url, "http_status": status,
                                       "sha256": sha(body), "matches": matches}
            if not matches:
                receipt["failures"].append("Served entry differs from the source file")
        if args.zip:
            prefix = relative_name(args.zip_prefix.rstrip("/\\")) + "/" if args.zip_prefix else ""
            archive_path = Path(args.zip).resolve(strict=True)
            with zipfile.ZipFile(archive_path) as archive:
                members = archive.infolist()
                member_names = [m.filename for m in members]
                if len(member_names) != len(set(member_names)):
                    raise ValueError("ZIP contains duplicate member names")
                for member in members:
                    relative_name(member.filename.rstrip("/"))
                bad_member = archive.testzip()
                if bad_member:
                    raise ValueError(f"ZIP CRC failed: {bad_member}")
                matches = {}
                for name in names:
                    member_name = prefix + name
                    if member_name not in member_names:
                        matches[name] = False
                    else:
                        matches[name] = archive.read(member_name) == initial[name][1]
                    if not matches[name]:
                        receipt["failures"].append(f"ZIP is missing or differs: {name}")
                receipt["zip"] = {"path": str(archive_path), "prefix": prefix,
                                  "crc_ok": True, "files_match": matches,
                                  "all_declared_match": all(matches.values())}
        if args.baseline_receipt:
            baseline = json.loads(Path(args.baseline_receipt).read_text(encoding="utf-8"))
            if baseline.get("schema") != receipt["schema"] or baseline.get("status") != "PASS":
                raise ValueError("Baseline must be a PASS receipt from this verifier")
            old_assets = {k: v["sha256"] for k, v in baseline["files"].items()
                          if k != baseline["entry"]}
            new_assets = {k: v["sha256"] for k, v in files.items() if k != entry}
            receipt["baseline_comparison"] = {
                "path": str(Path(args.baseline_receipt).resolve()),
                "script_tags_equal": scripts == baseline["script_tag_sha256"],
                "declared_assets_equal": old_assets == new_assets,
                "entry_equal": sha(source) == baseline["source_sha256"],
                "meaning": "Descriptive comparison; changed code requires fresh runtime checks.",
            }
        changed = [name for name, (path, data) in initial.items() if path.read_bytes() != data]
        receipt["source_unchanged_during_check"] = not changed
        if changed:
            receipt["failures"].append("Files changed during verification: " + ", ".join(changed))
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile,
            urllib.error.URLError, zlib.error, EOFError) as exc:
        receipt["failures"].append(f"{type(exc).__name__}: {exc}")
    receipt["status"] = "FAIL" if receipt["failures"] else "PASS"
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--entry", default="index.html")
    parser.add_argument("--asset", action="append", default=[])
    parser.add_argument("--url")
    parser.add_argument("--zip")
    parser.add_argument("--zip-prefix", default="")
    parser.add_argument("--expected-sha")
    parser.add_argument("--baseline-receipt")
    parser.add_argument("--out", help="New receipt path; existing files are never overwritten")
    args = parser.parse_args()
    receipt = verify(args)
    encoded = json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        try:
            # Parent creation is explicit caller work; do not alter project structure.
            with Path(args.out).open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(encoded)
        except OSError as exc:
            print(f"Receipt was not written: {exc}", file=sys.stderr)
            return 1
        print(json.dumps({"status": receipt["status"], "receipt": args.out,
                          "failures": receipt["failures"]}, ensure_ascii=False))
    else:
        print(encoded, end="")
    return 0 if receipt["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
