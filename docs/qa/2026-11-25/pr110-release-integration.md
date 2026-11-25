# PR110 릴리스 통합·검증 기록

## 소스와 승인
기준 mainc335c9d, ownfix/overview-pagination(PR110). 원본111/519b3eb·114/18e1cdc·102/fa629d2를 merge commit으로 통합해 작성자 브랜치를 보존한다. 사용자 PR 정리·CI 직접 배포 지시는 이 릴리스 반영 범위이며 Node26·운영014·추가자료삭제·자동승계를 포함하지 않는다. 이미 병합된112/113의 설계/랜딩은 기본 브랜치 변경으로 반영한다.

## 검토와 재현
- 기존114 CI45563624217: 관리자 탭5개/기존4개 기대 접근성6fail 확인. 새 탭 순서·내용·역할·mock응답을 함께 검사하도록 보완.
- 진행 현황 RED45572408558: DB252pass·새 상한/query2fail. 업무10개+sentinel,정확한microsecond+id keyset,매요청RR/admin·엄격query,SQL별5초timeout을 추가했다. 실제DB013 호환 project에 별도 progress 회귀를 포함한다.
- team_workspace_identity는 팀expires_at=infinity를 강제하므로 “만료팀이 존재한다”는 초기 가정은 철회했다. 제약을 그대로 두고 유효한 개인 세션 만료401 회귀로 검사한다.
- 대표 이양 실패에도 선택이 지워지는 act Promise 처리, 역할 재조회·불명확 결과 재전송·중복 클릭·확인/취소 포커스를 검토하며 새 회귀를 추가한다. RED45573921610에서DB255통과·기존E2E174통과·신규이양6실패를확인한뒤b10813f로보완했다. 최신통합CI는진행중이다.
- Nodemailer 공식v10.6.0..v10.6.1 비교를 읽어 DKIM List-Unsubscribe-Post 서명·fetch 쿠키 식별 수정과 서비스 목록 변경을 확인했다. 프로젝트 diff는 version/URL/integrity만 변경하며 새 전이 의존성은 없다. 실제SMTP 추가 시험메일은 보내지 않는다.

## 검증·실행 조건
최신 PR head 전체CI4개,독립 코드검토,합성 desktop/mobile/tablet 화면 확인 후 병합한다. 배포 이미지는 최초 기본 브랜치 push CI attempt1의단일 ghostmanual-event-image-<전체SHA> artifact만 사용한다. 이미지에포함된014 SQL은 SHA256 d859cc268e43e551477d65c759b8b177b30623442729e2e12c6c20aea5c4dca2/Gitblob883cbd0a91ada3a66128d371f2761dd94cb165e2를 재대조해 보호 tree에만 등록하고SQL은 실행하지 않는다. 설치기를재실행하거나가드를완화하지않는다.

현재/직전영수증·모든컨테이너·worker/OCR pin·환경/Compose해시·DBvolume·lock/marker를재확인하고 신규백업 S3업로드/checksum을 확인한다. 공간은 artifact.zip+압축image archive+새image동시점유까지 계산한다. 미사용79afe21e(source6cb1e1f)정리는별도사용자정확대상승인대기이며실행직전참조재검사한다. 전체prune은하지않는다.

앱은고정실행기,워커는stop→정확CID부재→pin→start순서. 배포후로그인/DB013·미준비503·역할별진행현황·업로드/추출·로그아웃/공유·환경/다른서비스보존을작은합성자료로검증한다. 무거운테스트/빌드/fixture는GHA격리에서만실행한다. 실제결과는PR본문/서버완료영수증에갱신한다.

## 한계
014 보류로 운영에서 대표 이양은 숨겨진다. 다른 팀 대표의 계정 삭제409 안내는014 활성화전 후속이다. 전체집계비용/전체서비스동시부하·기존선택기metadata전건조회·태블릿상단/모바일카드간격은 별도 작업이다. 운영 키/개인 연락처/업무 자료는 기록하지 않는다.

#114 작성자가 보고한 PPTX 모바일 status 선택자 충돌도 확인했다. 비교완료와문서로딩status가동시에존재할수있으므로대상처리중문구를가진status0개로범위를한정했다. 비교결과heading·실제old/new본문검사는유지한다.
