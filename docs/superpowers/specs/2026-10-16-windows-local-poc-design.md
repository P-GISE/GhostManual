# Windows 로컬 수집 PoC 구현 설계 제안

상태: Task1 Core 구현·Linux 단위 검증. Windows/화면/생성 부분은 검토용 제안. 사용자 확인은 Windows·PC 업무 자동 수집·웹→Excel→결과 문서 흐름이다. 아래 기술·지원 버전·보관·한도는 구현 기준으로 검토할 제안이며 아직 사용자 장비에서 검증하지 않았다.

기준: [제품 기획](../../기획/01_제품_기획서.md), [PoC](../../기획/02_PoC_검증_계획.md), [S-01](../../기획/03_Windows_대표업무_시나리오.md).

## 1. 목표와 완료 수준

Windows에서 명시적으로 시작한 업무 세션의 전면 앱 흐름과 선택한 화면 근거를 수집하고, 제외/마스크를 검토한 근거만 로컬 매뉴얼로 내보내는 최소 실험을 만든다. S-01의 데이터 정답은 이미 준비됐지만 수집기·수집 품질·매뉴얼 품질·인수인계 효과는 별도 검증한다.

완료 수준을 분리한다: A=이벤트 계약/재생 unit 통과, B=실 Windows 앱 전환 수집 통과, C=실 화면 제외/마스크·내보내기 통과, D=실 모델과 후임자 재현 평가 통과. A만으로 PoC 전체 성공을 선언하지 않는다.

## 2. 기술 대안과 권고

| 대안 | 장점 | 비용·제약 | 제안 |
|---|---|---|---|
| C#/.NET + WPF + Windows API | Windows 권한·창·캡처 API와 직접 연결, 웹 서버 없이 동작 | Windows 빌드/장비 검증 필요, 이미지·WinRT interop 작업 | 첫 PoC 권고 |
| Tauri/Rust + 웹 UI | 경량 UI와 향후 플랫폼 분리 | Rust·웹·Windows 경계 증가 | 다중 플랫폼 요구 시 재검토 |
| Electron + native helper | 웹 UI 개발 편의 | native helper와 배포/메모리 부담 | 첫 단일 OS 검증에는 보류 |

권고 baseline: Windows11 x64·단일 모니터·일반 사용자 권한, .NET10 LTS/C#, WPF, 순수 로직은 net10.0 프로젝트로 분리. 실제 Windows 버전·앱/Office 설치·장비를 확인한 뒤 지원 기준을 확정한다. 현재 개발 도구의 Node/Python을 제품 스택으로 자동 승계하지 않는다.

## 3. 첫 수집 범위와 경계

- 수집 대상 앱을 사용자 allowlist로 정한다. 초기 S-01 후보는 Edge 또는 Chrome, Excel, 문서 편집기다. 특정 앱이 설치됐다고 가정하지 않는다.
- 전면 앱 식별을 500ms 주기로 관찰하는 첫 후보를 제안한다. 관찰 시각·sequence·앱 식별·상태만 기록한다. 창 제목·전체 경로·키 입력·클립보드·UIA 텍스트는 기본 저장하지 않는다.
- 앱 변화 후 화면이 안정된 시점의 근거 후보와 사용자 수동 근거 버튼을 비교한다. 전환 직후 잘못된 창을 찍지 않도록 캡처 전후 창/앱 식별을 확인한다.
- 초기 화면 경로는 Windows Graphics Capture 후보로 별도 기술 검증한다. 캡처 불가·권한 상실·보호 화면·잠금·UAC 경계는 중단/공백으로 기록하며 우회하지 않는다.
- 앱 전환 이벤트만으로 Excel 필터·수식·문서 저장 성공을 알았다고 표시하지 않는다. 읽지 못한 의미는 확인 질문으로 남긴다.

## 4. 수집 상태와 이벤트 계약

Session 상태: prepared → recording ↔ paused → stopped, 어느 활성 상태에서도 cancelled 가능. recording에서만 관찰 이벤트를 받는다. stopped/cancelled에서는 재개하지 않고 새 세션을 만든다.

