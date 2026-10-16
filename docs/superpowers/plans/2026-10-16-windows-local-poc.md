# Windows Local PoC Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task after reviewing the design. Steps use checkbox syntax for tracking.

**Goal:** S-01의 Windows 업무 세션을 로컬 수집·검토·검수·Markdown 근거로 내보내는 최소 실험을 만든다.

**Architecture:** 순수 Core와 Windows collector/UI를 분리한다. 안전한 이벤트 JSONL과 승인된 이미지 파일만 로컬 보존하고 provider는 opt-in 경계로 둔다.

**Tech Stack:** 제안 baseline .NET10/C#, WPF/Windows11 x64. SDK와 테스트 패키지의 호환 버전은 착수 시 실제 조회해 고정한다. Task1 Core는 SDK10.0.402·패키지 고정 후 Linux 빌드/단위 검증했다. WPF/Windows 조합은 아직 빌드·실행하지 않았다.

**Spec:** [Windows 로컬 PoC 설계](../specs/2026-10-16-windows-local-poc-design.md)

## Global Constraints

- 제품 코드 작성 전 설계 제안·작업 계획 검토. 기존 초기화 앱 복구 금지.
- 순수 Core는 net10.0, Windows API/UI는 별도 프로젝트에 격리.
- 명시적 allowlist·recording 상태에서만 수집. 제목/전체 경로/키 입력/클립보드 기본 수집 금지.
- 세션20분·후보120개·이미지 후보/재인코딩 버퍼256MiB 한도 제안. 한도 도달 시 paused, 무음 유실 금지.
- 원본 화면 후보 디스크 저장 금지, 사용자 검토·마스크·승인 후 새 PNG만 보존.
- 기본 외부 호출 없음. template 결과를 AI 생성으로 표시하지 않음. 실제 provider는 별도 조건 확인.
- Linux unit, Windows 실제 수집, 이미지 경계, 생성 품질/가치 검증을 별도 상태로 기록.

## Review Focus

1. 한 번의 타이머 tick 사이 빠른 앱 전환·정지: 기록 공백을 실제 작업 이해로 위장하지 않음.
2. 캡처 도중 전면 창 교체·잠금: 다른 앱 화면을 승인 없이 저장하지 않음.
3. 이미지 한도·파일 쓰기 실패·앱 종료: 원본 후보 유출·완료 표시 오류 방지.
4. 제외된 근거/오래된 입력 manifest: 재생성·내보내기에서 제외 여부 유지.
5. template/fixture 성공을 실 모델·실 Windows·PoC 가치 성공으로 확대하지 않음.

## Task 1: Core 계약·상태·이벤트 저장

**Files:** GhostManual.slnx, global.json, src/GhostManual.Core/{Session.cs,CaptureEvent.cs,SessionStore.cs}, tests/GhostManual.Core.Tests/SessionTests.cs, Directory.Packages.props.
**Consumes:** 설계의 이벤트 v1·상태·한도·안전한 필드 정의.
**Produces:** Session.Start/Pause/Resume/Stop/Cancel, Append(CaptureEvent), SessionStore.SaveAsync(session, CancellationToken), 안전한 session.json/events.jsonl.

- [x] SDK·테스트 패키지의 실제 지원 버전을 확인해 global.json/중앙 패키지 버전에 고정한다. Core만 Linux에서도 빌드되게 하고 Windows 프로젝트는 분리한다.
- [x] 상태 전이·20분 경과 후 재개 거부·비허용 앱·동일eventId·순서 역전·정지 후 이벤트·safeNote 1000/1001 경계·알 수 없는 버전/필드 거부·허용 필드만 직렬화·쓰기 실패 테스트를 먼저 작성한다.
- [x] `dotnet test tests/GhostManual.Core.Tests`를 실행해 미구현 동작 실패를 확인한다. SDK/러너 오류를 RED로 기록하지 않는다.
- [x] 계약·원자적 안전 메타데이터 저장을 최소 구현한다. 생성된 UUID 외 사용자 텍스트를 경로로 쓰지 않는다.
- [x] 같은 명령과 관련 전체 suite를 실행한다. Expected: 종료0, 실제 결과를 10에 기록하고 Task1 커밋.

## Task 2: Windows metadata collector·상태 UI

**Files:** src/GhostManual.Windows/{App.xaml,MainWindow.xaml,ForegroundObserver.cs,CollectorController.cs}, tests/GhostManual.Core.Tests/CollectorPolicyTests.cs, docs/qa/windows-metadata.md.
**Consumes:** Task1 Session과 CaptureEvent.
**Produces:** IForegroundObserver.Poll(), CollectorController.Tick/Start/Pause/Resume/Stop, 명시적 상태·allowlist UI. collector는 경로/제목을 Core에 전달하지 않는다.

