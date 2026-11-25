# 내 문서함 제한 조회 검증

## 기준과 범위
기본#109/e9d87ff(병합후CI45368511296 success), fix/overview-pagination. 사용자지시의첫번째조회량제한만대상이다. 팀20·각팀/개인업무10·교체형페이지, 전체서버검색/상태필터, 기존개인/공유/원본/이력·세션보호를유지한다. 팀순서는이름변경에영향받지않는UUID ASC, 업무는created_at+id DESC이다. 기존팀이름순서와달라지며누락/중복없는동시각경계를우선한다.

## RED 근거
- dbea5b3 / CI45381138136:기존DB247pass·신규3fail. limit=999999를200으로수용,팀21건전건반환,workCount미정의.
- 9a9e48c / CI45382932202:DB251pass,기존E2E160pass·신규페이지/서버검색6fail(각desktop/mobile). 업무다음페이지버튼부재/서버검색요청부재/페이지재시도부재를확인하고2e70603으로구현했다.
- 테스트작성중타입/폐기토큰fixture오류는수정했다. 폐기된세션을다시허용하거나검증을삭제하지않았다.

## 서버 확인
4개고정데이터조회(인증/준비검사제외),공간최대22행sentinel→선택21그룹,그룹별11업무sentinel→10개. 전건행client반출후slice하지않는다. Node그룹화는Map으로한번처리한다. typedquerystrict/중복/조합/cursor검증422,정확한6자리UTC+UUID커서,매요청RR/현재권한·no-store·기존Reader/만료/약관거절.
실제DB:21팀·23업무동일microsecond10/10/3·개인11업무10/1,모든페이지합집합중복없음,타인404·권한회수뒤next404,전역미조회팀검색·NFKC/%_literal·매뉴얼제목·검색무관전체counts·게시+미응답질문의published/todo중복·013/014역할·기존실제경합barrier통과.

## 화면/최종 검증
2e70603에서전체API계약을화면에연결했다. 검색300ms debounce·조건변경시cursor초기화·generation으로오래된응답무시,교체형페이지·동기중복guard·실패입력/기존업무page보존·다시불러오기·live안내. 단독문서함응답은target만patch하고다른그룹/팀cursor는보존한다. 기존디자인의native button/secondary/actions만재사용하며새CSS/deps/dev-tool설치는없다.
최신문서headCI·최종캡처결과는PR본문에갱신한다. 현재진행중결과를전체통과로표기하지않는다.

## 한계/경계
전역집계·검색후보계산은DB전체허용후보에비례할수있다. SQL별5초statement_timeout은전체요청/동시부하5초보증이아니며,쿼리플랜/부하/색인추가는별도격리실측대상이다. 새페이지는새snapshot이므로데이터/권한변경은다음요청에반영되고신규상단업무는처음page에서확인한다. 768px상단메뉴줄바꿈은별도후속이며이번에는고치지않는다. Lighthouse/외부보안스캔/전체접근성인증완료를주장하지않는다.
로컬프로젝트수정·S1npm/DBfixture/빌드/테스트/부하·운영배포·014·대표지정·추가삭제는실행하지않았다. 격리GHA만사용하고native범위Biome/git diff check만작업checkout에서실행했다.
