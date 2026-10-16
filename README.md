# GhostManual

원본 업무 자료를 검수 매뉴얼로 정리하고, 후임자가 게시 버전과 원문 근거를 확인하는 한국어 웹 MVP입니다.

## 로컬 실행
Node24와 PostgreSQL18이 필요합니다. npm ci 후 .env.example을 .env로 복사하고 전용 DATABASE_URL·APP_ORIGIN·무작위 IP_HASH_SECRET을 설정합니다. npm run db:migrate, npm run dev 순서로 실행하면 localhost:3200에서 사용할 수 있습니다.
AI_ENABLED=false가 기본입니다. 합성 예제는 미리 작성된 자료이고 실제 AI 출력으로 표시하지 않습니다. 활성화에는 OpenAI 계정·키·예산과 실제 품질 평가가 필요합니다.

## 검증
npm test, npm run typecheck, npm run lint, npm run build를 실행합니다. 실제 DB 통합과 E2E에는 명시적인 DATABASE_URL의 DB 이름이 _test로 끝나야 합니다. npm run db:migrate 후 npm run test:integration, npm run test:e2e를 실행합니다. 테스트 setup은 전용 테스트 DB의 usage/rate counter만 초기화합니다. 운영 DB에는 적용하지 마세요.

## 현재 상태

[공개 데모](https://ghostmanual.pigs0516.com)는 AI 비활성 상태로 배포·공개 검증을 완료했습니다. 2026-10-17 기록 기준 desktop5/mobile5 흐름10개와 검증 공간 정리를 확인했고, 인계된 최신 소스 검증은 단위41·PostgreSQL 통합40·E2E24·빌드·타입·린트 통과입니다. 실제 AI·지속 부하·전체 접근성·이미지 provenance는 별도 범위입니다. 이번 가이드 갱신에서 제품 검증을 반복하지 않았습니다.

[프로젝트 가이드](PROJECT_GUIDE.md), [문서 가이드](docs/00_문서_가이드.md), [진행 기록](docs/구현_진행_기록.md), [배포 절차](deploy/README.md)를 참고하세요.
