# Independent review — `tools/file-compare` 0.1.0 candidate

2026-10-23 · Claude cloud review (independent of the Codex implementation and of the earlier Claude design note).
Source: `Bum-Boo/designer-skills` branch `codex/shared-delivery-20261023`, explicitly checked out at
**`ac44080ced6c2de83ef210415f8933d7de5d4f44`** (`git checkout --detach ac44080…`; `git rev-parse HEAD` confirmed).
Scope: read README, VALIDATION, `build.mjs`, `src/*`, `test/*`, `vendor/*`, the built HTML, and `skills/asset-delivery/scripts/delivery_manifest.py`. No implementation files changed. All fixtures were synthetic and created in a scratch directory. No private data, accounts, or uploads.

## Verdict

The core comparison is sound. Exact-path + size + SHA-256 matching, case/NFC alias reporting, manifest validation, cancel/reset/re-import state clearing, the 1 MiB chunked hashing past 4 GiB, CSP network blocking, and CLI interoperability all behaved correctly in Chromium. I found no false PASS that happens without a human action. Before calling it releasable, fix **F1** (unreadable 0-byte files) and **F2** (the WebKit `file://` worker cannot read files). The README should not claim Safari/WebKit support until F2 is fixed and checked on a real Mac.

## Environment

| Item | Version |
|---|---|
| OS | Linux 6.18 container (Ubuntu 24.04 userland), no display; `xvfb-run` for WebKitGTK |
| Node / npm | 22.22.0 / 10.9.4 |
| Python | 3.13.16 (`unicodedata.unidata_version` 15.1.0) |
| Chromium | 141.0.7390.37 (Playwright 1.56.1 headless shell, `/opt/pw-browsers`) |
| WebKit | WebKitGTK 2.52.6 MiniBrowser via `WebKitWebDriver` (apt `webkit2gtk-driver`) — **not Safari** |
| Firefox | **Not tested.** Every download host (cdn.playwright.dev, playwright.download.prss.microsoft.com, archive/ftp.mozilla.org, the Launchpad PPA) was refused by the session's egress policy. Ubuntu's `firefox` is a snap. |

The test harness, browsers and fixtures were installed only in the session scratch directory and system apt. Nothing was added to the source tree.

## Build / test reproduction

```
cd tools/file-compare
npm ci --ignore-scripts          # ok; esbuild 0.28.2, hash-wasm 4.12.0
npm test                         # 8/8 pass (287 ms)
npm run build                    # 109974 characters; sha256 be9a4590…f4344e3
cmp <committed dist copy> dist/file-compare.html   # IDENTICAL; git status clean
```

- The rebuilt `dist/file-compare.html` is byte-identical to the committed one: SHA-256 `be9a459065820467f3f954350a1f15ffd3075232ff08a73065ab5d826f4344e3`.
- The worker bundle rebuilt separately with the same esbuild options appears verbatim (JSON-escaped) in the dist HTML.
- `vendor/CaseFolding-16.0.0.txt` matches the README SHA-256 `6f1f9c58…09bb`.

## Case folding (dotless i, Cherokee)

Test 8 only checks the table's own keys against Python, so it would not catch mappings missing from the table. I ran a full-range check instead (all of U+0000–U+10FFFF except surrogates):

- Python 3.13 folds 1,530 code points. `vendor/casefold.json` has 1,557. There are **0 disagreements**, and the 27 table-only entries are Unicode 16 additions.
- The table equals CaseFolding-16.0.0 status `C`+`F` exactly (0 differences). Status `T` (Turkic) is correctly excluded.
- `İ` (U+0130) → `i̇` (U+0069 U+0307). `ı` (U+0131) is unchanged. `ꭰ` (U+AB70) → `Ꭰ` (U+13A0). `ᏸ` (U+13F8) → `Ᏸ` (U+13F0). `ẞ` and `ß` → `ss`.
- In the browser:
  - A folder containing `İ.txt` + `i̇.txt` is rejected as a collision.
  - `ꭰ.txt` + `Ꭰ.txt` is rejected.
  - `ı.txt` + `i.txt` is accepted (correct: they are distinct names).

## Browser evidence (Chromium, built `file://` UI)

Each scenario ran in a fresh `browser.newContext()`. Folders were supplied with **Playwright `setInputFiles(<directory>)` injection, not the OS picker**. Playwright walks the directory itself, so how the browser's real picker enumerates files (hidden files, symlinks, special files) was **not** exercised.

