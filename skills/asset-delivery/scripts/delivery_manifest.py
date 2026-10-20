"""Read-only inventory of a folder or ZIP; JSON/table on stdout, optional comparison."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import unicodedata
import zipfile
import zlib


def digest(stream):
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        h.update(chunk)
    return h.hexdigest()


def signature(info):
    return info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_ino


def file_hash(path):
    with path.open("rb") as stream:
        before = signature(os.fstat(stream.fileno()))
        value = digest(stream)
        if signature(os.fstat(stream.fileno())) != before:
            raise ValueError(f"file changed during read: {path}")
    return before[0], value


def linked(path):
    return path.is_symlink() or getattr(os.path, "isjunction", lambda p: False)(path)


def canonical(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name:
        raise ValueError(f"unsafe entry path: {name!r}")
    if name.startswith("/") or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError(f"unsafe entry path: {name!r}")
    if any(ord(c) < 32 for c in name):
        raise ValueError("control character in entry path")
    return unicodedata.normalize("NFC", name).casefold()


def inventory(target):
    if linked(target):
        raise ValueError("symlink/junction target forbidden")
    # Resolve system/user aliases while refusing links inside the chosen folder.
    target = target.resolve()
    entries = []
    archive_sha = None
    if target.is_dir():
        for directory, dirs, files in os.walk(target, followlinks=False):
            for name in dirs + files:
                if linked(Path(directory) / name):
                    raise ValueError(f"symlink/junction entry forbidden: {name}")
            for name in files:
                path = Path(directory) / name
                if not stat.S_ISREG(path.stat().st_mode):
                    raise ValueError(f"not a regular file: {path}")
                size, value = file_hash(path)
                entries.append({"path": path.relative_to(target).as_posix(), "bytes": size, "sha256": value})
        kind = "folder"
    elif target.is_file() and zipfile.is_zipfile(target):
        before = signature(target.stat())
        with zipfile.ZipFile(target) as archive:
            for item in archive.infolist():
                canonical(item.filename.rstrip("/") if item.is_dir() else item.filename)
                if stat.S_ISLNK(item.external_attr >> 16):
                    raise ValueError(f"ZIP symlink forbidden: {item.filename}")
                if item.is_dir():
                    continue
                with archive.open(item) as stream:
                    value = digest(stream)  # ZipExtFile checks CRC while reading to EOF.
                entries.append({"path": item.filename, "bytes": item.file_size, "sha256": value})
        _, archive_sha = file_hash(target)
        if signature(target.stat()) != before:
            raise ValueError("ZIP changed during inventory")
        kind = "zip"
    else:
        raise ValueError("target must be a folder or readable ZIP")
    seen = set()
    for item in entries:
        name = canonical(item["path"])
        if name in seen:
            raise ValueError(f"duplicate/case-colliding entry: {item['path']}")
        seen.add(name)
    result = {"schema_version": 1, "target": str(target), "kind": kind,
              "file_count": len(entries), "total_bytes": sum(e["bytes"] for e in entries),
              "entries": sorted(entries, key=lambda e: e["path"])}
    if archive_sha:
        result["archive_sha256"] = archive_sha
    return result


def compare(current, baseline):
    if not isinstance(baseline, dict) or baseline.get("schema_version") != 1 or not isinstance(baseline.get("entries"), list):
        raise ValueError("baseline must be a schema_version=1 delivery manifest")
    expected = {}
    seen = set()
    for row in baseline["entries"]:
        if not isinstance(row, dict) or not {"path", "bytes", "sha256"} <= row.keys():
            raise ValueError("invalid baseline entry")
        name = canonical(row["path"])
        if name in seen or type(row["bytes"]) is not int or row["bytes"] < 0:
            raise ValueError("duplicate or invalid baseline entry")
        if not isinstance(row["sha256"], str) or len(row["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in row["sha256"]):
            raise ValueError("invalid baseline SHA-256")
        seen.add(name)
        expected[row["path"]] = row
    if baseline.get("file_count") != len(expected) or baseline.get("total_bytes") != sum(r["bytes"] for r in expected.values()):
        raise ValueError("baseline count/size inconsistent")
    actual = {e["path"]: e for e in current["entries"]}
    missing = sorted(expected.keys() - actual.keys())
    extra = sorted(actual.keys() - expected.keys())
    changed = sorted(p for p in expected.keys() & actual.keys()
                     if any(expected[p][k] != actual[p][k] for k in ("bytes", "sha256")))
    return {"match": not (missing or extra or changed), "missing": missing, "extra": extra, "changed": changed}


def table(result):
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ")
    lines = [f"Files: {result['file_count']} | Bytes: {result['total_bytes']}", "",
             "| Path | Bytes | SHA-256 |", "|---|---:|---|"]
    lines += [f"| {cell(e['path'])} | {e['bytes']} | {e['sha256']} |" for e in result["entries"]]
    if "comparison" in result:
        lines += ["", json.dumps(result["comparison"], ensure_ascii=False)]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--compare", type=Path, help="prior JSON delivery manifest; exact relative paths")
    parser.add_argument("--format", choices=("json", "table"), default="json")
    args = parser.parse_args()
    try:
        result = inventory(args.target.absolute())
        code = 0
        if args.compare:
            result["comparison"] = compare(result, json.loads(args.compare.read_bytes()))
            code = 0 if result["comparison"]["match"] else 1
        print(json.dumps(result, ensure_ascii=False, indent=2) if args.format == "json" else table(result))
        return code
    except (OSError, ValueError, TypeError, zipfile.BadZipFile, zlib.error, EOFError, RuntimeError, NotImplementedError) as error:
        print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