CaptureEvent v1: schemaVersion=1, sessionId, eventId, sequence, observedAtUtc, kind(app_focus/gap/annotation/evidence_request), appId(optional), safeNote(optional). 제목/경로/입력 원문 필드는 계약에 두지 않는다. 알 수 없는 schemaVersion/필드는 읽기 경계에서 거부하고 safeNote는 선택 문자열·최대1000 UTF-16 code unit으로 제한한다. 시간은 UTC·순서는 단조 증가 sequence이며 같은 eventId 재전송은 중복 저장하지 않는다.

pause·resume·stop은 세션 제어 이력으로 별도 보존한다. 수집 완료와 생성 완료를 같은 상태로 합치지 않는다. 수동/자동 화면 후보는 evidence_request 이벤트를 근거 anchor로 사용한다. appId는 허용 앱의 표시용 식별자이며 실제 실행파일 경로를 저장하지 않는다. 새 세션의 sequence는1부터 시작하며 수락된 이벤트마다1씩 증가한다. 같은 eventId의 동일 payload만 중복으로 무시하고 내용이 다르면 거부한다. resume 후 첫 관찰은 새 focus anchor로 기록한다. Polling 사이에 보지 못한 전환은 자동으로 복원할 수 없으며 알려진 API 실패/중단만 gap으로 표기한다.

## 5. 화면 근거와 저장 제안

로컬 세션 데이터는 사용자 전용 앱 데이터 폴더 아래에 둔다. PoC는 서버·클라우드 DB·HTTP 업로드를 기본 도입하지 않는다.

화면 후보는 메모리에만 유지한다. 원본 이미지를 디스크·임시 파일·로그에 먼저 저장하지 않는다. 검토 화면에서 사용자가 제외하거나 영역 마스크를 적용하고 승인한 새 이미지 바이트만 로컬 assets에 저장한다. 승인되지 않은 후보는 내보내기에 포함하지 않는다. 관리형 런타임 메모리 해제가 포렌식 삭제를 보장한다는 주장은 하지 않는다.

제안 한도: 세션20분, 후보120개, 이미지 후보/재인코딩 버퍼256MiB. 어느 한도든 넘으면 수집을 paused로 전환하고 이유를 표시한다. 프레임을 조용히 버리거나 계속 수집하지 않는다. 세션20분은 pause 시간을 포함한 시작 이후 경과 시간이고, 초과 후 같은 세션 재개는 거부한다. 이미지 한도는 프로세스 전체 RSS가 아니라 후보와 임시 인코딩 버퍼의 합이며 캡처 할당 전 여유를 확인한다. 한도는 실 장비에서 타당성을 확인하고 실험 전에 고정한다.

세션 폴더 예시:

```text
sessions/<uuid>/
  current.json           # snapshotId: UUID, 마지막 게시된 메타데이터 버전
  .write.lock            # 세션별 동시 저장 배제
  snapshots/<uuid>/      # 불변, 이전 버전 유지
    session.json
    events.jsonl
    controls.jsonl
  assets/<uuid>.png       # 사용자 승인·마스크 후 바이트만
  revisions/<n>.json
  exports/revision-<n>/
```

JSONL에는 안전한 메타데이터만, PNG는 별도 파일에 둔다. sessionId/assetId로 생성한 경로만 사용하며 사용자 입력을 경로로 조합하지 않는다. 파일 쓰기 실패는 성공 저장으로 처리하지 않는다. 제거한 asset은 현재 생성 입력·미리보기·내보내기에서 제외하며 검수 후 변경은 needs_review로 표시한다.

보관 제안: 원본 후보는 앱 종료 시 폐기, 승인된 로컬 자료는 명시적 세션 삭제 전까지 보존하되 목록에서 삭제 가능. 자동 장기 백업·동기화는 제공하지 않는다. 실제 조직 도입 전 암호화·보관 기간·백업/삭제 정책은 별도 설계한다. 정답 evaluation 폴더는 자료 제공 범위와 분리한다.

## 6. 초안 생성·검수·내보내기

Generator 경계: 승인된 이벤트/이미지 manifest + 작성자 주석 → DraftResult. manifest에는 세션/입력 버전과 허용 asset ID를 고정한다. 제외/삭제 후 오래된 manifest 결과는 승인하지 않는다.

