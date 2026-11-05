# PR #55 운영 반영 전 실제 검증 — 2026-11-05

현재 단계는 병합 전 검증이다. 운영 앱은0d4057e 그대로이고 관리자006만 적용됐다. 문서007·운영 앱 배포·실제 PKI를 사용하는 gateway/queue worker 활성화는 아직 하지 않았다. 아래 검사는 합성 파일과 전용 합성 인증서만 사용했다.

## 코드·CI

최신 코드386069e에서 기본 브랜치0d4057e/PR52를 보존했다. SourceForm은 XLSX 기존 안내와 다른 형식의 처리 후 안내를 구분하고 Reader E2E는POST202/실제UUID 등록 완료 후 큐를 처리한다. 제품의 quarantine/검수 guard를 완화하지 않았다. 단위235개와 runtime16개·production18개, 전체 PostgreSQL 통합·일반 build·E2E·session/transport·접근성·배포 이미지 build를 포함한 GitHub CI가 통과했다. [PR CI41959002639](https://github.com/P-GISE/GhostManual/actions/runs/41959002639), [push CI41958996837](https://github.com/P-GISE/GhostManual/actions/runs/41958996837).

## 자격 증명 계약 보완

systemd255는 root 소유0400 자격 증명에 서비스 UID 읽기 ACL을 추가한다. 실제 root:root 파일0440·디렉터리0550의 group mode 비트는 ACL mask이며 group_obj 권한은0이다. UID1000의 named ACL만 파일r/디렉터리rx이고 other0이다. 기존 own-UID0400 가정은 이를 잘못 거부했다.

수정은 자기 unit의 고정 credential 경로, no-follow/dirfd 상대 열기, root0:0, 정확 mode·단일 link·64KiB 상한·읽기 전용 mount와 정확한 버전2의5-entry ACL을 함께 요구한다. 다른 사용자/그룹·추가 ACL·잘못된 mask/version·쓰기 가능 filesystem은 실패한다. [systemd255 구현](https://github.com/systemd/systemd/blob/v255/src/core/exec-credential.c)을 실제 메타데이터와 대조했고 새 검사는18/18 통과했다. 키 본문은 기록하지 않았다.

## 최종 extractor 실행

최신 이미지 `sha256:dbcfde8fe78ff401b586c5b321c59cfefb5d76af3247598172b5f4bf338f886d`의19개 소스 해시를 새 rootfs에서 확인했다. 기존14개 검증 소스는 동일하며 검증된 pinned dependency cache를 재사용했다. 기존 rootfs는 수정하지 않았다.

- 실제 production launcher·활성화 FD3·RootDirectory·AppArmor·전용 cgroup·private network에서 격리5/5와 실제 추출10/10 통과, 종료success/0.
- 시간 초과 setsid 자손·출력 폭주·메모리 초과 후 정상 파싱 복구와 UID·FD/PID1·환경·파일·네트워크 경계를 검사했다.
- gateway service의 실제 host capability bound는SETUID/GID만, NNP1, UID/GID1000이고 host와 net namespace가 다르다. socket/service의 ingress·egress BPF를 각각 확인했다.
- 정상 mTLS 실제PDF 추출 성공. client 인증서 없음·다른 client CA·잘못된 server CA·server 이름·TLS1.2를 SSL 오류로 거부했고 비루프백18443도 거부했다.
- Node24의 실제 `src/lib/document-extractor.ts` transport를 worker slice의 실제 Docker scope에서 실행해 HWP/DOC/PPT/textPDF 각2버전 ready8개와 한글 scanPDF2버전 limited/OCR를 확인했다. 본문 일치·PPT 표·숨김 내용 제외·버전 차이까지 확인했다.

소스 overlay 없이 검증했고 진단 override는 합성 credential/fixture/실행 모드만 설정했다. 소스 guard나 이미지를 진단용으로 바꾸지 않았다. 감사 로그에서 fdwalk·mount·필수 exec 차단을 통과로 오인하지 않았고, optional Tika 디렉터리/core 쓰기/불필요한 capability 및 외부 profile 읽기 거부는 유지했다.

## Worker 네트워크 사전 검사

root 전용 drop-in으로 검증된 DB IPv4의/32만 추가했다. 실제 Docker.scope가 전용 slice 아래에 있고 UID/GID1000·모든 capability0·NNP1·read-only·core0임을 확인했다. 상위256MiB/swap0/CPU25%/96태스크 한도와 실제 leaf scope의 ingress/egress BPF program을 대조했다. DB TCP 연결은 허용되고 인터넷/metadata TCP는 실패했다. 동일 시점 host의 공용443 연결은 성공해 단순 host 네트워크 장애와 구분했다. 자기 label/run/image/CID를 확인한 임시 컨테이너만 제거했다.

slice는 부모 IP 정책을 갖고 실제 필터는 leaf service/scope에서 합성된다. 최초 시험 스크립트는 slice에 program이 있어야 한다고 잘못 판단해 컨테이너 생성 전 중단했다. [systemd255 BPF 구현](https://github.com/systemd/systemd/blob/v255/src/core/bpf-firewall.c)에 맞춰 실제 Docker.scope의 effective program을 확인하도록 검사 위치만 고쳤다. 허용 범위·차단 정책은 바꾸지 않았다.

이 TCP 사전 검사는 실제 운영 queue worker의 DB SELECT1·업로드 처리 완료를 대신하지 않는다. 실제 worker 활성화 후 그 상태를 다시 확인해야 한다.

## 증거·남은 단계

원격 `.omo/multiformat/`의 `release-acl-fixed-full-gate.*`, `release-acl-fixed-gateway-kernel-properties.json`, `release-acl-fixed-mtls-python.log`, `release-node-mtls-transport-actual.*`, `release-worker-boundary-effective-actual.log`, `release-credential-contract-review.md`, `release-20261105-premerge-gate.md`에 근거를 보존했다. 이는 공개된 실행 링크가 아닌 원격 실행 자료다.

독립 premerge gate가 source/CI/staged readiness 범위에서 승인했다. PR55의 명시적 병합 지시, main CI 검증 이미지, 신규 백업·007 적용, 보호 tree 검토 갱신, 운영 앱·gateway/worker 반영, 실제 합성 업로드 검증은 후속이다. 관리자 PR53 코드/브랜치·관리자 권한 지정은 이 작업에서 변경하지 않았다. OCR은 원본 대조가 필요한 결과이며 정확도·시각적 배치 비교·장기 부하를 보장하지 않는다.
