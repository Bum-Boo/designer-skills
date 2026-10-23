# 파일 비교: browser delivery checker design

2026-10-23, Claude (cloud). Design and specification only. Codex implements it and a separate Claude review verifies it. Base: `7a4f0c1` on `codex/cloud-fixes-20261023`. This document changes no production source, skill or configuration.

## 1. Purpose and boundaries

The designer moves image, video and project folders between Windows, Linux and shared lab Macs. Python is not always installed on those machines, so `delivery_manifest.py` cannot always run there. 파일 비교 is a single HTML file that opens from a USB stick or a synced folder over `file://`. It answers one question: **is the received folder byte-identical to the reference, and if not, which files differ?**

In scope:

- The reference can be a folder or a saved JSON manifest. The received copy is always a folder.
- Streaming SHA-256 of every file without loading whole files into memory.
- Missing, extra, changed and identical rows, with search and filters.
- Export of a manifest and a comparison report that `delivery_manifest.py` can read.

Out of scope: image or video inspection, AE/Blender relinking, ZIP reading (the Python helper covers it), writing or renaming files, upload, accounts, a backend, external CDNs, installers and publishing. The tool does not duplicate the existing Zotero, asset gallery, task tracking or machine dispatch tools.

## 2. Compatibility with the existing helper

`skills/asset-delivery/scripts/delivery_manifest.py` defines the contract. The browser tool must produce and accept the same `schema_version: 1` manifest.

```json
{"schema_version": 1, "target": "…", "kind": "folder",
 "file_count": 2, "total_bytes": 123,
 "entries": [{"path": "art/image.bin", "bytes": 16, "sha256": "<64 lowercase hex>"}]}
```

These are the helper semantics to keep, from `compare()` and `canonical()`:

