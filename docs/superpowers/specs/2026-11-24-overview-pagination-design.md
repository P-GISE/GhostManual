# 내 문서함 제한 조회 설계

사용자의 "1번째 바로 진행" 지시로 조회량 제한/페이지 처리를 구현한다. 기술 선택은 구현 담당 판단이며 별도 제품 정책 합의로 표기하지 않는다. 기존 자료·공유·권한·세션·013/014 동작을 유지하고 운영/014 적용은 하지 않는다.

## 선택과 대안
전건 조회에 LIMIT만 넣으면 자료가 조용히 사라지고 client 검색도 빠진다. 전역 업무 한 페이지만 그룹화하면 빈 팀과 팀별 탐색이 사라진다. 기존 팀별 화면을 유지하는 두 단계 페이지를 선택한다. 팀20개, 팀/개인 업무10개 기본·고정 크기, DB에서는 sentinel 한 개만 추가 읽어 다음 페이지를 판정한다. 화면도 교체형 페이지로 최대21그룹/210업무를 유지한다.

## 계약
GET /api/overview 기존응답 teams/personal 유지, counts:{all,todo,published},nextTeamCursor:string|null 추가. 각 group에 workCount(필터 전),matchingCount(검색/필터 후),nextWorkCursor:string|null 추가. 작품 Work의 기존필드는 유지하며 cursor용 내부값은 제외한다.
query(정규화 전최대100자): trim/NFKC/ko 소문자 literal substring, title+공백+manualTitle 비교. filter=all|todo|published 기본all. counts는 검색과 무관한 접근가능 전체업무 상태집계이며 published와todo는 질문상태로 겹칠 수 있다. DB SQL은 taskState와 의미 일치한다.
afterTeam=UUID: immutable workspace id ASC keyset, 최초 요청부터 접근가능한 모든 팀에 검색/필터 적용 후 팀20개를 선택한다. 기본all+빈검색은 빈 팀도 포함. 검색/필터 활성 시 일치업무 없는팀은 제외하고 전역결과없음 안내. 개인 문서함은 원래 자료가 있는 경우 팀 페이지와독립적으로 포함, 타인개인은거절한다.
workspaceId=UUID,afterWork=opaque cursor: 한 문서함 업무 다음페이지. 현재 같은user 접근권한을 재검사하고 404로 타인존재은닉. afterWork는 정확한created_at microsecond+id DESC keyset; 같은시각업무도 빠짐없이 탐색. query/filter는 이어받고 다음자료없으면cursor=null. cursor는권한증거아님. 잘못된/중복/알수없는query·과긴검색·잘못된cursor·비UUID·afterWork만입력·afterTeam+workspaceId조합은422. authenticated GET만허용하고기존Reader/만료/약관거절유지.
첫 SQL RR 및 인증세션잠금 유지. query timeout은해당TX에서만 5초설정, 기존http503처리를재사용해부분성공없이재시도안내. 응답행수 제한과전체서비스부하안전보증을구분한다. 범위가커지면색인/집계캐시를실측후별도검토하며 이번migration은없다.

## 화면
검색은300ms debounce 후server 재조회, filter/검색변경시팀·업무cursor초기화. 오래된응답은새결과를덮지않고 pending중 이전카드를비활성/숨김 처리하여다른조건결과를정답처럼보이지않게한다. 실패시입력보존·명시재시도, no자동POST재시도. page loading도별도live안내. 팀 "이전 문서함/다음 문서함", 업무 "처음 업무/다음 업무" 버튼, target44px 기존secondary사용. loaded누적없이교체, workCount와matchingCount/현재표시건수를구분한다. 기존enter의targetPOST/동기중복guard/unmount보호 유지.

## 검증
실제DB에서21팀·11업무초과 sentinel, 동일timestamp복수source tie-break, 모든page합집합/중복없음, 뒤page전역검색·필터·literal기호/NFKC, private/expired/Reader/회수후next거절 및 RR경합 회귀. UI mock+실제API E2E로다음·이전·초기화·늦은응답·오류입력보존·중복page클릭·keyboard/모바일/태블릿 검사. S1에서빌드/DB/fixture생성/부하실행금지, GHA격리에서만실행.
