# picomatch 단일 분기 반복 취약점 조치

## 원인과 변경
GHSA-fc5q-39xc-vjpf / CVE-2026-112366은 picomatch4.0.7 이하의 단일 분기 wildcard 반복 extglob에서 발생한다. 공식 수정판은 조회 시점에 없다.
PR #68 CI가 이 간접 개발 의존성 때문에 중단됐다. npm overrides로 picomatch를 실제 수정이 담긴 공개 포크 @ryotsu/picomatch4.0.7-a에 고정한다. 원본 패키지 버전과 보안 검사 정책은 바꾸지 않는다.

## 출처와 무결성
- 공식 공지 https://github.com/advisories/GHSA-fc5q-39xc-vjpf
- 고정 소스 https://github.com/ryotsu-kankichi/secured-picomatch/tree/3ab5a7627d480259e3d9ca67fbc14c125d374f0e
- 패키지 https://www.npmjs.com/package/@ryotsu/picomatch/v/4.0.7-a
- npm tarball10개 파일과 고정 Git 소스의 바이트 일치 및 registry sha512 일치를 독립 확인했다. lockfile에 무결성을 고정한다.
- integrity sha512-JroBFEmaejC7szGSfqOhF1QZHLKvX2wTA1+fWyfkpy3BjzdQKNPLKa2FtgeKVUDy5/UPUNkXEeCHJ5ZRBMLTVA==
- MIT와 기존 저작권을 보존하며 런타임 의존성·설치 lifecycle script가 없다. npm provenance metadata가 존재한다.

## 적용 범위와 한계
GhostManual에서 이 패키지는 vitest/vite/tinyglobby/fdir의 개발 도구 경로에 있다. src와 scripts는 picomatch를 직접 사용하지 않고 외부 요청에서 glob을 입력받지 않는다. 보호를 끄는 maxExtglobRecursion:false 사용도 저장소에서 발견하지 않았다.
이 포크는 공식 upstream 릴리스가 아니다. 복잡한 단일 분기 wildcard extglob을 문자 그대로 취급하고 capture 결과가 달라질 수 있다. 임의 외부 glob 매칭용으로 사용하면 안 된다.
다중 분기 패턴 +(a|*a)의 기존 ReDoS 문제는 남아 있다. 이번 조치는 공지된 단일 분기 취약점의 수정이며 모든 glob의 안전성을 보장하지 않는다.
공식 수정판이 나오면 동일 공격 회귀와 전체 CI를 실행해 override 제거 여부를 검토한다.

## 검증
독립 대조에서 원본4.0.7의 +(*a)와 a32개+! 입력은2초 timeout, 고정 포크는2ms/false를 확인했다.
패키지의 scoped 이름 때문에 scanner가 upstream 공지와 연결하지 못할 수 있다. audit0건만으로 해결을 판정하지 않으며, 실제 소스 수정·무결성·공격 회귀를 함께 근거로 사용한다.
tests/unit/picomatch-security.test.ts에서 실제 설치된 패키지 이름·버전, 프로젝트의 static glob 의미, 공격 패턴6개를 검사한다. 공격 매칭은 메모리 제한 worker에서 수행하고2초를 넘기면 종료해 테스트 실패로 판정한다.
npm audit 결과와 전체 unit/통합/E2E/접근성·이미지 검증 결과는 PR #68의 최신 CI를 따른다.
