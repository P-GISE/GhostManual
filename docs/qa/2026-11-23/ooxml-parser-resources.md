# OOXML 동기 파싱 자원 측정

## 최종 검증·운영 상태

PR #95는2ff147b로 병합됐고 [canonical CI45117000015](https://github.com/P-GISE/GhostManual/actions/runs/45117000015)의 전체 기능 검사와 자원46/46건이 통과했다(허용24·안전 거부22, OOM·watchdog·미측정0). 이후 앱·큐 워커를 동일 검증 이미지5fd239f2…로 반영했고 DOCX·HWPX·PPTX·텍스트 PDF의 실제 운영 API 업로드·추출을 확인했다. [배포 및 화면 검증 상태](pr95-production-verification.md)를 따른다. 아래 초기 한도·측정·보완안은 원인 확인 순서의 이력이며 현재 운영에 미반영이라는 뜻이 아니다.

## 목적과 범위

박기성 독립 후속으로 DOCX·HWPX·PPTX의 업로드 전 detectDocumentFormat과 큐 워커 readDocument를 측정한다. 보완 전에는 XML 파트마다100,000태그·깊이80, `.xml/.rels` 파트10MiB·전체확장20MiB·파일5MiB 제한이 있지만 `.hpf`에는 파트10MiB 조건이 없고 전체 확장 한도를 적용한다. 파트 전체 태그 합계 제한도 없다. nativeMs20초는 추출 블록을 내보낼 때 검사하므로 앞선 전체 패키지 파싱을 중단하지 못한다. 이 사실만으로 취약점이나 최대 사용량을 단정하지 않는다.

## 실행 계획

- 공유 서버에서는 fixture 생성·파싱·빌드·부하 실행을 하지 않는다. GitHub runner의 CI에서 빌드한 동일 이미지에서만 실제 `/app/src/lib`를 호출한다.
- 기존 합성 fixture builder를 재사용한다. 작은 정상 입력, 20MiB 확장 근처의 적은 태그 텍스트, 각 파트 한도 안에서 총 태그가 많은 입력, 한도 초과 거부 입력을 구분한다. 파일·XML·확장 크기와 hash를 기록한다.
- 2026-11-23 운영 inspect 기준 앱은384MiB·heap256MiB·0.75CPU·memorySwap총768MiB, 워커는192MiB·heap128MiB·0.25CPU·memorySwap총192MiB다. runner의 swap 가용성 차이는 별도로 표시한다.
- 파싱마다 새 프로세스와 컨테이너를 사용한다. network none·읽기 전용·권한 제거·PID/core 제한을 적용하며 DB·운영 env·socket·실제 업무 자료는 제공하지 않는다. 합성 입력 생성은 측정 프로세스 밖에서 한다.
- 호출 경과 시간, process 최대RSS(KiB), 결과 상태·블록 수, 종료 코드·OOMKilled·watchdog 종료를 집계한다. 개별45초·전체300초 watchdog은 측정 안전장치이며 제품 응답시간 합격선이 아니다. 실행하지 못한 표본도 보고한다.
- 정상 입력 실패·예상 밖 거부·OOM·강제 종료는 안전 처리 검증 실패로 보고한다. 나머지 표본을 수집하고 집계 JSON만 보관한다. 제품 제한·권한·AI 범위는 측정 단계에서 변경하지 않는다.

## 확인 지점

1. fixture가 주장하는 크기·파트 한도와 예상 결과가 실제 값과 맞는지 자체 확인한다.
2. GitHub 격리 실행 결과와 JSON artifact로 성공·안전 거부·자원 실패를 구분한다.
3. 실패가 발견되면 원인을 좁히고 별도 회귀로 재현한 뒤 최소 수정한다. 정책을 느슨하게 바꾸거나 운영 자원을 자동 증설하지 않는다.
4. workflow 변경은 배포 보호 트리의 검토 대상이다. 이 측정 PR만으로 운영 설정·보호 목록을 바꾸지 않는다.

## 실행 도구

호스트 runner는 `tests/performance/measure-native-documents.ts`이며 테스트 fixture가 제외된 Docker 빌드에 포함하지 않는다. 자식 측정기는 `scripts/native-document-probe-child.ts`에서 실제 이미지의 파서를 호출한다. Docker 빌드·자원 진단을 E2E 앞에 두지만 성공한 CI는 기존 모든 기능·접근성 검증도 통과해야 한다.