| Rule | Helper behaviour | Browser requirement |
|---|---|---|
| Path identity | Comparison keys are the **exact** `path` strings, with no normalization | Same. Never match NFC to NFD or `A` to `a` |
| Unsafe path | Rejected when empty, absolute (`/…`), containing `\` or `:`, a `""`/`.`/`..` segment, or any code point < 32 | Same rules, for both manifest entries and received-folder paths |
| Collision | `NFC(path).casefold()` duplicate → reject the whole set | Same. JS has no `casefold`, so use `s.normalize('NFC').toUpperCase().toLowerCase()`; this handles `ß`→`ss`. Add a fixture that cross-checks it against Python. If the two disagree, the browser must be the stricter one |
| `bytes` | `type(x) is int`, ≥ 0 (booleans rejected) | `Number.isSafeInteger(x) && x >= 0`. Values above 2^53−1 are rejected (documented difference) |
| `sha256` | Exactly 64 chars of `[0-9a-f]` | `/^[0-9a-f]{64}$/`; uppercase is rejected |
| Counts | `file_count == len(entries)` and `total_bytes == sum(bytes)` | Same. `total_bytes` must also be a safe integer |
| `schema_version` | `== 1` (Python also accepts `true`/`1.0`) | `=== 1`, which is stricter |
| Encoding | `json.loads(bytes)`: UTF-8/16/32, with or without a BOM | UTF-8 (with or without BOM) and UTF-16 with a BOM through `TextDecoder(…, {fatal:true})`. UTF-32 and BOM-less UTF-16 are rejected with a message (documented difference) |
| Extra keys | Ignored (`target`, `kind`, `comparison`, …) | Ignored on import. They are written on export, see below |
| Entry order | Output sorted by Python `str` order, which is code point order | Sort by **code point**, not by JS default UTF-16 unit order (they differ above U+FFFF) |
| Mismatch vs error | Exit 1 means a difference; exit 2 means invalid input. Invalid input is never reported as a difference | Invalid input reaches the 실패 state, never 차이 있음 |

A manifest import is rejected as a whole on the first violation. The rejection message names the rule and the first offending entry number, never a stack trace. Size cap: 64 MiB of JSON.

The received folder (and a reference folder) uses the same path rules. If any path is unsafe or collides, the folder is refused, as the helper refuses it. The message lists up to 20 offending paths. This guarantees that every exported manifest is also valid helper input.

### Exports

- **목록 저장** (manifest) writes exactly the helper's inventory shape. `target` is the selected folder's top-level name, because the browser cannot see absolute paths. This is the only intended difference from the helper's output, and it is also a privacy gain. Extra key: `"generator": {"name": "파일 비교", "version": "<build>"}`.
- **결과 저장** (report) is the received-folder manifest plus `"comparison": {"match", "missing", "extra", "changed"}`, the same object the helper's `--compare` output carries. It adds `"reference": {"source": "folder"|"manifest", "target", "file_count", "total_bytes"}`. The helper can use it as a baseline, because extra keys are ignored.
- Saving uses a `Blob` and `<a download>`, triggered only by a click. The tool never writes a file on its own. Default names are `<folder>-manifest.json` and `<folder>-compare.json`, written as UTF-8 without a BOM, 2-space indent, with `ensure_ascii=False` equivalence (raw Korean is kept).

Required interop test, in both directions: a browser manifest compared with `delivery_manifest.py <same folder> --compare` gives exit 0, and a helper manifest imported as the reference with the same folder gives 일치.

## 3. Browser mechanics

- **Picking.** Use `<input type="file" webkitdirectory>`. `File.webkitRelativePath` starts with the chosen folder's name (`handoff/art/x.bin`). Strip exactly the first segment to get the manifest `path`. Reset `input.value` before each pick so that picking the same folder again still fires `change`. Drag-and-drop and `showDirectoryPicker` are not part of the first version. The latter is not available in Firefox or Safari.
- **Hashing.** One dedicated Web Worker is created from a `Blob` URL of inline source, because `new Worker('file.js')` is blocked on `file://`. The worker embeds hash-wasm's `sha256.umd.min.js`, pinned at version 4.12.0 (MIT, embedded WASM). For each file: `createSHA256()`, `init()`, then `update(new Uint8Array(await file.slice(o, o+8 MiB).arrayBuffer()))` in a loop, then `digest('hex')`. Only one chunk is in memory at a time. Files are hashed sequentially in code point path order. Progress posts at most 4 times per second and reports bytes, not file count.
- **Integrity checks.** Every hashed byte count must equal `File.size`, or the file counts as a read failure. Any read error (`NotReadableError` when a file was changed or removed after picking, a permission error, or a cloud placeholder that fails to download) moves the run to 실패. No PASS or report export is possible after that. The file stays listed in the table with the label 읽기 실패.
- **Stale state.** A `runId` counter goes up on every new reference, new received folder, cancel, manifest import, failure or 다시 비교. On each bump, `worker.terminate()` runs, a fresh worker starts if needed, the verdict and report export are cleared, and any message carrying an old `runId` is dropped. Export buttons read state from the current `runId` only.
- **Content Security Policy** (in a meta tag): `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`. `connect-src 'none'` makes "no network" enforced, not just promised. The page loads no fonts, images or scripts from outside.
- **Build.** Source lives in a small folder (suggested: `tools/file-compare/`). A dependency-free Node build script inlines the CSS, the app JS and the vendored hash-wasm file into a single `file-compare.html`. The vendored file's SHA-256 is recorded and checked in tests, and the hash-wasm MIT notice is kept in an HTML comment and on the 정보 screen. Where the built file ships is Codex's call; next to `skills/asset-delivery/` is the natural home, provided `scripts/validate.py` accepts it.

### Honest limits (shown in the UI under 비교 범위)

