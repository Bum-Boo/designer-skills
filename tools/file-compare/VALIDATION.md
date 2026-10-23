# Validation — candidate 0.1.0

2026-10-23. Codex implementation; independent Claude cloud review and cross-device browser checks are in progress.

Observed locally on Arch Linux, Node 26, Python 3.14:

- Eight focused test groups passed: exact/same-size content changes; missing/extra; Korean NFC/NFD/case aliases; malformed paths/manifests; full case folding; picker root handling; JSON encoding; bidirectional real Python CLI interoperability.
- Every Unicode 16 mapping also known by the installed Python agrees with Python case folding.
- `npm run build` succeeds and produces one standalone HTML, with JS, CSS, worker, WASM and third-party notices embedded.

Browser and remote rows will be filled with observed versions and artifacts after the checks. Native OS picker behavior, VoiceOver/NVDA and live client deliveries have not been verified. Do not interpret an automated injected folder as a manual picker test.