첫 baseline은 template 모드다. 관찰한 앱 전환·제공한 주석·근거를 나열하며 의미를 모르는 절차는 ‘확인 필요’로 표시한다. 이를 AI 생성이나 단계 자동 이해 성공으로 표시하지 않는다. S-01의 정답·보고서 내용을 baseline 생성기에 하드코딩하지 않는다.

provider 모드는 별도 opt-in이다. 모델·키·입력 전송·비용/시간 상한을 검토한 뒤 선택하고 구현한다. 실제 호출 전에는 adapter 계약과 fixture만 검증할 수 있다. 외부 네트워크 자동 요청은 기본 없다.

내보내기는 검수한 revision의 Markdown + 승인 PNG만 담은 로컬 폴더를 제안한다. 중간 임시 디렉터리에 모두 작성한 뒤 완료 폴더로 이동하고, 실패하면 완료로 표시하지 않는다. revision이 승인 뒤 바뀌면 다시 검수한다. 문서 공유 서비스·PDF/Word 변환·자동 메일은 첫 구현 범위 밖이다.

## 7. 구현 단계와 환경 검증

1. 순수 Core: 계약·상태 전이·중복·한도·입력 manifest·안전한 export. Linux/Windows에서 unit 검증 가능.
2. Windows metadata collector: 수집 상태 표시·allowlist·전면 앱 변화·잠금/정지·실 장비 기록. Windows 장비가 필요.
3. Windows 화면 근거: 캡처 기술 spike·메모리 후보·검토/마스크/승인·실 화면 제외 시험. API 지원 검증 전 fake screenshot을 성공으로 처리하지 않음.
4. template 초안·검수·내보내기 및 S-01 실험. 별도 provider 이후 실 생성 품질/비용·후임자 재현 평가.

현재 환경은 Linux이며 SDK10.0.402로 Core를 구현·단위 검증했다. Windows API·UI·Office를 이 환경에서 실제 실행했다고 기록하지 않는다.

## 8. 검토할 선택과 선행 조건

Windows11/.NET10/WPF·단일 모니터 baseline, 로컬 전용/기본 외부 호출 없음, 화면 원본 메모리 전용과 한도·보관·마스크 절차, template/provider 구분을 검토한다. 실제 Windows 장비·앱·보관 조건·provider 예산이 준비되지 않은 단계는 해당 실험을 차단 상태로 둔다.

Core의 이벤트/상태/저장은 구현했으며 나머지는 설계 제안이다. 실제 Windows 수집 실험 결과는 없다. [인수 시나리오](../../기획/04_Windows_PoC_인수_시나리오.md)와 [위험 검토](../../기획/PreMortem-GhostManual-2026-10-16.md)를 함께 검토한다.

## Task1 구현 시 저장 일관성 보완

세 파일을 개별 덮어쓰면 서로 다른 버전이 섞일 수 있어 snapshotId로 만든 불변 폴더를 먼저 완성하고 같은 디렉터리의 임시 포인터를 current.json으로 rename해 게시한다. 읽기는 SessionStore.GetCurrentSnapshotAsync로 선택한 snapshot 경로를 사용한다. 동일 세션의 경쟁 writer는 파일 잠금 실패를 명시적으로 반환한다. 실패/취소는 성공 경로를 반환하지 않고 이미 게시한 snapshot을 유지한다. 임시 포인터/미게시 snapshot은 정상 오류 처리 시 정리한다. 충돌·전원 장애 후 고아 snapshot 정리는 미구현이며 rename은 전원 장애 시 파일시스템 내구성 전체를 보장하지 않는다.

저장 루트는 신뢰 가능한 사용자 전용 로컬 폴더여야 한다. Unix 새 폴더는0700으로 만들고 Windows는 상위 AppData 권한을 상속한다. 기존 디렉터리 권한 교정·악의적인 동일 사용자 프로세스와의 경합·외부 동기화/네트워크 파일시스템 보장은 이번 검증 범위 밖이다. 현재 원본 화면이나 파일 내용은 수집하지 않는다.
