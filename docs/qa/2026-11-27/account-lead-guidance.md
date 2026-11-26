# 계정 탈퇴 대표 이양 안내: 검증 근거와 한계

## 범위

사용자가 PR116 병합과 대표 권한 때문에 계정 탈퇴가 막힐 때 기존 이양 화면 안내 구현을 지시했다. PR116은 f0be15a로 병합했고 병합 후CI45860997292가 성공했다. 원본 PR117(63a480c)의 메뉴 개편은 미병합이며 해당 원본/공유 파일은 수정하지 않는다. [설계](../../superpowers/specs/2026-11-27-account-lead-guidance-design.md)·[계획](../../superpowers/plans/2026-11-27-account-lead-guidance.md).

운영은 기존 Node26.13.1/DB013이고 이번 구현에서 앱/워커/SQL/014/backfill/대표 지정은 실행하지 않는다. 실제014 검증은 GitHub 격리DB만 대상으로 한다.

## RED 근거

- test-only87f5874/CI45861720971: 기존DB255성공·신규3실패. GET 목록에 lead:boolean이 없어 strict 응답 검사가 실패했다. 실제 ownlead/소속/다른계정/multi-team/이양·역할변경 경계다.
- API보완c2c0120/CI45862399498: DB검사 성공 뒤 화면에서 기존E2E186성공·신규10실패. 8건은 새 안내 region이 없는 기능 RED, 2건은 일반 오류 검사에 Next route-announcer까지 선택된 테스트 selector 문제였다. 오류 본문이 실제 렌더된 것을 로그에서 확인하고 main 영역으로 selector를 한정했다. 이를 제품 결함10건으로 부르지 않는다.

## 구현·GREEN 진입

같은 SQL에서 marker014/team/admin/ownpointer를 확인해 lead를 산출하고013에서는 false를 반환한다. AccountPage만 로컬 확장 schema·정확한409코드·no-store GET·검증 UUID링크·삭제 재확인 초기화·동기중복잠금·언마운트가드를 구현한다. Shared Teams.tsx/권한·탈퇴 정책/SQL은 유지한다.

mock UI는503→재조회→401의 오래된 링크 제거·invalidUUID/누락lead·empty목록·일반409/잘못된HTTPstatus·중복DELETE·자동삭제금지를 확인한다. 실제014 E2E는 다른팀선택상태에서 A/B대표팀안내→각팀 명시적이양→사용자 재확인 삭제와팀매뉴얼/공유 보존을 확인한다. 별도013 fixture에서 유효한 pointer가 있어도 안내false를 검사한다. 접근성은3뷰포트 키보드·결과 focus·폭·캡처를 검사한다.

현재 최종GREEN/독립검토는 PR118의 최신head/checks를 따른다. 이 문서를 성공 주장으로 해석하지 않는다. 실제 운영014·브라우저운영·전체부하·추가UI리디자인은 제외다. 기존metadata 전건 조회의 상한을 새로 보장하지 않는다.


## 최종 검토 중 보완

독립 검토에서 기능 코드의 권한·정책 차단 문제는 없었다. 실제E2E의 후임자가 팀A로 이동할 때 H1표시 뒤에도 GET목록→POST세션 전환이 남을 수 있어 자료조회가 이전문서함에서404가 되는 테스트 경쟁을 발견했다. 후임자의 UI발 POST를300ms 지연시키는 조건에서 GET목록의 current가A가 될 때까지 읽기poll로 확인한 뒤 자료를 검사하도록 보완했다. 테스트가 세션을 직접 강제POST하는 우회는 없다. 기존동기잠금 검사는실제disabled UI입구의중복요청을검사하며ref구현자체의분리단위증명은아니다.


## 테스트 간 요청 한도 오염 보완

0970970/CI45864610472는 새 안내/실제이양검사를 포함한E2E202건성공·기존진행현황2건실패였다. 실패는초대201기대/429수신이며새기능UI18건은통과했다. 새실제흐름의APIRequestContext초대3건이Page의asNewVisitor헤더를상속하지않아공통unknown IP의resend5/hour한도를사용한원인을소스/로그로확인했다. 새파일의API요청에만고유합성CF-Connecting-IP를명시하고기존진행현황/공용helpers/운영한도/DBcounter는수정하지않았다. 재실행없이문제를덮지않고전체최신CI로확인한다.
