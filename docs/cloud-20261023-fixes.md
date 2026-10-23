# 클라우드 검토에서 찾은 두 문제의 수정 후보

2026-10-23, Codex. 독립 검토 기준 소스는 `30a2bbf`이며 원래 검토는 `cloud-20261023-independent-review.md`에 있다. 이 후보는 설치·배포하지 않았다.

- 작업 시간초과·출력 초과·런타임 종료 시 POSIX의 별도 프로세스 그룹에 TERM을 보내고, 500ms 뒤 KILL로 정리한다. 래퍼가 종료되거나 자식이 파이프를 붙잡고 있어도 실패 응답이 무기한 대기하지 않게 했다. 그룹을 벗어나 새 세션을 만든 프로세스는 정리 대상이라는 보장이 없다. Windows는 직접 자식 종료만 지원하며 하위 프로세스 정리는 미검증·미해결이다.
- 기준 영수증 JSON의 최상위와 `files`가 객체인지 검증한다. 잘못된 값은 traceback으로 끝나는 대신 기존 FAIL 영수증 경로로 반환하고 `--out` 파일도 남긴다. 기존 PASS 기준 비교는 설명용이라는 의미를 유지했다.

Arch Linux / Node 26.8.1 / Python 3.14에서 실행:

```
node --test --test-concurrency=1 mcp/runtime.test.mjs mcp/runtime-tree.test.mjs
python3 -B skills/reference-to-web-toy/scripts/test_verify_static_artifact.py -v
```

첫 검사에서 Node 5개·Python 11개 통과. Node 신규 두 검사는 TERM을 무시하는 합성 래퍼와 하위 sleep 프로세스를 실제로 실행해 시간초과·종료 후 살아 있지 않음을 확인한다(Linux 전용). 기존 경로 검사·Python 도구 호출도 통과했다. 중첩 `files` 오형식까지 추가한 뒤 해당 CLI 회귀 검사 1개(9가지 잘못된 값)를 별도로 실행해 통과했다.

실제 Blender/AE, MCP 클라이언트의 취소 전달, Windows/macOS 프로세스 트리는 이 검사로 검증되지 않는다. 설치한 개인 스킬이나 MCP 설정은 변경하지 않았다. 독립 클라우드 검토(`e35f65f`)는 정확한 후보 `d91596e`를 별도 worktree에서 검증했다. Node 전체 18개·Python verifier 11개, 기존 재현기와 추가 종료 경로를 통과했고 테스트 범위에서 차단 이슈는 없었다. 서버를 SIGKILL하면 도구 프로세스가 남을 수 있다는 비차단 관찰은 운영 문서에 보완했다. 실제 앱·Windows/macOS 검증은 여전히 남아 있다.