| Scenario | Observed |
|---|---|
| Same folder (70 files, nested Korean names, 3 MiB + 17 B multi-chunk file) | `일치`, report enabled, no console errors, **0 non-file/blob/data requests** |
| 1 missing / 1 extra / same-size change in the last byte of the final 1 MiB chunk | `없음 1 · 추가 1 · 변경 1`; report `comparison` exact |
| Case rename `Project.blend` + NFD `보고서.txt` | 2 missing + 2 extra, with notes `대소문자 등의…` / `이름 표기 방식만 다름` (never treated as the same file) |
| Python CLI manifest import, then received folder | `일치`; reference label `납품` taken from the absolute `target` |
| Invalid import (`file_count` wrong) **after a PASS** | verdict `비교 미완료`, table emptied, report and reference-save disabled |
| Malformed imports: truncated JSON, UTF-16 without BOM, uppercase SHA, `../x`, empty `entries` | All rejected, or `비교 미완료` for the empty list; report never enabled |
| `"__proto__"` as an entry path / top-level key | Treated as an ordinary path; no prototype effects |
| Escape during hashing of a 5 GiB received file (at 1%) | Cancelled. Received side reads `취소했습니다…`, no verdict, report disabled, reference kept |
| 5 GiB **sparse** files, 1 byte differing at offset 4 GiB + 512 | `변경 1` detected in 112 s for 10 GiB hashed (~90 MB/s). Peak total Chromium RSS 495 MB (sampled every 2 s) — memory stays bounded |
| Zero-byte file present, otherwise identical | `0바이트 파일 확인 필요`, report disabled → tick → `일치` + `zero_byte_confirmation: true` → re-pick resets the tick → reset clears all |
| Filename `<img src=x onerror=alert(1)>.txt` | Rendered as text (0 `img` nodes), no script ran |
| Exports | `납품-manifest.json`, `납품-compare.json` (Korean preserved), UTF-8, parse as schema 1 |
| CLI ↔ browser | `delivery_manifest.py same/납품 --compare <browser manifest>` → match. Browser diff report used as CLI baseline vs the diff folder → exit 0 |
| Filename containing `:` | Whole folder rejected (`안전하지 않거나…`), same as the Python CLI |
| 390 px | no page-level horizontal overflow; after a result, focus moves to the `#verdict` heading |
| Keyboard | Tab order: filters → search → table region → saves → reset → details |

Screenshots were taken at 1280 px and 390 px (scratch only, not committed).

Not testable by injection: an empty directory (`setInputFiles` timed out), and anything that depends on the native picker.

## WebKitGTK evidence (not Safari)

- The page loads from `file://`, feature detection passes, and the pick buttons are enabled.
- CSP is enforced: `fetch('https://example.com/')` raised `securitypolicyviolation connect-src`.
- The blob worker starts under `worker-src blob:`.
- Manifest import via WebDriver Send Keys → `납품 · 70개 파일 · 3 MiB`. A later invalid import → `비교 미완료`, report disabled.
- Directory Send Keys gives files without `webkitRelativePath`, and the app correctly refuses (`폴더 경로를 읽지 못했습니다`). A real folder comparison therefore could not be driven in WebKit; see F2.

## Findings

### F1 — Medium: unreadable 0-byte `File`s are hashed as empty, leaving only a checkbox between them and a false PASS
`src/worker.mjs` never reads a file whose `size` is 0. It digests the empty string, so a `File` that the browser reports as 0 bytes **and cannot read** looks identical to a real empty file.

Reproduction (Chromium 141, Playwright 1.56.1, process started **without** `LANG`/`LC_ALL`, i.e. a C locale):
1. Inject `fx/ref` as reference and `fx/same` as received. Both contain a non-ASCII subfolder `납품/`.
2. Every `File` has `size 0`. `file.arrayBuffer()` throws `NotReadableError`; `file.slice(0,0).arrayBuffer()` returns 0 bytes.
3. UI shows `0바이트 파일 확인 필요 · 같음 70 · 0바이트 파일 70개`, reference `ref · 70개 파일 · 0 B`.
4. Tick the confirmation → **`일치`, report enabled**. The two folders were never read.

With the reference taken from a CLI manifest instead, the same received input correctly shows `변경 70`.

The README already calls this an automation artefact. The gate works, but it depends on a person reading "70 files, 0 B" correctly. Fix: when `file.size === 0`, call `await file.arrayBuffer()` (not `slice(0,0)`) and fail on error. That turns this case into a read error before any verdict. Optionally, refuse to offer the tick when every file is 0 bytes.

