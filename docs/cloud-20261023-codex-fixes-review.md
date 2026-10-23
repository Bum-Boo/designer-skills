# Codex 수정 후보 독립 검토 (cloud, 2026-10-23)

## 결론

**검토할 수정 사항이 해당 커밋에 없다.** 요청된 `codex/cloud-fixes-20261023` 브랜치와 커밋 `94ded5111d4a6a2b8417bc25bb03924a33de05e8`은 이전 클라우드 리뷰 커밋(리뷰 문서와 `review/` 하네스만 추가)과 같다. `94ded51` 대비 diff가 비어 있다. Codex가 로컬에서 관찰했다는 수정과 테스트(runtime 테스트 5개, verifier 테스트 11개, 잘못된 baseline 값 9개)는 이 커밋에서 재현되지 않는다. 두 결함은 이 커밋에 **그대로 남아 있다**. 수정 사항을 검토하지 못했으므로 "차단 이슈 없음"이라고 판단하지 않는다.

## 확인한 소스

```sh
git fetch origin codex/cloud-fixes-20261023   # FETCH_HEAD = 94ded5111d4a6a2b8417bc25bb03924a33de05e8
git ls-remote origin
#   30a2bbf… refs/heads/main
#   94ded51… refs/heads/claude/task-q2tgq0
#   94ded51… refs/heads/codex/cloud-fixes-20261023
git diff --stat 94ded51 FETCH_HEAD            # 출력 없음 (변경 0개)
```

## 격리 worktree 실행 결과 (Linux, Node v22.22.0, Python 3.13.16)

```sh
git worktree add --detach <scratch>/cand 94ded5111d4a6a2b8417bc25bb03924a33de05e8
npm ci --ignore-scripts
npm test                                                   # tests 16, pass 16, fail 0
node --test mcp/runtime.test.mjs                           # tests 3, pass 3  (Codex 주장: 5)
python3 skills/reference-to-web-toy/scripts/test_verify_static_artifact.py   # Ran 10, OK (Codex 주장: 11)
python3 skills/asset-delivery/scripts/test_delivery_manifest.py              # OK
python3 -I review/repro_python_helpers.py                  # baseline `[]` → AttributeError traceback, receipt 미작성
```

- `mcp/runtime.mjs`에는 `detached` spawn, 프로세스 그룹 kill(`process.kill(-pid)`), TERM→500ms→KILL 단계적 종료, 상속된 pipe 처리 코드가 없다. 종료 방식은 여전히 직접 자식에게 보내는 `child.kill()` 한 번이다(`mcp/runtime.mjs:56`, `:151`).
- `verify_static_artifact.py`에는 최상위나 중첩된 baseline 타입 가드가 없다(`:134`의 `baseline.get`, `:150`의 except 목록은 그대로).

따라서 요청된 검토 항목(정리 경로, POSIX 프로세스 그룹, TERM→KILL 단계적 종료, pipe 처리, close 반복 호출, 실행 파일 누락 경로, baseline 가드)은 검토할 코드가 없다. 테스트 통과는 기존 테스트의 통과일 뿐이고 수정을 검증하지 않는다.

## 남은 결함과 재현 방법 (이전 리뷰와 같음)

1. 손자 프로세스가 출력 pipe를 잡고 있으면 타임아웃이 늦게 보고되고, 그 프로세스가 cancel이나 server close 뒤에도 살아남는다. 재현: `node review/repro_mcp_boundaries.mjs`. 결과는 `status-probe-timeout-with-grandchild` 약 20 s(제한 15 s), `server-close-leaves-grandchild: 1`.
2. 객체가 아닌 `--baseline-receipt`를 주면 traceback이 나고 receipt가 작성되지 않는다. 재현: `python3 -I review/repro_python_helpers.py`(`verify-malformed-baseline-*`).

최소 수정 방향(참고용, 이 검토에서는 적용하지 않음):
- POSIX에서 `spawn(..., {detached: true})`로 실행하고, 종료할 때 `process.kill(-child.pid, 'SIGTERM')`를 보낸다. 500 ms 뒤에도 남아 있으면 `SIGKILL`을 보낸다. `close` 대신 `exit` 이후의 타이머로 settle하고 pipe를 `destroy()`한다. Windows 자손 프로세스와 setsid로 그룹을 벗어난 프로세스는 문서화된 한계로 남긴다.
- 파이썬은 `json.loads` 직후 `if not isinstance(baseline, dict) or not isinstance(baseline.get("files"), dict) or not isinstance(baseline.get("script_tag_sha256"), list): raise ValueError(...)`로 검사한다. `files`의 각 값이 dict인지도 확인한다.

## 범위

실제 Blender, After Effects, CEP는 사용하지 않았다. Windows나 macOS 검증도 하지 않았다. 다음 단계: Codex 수정이 들어간 실제 커밋을 원격에 push한 뒤 SHA를 알려 주면 같은 절차로 다시 검토한다.
