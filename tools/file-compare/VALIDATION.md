# Validation — candidate 0.1.0

2026-10-23. Implementation source: `b33120e2a569809f3bd398f0e66ce0ceb19361cc`.
Standalone HTML SHA-256: `8cee898848f1afc2f6078cc926903c61584d23cb72a1e3e5d4c5a7bf4c621b50`.

## Focused checks

Arch Linux, Node 26.8.1 / Python 3.14.7: eight core/CLI interoperability groups and three streaming/worker groups passed (`npm test`, with the final edited streaming test re-run directly). `npm run build` succeeds. The tests exercise same-size content changes, missing/extra paths, NFC/NFD/case aliases, malformed manifests, encodings, Python CLI round-trips, Unicode case folding, original zero-byte read errors, bounded slices, actual WASM worker transfers and incomplete-job rejection.

## Built HTML on connected devices

All rows below tested the exact HTML hash above from `file://`, in isolated headless contexts via Playwright CLI 0.1.22. **Directory inputs were injected with `setInputFiles`, not selected in the native OS picker.** Inputs were synthetic/public only. No personal files, credentials or vaults went to lab devices.

| Host / OS | Installed browser (reported UA) | Large-file check | Result |
|---|---|---|---|
| Arch, Linux 7.1.11 | Brave / Chromium 152 | 134,217,735 bytes | passed |
| Personal Himmel, Windows 11 build 26200 | Edge 152 | 134,217,735 bytes | passed |
| Shared lab Windows 11 build 26200 | Edge 155 | **4,294,967,303 bytes** | passed |
| Shared Mac, macOS 15.6.1 arm64 | Chrome 155 | 134,217,735 bytes | passed |

Each flow observed: same-folder match and downloaded report; 1 missing, 1 extra, 1 same-size changed and 1 identical; Python manifest import; invalid import clearing a prior result; deliberately unreadable 0-byte File refusing completion; legitimate zero-byte confirmation; 50+15 row pagination; empty selection clearing a prior PASS; cancel then re-pick; large-file hash matching Python. HTTP(S) requests and page errors: zero. Downloads were parsed and their entries checked against independently computed Python hashes. Screenshots at 1280 and 390 were reviewed; narrow view now shows sizes under each path.

The 4 GiB+7 fixture is sparse synthetic data. This verifies offsets and hashing, not real-drive throughput or a performance guarantee.

Local evidence and durable remote job IDs are in the private task control folder `/home/bumboo/Projects/claude-cloud-credit-20261023/cross-device-receipts.json`; its logs are not published with this repository.

## Independent review and corrections

The original Claude cloud review at `ac44080` is retained verbatim in `../../docs/cloud-20261023-file-compare-review.md`. It independently verified the build, core tests and Chromium flows, and found:

- F1: unreadable 0-byte Files were not opened. Fixed by reading the original File before hashing an empty buffer; errors refuse completion.
- F2: WebKitGTK could not read picked File handles in a worker from `file://`. Fixed by reading 1 MiB slices on the page and transferring acknowledged buffers; the worker only hashes.
- F3: an empty change kept an earlier PASS. Fixed by invalidating on picker start and processing empty change events.
- F4: invisible filename controls could alter displayed extensions. Fixed by visible U+ markers while keeping exact export/comparison paths.
- F5: narrow size columns were off-screen. Fixed by showing sizes under the path.

The focused independent Claude cloud follow-up on exact source `b33120e` completed with **no blocker in the tested scope** (review commit `0ca2d572f73dea0f02d2680bd07bc9b492b61c35`, branch `claude/file-compare-followup-review-6p9hiz`). It independently passed all 11 tests on Node 22.22, reproduced the exact HTML hash, re-tested the actual C-locale unreadable File failure, cancellation/delayed reads, malformed replies, bidi display/raw export and narrow layout. WebKitGTK 2.52.6 successfully ran the real page-read → buffer-transfer → hashing-worker flow on disk-backed Files from `file://`; the fixture's relative-path field was injected because WebDriver cannot supply directory paths. **This is not a Safari or native directory-picker test.** Full evidence: `../../docs/cloud-20261023-file-compare-followup.md`.

The nonblocking liveness limit is a missing worker reply without an `error` event: the run remains busy with cancel available and report disabled. It was reproduced using deliberate worker termination/forged replies, not as a spontaneous device failure. No PASS was produced. Cancelling a native picker intentionally clears that side's old verdict. Invisible emoji joiners are displayed as markers while exports retain the raw path.

## Limits

No real customer deliveries, AE/Blender external-link validation, VoiceOver/NVDA, manual picker validation on every platform, real Safari, or Firefox is established by the automated table. The browser file picker is not an atomic filesystem snapshot and cannot identify symlinks/junctions. See README and the in-app comparison scope. Chrome/Edge/Brave are the verified browser choices on the four hosts.
