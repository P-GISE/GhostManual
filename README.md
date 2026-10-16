# GhostManual

Windows PC 업무 자동 수집형 GhostManual의 첫 PoC를 개발 중입니다. 순수 .NET Core의 세션·이벤트·로컬 저장과 단위 테스트를 구현했습니다. Windows 수집기·UI·화면 처리·문서 생성·DB·제품 배포는 아직 없습니다.

.NET SDK 10.0.402 설치 후 저장소 루트에서 `dotnet restore --locked-mode`, `dotnet test --no-restore`, `dotnet build -c Release --no-restore`로 검증합니다. 실행 가능한 데스크톱 앱은 다음 단계입니다.

- [프로젝트 가이드 전체](docs/README.md)
- [문서 작성 시작점](docs/00_문서_가이드.md)
- [개발 도구 설치·사용](docs/개발_도구_가이드.md)

이전 상태는 Git 이력과 `backup/before-reset-2026-10-16` 브랜치에 보존했습니다. 운영 서버·DB는 이번 초기화 대상이 아닙니다.
