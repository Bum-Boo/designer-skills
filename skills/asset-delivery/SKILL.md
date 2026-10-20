---
name: asset-delivery
description: Package local design assets with a verifiable file inventory, compare a delivery folder with its ZIP, and identify missing or changed files before handoff.
license: MIT
compatibility: Python 3.12 or later; standard library only. Local filesystem access.
---

# Asset delivery

Use for a local handoff of artwork, renders, source files, fonts, or documents. Preserve editable sources and include only assets the user may share. Work in a new staging folder; keep originals intact. Requires Python 3.12+ and the bundled standard-library script, including junction detection on Windows. This skill does not upload files or manage cloud permissions.

1. Establish requested formats, expected files, destination, and editable-source requirements. Use descriptive names; distinguish exports from originals.
2. Open actual deliverables and check crop, transparency, page order, text, and linked assets as relevant. Include dependencies and license notices the recipient needs. A hash cannot establish visual quality or usage rights.
3. Inventory the staged folder. Run from the user's working project. Replace `SKILL_DIR` with this installed skill's directory and quote paths containing spaces. Data and receipt paths belong to the working project, outside the installed skill. Store the manifest **outside** the folder being inventoried: shell redirection creates the output before inspection starts.

```sh
python -X utf8 SKILL_DIR/scripts/delivery_manifest.py ./handoff > ./handoff-manifest.json
```

4. Create a ZIP with the project's archive tool, preserving the same relative paths. Keep the ZIP outside the staged folder. The helper does not create archives. Compare its contents with the manifest:

```sh
python -X utf8 SKILL_DIR/scripts/delivery_manifest.py ./handoff.zip --compare ./handoff-manifest.json > ./zip-check.json
```

The helper reads every ZIP member to check CRC and hashes its uncompressed content. Exit 0 means successful inventory, or exact relative-path/size/hash agreement with `--compare`. Exit 1 means mismatch; exit 2 means invalid input or inventory error. Inspect `missing`, `extra`, and `changed`. Unsafe names, duplicate/case-colliding entries, linked targets, and linked folder entries are rejected; ordinary ancestor aliases are resolved. Folder traversal is not an atomic snapshot: stop other writers first.

The redirection examples require PowerShell 7.4+ or a UTF-8 POSIX shell. Earlier Windows PowerShell versions can mangle non-ASCII filenames when decoding native output; use PowerShell 7.4+ for those names. Baseline JSON with a valid UTF-8/16/32 BOM is accepted, but the reader cannot repair filenames already mangled by a shell. See [PowerShell native-output redirection](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection?view=powershell-7.4).

5. Report checked version, file count, bytes, manifest location, actual visual checks, and remaining limitations. Manifests contain absolute target paths and filenames; review them before sharing. Keep receipts locally unless requested in the handoff.

The tool reads inputs and prints JSON or `--format table` to stdout. It does not rename, extract, upload, delete, or modify assets. Redirection is the caller's write operation: choose a new output path. Checks establish local identity, not server content, semantic correctness, or recipient access.

```sh
python -B -X utf8 SKILL_DIR/scripts/test_delivery_manifest.py -v
```
