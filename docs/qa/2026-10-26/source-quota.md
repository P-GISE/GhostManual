# 자료 누적 저장 및 쓰기 제한

확인됨: 자료 생성·수정은 기존 owner 세션 검증이 workspace 행을 FOR UPDATE로 잠근 동일 DB 트랜잭션에서 한도를 검사한다. 공간별 자료50개·불변 revision200개·모든 revision 제목/본문 UTF-8 합2MiB를 상한으로 두고 새 revision의 byte수까지 더해 검사한다. 최근1분의 성공한 자료 저장은 생성과 수정 합20회로 제한한다. 별도 세션이나 동시 요청으로 같은 공간의 상한을 우회할 수 없도록 실제 행 잠금을 재사용한다.

storage_quota/source_write_limit은 HTTP429와 한국어 안내를 반환한다. 과거 snapshot·매뉴얼 검수 관계는 수정하지 않는다. 기존 데이터가 이미 상한을 넘었다면 조회·공유·내 데이터 삭제는 유지하면서 추가 저장만 거절한다. 기존 공간7일 보관/삭제와 일반 body/upload 크기 제한은 유지한다. 제목/본문 payload 한도이며 PostgreSQL 인덱스·행 overhead 등 실제 디스크2MiB 보장은 아니다.

검증: 기존 CI의 격리 ghostmanual_test PostgreSQL18에서 신규4개 회귀가 모두 실패한 RED run40214555990(source51개 병렬 생성, multibyte 누적,201번째 revision, create/update 공유 window)을 확인했다. 수정 후 run40214701861에서 실제 DB 통합·lint·타입·단위41·production build 단계 성공을 확인했다. 최종 전체 CI 결과는 PR 실행 결과를 따른다. 테스트는 합성 자료만 사용하며 실제 원문/키/세션 토큰을 증거 문서에 복사하지 않는다.

운영 DB schema/데이터·AI 설정·DNS·접근정책·서비스 상태는 변경하지 않았다. 새 migration이나 서버 설정이 필요 없는 앱 변경이다. 앱만 이전 이미지로 되돌릴 수 있고 DB 복원은 필요하지 않지만 이전 저장 고갈 경계도 복원되므로 권장하지 않는다. 서비스 전체 workspace 증가·디스크 경보와 보관 삭제 실행 여부는 별도 운영 확인 대상이다. 이 변경이 다른 기기의 시작/쿠키 오류를 해결했다고 판정하지 않는다.
