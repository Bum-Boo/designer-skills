# Windows 프로세스 트리 정리와 강제 종료 후 고아 프로세스 감소 (cloud, 2026-10-31)

기준: 후보 브랜치 `codex/cloud-fixes-20261023` (`7a4f0c1`). 작업 브랜치 `claude/windows-process-cleanup-sco6le`. 스킬 본문과 AE 어댑터 동작, 의존성·lockfile은 바꾸지 않았다. 데이터는 모두 합성이고 외부 서비스 호출은 없다. 구현 뒤 독립 리뷰 에이전트에게 두 차례 검토를 맡겼고, 지적된 결함은 모두 회귀 테스트와 함께 고쳤다(아래 #3, #4).

## 바꾼 것

| 파일 | 내용 |
|---|---|
| `mcp/process-tree.mjs` (신규) | 플랫폼별 프로세스 스냅샷과 트리 종료, PID 재사용 판별(`selectTargets`), pid 파일(`ToolRegistry`), 시작 시 정리(`sweepStale`), reaper 동작(`reapFile`) |
| `mcp/reaper.mjs` (신규) | 서버마다 하나씩 뜨는 분리된 감시 프로세스. stdin이 닫히면(서버가 SIGKILL로 죽은 경우 포함) pid 파일에 남은 도구를 정리한다 |
| `mcp/runtime.mjs:15-24, 64-87, 116-120, 200` | 기존 `run()` 인터페이스는 그대로 두고 종료를 `ProcessTree`에 위임한다. 실행 기록을 등록·해제하고 종료 시각을 기록한다 |
| `mcp/server.mjs:26-31` | 시작할 때 백그라운드에서 오래된 기록을 정리하고, pid 파일을 쓸 수 없으면 stderr에 알린다 |
| `docs/mcp.md:55` | Windows 동작, reaper, 남은 한계 |
| 테스트 | `mcp/process-tree.test.mjs` 16개(Windows 경로·식별 규칙 모의), `mcp/runtime-orphan.test.mjs` 6개(Linux 실제 프로세스·실제 MCP 서버) |

**Windows (`process-tree.mjs`의 `signal`/`stopWindows`)**: 시간초과, 출력 초과, close가 일어나면 `%SystemRoot%\System32\taskkill.exe /PID <pid> /T /F`로 트리 전체를 종료한다. PATH에 의존하지 않는다. 래퍼가 이미 끝났거나 taskkill이 실패하면 PowerShell 5.1의 `Get-WmiObject Win32_Process` 스냅샷을 쓴다. Windows는 고아의 부모를 바꾸지 않으므로 ParentProcessId를 따라가 후손을 찾고, `taskkill /F /PID …`를 32개씩 끊어 보낸다. 생성 시각은 DMTF 문자열과 UTC 오프셋으로 해석한다(`parseDmtf`). pid 파일 항목은 트리 종료가 확인된 뒤 그 실행 객체가 아직 주인일 때만 지운다(`runtime.mjs:87`, `ToolRegistry.delete`). Job Object는 Node 내장만으로는 만들 수 없어 쓰지 않았다(네이티브 애드온이나 의존성 추가가 필요하다).

**강제 종료 대비**:
- 서버는 실행 중인 도구를 `os.tmpdir()/designer-tools-mcp-<uid>/server-<pid>-<ms>.json`에 원자적으로 기록한다(임시 파일 → rename, 0600). 디렉터리는 0700이어야 하고, 소유자가 다르거나 symlink이면 기능을 끄고 도구는 그대로 실행한다.
- 첫 도구를 실행할 때 reaper를 `detached`로 띄운다. 서버 프로세스 그룹이 SIGKILL을 받아도 살아남고, stdin EOF를 받으면 기록된 그룹에 TERM, 500ms 뒤 KILL을 보낸다. KILL은 식별했던 프로세스가 같은 시작 시각으로 남아 있거나, 남은 멤버가 모두 대기 중에 fork된 것이고 그룹 ID를 새 리더가 차지하지 않았을 때만 보낸다. reaper가 처리하지 못한 기록은 다음 시작 정리를 위해 남긴다.
- 새 서버는 시작할 때 죽은 서버의 기록을 정리한다. 보수적으로 동작한다. 같은 부팅의 기록에 대해서만, 그리고 기록된 도구 프로세스 자체가 시작 시각까지 일치하며 살아 있을 때만 종료한다. 다른 버전이 쓴 기록은 건드리지 않는다.
- 식별 규칙(`selectTargets`): 기록된 시작 시각과 ±5s 안에서 시작한 프로세스만 우리 것으로 본다. 자식은 부모보다 늦게 시작해야 하고, 종료된 부모의 직계 자식은 그 부모의 종료 시각 이전에 시작했어야 한다. Linux는 spawn 직후 `/proc/<pid>/stat`에서 시작 시각을 직접 읽으므로 벽시계 점프나 lxcfs의 가상 `/proc/uptime`에 영향을 받지 않는다. macOS는 `ps -o etime`, Windows는 오프셋 포함 WMI 시각을 쓴다.

## 발견 사항 분류

| # | 분류 | 내용 |
|---|---|---|
| 1 | **검증된 결함 → 수정** | 서버 프로세스 그룹을 SIGKILL하면 도구의 후손이 남는다. 기존 코드에서 재현했다. `runtime-orphan.test.mjs:49`, `:121`은 `7a4f0c1`의 runtime/server에서 2개 모두 실패하고("descendant must be stopped…") 수정 후 통과한다. |
| 2 | 정적 위험 → 수정(모의 검증만) | Windows는 직접 자식만 종료했다(`7a4f0c1`의 `runtime.mjs:62`, `child.kill`). 모의 테스트 `process-tree.test.mjs:65-155`. |
| 3 | **검증된 결함 → 수정** (내 구현, 리뷰 1차) | (a) 원래 프로세스가 사라진 오래된 기록이 재사용된 PID의 그룹이나 후손을 죽일 수 있었다(재현됨). (b) macOS `lstart`는 DST의 반복되는 1시간 동안 실행 중인 서버를 죽은 것으로 판정했다(재현됨). (c) Linux `btime`은 벽시계 점프에 따라 움직였다(정적). (d) Windows 정리가 확인되기 전에 기록을 지웠다. (e) reaper가 실패해도 기록을 지웠다. (f) TERM→KILL 사이의 그룹 ID 재사용. (g) 항상 통과하던 테스트 단언. 회귀 테스트: `process-tree.test.mjs:19,56,87,157,226`, `runtime-orphan.test.mjs:68,144`. |
| 4 | **검증된 결함 → 수정** (내 구현, 새 테스트와 리뷰 2차) | (a) Windows 정리 Promise가 run이 끝나기 전에 거부되면 처리되지 않은 거부가 생긴다. Node 기본값에서는 서버가 종료된다. `process-tree.test.mjs:87`로 발견했고 `runtime.mjs:73`에서 수정했다. (b) 비동기 정리 뒤 PID로 지우면, 같은 PID를 받은 다음 도구의 항목이 지워질 수 있었다(`:182`). (c) lxcfs 컨테이너에서는 `os.uptime()`이 가상화되어 식별이 전부 실패했다(`runtime-orphan.test.mjs:162`). (d) 다른 버전의 기록을 삭제했다(`:200`). (e) 대기 중에 fork된 자식은 KILL이 빠졌다(`:171`). |
| 5 | 검증된 결함 (범위 밖, 미수정) | Node 22.23.4에서 `mcp/ae/install-panel.test.mjs`의 2개 테스트가 실패한다. 원인은 Node 동작 변경이다. 빈 대상 디렉터리를 `fs.cp(..., {errorOnExist: true})`(`install-panel.mjs:20`)로 복사하면 22.23.4는 `ERR_FS_CP_EEXIST`, 22.20.0은 성공한다(최소 재현으로 확인). 내 변경 전에도 같았다. CI는 22.20.0으로 고정되어 있어 드러나지 않는다. AE 설치기 동작이라 건드리지 않았다. |
| 6 | 정적 위험 (남음) | (a) `setsid`로 새 세션을 만든 POSIX 후손, Windows에서 중간 부모가 먼저 끝난 손자, reaper까지 함께 SIGKILL된 경우는 정리되지 않는다. (b) 도구 프로세스가 먼저 끝난 뒤 남은 후손은 서버 종료 시 reaper만 정리한다. reaper는 POSIX 그룹에 `exitedAt` 상한을 적용하지 않으므로, 서버가 사는 동안 그룹이 비고 그 ID가 재사용되면 오탐 가능성이 아주 작게 남는다. (c) Windows WMI가 DST 이전에 시작한 프로세스에 현재 오프셋을 붙이는지 확인하지 못했다. 그렇다면 1시간이 어긋나 정리하지 않는 쪽으로 실패한다. (d) macOS·Windows의 부팅 판별은 벽시계 기준 ±120s라, 큰 시계 점프가 있으면 기록을 정리 없이 버린다. |
| 7 | 이미 대응됨 | 클라이언트 취소가 작업을 멈추지 않는 점, 그룹 밖으로 나간 프로세스의 파이프 대기는 기존 문서와 코드(500ms 뒤 대기 중단)에 반영되어 있다. |

## 실행한 명령과 결과 (Linux, Node v22.23.4 / v22.20.0, Python 3.13.18)

```sh
npm ci --ignore-scripts
npm test                                                   # Node 22.23.4
<node-v22.20.0>/bin/node --test mcp/*.test.mjs mcp/ae/*.test.mjs
python3 scripts/validate.py
python3 scripts/test_validate.py
python3 skills/asset-delivery/scripts/test_delivery_manifest.py -v
python3 skills/reference-to-web-toy/scripts/test_verify_static_artifact.py
npx --yes --package=. designer-tools-mcp --help
node review/repro_mcp_boundaries.mjs; node review/repro_ae_protocol.mjs; python3 -I review/repro_python_helpers.py
```

| 검사 | 변경 전 (`7a4f0c1`) | 변경 후 |
|---|---|---|
| `npm test` (Node 22.23.4) | 18개 중 16 통과, 2 실패(설치기, #5) | 39개 중 37 통과, 2 실패(같은 설치기 2개). 3회 반복해도 같음 |
| Node 22.20.0 (CI 버전) | 18/18 | 39/39 |
| `validate.py` | passed (66 files) | passed (70 files) |
| `test_validate.py` / delivery / verifier | 4 / 8 / 11 OK | 4 / 8 / 11 OK |
| 기존 재현기 3종 | 이전 리뷰와 같은 결과 | 같음(15.03s 시간초과, close 뒤 남은 손자 0개) |

lint, 타입 검사, 빌드 스크립트는 저장소에 없다. 테스트 뒤 `sleep`·reaper 프로세스와 pid 파일이 남지 않은 것을 `ps`와 `ls`로 확인했다. macOS `ps` 경로는 Linux procps로 실행해 `/proc` 결과와 비교했고 약 0.5s 이내로 일치했다. 벽시계 점프와 lxcfs는 `Date.now`와 시계 함수를 바꿔 끼워 모의했고, VM의 실제 시계는 바꾸지 않았다.

## 이 VM에서 검증하지 못한 것

- **Windows 실제 동작 전체**: `taskkill.exe`, PowerShell 5.1 `Get-WmiObject`의 출력 형식과 DMTF 오프셋(#6c), 콘솔 공유 reaper의 Ctrl+C 처리, 클라이언트가 Job Object로 서버를 가두는 경우. 모두 모의 테스트뿐이다.
- macOS의 `ps -o pgid=,etime=` 출력과 프로세스 그룹 동작, 실제 lxcfs 컨테이너, 실제 Blender/AE/CEP, 실제 MCP 클라이언트의 종료 방식(stdin 닫기 뒤 강제 종료 등), 컨테이너 간에 `/tmp`를 공유하는 환경.

## 소유자가 할 일

1. Windows에서 `npm test`를 실행한다. 그다음 실제 클라이언트로 Blender가 렌더링하는 중에 서버를 작업 관리자에서 강제 종료하고, `blender.exe`가 사라지는지와 `%TEMP%\designer-tools-mcp\`가 비는지 확인한다. macOS에서도 `kill -9 -<서버 pgid>`로 같은 확인을 한다.
2. Windows에서 `Get-WmiObject Win32_Process | Select -First 3 ProcessId,CreationDate`의 오프셋이 DST 전환 전후에 어떻게 찍히는지 확인한다(#6c).
3. Windows CI 잡(`windows-latest`, Node 22.20.0)을 추가해 `process-tree.test.mjs`와 `server.test.mjs`를 실제 환경에서 돌릴지 결정한다.
4. 설치기(#5) 대응: `fs.cp` 대상 디렉터리를 미리 만들지 않는 방식으로 바꾸거나, 지원 Node 범위를 문서화한다. 별도 변경으로 진행한다.
5. Windows에서 후손 탈출(#6a)까지 막으려면 Job Object(kill-on-close)가 필요하다. 네이티브 헬퍼나 의존성 추가 여부는 소유자 판단이다.