## 1차 측정: 현행 한도의 실패

[1차 측정 CI45111721692](https://github.com/P-GISE/GhostManual/actions/runs/45111721692)·commit dc4b04a·artifact14790216856에서 24건 모두 실행했다. 정상 소형6건과 기존 XML 파트 크기 초과의 안전 거부6건은 통과했다. 제한 내 긴 XML 텍스트6건·다중 XML 파트6건은 메모리 부족으로 종료됐다(heap OOM7건, cgroup OOM5건). watchdog 미측정은0건이었다. 통과 표본의 최대RSS는 85.6~87.7MiB였으며, OOM 표본은 정상 반환하지 않아 최대RSS 값이 없다.

긴 텍스트 표본은 확장 약20MiB·시작 태그11~29개, 다중 파트는 확장 약16MB·시작 태그 약400만개였다. 각 XML 파트10MiB·태그100,000 이하와 파일5MiB·전체 확장20MiB 조건 안에 있었다. 현재의 파트별 제한만으로 실제 운영 자원 상한에서 안전하게 처리된다고 볼 수 없음을 확인했다. 프로세스가 반환한 표본에서는 실제 cgroup 메모리·swap 상한이 요청 profile과 일치했고 runner swap은 3145724KiB였다.

공유 서버에서는 이 입력을 실행하지 않았다. 이 1차 측정 당시에는 운영103db6f를 유지했고 아래 보완은 PR #95의 구현·검증 대상이었다. 이후 최종 CI·운영 반영을 완료했다. 새 업로드·새 추출 및 대기 작업의 재시도에는 적용되지만 기존 완료 자료를 자동 재처리·삭제하거나 게시 snapshot을 다시 쓰지 않는다.

## 추가 경계 측정과 보완안

[CI45112782700](https://github.com/P-GISE/GhostManual/actions/runs/45112782700)·commit827c040·artifact14789419784에서는 기존24건을 유지하고 DOCX 진단16건을 추가했다. 40건 모두 실행했고 추가16건은 모두 처리됐으며 기존 대형 입력12건 OOM은 재현됐다. 별도 PR 실행45112787397에서도 같은 12개 표본이 OOM이었고 나머지28건은 통과했다. 결과는 실패한 입력을 축소해 통과시킨 것이 아니다.

| DOCX 진단 | 앱 최대RSS | 워커 최대RSS |
|---|---|---|
| single-text-512k | 105.7MiB | 105.0MiB |
| single-text-1m | 122.0MiB | 122.9MiB |
| single-text-2m | 157.7MiB | 158.1MiB |
| flat-total-25000 | 102.3MiB | 98.6MiB |
| flat-total-50000 | 105.4MiB | 103.4MiB |
| flat-total-100000 | 115.5MiB | 115.5MiB |
| mixed-xml-512k-tags-25000 | 114.9MiB | 112.9MiB |
| mixed-xml-1m-tags-50000 | 132.4MiB | 131.9MiB |

선행 검사 보완안은 `.xml/.rels/.hpf` 합계1MiB·패키지 전체 시작 태그 후보100,000개다. XML1MiB·태그5만 혼합 표본의 워커 최대RSS가 약132MiB였고 긴 텍스트2MiB 표본은 약158MiB였다. 앱 전체·DB 연결·동시 요청을 포함하지 않은 수치이므로 2MiB까지 처리됐다는 이유로 그 값을 서비스 안전 한도로 보지 않는다. 기존40표본을 유지하고 XML1MiB·태그100,000개와 비XML 분량을 합쳐 전체확장20MiB를 채운 3형식×2프로필의 허용 경계6건을 추가해 총46건으로 검증한다. 새 정책 초과는 rejected, 한도 안의 정상 표본은 ready와 원본 표식이 필수다. 최신 통과 여부·측정값은 [PR #95](https://github.com/P-GISE/GhostManual/pull/95)의 CI와 집계 artifact를 따른다.

이 보완은 기존보다 엄격한 **허용 범위 변경**이다. 파일5MiB·ZIP 전체확장20MiB는 유지하지만 본문·스타일·관계·HWPX manifest·미사용 XML까지 합산하므로 기존에 허용되던 복잡한 문서가 거부될 수 있다. 새 env나 DB schema·게시 snapshot 형식은 추가하지 않는다. 시작 토큰은 Unicode 이름을 포함하도록 보수적으로 세며, CDATA·주석 안의 태그 모양 문자열도 추가 계수될 수 있어 정확한 노드 수와 같다고 주장하지 않는다. 초과 입력은 안전한 거부이며 게시 가능한 limited로 처리하지 않는다. 이 제한은 최종 검증 후 PR95 운영 반영에 포함됐다.

단일 parser의 통과는 Next.js/DB 연결의 기본 RSS·동시 업로드·다른 요청을 포함한 서비스 전체 안전성 보증이 아니다. 표본은 허용 범위 안의 스트레스 입력이며 가능한 모든 OOXML의 최악값은 아니다.

## 구현 회귀

새 기준의 테스트만 기준 코드에 적용한 [CI45113884324](https://github.com/P-GISE/GhostManual/actions/runs/45113884324)에서 신규12건 실패·265건 통과를 확인했다. 실패는 거부되어야 할 입력이 통과한 assertion이며 빌드·타임아웃 실패가 아니다. 구현은 XML rawbytes를 디코딩·validator·AST 전에 합산하고, 호출별 새 예산을 공유하며 Unicode 시작 이름도 포함하도록 검사한다. 정확 한도/초과·여러 파트·Unicode·호출 간 초기화·.rels/.hpf·작은CDATA/comment·비XML 분량 보존 회귀를 추가했다.

## 검사되지 않은 DOCX 스타일 참조

일반 `.xml`이 아닌 파일의 styles 관계는 업로드 형식 검사에서 존재 확인만 통과하고, 기존 `removeHiddenStyles`가 검사된 XML을 찾지 못하면 조용히 건너뛰었다. 정상 styles MIME·관계를 사용한 순수 합성 `styles.dat` 회귀의 [테스트-only CI45115272095](https://github.com/P-GISE/GhostManual/actions/runs/45115272095)에서 ready 결과가 반환되어 신규1건 실패·277건 통과로 재현했다. 실제 업무 자료에서의 발생을 확인한 것은 아니다.

스타일 관계가 있지만 검사된 스타일 XML이 없으면 unsafeDocument로 거부하는 한 줄을 추가했다. styles 관계가 없는 정상 문서와 기존 `.xml` 스타일 처리는 유지한다. 업로드의 detectDocumentFormat은 통과할 수 있고 비동기 readDocument 추출이 rejected·snapshot:null로 종료되는 경계다. 미검사 스타일을 적용하지 않은 ready 결과를 저장하지 않으며, 기존 완료 snapshot을 자동 변경하지 않는다. 새 업무 범위를 추가하는 대신 이 재현 건까지만 보완하고 전체 회귀를 확인한다.

## 자원 보완 후 46표본 결과

[CI45115198130](https://github.com/P-GISE/GhostManual/actions/runs/45115198130)·commit d9d2b2e·artifact14791467778의 자원 측정 단계에서 **46/46건이 통과**했다. 허용24건과 안전 거부22건이며 OOM·watchdog·미측정0건이었다. 기존40개 입력의 XML/확장 바이트와 태그 수가 이전 실패 측정과 같음을 대조했고, 이전 OOM12건은 파싱 전 안전 거부로 바뀌었다. 이 결과는 해당 자원 측정 단계의 결과이며 최종 전체 CI 여부는 PR 최신 실행을 따른다.

아래6건은 XML합계1,048,576bytes·시작후보100,000개와 비XML 분량을 포함한 전체확장20,971,520bytes를 동시에 채운 허용 경계다.

| 형식 | profile | 최대RSS | 파싱 호출 시간 |
|---|---|---|---|
| docx | app | 167.8MiB | 798.9ms |
| docx | worker | 165.6MiB | 2597.3ms |
| hwpx | app | 158.1MiB | 806.5ms |
| hwpx | worker | 159.7MiB | 2588.4ms |
| pptx | app | 158.7MiB | 823.9ms |
| pptx | worker | 161.9MiB | 2695.3ms |

이는 parser 단독의 합성 표본 결과다. worker 전체의 DB 연결·TLS 자료·다음 작업과의 GC 중첩, Next.js 기본 RSS·동시 업로드는 포함하지 않아 서비스 전체 최대 부하 통과로 해석하지 않는다. 네이티브 자원 보완 및 검사되지 않은 스타일 거부는 최종 CI를 통과한2ff147b·앱/워커5fd239f2… 운영 반영에 포함됐다.
