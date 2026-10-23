# Codex 수정 후보 독립 검토 (cloud, 2026-10-23)

## 이전 결과 대체

이 문서의 이전 판(커밋 `4ff1fb4`)은 `94ded51`을 검토했다. `94ded51`은 리뷰 문서만 추가한 커밋이고 수정 후보가 아니었다. 그때의 "수정 없음" 판정은 **잘못된 입력을 검토한 결과**이므로 철회한다. `d91596e`의 결함이 아니다. 아래 내용만 유효하다.

## 검토 대상

- 브랜치 `codex/cloud-fixes-20261023`, 커밋 **`d91596eb96fdd9a1e4cb898d3ef9ae47dbaed8a5`** ("Fix bounded tool shutdown and malformed baseline receipts"). fetch 후 `FETCH_HEAD`와 일치하는 것을 확인했다.
- `94ded51` 대비 변경: `mcp/runtime.mjs`, 신규 `mcp/runtime-tree.test.mjs`, `verify_static_artifact.py`와 그 테스트, `docs/mcp.md`, `docs/cloud-20261023-fixes.md`. 제품 소스는 수정하지 않았다. 별도 worktree(`git worktree add --detach <scratch> d91596e…`)에서 실행했고 검토 후 제거했다.
- 환경: Linux, Node v22.22.0, Python 3.13.16. 실제 Blender, AE, CEP, Windows, macOS는 사용하지 않았다.

## 실행 명령과 결과 (후보 worktree)

```sh
npm ci --ignore-scripts
npm test                                                     # tests 18, pass 18, fail 0, skipped 0
node --test mcp/runtime.test.mjs mcp/runtime-tree.test.mjs   # tests 5, pass 5
python3 skills/reference-to-web-toy/scripts/test_verify_static_artifact.py -v   # Ran 11, OK
python3 skills/asset-delivery/scripts/test_delivery_manifest.py               # OK
python3 scripts/validate.py                                  # passed: true
node review/repro_mcp_boundaries.mjs                         # 이전 재현기 재실행
python3 -I review/repro_python_helpers.py
node review/repro_codex_fixes.mjs <candidate-worktree>       # 이번에 추가한 합성 재현기
```

Codex가 보고한 Node 5개, Python 11개, 잘못된 값 9개(최상위 `[] "PASS" 1 true null`, `files`가 `[] null "bad" 3`인 경우) 통과를 그대로 재현했다.

## 확인 결과

**타임아웃과 종료 (POSIX, Linux에서 측정)**
- 이전 재현기에서 15 s 상태 점검 시간초과는 **15.02 s**에 반환됐다(이전 20.0 s). server close 뒤 남은 손자 프로세스는 **0개**(이전 1개)였다.
- 래퍼가 즉시 exit 0 하고 자식이 pipe를 쥐고 있는 경우: 1.5 s 시간초과에 실패로 반환되고 자식은 종료됐다. 성공으로 오보되지 않는다.
- TERM을 무시하는 프로세스에서 `close()`를 세 번 연속 호출해도 약 0.50 s 뒤 KILL로 정리됐다. 이후 `children`/`stoppers`는 0이고, `close()` 뒤 `run`은 "Runtime is closed"로 거부된다.
- 실행 파일이 없을 때는 `ENOENT`로 거부되고 `children`은 0이다. 출력 4 MiB 초과는 기존 테스트로 통과했다.
- stdin 종료로 정상 종료하면 server는 0.01 s에 끝나고 도구 프로세스 그룹도 종료됐다.
- 잘못된 baseline은 traceback 없이 FAIL receipt를 반환하고 `--out` 파일도 작성한다. 중첩 `files` 값의 `sha256` 누락 같은 나머지 형식 오류는 기존 `KeyError`/`TypeError` 처리로 FAIL이 된다.

**문서화된 한계와 일치 (결함 아님)**
- `setsid`로 새 세션을 만든 프로세스는 시간초과 뒤에도 살아 있다. `docs/mcp.md`의 "separate session can escape"와 일치한다.
- pipe를 닫은 백그라운드 자식은 **성공** 호출 뒤에도 정리되지 않는다. 정리는 시간초과, 출력 초과, close 때만 한다.
- 클라이언트 취소만으로는 작업이 멈추지 않는다(문서화된 내용).
- Windows는 직접 자식만 종료한다는 문서도 코드 분기(`grouped = platform !== 'win32'`)와 일치한다.

## 비차단 관찰

1. **server 프로세스 그룹 전체가 SIGKILL되면 도구 프로세스가 남는다(동작 변화).** 이제 도구가 `detached` 그룹에서 실행되기 때문이다. 같은 측정 결과:
   - `94ded51`: 도구 자식 `alive=false`
   - `d91596e`: `alive=true`

   SIGTERM, SIGINT, stdin 종료 같은 정상 경로는 정리된다. 이전 코드도 server pid만 SIGKILL하면 자식이 남았으므로 새 결함이라기보다 트레이드오프다. 최소 대응은 `docs/mcp.md`에 "server를 SIGKILL(그룹 포함)하면 실행 중인 Blender/Python이 남을 수 있음"을 한 문장 추가하는 것이다.
2. 신규 트리 테스트는 `process.platform !== 'linux'`이면 skip된다. 그래서 macOS의 그룹 kill 경로는 테스트되지 않는다. 문서는 "POSIX"라고 쓰지만 측정 근거는 Linux뿐이다.

## 결론

테스트한 범위(Linux, 합성 래퍼, 모의 입력) 안에서 **차단 이슈는 없다**. 두 원래 결함은 해결됐고, 누락 실행 파일과 출력 초과 경로의 회귀나 테스트 거짓 통과는 발견하지 못했다. 위 1번은 문서 보강을 권한다. 실제 Blender/AE, macOS, Windows 프로세스 트리, MCP 클라이언트의 취소 전달은 검증하지 않았다.