- [ ] 가짜 observer로 동일 앱 반복·빠른 전환·잠금/무효 창·시간 경과·pause tick·resume 첫 focus anchor·허용되지 않은 앱 전환 테스트를 작성하고 RED를 확인한다.
- [ ] 상태/정책을 Core에서, Windows foreground API 접근을 adapter에서 구현한다. 없는 지원을 fake 성공으로 처리하지 않는다.
- [ ] Core suite GREEN 확인. Windows에서 Windows 프로젝트를 build/run하고 브라우저→Excel→편집기의 실제 전환·정지·권한 실패를 기록한다.
- [ ] Expected: 일반 권한·지원 장비에서 검증된 앱 전환만 수집. Windows 장비 없으면 실제 검증 미완료로 둔다. Task2 커밋과 근거 기록.

## Task 3: 화면 후보·검토·마스크·승인 경계

**Files:** src/GhostManual.Core/{EvidenceCandidate.cs,EvidencePolicy.cs}, src/GhostManual.Windows/{CaptureAdapter.cs,EvidenceReviewWindow.xaml}, tests/GhostManual.Core.Tests/EvidencePolicyTests.cs, docs/qa/windows-evidence.md.
**Consumes:** Task1 세션 상태, Task2 허용된 전면 창 신호.
**Produces:** TryCaptureAsync(target), CandidateBudget.TryAdd(), Approve/Exclude, 승인된 asset manifest. raw 후보와 승인 asset 타입을 분리한다.

- [ ] 한도120개/256MiB·정지 중 캡처 거부·창 변경 race·제외 후보·마스크 미완료 후보·허용 manifest 외 경로 테스트를 먼저 작성하고 RED를 확인한다.
- [ ] Windows Graphics Capture 지원을 실 장비에서 작은 기술 probe로 확인한다. 불가능하면 막힌 이유를 기록하고 설계를 수정한다. 다른 캡처 API로 조용히 바꾸지 않는다.
- [ ] 원본 후보는 메모리 전용, 검토 후 재인코딩한 승인 PNG만 쓰도록 구현한다. writer spy/분리 타입으로 raw 바이트가 파일 writer에 전달되지 않는 것을 시험한다.
- [ ] 실제 화면에 합성 제외 영역·알림·잠금·UAC/미지원 상태를 넣고 파일/로그/내보내기를 검사한다. 실 화면 마스크 효과는 실제 픽셀로 확인한다.
- [ ] Expected: Core suite GREEN와 Windows 경계 검증 근거. 원본 폐기·마스크·표시가 확인되지 않으면 완료 아님. Task3 커밋.

## Task 4: template 초안·검수·안전한 export·S-01 실행

**Files:** src/GhostManual.Core/{InputManifest.cs,TemplateDraftGenerator.cs,ManualRevision.cs,ManualExporter.cs}, src/GhostManual.Windows/ManualReviewWindow.xaml, tests/GhostManual.Core.Tests/ManualExportTests.cs, docs/qa/s01-run.md.
**Consumes:** Task1~3의 허용 입력·승인 asset manifest.
**Produces:** BuildManifest(), GenerateTemplate(), CreateRevision/Approve, ExportAsync(approvedRevision, destination). template 표시·근거 연결 Markdown/PNG 폴더.

- [ ] 제외 asset·오래된 입력 버전·미승인 revision·동일revision 재내보내기·저장 실패·경로 이탈·근거 누락·한글 Markdown 테스트를 먼저 작성하고 RED를 확인한다.
- [ ] 앱 전환/주석·승인 근거 기반 template만 구현한다. 정답960,000원·부서 집계를 생성기 코드에 하드코딩하지 않는다.
- [ ] 승인본만 임시 폴더에 작성한 뒤 완료 폴더로 이동한다. 내보내기 실패 시 성공 경로를 반환하지 않는다. 제품 기록에 test 정답을 포함하지 않는다.
- [ ] Core 전체 suite GREEN. Windows에서 S-01을 실제 수행하고 원자료/정답의 분리·수집·제외·문서 검수·내보내기·오류를 실행 기록한다.
- [ ] Expected: baseline 동작만 확인하고 실제 AI 품질은 미검증으로 유지한다. provider 계정·전송·상한을 검토한 뒤 별도 provider 작업과 P2/P3 실험을 계획한다. Task4 커밋.

## 단계별 중단·인계

독립 기능인 provider/회사 배포/멀티테넌시/자동 업무 실행은 위 Task에 끼워 넣지 않는다. 실 장비가 없으면 Core 개발을 진행할 수 있어도 Windows 수집 Task의 실제 인수 검증은 차단으로 남긴다.

계획 검토 후 직접 실행을 권고한다. 같은 세션/manifest/근거 타입을 순서대로 사용하는 작은 PoC라 병렬 구현보다 통합 확인이 쉽다. Task1 Core와 단위 테스트는 구현했다. Task2~4는 미구현이며 실제 Windows 단계는 장비 확인 전 차단이다.
