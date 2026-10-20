# Designer Skills

[English](README.md) | **한국어** | [日本語](README.ja.md) | [中文](README.zh-CN.md)

디자이너의 멀티모달 제작 절차를 설치해서 쓰는 AI 에이전트 스킬 모음입니다.

레퍼런스나 브리프를 계속 수정할 수 있는 결과물로 만듭니다. Blender 장면, After Effects 프로젝트, 인터랙티브 프로토타입, 검증된 납품 폴더까지 각 스킬에 산출물·수정 위치·실제 결과 확인 방법을 담았습니다.

**프리뷰 · 0.2.0-alpha.1** — 첫 구성은 네 가지입니다. 도구와 작업 안내의 검증 범위는 다릅니다. [검증 기록](docs/validation.md)을 확인하세요.

![동봉된 Blender 템플릿으로 생성한 제품 장면](docs/images/blender-product.png)

## 작업 선택

| 스킬 | 요청할 작업 | 추가하는 것 | 필요한 환경 |
|---|---|---|---|
| [blender-production](skills/blender-production/SKILL.md) | 제품 렌더와 편집 가능한 `.blend` | 기기 장면 예제, 생성기, 새 프로세스 재열기 검사 | Blender; CPU 또는 지원 GPU |
| [after-effects-production](skills/after-effects-production/SKILL.md) | 계속 수정할 모션 그래픽 | 네이티브 레이어, 컴프 구조, 프리뷰와 수정 안내 | After Effects + 본인의 스크립트/브리지 경로 |
| [reference-to-web-toy](skills/reference-to-web-toy/SKILL.md) | 레퍼런스를 동작하는 인터랙션으로 재현 | 동작·조작 목록, 브라우저 비교, 파일 검증기 | 브라우저 자동화; 검증기는 Python |
| [asset-delivery](skills/asset-delivery/SKILL.md) | 납품 폴더·ZIP 누락 검사 | 수량, SHA-256, 압축파일 검사, 기준본 대조 | Python 3.12+ |

네 스킬은 각각 설치할 수 있습니다. 앱과 계정은 별도로 준비하세요. 저장소에는 로컬 MCP 서버와 선택형 AE CEP 연결기도 포함하며, 스킬과 별도로 설치·등록합니다.

작은 [제작 도구 네 개](docs/tools.md)는 스킬 폴더에 함께 들어 있습니다. [Designer Tools MCP](docs/mcp.md)에서 파일 검사·Blender 생성과 검수·선택형 AE 연결을 제공합니다.

## 설치

Node.js 22.20 이상에서 [Skills CLI](https://github.com/vercel-labs/skills)를 사용합니다. 작업 프로젝트에서 실행하세요.

```bash
npx skills@latest add Bum-Boo/designer-skills
```

스킬과 에이전트를 선택합니다. 하나만 명시하려면:

```bash
npx skills@latest add Bum-Boo/designer-skills --skill blender-production -a codex
```

`codex`를 `claude-code`, `hermes-agent` 등 지원 에이전트로 바꿀 수 있습니다. 사용자 전체 설치는 `-g`를 추가하세요. 같은 이름의 기존 스킬을 교체하기 전에 확인하세요. Blender·Adobe 앱·MCP 서버를 설치하는 명령은 아닙니다.

수동 설치는 저장소를 복제하거나 내려받아 선택한 **스킬 폴더 전체**를 `LICENSE`와 함께 에이전트의 스킬 경로에 복사합니다. 스크립트·참조 파일을 함께 유지하세요. [설치 안내](docs/installation.md)에 경로를 정리했습니다.

## 선택형 MCP 서버

같은 저장소에서 서버를 설치하고 에이전트에 실행 명령과 작업 프로젝트 경로를 등록합니다. Node.js 22.20 이상이 필요하며 Python과 Blender는 해당 도구에만 필요합니다. AE는 동봉된 CEP 패널의 별도 설정이 필요합니다. [설치·설정 예제와 한계](docs/mcp.md).

```bash
git clone https://github.com/Bum-Boo/designer-skills.git
cd designer-skills
npm ci --ignore-scripts
```

## 사용 예

요청에 설치한 스킬 이름을 넣습니다. 슬래시·달러 호출 방식은 에이전트마다 다르며 자동 발견을 지원하면 일반 문장으로도 사용할 수 있습니다.

```text
blender-production으로 기본 예제의 편집 가능한 제품 장면을 만들어줘.
시험 렌더하고 저장본을 다시 열어서 수정할 곳도 알려줘.

after-effects-production으로 이 타이틀 시퀀스를 편집 가능한 AEP로 만들어줘.
문구와 타이밍을 바꾸기 쉽게 하고 프리뷰와 수정 안내를 넣어줘.

reference-to-web-toy로 레퍼런스에 보이는 조작과 인터랙션을 재현해줘.
실제 브라우저 동작과 레퍼런스를 대조해줘.

asset-delivery로 납품 ZIP과 승인된 폴더를 비교해줘.
원본을 바꾸지 말고 누락·추가·변경 파일을 알려줘.
```

## 수록 기준

편집 가능한 산출물, 실제 화면 관찰, 확인 가능한 납품을 중심으로 발전시킨 제작 절차를 담습니다. 현재 3D·모션·인터랙션·납품을 다루며 이미지·영상 생성과 다른 디자이너 도구는 의존성과 실제 결과를 확인한 뒤 확장합니다.

수정하지 않은 공급사 스킬과 범용 개발 모음은 원본에서 사용합니다. 설치된 모든 스킬을 재배포하는 저장소가 아닙니다. [범위와 다음 후보](docs/scope.md), [출처 안내](docs/provenance.md)를 확인하세요.

## 패키지 검사

```bash
python scripts/validate.py
python skills/asset-delivery/scripts/test_delivery_manifest.py
python skills/reference-to-web-toy/scripts/test_verify_static_artifact.py
```

Blender 검사는 Blender에서 해당 스킬의 명령으로 실행합니다. 파일 검사·테스트 통과가 시각 품질이나 자동 호출을 증명하지는 않습니다. [검증 기록](docs/validation.md)에 실제 확인과 한계를 구분했습니다.

## 라이선스

[MIT](LICENSE). 동봉된 저작권 고지를 유지하세요. 앱 구독·플러그인·폰트·사용자 자산에는 각각의 이용 조건이 적용됩니다. 일본어·중국어 문서는 원어민 검수 전입니다.
