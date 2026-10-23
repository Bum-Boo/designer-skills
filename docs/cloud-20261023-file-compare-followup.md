# Independent follow-up review — `tools/file-compare` F1–F5 fixes

2026-10-23 · Claude cloud review, independent of the Codex implementation.
Source: `Bum-Boo/designer-skills` branch `codex/shared-delivery-20261023`, explicitly checked out at
**`b33120e2a569809f3bd398f0e66ce0ceb19361cc`** (`git checkout --detach b33120e…`; `git rev-parse HEAD` confirmed).
Prior report: `docs/cloud-20261023-file-compare-review.md` (source `ac44080`).
Scope: the `ac44080..b33120e` diff (`src/app.mjs`, `src/worker.mjs`, `src/read-chunks.mjs`, `src/core.mjs` `visibleText`, `src/style.css`, README, `test/stream.test.mjs`) and the rebuilt HTML. I did not change any implementation files. All fixtures were synthetic and lived in the session scratch directory. No accounts, private inputs, uploads or purchases.

The root session is re-running the four real devices (Arch Brave, macOS Chrome, personal Windows Edge, lab Windows Edge including 4 GiB+7). **Those are not my tests**, and nothing below claims them.

## Verdict

**I found no blocker within the tested scope.** F1–F5 are fixed:

- **F1:** An unreadable 0-byte file now fails before any verdict.
- **F2:** WebKitGTK `file://` now hashes correctly, because reads happen on the page. Reading a picked File inside a worker still fails in that engine, and the app no longer does it.
- **F3:** An empty `change` and a pick click both clear a previous PASS.
- **F4:** Bidi and invisible characters in names are shown as `⟨U+XXXX⟩` markers. Exports keep the raw path.
- **F5:** At 390 px, sizes appear under the path.

I found no false PASS from cancellation, stale reads, a re-pick, read errors, or malformed RPC. The remaining notes (N1–N4) are low severity and none can produce a PASS.

## Environment

| Item | Version |
|---|---|
| OS | Linux 6.18 container, Ubuntu 24.04.5 userland, no display (`xvfb-run -a` for WebKitGTK) |
| Node / npm | 22.22.0 / 10.9.4 |
| Chromium | 141.0.7390.37 (Playwright 1.56.1 headless shell, `/opt/pw-browsers`) |
| WebKit | WebKitGTK 2.52.6 MiniBrowser (`libwebkit2gtk-4.1-0 2.52.6-0ubuntu0.24.04.1`), driven by `WebKitWebDriver` from apt `webkit2gtk-driver 2.52.6`. UA string `…AppleWebKit/605.1.15 … Version/60.5 Safari/605.1.15`. **This is not Safari.** |
| Firefox | **Not tested.** There is no local binary. One bounded check, `curl https://playwright.download.prss.microsoft.com/…/firefox/1495/firefox-ubuntu-24.04.zip`, failed with `CONNECT tunnel failed, response 403`. I made no further attempts. |

## Build / test reproduction

```
cd tools/file-compare
sha256sum dist/file-compare.html   # 8cee898848f1afc2f6078cc926903c61584d23cb72a1e3e5d4c5a7bf4c621b50 (committed)
npm ci --ignore-scripts            # ok; esbuild 0.28.2, hash-wasm 4.12.0
npm test                           # tests 11, pass 11, fail 0 (316 ms)
npm run build                      # 112447 characters; sha256 8cee898848f1afc2f6078cc926903c61584d23cb72a1e3e5d4c5a7bf4c621b50
cmp <saved committed copy> dist/file-compare.html   # IDENTICAL; git status clean
```

The rebuilt HTML is byte-identical to the committed one and matches the expected SHA-256.

## Code review: RPC, cancellation, stale reads, worker termination

The page now drives a strict request/acknowledge protocol. It sends `start → (file → chunk* → file-end)* → finish`, with one `pending` request at a time and a global, increasing `id`. Each message is tagged with `runId = state.generation`.

- **Stale replies.** `onmessage` drops a reply unless `runId`, `state.active` and `pending.id` all match. `stop()` increments `generation`, rejects `pending`, and terminates and revokes the worker. Any in-flight `request()` therefore rejects. The resulting `fail(oldRunId)` is a no-op because the generation has changed.
- **Stale reads.** Every `await` in `pick()` that is not a `request()` (the `fileChunks` reads) is followed by `if (runId !== state.generation) return` before the next `request()`. I traced each place `request()` is called. All of them are reached synchronously after a generation check, or right after a resolved request, in the same microtask chain. So a stale run cannot post into a newer run's worker under the new `generation` tag. As a second guard, `request()` refuses while another request is pending.
- **Worker-side validation.**
  - The worker rejects a mismatched `runId`, and any request before `start`.
  - It rejects a `file` while another file is open, a non-`ArrayBuffer` chunk, a chunk over 1 MiB, and cumulative bytes over the declared size.
  - It rejects `file-end` unless the bytes read equal the declared size, and `finish` while a file is open or when `entries.length !== fileCount`.
  - On the page, `fileChunks` checks every slice's `byteLength` against the expected size, so short and long reads both fail before the worker sees them.
