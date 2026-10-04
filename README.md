# GhostManual

원본 업무 자료를 검수 매뉴얼로 정리하고, 후임자가 게시 버전과 원문 근거를 확인하는 한국어 웹 MVP입니다.

## 로컬 실행
Node24와 PostgreSQL18이 필요합니다. npm ci 후 .env.example을 .env로 복사하고 전용 DATABASE_URL·APP_ORIGIN·무작위 IP_HASH_SECRET을 설정합니다. npm run db:migrate, npm run dev 순서로 실행하면 localhost:3200에서 사용할 수 있습니다.
AI_ENABLED=false가 기본입니다. 합성 예제는 미리 작성된 자료이고 실제 AI 출력으로 표시하지 않습니다. 활성화에는 OpenAI 계정·키·예산과 실제 품질 평가가 필요합니다.

## 검증
npm test, npm run typecheck, npm run lint, npm run build를 실행합니다. 실제 DB 통합과 E2E에는 명시적인 DATABASE_URL의 DB 이름이 _test로 끝나야 합니다. npm run db:migrate 후 npm run test:integration, npm run test:e2e를 실행합니다. 테스트 setup은 전용 테스트 DB의 usage/rate counter만 초기화합니다. 운영 DB에는 적용하지 마세요.

## 현재 상태
로컬 unit41·PostgreSQL integration39·Chrome desktop/mobile E2E20 통과. 원본 수정 후 버전2 재검수·Reader 원본열람·reload 공유취소·개별삭제·초안/게시본 구분을 확인했습니다. 실 AI·공개HTTPS·운영부하는 미검증입니다.

[프로젝트 가이드](PROJECT_GUIDE.md), [문서 가이드](docs/00_문서_가이드.md), [진행 기록](docs/구현_진행_기록.md), [배포 절차](deploy/README.md)를 참고하세요.