- **Empty folders** are not listed by the picker, so they are not compared. The helper does not list them either.
- **Symlinks and junctions.** The helper rejects them. The browser cannot see them: depending on the browser and OS, the picker may follow them, skip them or fail. The tool therefore cannot promise "no links". Say so, and point to `delivery_manifest.py` for link-sensitive deliveries.
- **Hidden and system files** (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`) are listed whenever the browser provides them. They count as 추가 or 없음 like any other file. A filter may hide them from view (시스템 파일 숨기기), but the verdict always counts them, and the summary says how many are hidden.
- **Unicode normalization.** macOS copies often carry NFD Korean names; Windows and Linux usually carry NFC. Paths that differ only in normalization or case stay separate missing and extra rows, so the verdict is 차이 있음. The UI pairs them with a note on both rows (이름 표기 방식만 다름 / 대소문자만 다름) so the designer understands what happened. It never treats the pair as identical.
- **Snapshot.** Picking is not an atomic snapshot. Files changed during the run are caught only when the browser raises a read error. Stop syncing and copying before comparing.
- **Meaning of 일치.** The same relative paths with the same bytes. It says nothing about visual quality, rights, timestamps, permissions, empty folders, or whether the recipient can open the files.
- **Mobile.** Folder picking is not supported in mobile browsers. Show 데스크톱 브라우저에서 열어 주세요.

## 4. Smallest flow

1. Open `file-compare.html`. The reference and received slots are both empty.
2. **Reference.** Choose 폴더 선택 or 목록 불러오기. A folder is hashed right away; a manifest is validated and shows its file count and size.
3. **Received.** Choose 폴더 선택. Hashing starts, with progress and a 취소 button.
4. When both sides are complete, the verdict is computed: 일치 or 차이 있음. Focus moves to the verdict.
5. Filter, search and inspect rows. Export with 결과 저장 or 목록 저장.

If the received folder finishes first, it waits for the reference. Cancelling either side keeps the other side's finished result but clears the verdict.

## 5. Korean UX copy

| Place | Copy |
|---|---|
| Title / tab | 파일 비교 |
| Privacy line (header, muted) | 파일은 이 컴퓨터 안에서만 읽습니다. 업로드하지 않습니다. |
| Reference slot label | 기준 |
| Received slot label | 받은 폴더 |
| Buttons | 폴더 선택 · 목록 불러오기 · 취소 · 다시 비교 · 결과 저장 · 목록 저장 |
| Empty slot hint | 비교할 원본 폴더나 저장해 둔 목록(JSON)을 고르세요. / 전달받은 폴더를 고르세요. |
| Ready | 128개 파일 · 3.2 GB |
| Hashing | 확인 중 41% · 1.3 / 3.2 GB |
| Cancelled | 취소했습니다. 다시 고르면 처음부터 확인합니다. |
| Verdict: identical | 일치 — 128개 파일의 경로와 내용이 모두 같습니다. |
| Verdict: different | 차이 있음 — 없음 2 · 추가 1 · 변경 1 · 같음 125 |
| Row statuses | 없음 (기준에만 있음) · 추가 (받은 폴더에만 있음) · 변경 (내용이 다름) · 같음 · 읽기 실패 |
| Pair notes | 이름 표기 방식만 다름 (유니코드 정규화) · 대소문자만 다름 |
| Zero-byte notice | 0바이트 파일 3개가 있습니다. 원본에서도 비어 있는지 확인하세요. |
| Read failure | 파일 1개를 읽지 못해 비교를 끝내지 못했습니다. 복사가 끝났는지 확인하고 다시 고르세요. |
| Bad manifest | 이 목록은 사용할 수 없습니다: {reason} ({n}번째 항목) |
| Reasons | 형식이 다릅니다 · 안전하지 않은 경로 · 겹치는 이름 · 파일 수 또는 크기 합계가 맞지 않습니다 · 지원하지 않는 인코딩 |
| Refused folder | 이름이 겹치거나 안전하지 않은 경로가 있어 비교할 수 없습니다. |
| Search placeholder | 경로 검색 |
| Filter extras | 시스템 파일 숨기기 · 해시 보기 |
| Scope link / panel | 비교 범위 — 빈 폴더와 바로가기(링크)는 비교하지 않습니다. 일치는 경로와 내용이 같다는 뜻이며, 화질이나 사용 권리는 확인하지 않습니다. |
| Unsupported | 이 브라우저는 폴더 선택을 지원하지 않습니다. 데스크톱 Chrome, Edge, Firefox, Safari에서 열어 주세요. |

The UI says 해시 only in the optional column. It avoids words like worker, WASM, NFC, exit code or schema in visible copy; the reference terms belong in the 정보 screen.

## 6. Visual design

**Character.** A quiet working surface. The comparison table is the main object and fills the remaining height. Sources and the verdict sit above it as compact rows, not as cards. There is no hero section, illustration, card grid or decorative rule; grouping comes from spacing and a single surface change.

**Palette** (CSS custom properties on `:root`, dark values under `prefers-color-scheme: dark`):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F5F2` | `#18191B` | page |
| `--surface` | `#FFFFFF` | `#212225` | table, source rows |
| `--line` | `#E3E1DB` | `#33353A` | table row lines only |
| `--text` | `#1E1F22` | `#E9E7E2` | body |
| `--muted` | `#5D5F65` | `#A4A6AC` | sizes, hints |
| `--accent` | `#2B59D1` | `#8EA9FF` | primary button, focus ring, selected filter |
| `--missing` | `#B0261C` | `#FF8F85` | 없음, failure |
| `--extra` | `#875700` | `#E7B45A` | 추가 |
| `--changed` | `#6A3FB5` | `#C2A5FF` | 변경 |
| `--same` | `#2D6A3E` | `#8FCB9C` | 같음, 일치 |

Every status pairs color with a glyph and a word: `−` 없음, `+` 추가, `≠` 변경, `=` 같음, `!` 읽기 실패. Text must reach at least 4.5:1 contrast against `--surface`, and the focus ring at least 3:1. Codex verifies the final values with a contrast checker rather than trusting these numbers. Status color tints only the status cell, never the whole row, except for a faint `--missing` row background when a read fails.

**Typography.** No web fonts. The stack is `system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`. Monospace (`ui-monospace, "SF Mono", Consolas, "D2Coding", monospace`) is used for hashes only. Paths stay in the sans stack so Korean names read well.

| Role | Size / weight | Notes |
|---|---|---|
| Tool name | 18px / 600 | one line, top left |
| Verdict | 16px / 600 | `<h2>`, receives focus |
| Labels, filters | 13px / 600 | |
| Body, hints | 14px / 400, line height 1.5 | |
| Table cells | 13px / 400 | `font-variant-numeric: tabular-nums`; sizes right-aligned |
| Hash | 12px mono | first 12 chars plus `…`; the full value shows on focus or hover and through the 해시 보기 toggle |

`word-break: keep-all` applies to Korean prose. Paths use `overflow-wrap: anywhere` so long names never force horizontal scroll.

### Layout (≥ 960px)

```
┌────────────────────────────────────────────────────────────────────────┐
│ 파일 비교                       파일은 이 컴퓨터 안에서만 읽습니다.  정보 │
│                                                                        │
│ 기준      [폴더 선택] [목록 불러오기]   handoff · 128개 · 3.2 GB        │
│ 받은 폴더 [폴더 선택]                   handoff · 129개 · 확인 중 41% [취소] │
│           ▓▓▓▓▓▓▓▓░░░░░░░░░░ 1.3 / 3.2 GB                              │
│                                                                        │
│ 차이 있음 — 없음 2 · 추가 1 · 변경 1 · 같음 125                        │
│ (전체 129)(없음 2)(추가 1)(변경 1)(같음 125)   [경로 검색______] ☐ 해시 보기 │
│ ┌────────┬──────────────────────────────────┬─────────┬─────────┐      │
│ │ 상태   │ 경로 ▲                           │ 기준    │ 받은    │      │
│ ├────────┼──────────────────────────────────┼─────────┼─────────┤      │
│ │ − 없음 │ render/shot_010.mov              │ 1.2 GB  │ —       │      │
│ │ ≠ 변경 │ project/main.aep                 │ 48.1 MB │ 48.3 MB │      │
│ │ + 추가 │ render/보고서.txt                │ —       │ 2 KB    │      │
│ │        │   이름 표기 방식만 다름 ↔ render/보고서.txt (없음)         │      │
│ │ = 같음 │ textures/wood_albedo.png         │ 8.4 MB  │ 8.4 MB  │      │
│ │ …      │                                  │         │         │      │
│ └────────┴──────────────────────────────────┴─────────┴─────────┘      │
│ 비교 범위 · 시스템 파일 숨기기 ☐          [목록 저장 ▾]  [결과 저장]      │
└────────────────────────────────────────────────────────────────────────┘
```

- **Width.** At most 1200px, centered. The table section is the only scrolling region, with a sticky header. The source rows and the verdict stay visible.
- **640–959px.** Same structure. The size columns merge into one column, `1.2 GB → —`.
- **Below 640px.** Source rows stack as label, then buttons, then summary. Filters wrap. Table rows become two-line rows (path on top, then status and sizes) using the same `<table>` semantics with a CSS `display` change, not a card grid. Gutters are 16px, with no horizontal page scroll.
- **Default order.** 읽기 실패, 없음, 변경, 추가, 같음, then code point path order. Clicking the 경로 header switches to path order.
- **Large folders.** The table body is windowed above 2,000 rows (fixed row height, about 40 visible rows plus a buffer). Search and filter run on the full in-memory model.
- **Search.** Substring match on the NFC form, case-insensitive. Normalization applies only to matching; the displayed text is always the exact path. 같음 rows stay included unless filtered out.

## 7. States

| State | Visible | Export |
|---|---|---|
| 비어 있음 | Empty slot hints; table placeholder 두 쪽을 고르면 여기에 비교 결과가 나옵니다. | none |
| 확인 중 (either side) | Progress bar and bytes; 취소 enabled; table shows nothing yet | none |
| 한쪽 준비됨 | That side's count and size; the verdict area waits for the other side | 목록 저장 for the finished folder side |
| 취소됨 | Cancelled copy; the side returns to 비어 있음 | finished other side only |
| 실패 | Read failure, refused folder or bad manifest copy in `--missing`; no verdict | 목록 저장 of an intact other side only; never 결과 저장 |
| 일치 | Verdict line in `--same` with `=`; table shows 같음 rows | 결과 저장 and 목록 저장 |
| 차이 있음 | Verdict line with counts; 같음 rows filtered out by default | 결과 저장 and 목록 저장 |

New picks, a new import, 취소 and 다시 비교 always pass through a cleared verdict, because the `runId` goes up. A PASS is never shown from data read before the latest selection.

## 8. Accessibility and focus

- `<html lang="ko">`, with one `<h1>` and the verdict as an `<h2>`. The table is a real `<table>` with `<th scope="col">` and `aria-sort` on the path header.
- Inputs are native `<input type=file>` elements with visible `<label>` buttons, operable with Enter and Space.
- Progress uses `role="progressbar"` with `aria-valuenow`. A polite live region announces start, every 25%, completion and failure, not every tick. Failures use `role="alert"`.
- After the verdict, focus moves to the verdict `<h2>` (`tabindex="-1"`). After a cancel, focus returns to the side's 폴더 선택 button.
- Filters are a group of toggle buttons with `aria-pressed`. Each label includes its count (`없음 2`). Changing a filter announces `{n}개 표시`.
- Focus is drawn as `outline: 2px solid var(--accent); outline-offset: 2px` on `:focus-visible` and is never removed. Esc cancels an active run when focus is inside the page.
- The UI never relies on color alone, respects `prefers-reduced-motion` (no animated progress stripes), and stays usable at 200% zoom.

## 9. Acceptance flows

Fixtures are synthetic only; no real personal files.

| # | Setup | Expected |
|---|---|---|
| A1 | The same folder picked as both reference and received | 일치. The exported manifest, compared with `delivery_manifest.py <folder> --compare`, gives exit 0 and byte-identical `entries` |
| A2 | Helper manifest imported as reference, same folder received | 일치. Then delete one file, add one, change one byte and re-pick: 없음 1 · 추가 1 · 변경 1, matching the helper's `comparison` arrays exactly |
| A3 | A file larger than 4 GiB (sparse or generated) | Hash equals `sha256sum`; tab memory stays bounded (no growth proportional to file size); progress moves |
| A4 | Cancel at about 30%, then pick a different received folder | The old progress never reappears and no verdict comes from the old run. A deliberately delayed old-run worker message is ignored |
| A5 | Manifests that are invalid in each way listed in §2 (bad JSON, `schema_version:"1"`, a boolean or `1.5` `bytes`, uppercase hash, `../x`, `a\b`, `C:x`, `a//b`, a control character, `A.txt` with `a.txt`, `ß` with `ss`, `file_count` off by one, `total_bytes` off by one, BOM-less UTF-16) | Each rejected with the matching reason; the state is 실패 and no comparison starts. Every case the Python helper also rejects gets exit 2 there |
| A6 | Reference holds `보고서.txt` in NFC; received holds it in NFD | 없음 1 + 추가 1, both carrying the 이름 표기 방식만 다름 note. Verdict 차이 있음 |
| A7 | A file made unreadable, or removed, after picking | 읽기 실패 row; state 실패; 결과 저장 disabled |
| A8 | Received folder contains `.DS_Store` | Counted as 추가. With 시스템 파일 숨기기 on, it is hidden from view but still counted in the verdict |
| A9 | Keyboard only (Tab, Enter, Space, Esc), plus a screen reader smoke test (VoiceOver or NVDA) | The full flow A2 completes and the verdict is announced |
| A10 | Open the built file with the network disabled, with the DevTools network panel open | Zero network requests; no CSP violations in the console |
| A11 | Linux started with no UTF-8 locale (see §10) | Either correct hashes or a visible problem; a silent 일치 between two wrongly read folders counts as a failure of this test |

## 10. What was actually tested in this design pass

A throwaway probe was run in the cloud container, not committed, at `/tmp/…/scratchpad/probe`. It used Chromium 141.0.7390.37 headless through Playwright 1.56, with the page opened over `file://` under the CSP above. A blob-URL worker loaded the inlined hash-wasm 4.12.0 `sha256.umd.min.js` and hashed files in 8 MiB `slice()` chunks. The folder was injected with Playwright `setInputFiles(dir)`, **not a real OS picker**.

Observed:

- The blob worker and the embedded WASM run on `file://` under `worker-src blob:` with `'wasm-unsafe-eval'`. A 70 MiB file's hash matched `sha256sum`.
- `webkitRelativePath` starts with the folder name (`handoff/…`). An NFD Korean name kept its decomposed code points (`U+1107 U+1169 …`). A dotfile was included. The empty folder did not appear.
- The symlink was absent. This reflects Playwright's directory walk, not proven picker behaviour.
- **Risk found:** with no locale set (`LANG` empty), Chromium reported Korean-named files as **0 bytes** and hashed them as empty, without any error. With `LANG=C.UTF-8` the hashes were correct. If both folders were read on such a machine, they could falsely come out 일치. This is why the zero-byte notice and acceptance flow A11 exist. Whether a real picker on a lab Linux desktop shows this needs a manual check.

Everything else in this document is **designed, not tested**: real pickers on any OS, Safari and Firefox behaviour, downloads from `file://`, and files over 4 GiB.

### Validation matrix (to fill during implementation review)

| OS / browser | Opens on file://, worker + WASM | Folder pick, Korean NFC/NFD names | >4 GiB file | Cancel / re-pick | Export download | Status |
|---|---|---|---|---|---|---|
| Windows 11, Edge / Chrome current | ☐ | ☐ | ☐ | ☐ | ☐ | untested |
| Windows 11, Firefox current | ☐ | ☐ | ☐ | ☐ | ☐ | untested |
| macOS (lab), Safari current | ☐ (check `'wasm-unsafe-eval'`) | ☐ (NFD expected) | ☐ | ☐ | ☐ | untested |
| macOS (lab), Chrome current | ☐ | ☐ | ☐ | ☐ | ☐ | untested |
| Linux desktop, Firefox current | ☐ | ☐ | ☐ | ☐ | ☐ | untested |
| Linux, Chromium 141 headless (Playwright injection) | ✔ | partial (✔ with UTF-8 locale; ✘ 0 bytes without a locale) | ☐ | ☐ | ☐ | probe only |

Record the browser version, OS build and fixture for each cell. Note "real picker" versus "automation".

## 11. Later tools (prioritized)

1. **DOI / citation consistency check (next).** It reads an existing Zotero export (CSL JSON, BibTeX or RIS) and optionally the citation keys found in a thesis or paper draft. It reports keys cited but missing from the export, entries with duplicate DOIs, malformed DOIs, and the same DOI with conflicting title or year. It is useful every week while writing and before each advisor or journal submission, which is when citation errors are costly. Privacy and host fit: it works offline on files the user already exported, and never writes to the Zotero database, so it does not duplicate Zotero. Online DOI resolution would reveal the reading list to doi.org or Crossref, so it stays an explicit, off-by-default step, and the manuscript itself is never sent anywhere. The same single-HTML, `connect-src 'none'` pattern carries over.
2. **Reference to AE/Blender production brief (after AE native validation).** It turns a chosen reference set from the existing asset gallery into a structured brief: shot list, timing, camera, materials, and what has to stay editable. The existing `after-effects-production` and `blender-production` skills already consume this kind of brief. It is useful at the start of each production project, not daily. It needs real visual judgment, so it fits an agent skill rather than a browser tool. The references may be unpublished or licensed, so they stay local, with no default hosted generation service. It comes second because the AE native build/save/reopen path is still unverified (`docs/scope.md`), and a brief is only worth as much as the pipeline that executes it.