- **Zero-byte probe.** `size === 0` reads the original `File` with `arrayBuffer()`, not `slice(0,0)`, then requires 0 bytes back.
- **Memory.** At most one 1 MiB buffer is in flight. Transferring it detaches it on the page.

## Browser evidence — Chromium 141, built `file://` UI

Folders were supplied with Playwright `setInputFiles(<dir>)` injection, **not the OS picker**. Each scenario ran in a fresh context.

Fixtures (`ref`, `same`, `diff`) each hold 9 files:
- a 3 MiB + 17 B multi-chunk `납품/big.bin`;
- a legitimate `empty.txt`;
- `"q" & U+202E txt.exe`;
- `a U+200D b.txt`;
- five Korean-path text files.

`diff` flips the **final byte** of `big.bin`, which falls in the 4th (partial) chunk.

| Scenario | Observed |
|---|---|
| ref vs same (UTF-8 locale) | `0바이트 파일 확인 필요`, report disabled → tick → `일치`, report enabled. 0 console errors, **0 non-file/blob/data requests** |
| ref vs diff (final-byte change) | `차이 있음 · 변경 1 · 같음 8`; the only changed row is `납품/big.bin` |
| **F1 retest, C locale.** Node and Chromium launched with `LANG`/`LC_ALL`/`LC_CTYPE`/`LANGUAGE` unset | Every non-ASCII-named `File` has `size 0`. `arrayBuffer()` gives `NotReadableError`, while `slice(0,0).arrayBuffer()` gives 0 (the old blind spot). The ASCII `empty.txt` reads 0 bytes legitimately. App: reference → `비교 미완료`, `"q" & ⟨U+202E⟩txt.exe: The requested file could not be read…`, report disabled, zero tick not offered. The same happens after picking received. **No path to PASS.** |
| Legitimate empties (one 0-byte file each side) | `0바이트 파일 확인 필요` → tick → `일치`. The probe does not reject real empty files. |
| **F3.** Empty `change` after `일치` (`value=''` plus a `change` event with an empty `FileList`) | `비교 미완료`, `빈 폴더는 비교할 수 없습니다`, received `확인 실패`, report disabled |
| F3: clicking **받은 폴더 선택** after `일치` (native chooser intercepted) | The verdict resets to `두 쪽을 고르면…` and received is cleared **before** the chooser opens |
| Cancel and re-pick with delayed reads (every `Blob.arrayBuffer` delayed 400 ms by an init script) | Escape mid-read → `취소했습니다…`, no verdict. Then re-picks while delayed reads were outstanding: `same→diff`, `same2→diff2`, `diff→same`, `diff2→same2`. Each final verdict matched the **last** pick (`변경 1`, or `0바이트 확인 필요` with 9 same). Stale reads resolving 1.5 s later changed nothing. No errors. |
| Read error on the page: a non-first `big.bin` slice rejects `NotReadableError` | `비교 미완료`, `납품/big.bin: I/O`, report disabled |
| Short slice (1 byte fewer) / long slice (1 extra byte) | Both `비교 미완료 … 파일을 끝까지 읽지 못했습니다` |
| `postMessage` of a chunk throws `DataCloneError` | `비교 미완료`; the request rejects, `pending` is cleared |
| Worker terminated by the page before acknowledging `file-end` | **Stays busy** (no reply and no `error` event); see N1. No verdict, report disabled, cancel available |
| An acknowledgment with a mismatched id (chunk #3 sent with `id:-1`) | Reply ignored; that run **stays busy** until a re-pick, which then completes normally (N1) |
| **F4.** Bidi/invisible characters in names | The table shows `"q" & ⟨U+202E⟩txt.exe` and `a⟨U+200D⟩b.txt`. Errors also use `visibleText`. The exported `same-compare.json` keeps the raw U+202E and U+200D and contains no `⟨U+` markers. Download name `same-compare.json`. |
| **F5.** 390 × 844 | Page overflow 0, `#table-wrap` overflow 0. Size columns `display:none`. `.mobile-sizes` is `block` and reads `기준 3 MiB / 받은 3 MiB` |

Harness note: Playwright `setInputFiles` hangs when the input is re-injected with the **same directory** it already holds. This also happens on a bare `data:` page with `<input webkitdirectory>`, so it is a tool artefact, not an app bug. Re-pick tests therefore used distinct copies (`same2`, `diff2`).

## WebKitGTK evidence (same engine family, **not Safari**)

Setup:
```
apt-get install -y webkit2gtk-driver
xvfb-run -a WebKitWebDriver --port=4444 &
# W3C session: browserName MiniBrowser,
#   webkitgtk:browserOptions {binary: /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser, args: [--automation]}
```

WebDriver Send Keys cannot fill a `webkitdirectory` input with relative paths (see the prior report). So **real disk-backed `File`s** were sent to a plain `<input type=file multiple>` that I added to the page. `webkitRelativePath` was then defined on each `File` instance, and the app's own `#received-files.onchange` / `#reference-files.onchange` handler was called with them. This runs the real `pick → fileChunks → worker RPC` path on disk-backed files from the `file://` page with CSP, but **not** the native directory picker or a native `change` event.

| Check | Result |
|---|---|
| Feature detection (`webkitdirectory`, Worker, WebAssembly) | Pass; pick buttons enabled |
| **Original F2 control.** A disk-backed `big.bin` `File` posted to a `blob:` worker, `slice(0,1 MiB).arrayBuffer()` inside the worker | **Still `NotReadableError: The I/O read operation failed.`**. The engine limitation is unchanged. |
| Main-thread `slice(0,1 MiB).arrayBuffer()` / 0-byte `arrayBuffer()` | 1,048,576 / 0 |
| App: ref vs same | `0바이트 파일 확인 필요` → tick → `일치`, report enabled |
| App: ref vs diff (final byte) | `차이 있음 · 변경 1 · 같음 8`; changed row `납품/big.bin` |
| Empty `change` after a result | `비교 미완료`, `빈 폴더는 비교할 수 없습니다` |
| Reads delayed 300 ms; cancel mid-run; re-pick diff then same while busy | Cancel → `취소했습니다…`. The final verdict matches the last pick (same), stable after 1.5 s |
| Bidi display (separate in-memory 2-file run, `all` filter) | `"q" & ⟨U+202E⟩txt.exe`, `일치` |

**F2 is resolved in WebKitGTK 2.52.6 `file://`.** Safari on macOS was **not** tested. That still needs a real Mac.

## Notes (none blocking)

- **N1. Low (liveness, not correctness).** If the worker dies without an `error` event, or a reply never arrives, the run waits indefinitely: `파일 내용을 확인하고 있습니다…`, with cancel available. The previous design had the same property. I reproduced it only with injected faults (page-side `terminate()`, a forged id). Whether a real renderer OOM or a worker crash raises `error` was not tested. A per-request watchdog (for example 60 s with no acknowledgment → `fail`) would turn a hang into a visible error. Optional.
- **N2. Low (UX, consequence of the F3 fix).** `selectInput` clears that side **before** the chooser opens. Dismissing the chooser therefore drops the previously completed side and its verdict. Clearing is the safe choice for preventing a stale PASS. The cost is that the user must pick again.
- **N3. Cosmetic.** `\p{Default_Ignorable_Code_Point}` also covers U+200D (ZWJ) and U+FE0F (variation selector). So emoji names display as `👩⟨U+200D⟩💻.txt` and `❤⟨U+FE0F⟩.txt`, and Hangul fillers display as `⟨U+3164⟩` and `⟨U+115F⟩`. This is safe, and arguably desirable for a delivery checker, but emoji names will look odd. The search box matches the raw path, not the marker text.
- **N4. Cosmetic.** `td.path { unicode-bidi: plaintext }` takes the cell direction from the first strong character. A path that starts with an RTL folder name will display its segments right-to-left. Explicit bidi controls are already neutralised by the markers, so this does not hide an extension. I did not test it visually.

## Material limits of this review

- No OS folder picker on any platform. Chromium used Playwright directory injection. WebKitGTK used disk-backed `File`s with an injected `webkitRelativePath`, fed into the app's `onchange` handler.
- No Safari, no Firefox (egress 403), no screen reader. WebKit coverage is WebKitGTK on Linux only.
- No large-file benchmark. One multi-chunk file (3 chunks of 1 MiB plus a 17-byte final chunk) with a final-byte change. Offset handling in `fileChunks` is a plain `offset += CHUNK_BYTES` loop with `Math.min` bounds, and I found nothing that called for a > 4 GiB rerun. The 4 GiB+7 device run belongs to root.
- The fault-injection cases monkey-patch `Blob.prototype` / `Worker.prototype` in the page. They show how the app reacts to those failures, not whether a real device produces them.
- Test harness scripts, fixtures and screenshots stayed in the session scratch directory and are not committed.