### F2 — High (compatibility, fails safe): in WebKit, `file://` workers cannot read picked files
WebKitGTK 2.52.6 setup: a real disk file is put into an `<input type=file>` with WebDriver, then posted to a `blob:` worker created by the page. Results:

| Page | `arrayBuffer()` / `slice().arrayBuffer()` inside the worker | Main-thread `slice()` |
|---|---|---|
| `file://…/dist/file-compare.html` (with CSP) | `NotReadableError: The I/O read operation failed.` | 1,048,576 bytes OK |
| `file://…/nocsp.html` (no CSP; page-created `File`) | same error | OK |
| `http://127.0.0.1:8765/nocsp.html` | 1,048,576 / 3,145,745 bytes OK | OK |

The same failure occurs when the real embedded worker bundle hashes a page-created `File`: `a.bin: The I/O read operation failed.` So the cause is the `file://` origin, not the CSP. The app reports `비교를 끝내지 못했습니다`, so there is no false PASS, but **folder hashing would not work in this engine from `file://`.**

Safari on macOS uses the same file-origin model and is likely affected, but **this was not verified on Safari**. The README says "최신 데스크톱 브라우저" and the target audience includes lab Macs. Fix options:
- (a) Read 1 MiB slices on the main thread and transfer each `ArrayBuffer` to the worker, which only hashes. This keeps memory bounded and the UI responsive.
- (b) Detect the read failure and fall back to main-thread hashing.

Then re-test on real Safari, and on Firefox, which has its own `file://` unique-origin rules.

### F3 — Low–Medium (plausible; depends on the real picker): an empty `FileList` keeps the previous verdict
`$(side + '-files').onchange` ignores a change with `files.length === 0`. As a result, `prepareFiles`' empty-folder error (`빈 폴더는 비교할 수 없습니다`) can never be reached from the UI.

Reproduction (Chromium): reach `일치` → clear `#received-files.value` (as the button does) → dispatch `change` with an empty `FileList` → the UI still shows `일치 | 납품 · 70개 파일 | report enabled`.

If a real picker fires `change` when the user selects an empty folder (not verified here), the stale PASS would appear to belong to the newly chosen folder. A dialog cancel fires `cancel`, not `change`, and is unaffected. Fix: on `change`, call `pick()` whenever `change` fires so the empty-folder error shows. Treat the `cancel` event separately.

### F4 — Low: bidirectional/invisible controls in filenames are displayed raw
The file `"q" & ‮txt.exe` is shown in the table as `"q" & exe.txt` (visible in the 1280 px screenshot), so a `.exe` reads as `.txt`. Escaping is otherwise correct (`textContent` everywhere; no HTML injection). Fix: render `Bidi_Control` and default-ignorable code points as visible markers (e.g. `⟨U+202E⟩`) in the path cell. Exported JSON should keep the raw name.

### F5 — Low (UX): size columns are off-screen at 390 px
The page itself doesn't overflow, but the size columns (`기준 크기` / `받은 크기`) sit off-screen inside the table's scroll region, with no visual hint that it scrolls. Consider stacking size under the path on narrow widths.

### Informational (no change required for this candidate)
- **Throughput:** about 90 MB/s in Chromium with sparse (cheap-I/O) files, so a 100 GB delivery takes roughly 18 min per side. Consider stating an expected rate in the README.
- **Number type:** JS accepts `"bytes": 1.0` / `1e3` (parsed as integers), while the Python baseline check rejects non-`int`. This only matters for hand-edited JSON and never produces a false PASS.
- **Kind field:** a `kind: "zip"` CLI manifest is accepted as a folder reference. Comparing an extracted folder against it is reasonable, but the UI doesn't say so.
- **Symlinks / special files:** the browser can't distinguish symlinks, junctions or special files. The Python CLI rejects them, but a browser-vs-browser comparison would silently include whatever the picker returns. This is documented in the README. The injection tests cannot show how the real picker behaves.

## Unresolved limitations of this review
- No manual OS picker on Windows, macOS or Linux; no real Safari; no Firefox; no screen reader.
- WebKit coverage is WebKitGTK on Linux, driven via WebDriver.
- Large-file performance was measured with sparse files, so it reflects hashing cost, not disk I/O.
- No private or real client deliveries were used; per the brief, that is not a blocker.
