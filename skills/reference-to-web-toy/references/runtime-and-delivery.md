# 런타임 검증과 전달

## 버전과 실제 화면

소스의 SHA256 또는 빌드의 불변 ID를 고정하고 실제 브라우저 조작을 수행한다. 정적 HTML은 아래 도구의 HTTP 응답 해시로 저장 파일과 served bytes를 대조할 수 있다. 프레임워크 앱은 그 프로젝트의 빌드/배포 버전 검사를 사용한다.

캐시를 피하는 query만으로 served bytes가 증명되지는 않는다. 수정 뒤 브라우저를 reload하고 새 상태/캡처를 확인한다. iframe을 썼다면 실제 iframe browsing context의 innerWidth/innerHeight, URL, scroll 위치를 읽는다. iframe CSS viewport 검사를 물리 터치 기기 시험으로 표현하지 않는다.

검증 helper가 소스 버전을 오래된 closure로 붙이지 않도록 현재 관측에 버전을 명시적으로 전달하고 저장된 receipt를 읽어 대조한다. 귀속이 불명확한 이전 캡처는 승인 근거에서 제외하고 원시 자료·제외 이유를 보존한다.

## 기능 검사

요구 대조표의 입력마다 실제 결과를 확인한다. 해당 앱에 있는 항목만 적용한다.

- 도구·색상·모드 변경: 눌림/라벨, 실제 객체 변화, 다시 기본 모드로 복원.
- 슬라이더: 의미 있는 값과 경계, 숫자/단위/실제 상태의 일치.
- 객체 조작: 실제 hit-test, 잡기/놓기·돌리기·절단 등 장면 변화, 입력 종료/취소.
- 먹이·절단: 횟수뿐 아니라 소비/새 조각/절단면/개별 조작과 옵션 상속.
- pause/slow/reset: simulation time의 실제 관측, 정지 중 허용 조작, 재개 시 급격한 시간 누적 여부.
- keyboard: input 포커스 충돌, 옵션과 접힘 영역 접근.

상태 계측은 순수 DOM 읽기로 확인할 수 있다. 내부 앱 함수를 호출하거나 상태를 주입한 결과는 사용자 입력 검증으로 세지 않는다. 이전 기능 검사를 이월할 때 관련 JS/asset bytes와 입력 경로 보존을 확인한다. 레이아웃이 바뀌었으면 새 위치의 pointer hit-test를 다시 수행한다.

## 화면 검사

프로젝트에서 요구한 viewport를 우선한다. 요구가 없다면320,768,1024,1440px 폭과 낮은 데스크톱 창(예:1024×400)을 확인하고 실제 원본의 장면 비율을 추가한다.

긴 주둥이·꼬리, 칼, 그림자, 변형/잘린 조각까지 화면 경계를 확인한다. 패널은 물체/안내를 가리지 않고 필요한 스크롤로 모든 조작에 닿아야 한다. 좁은 화면은 적절한 터치 대상 크기와 가로 overflow를 확인한다.

처음 찍힌 빈 canvas는 로딩을 다시 확인하고 실제 렌더가 나온 캡처로 대체한다. 펼침 버튼이 보였다는 것과 마지막 설명 문단이 보였다는 것을 구분한다. 실제 scroll/요소 접근 뒤 문단 끝을 확인한다. 이미지 검사자에게 전체와 필요한 세부 캡처, 버전, viewport, 동작 전후를 넘기고 실제 관찰 결과를 회수한다.

최종 디자인 리뷰는 해당 버전의 코드와 실제 이미지 검사/기능 근거를 사용한다. 변경 뒤 영향을 받는 캡처·조작·검토를 갱신한다. 검증되지 않은 화면/터치/FPS는 그대로 남은 범위로 보고한다.

## 정적 포터블 HTML 검사

`scripts/verify_static_artifact.py`는 Python 표준 라이브러리만 사용한다. `--asset`으로 런타임 의존성/라이선스를 명시한다. 이 목록이 전체 의존성인지는 실행자가 확인한다. 프로젝트 파일을 수정하거나 ZIP을 풀지 않으며 선택한 receipt만 새로 쓴다.

```sh
python -X utf8 SKILL_DIR/scripts/verify_static_artifact.py --root "./toy-app" --asset serve.py --asset start.cmd --asset start.ps1 --asset vendor/three.module.js --asset vendor/three.core.js --asset vendor/THREE-LICENSE.txt --url "http://127.0.0.1:PORT/?v=VERSION" --zip "./Toy.zip" --out "./evidence/static-version.json"
```

자신의 앱에 실제 존재하는 asset만 선언하고 실제 포트/버전을 넣어 실행한다. receipt의 부모 폴더는 미리 만들고 경로는 실행마다 새 이름을 사용한다. `--expected-sha`는 고정한 entry 해시를 검사한다. `--baseline-receipt`를 주면 이전 receipt의 script-tag 해시와 선언한 asset 해시를 비교한다. HTML entry 전체가 달라질 수 있으므로 이 비교는 바뀐 CSS의 화면/클릭 검증을 대체하지 않는다. ZIP 경로가 app 아래 폴더 prefix를 가진 경우 `--zip-prefix`를 지정한다.

HTTP 검사는 loopback URL만 허용하며 redirect를 따라가지 않는다. `PASS`는 해당 파일·served entry·ZIP 일치만 뜻한다. 시각/기능/검토 승인은 별도 실제 근거로 확인한다.

## 전달

포터블 모드에는 실제 의존성·라이선스·빈 loopback 포트를 선택하는 기존 launcher와 간단한 재실행 안내를 포함한다. 브라우저가 필요할 때는 지원되는 CUA/API로 열고 최종 탭을 사용자에게 남기고 도구가 지원하면 deliverable로 표시한다. QA·연구 탭은 해당 도구의 정리 정책을 따른다.

프로젝트의 기존 요구/리뷰/작업 상태에 결과·검증 버전·남은 차이와 다음 owner를 기록한다. 소스/문서 변경 직전 해시·백업을 비교하고 다른 작성자의 변경과 사용자 done/aliases를 보존한다. 실행 주소·재실행 파일·남은 근사값을 사용자에게 짧게 안내한다.

## helper 수정 후 검사

작업 프로젝트에서 실행하고 `SKILL_DIR`을 실제 설치된 스킬 경로로 바꾼다. `python -X utf8 SKILL_DIR/scripts/test_verify_static_artifact.py -v`로 실제 CLI·HTTP·ZIP 성공/실패 사례를 확인한다. Python3.10 이상이며 helper와 테스트에는 표준 라이브러리만 필요하다.
