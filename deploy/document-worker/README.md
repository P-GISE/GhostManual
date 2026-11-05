# GhostManual 외부 엔진·문서 worker 운영 구성

이 문서는 검토용 설치 절차다. 소스·단위 검사 성공을 운영 설치/DB 적용/실제 부하·mTLS·네트워크 차단 성공으로 기록하지 않는다. 설치 담당자는 정확한 Git SHA·CI image·extractor digest·rootfs manifest·unit/profile/설정 해시를 보존한다. 기존 운영 Compose/.env·DB·다른 서비스와 고정 배포 실행기의 보호 설정을 바꾸지 않는다.

## 경계와 구성

- gateway는 `ghostmanual-extractor@<digest>.socket`의 **127.0.0.1:18443** 소켓 FD3 하나만 받는다. service의 `PrivateNetwork=yes`를 유지하므로 새 소켓은 private loopback만 사용하고 DB·인터넷 경로를 갖지 않는다. systemd255 `systemd.socket(5)`가 명시적으로 지원하는 조합이다. service와 socket 모두 IPAddressDeny=any/IPAddressAllow=localhost를 사용한다. systemd.resource-control(5)에 따라 service 필터만으로 activation socket까지 필터링됐다고 가정하지 않는다.
- production.py는 실제 LISTEN_PID·FD수·이름·AF_INET/TCP·정확한 루프백 주소·listen 상태를 확인하고 FD를 CLOEXEC로 바꾼다. 기존 configure/probe와 Gateway/Handler를 사용하며 파서는 기존 close_fds·별도 user/PID/proc/net/mount·capability 제거를 그대로 사용한다. inherited host 소켓이 파서에 남지 않는 실제 검사가 필요하다.
- gateway service는 기존512MiB/swap0/CPU50%/128태스크와 read-only outer cgroup·SETUID/GID만의 host bound·NNP를 유지한다. production AppArmor는 기존 정책의 self-peer 이름과 자기 unit credential의3파일 읽기만 다르며 다른 키·셸·호스트 권한을 허용하지 않는다.
- worker는 검증된 **동일 앱 CI 이미지**의 scripts/document-jobs.ts를 Node24로 실행한다. Node UID/GID1000·cap0·NNP·읽기 전용 root·192MiB/swap0/CPU25%/64태스크이며 Docker socket/서버 개인키/AI·메일·Google 비밀 값/호스트 폴더/공개 포트가 없다.
- worker의 trusted Docker CLI만 User1000와 docker 보조그룹을 사용한다. Docker UDS는 컨테이너에 전달하지 않는다. unit의 PrivateNetwork=yes는 CLI에 적용되며 daemon이 만드는 컨테이너의 host 네트워크와는 별개다.
- worker container의 host networking은 루프백 gateway와 DB 접속에 필요하다. `--cgroup-parent=ghostmanual-document-worker.slice`로 CLI와 container.scope가 같은256MiB/swap0/CPU25%/96태스크 slice의 BPF 주소 필터를 상속해야 한다. source slice는 localhost만 허용하므로 DB IP drop-in이 없으면 실패한다. host networking 자체를 격리로 설명하면 안 된다.
- gateway/worker host unit의 LimitCORE=0, worker Docker의 `--ulimit=core=0`으로 비밀 값 crash dump를 막는다. CLI의 rlimit이 daemon의 컨테이너에 자동 전달된다고 가정하지 않는다.

## 사전 검사와 새 extractor 이미지

기존14개 파일과 이전 digest rootfs를 직접 수정하지 않는다. 기존 Dockerfile의 COPY runtime이 새 production.py/정책/검사를 포함하므로 새 검증 extractor 이미지와 source manifest/rootfs를 만든다. 기존 준비 코드의 공간 하한·stream cap을 지킨다. host Node나 Java 설치, privileged Docker, SYS_ADMIN/전역 user namespace 보호 해제는 사용하지 않는다.

소스 검사: `python3 -B -m unittest discover -s services/document-extractor/runtime -p test_production.py -v`, `apparmor_parser -Q -T services/document-extractor/runtime/ghostmanual-extractor-production.apparmor`, 새 service/socket/slice의 `systemd-analyze verify --man=no`. AppArmor compiler가 없는 CI에서 해당 한 검사의 skip은 실제 정책 검증 성공이 아니다.

설치 전 현재 DB 컨테이너 IP를 선택한 inspect 필드로 읽고 DB 컨테이너/volume ID를 기록한다. 전체 env·process argv·업무 원문을 출력하지 않는다. 현재 IP를 source에 영구 고정하지 않는다. 18443 미사용·디스크2GiB 이상·가용 메모리·기존 배포 lock/marker·정규 백업과 작업 창을 확인한다.

## 인증서·설정 파일

1. 전용 서버 CA와 worker client CA를 만들고 다른 회사/공개 CA를 client 신뢰 목록에 넣지 않는다. 서버 SAN은 localhost, EKU는 serverAuth, worker EKU는 clientAuth다. CA private key는 런타임에 주지 않는다. 원본과 CA private key는 root0700 폴더·root0600 파일에 보관한다. 공개 fingerprint·만료일만 기록한다.
2. gateway root0600 source3개는 `/etc/ghostmanual-extractor/{client-ca,server-cert,server-key}.pem`이다. systemd255 LoadCredential은 자기 service의 `/run/credentials/ghostmanual-extractor@<64hex>.service/`에 root:root 디렉터리0550·파일0440으로 제공하며, ACL의 named UID1000에만 디렉터리 읽기/탐색·파일 읽기를 부여한다. group_obj/other 권한은 없고 group mode 비트는 ACL mask다. production.py는 정확한 자기 경로·root 소유·읽기 전용 filesystem·단일 link/크기와 버전2의 정확한5-entry ACL을 함께 검사한다. 다른 사용자/그룹이나 writable mount·추가 ACL은 거부한다. 읽히지 않는다고 world/group read나 profile 전체 허용을 추가하지 않는다. RootDirectory 안 credential 노출은 합성 키로 먼저 실측한다.
3. worker TLS 원본도 root0600으로 두며 `/run/ghostmanual-document-worker/secrets/`를 root0700으로 만든다. daemon이 bind할 runtime 사본3개 `{server-ca,client-cert,client-key}.pem`만 UID1000·0400으로 복사하고 원본과 해시를 대조한다. root700 부모를 컨테이너에 통째로 mount하지 않는다. systemd `%d`는 private mount namespace일 수 있어 Docker daemon bind 원본으로 사용하지 않는다.
4. `/etc/ghostmanual-document-worker.env`는 root0600이며 **제한 앱 계정 DATABASE_URL과 `DOCUMENT_EXTRACTOR_URL=https://localhost:18443/`만** 넣는다. DB URL의 host는 방금 확인한 단일 DB IP이고 비밀번호를 인자나 로그에 넣지 않는다. 관리자용 migration env는 worker에 주지 않는다. PEM multiline을 Docker env-file에 직접 쓰지 않는다.
5. unit의 LoadCredential=worker-env는 trusted CLI가 `%d/worker-env`를 읽게 한다. worker-entry.mjs는 개별 read-only mount3개를 읽고 기존 DOCUMENT_EXTRACTOR_CA/CERT/KEY 환경으로 넣은 뒤 기존 worker를 import한다. 최초 Docker 환경에 PEM이 들어 있거나 key 파일이 없거나 group/world에 읽히면 시작을 거부하며 값·stack은 출력하지 않는다.
6. `/etc/ghostmanual-document-worker-image.env`는 root0600이며 `GHOSTMANUAL_WORKER_IMAGE=sha256:<검증된 immutable image ID>`만 넣는다. 고정 helper가 mutable tag를 거부한다. worker-entry.mjs·stop-worker.py는 root 소유 read-only `/usr/local/lib/ghostmanual-document-worker/`에 정확한 Git blob/해시로 설치한다.
7. source slice와 별도 root0600 `/etc/systemd/system/ghostmanual-document-worker.slice.d/20-database-address.conf`를 설치한다. drop-in은 `[Slice]`와 `IPAddressAllow=<검증 DB IPv4>/32`만 추가한다. localhost는 source에 이미 있다. 다른 CIDR·전체 bridge·0.0.0.0/0를 허용하지 않는다. DB IP가 바뀌면 안전 실패이며 별도 재검토/설정 갱신이 필요하다.

## 실제 활성화 전 필수 gate

- 새 digest의 synthetic credential/fixture만 쓰는 service에서 inherited FD3가 열린 상태로 production.py `--gate`를 실행한다. 검토된 임시 진단 override만 사용해 기존5개 격리 검사와10개 실제 형식 추출을 모두 통과시킨다. **실제 production credential로 기존 synthetic-only 검사를 실행하지 않는다.** fixture/key mounts, 진단 stdout 설정과 --gate override는 해시를 확인해 제거한다.
- 새 production profile의 실제 enforcement·기존 host bound·outerRO·별도 netns를 확인한다. fdwalk/마운트/필수 실행파일 거부를 성공으로 해석하지 않는다. gateway가 새로 만든 소켓으로 DB/인터넷/metadata에 연결할 수 없어야 한다.
- 같은 socket/service 구성과 합성 전용 PKI로 먼저 `serve`를 실행해 Node24 transport의 valid mTLS/TLS1.3와 synthetic DOC/PDF/OCR을 확인한다. client 인증서 없음·다른 client CA·잘못된 server CA/이름은 모두 거부돼야 한다. 실제 키 전환은 service/socket을 중지한 뒤 root source를 교체·재검토하고 시작한다.
- worker의 actual Docker inspect에서 image·User·capdrop·NNP·readOnly·Memory/Swap/Pids/CPU·HostConfig.CgroupParent를 확인하고, 선택한 container PID의 `/proc/<PID>/cgroup` 경로가 **worker slice 아래 실제 docker.scope**인지 확인한다. 컨테이너 cgroupns private의 `0::/`만 보고 부모를 증명하면 안 된다.
- 그 실제 scope에서 DB SELECT1·gateway positive, metadata/공용 인터넷/허용하지 않은 다른 주소 connect negative를 확인한다. gateway socket과 service의 별도 localhost-only 필터도 실제 활성 상태와 동작으로 확인한다. BPF 설정 문자열만으로 성공을 주장하지 않는다. cgroupdriver/systemd 또는 BPF가 성립하지 않으면 worker를 시작하지 않고 설계를 재검토한다. filter 해제/host 전체 허용 fallback은 없다.
- host listener는127.0.0.1:18443만 있어야 한다. app에 extractor 키가 없어야 하고 worker에는 server key가 없어야 한다. 파서에는 둘 다 없어야 한다. 원본·버전·owner-only 변경 원문·OCR limited 검수와 publish guard를 실제 synthetic 업로드부터 확인한다. 인식 정확도 보장은 하지 않는다.

## DB·고정 배포 실행기·순서

migration007과 새 scripts/deploy 파일은 고정 SSM/event 실행기의 protected_tree를 바꾼다. 현재 고정 실행기, config model, receipt/fence/lock을 보존하고 검토된 보호-tree 갱신 절차를 적용한다. `install.py`와 `prepare-review.py`는 wrapper가 없는 최초 설치를 가정하므로 기존 설치에 그대로 재실행하지 않는다. 기존 review 원문을 root 전용으로 백업하고 정확한 성공 SHA/run/artifact/module/config/현재 운영 신원을 재검토한 승인 사본만 사용한다. 보호 검사·SSM 권한을 끄거나 receipt/fence를 고쳐 맞추지 않는다.

DB 백업 후 검토된007을 먼저 적용하고 기존 앱 호환성을 확인한다. 관리자006은 별도 사용자 지시로 검토·백업 후 이미 적용했다([기록](../../docs/qa/2026-11-05/pr53-admin-migration.md)). 이 엔진 배포 절차에서 추가 적용할 대상은007이다. 기존 event app 배포는 원래 app/db Compose로만 한다. worker를 그 Compose에 넣으면 정확히 app/db만 허용하는 guard를 깨므로 별도 서비스로 유지한다. 새 worker container는 event 배포의 다른 컨테이너 fingerprint 전후에 추가/제거하지 않고 앱 승격 성공 후 시작한다.

**worker 이미지 갱신 순서:** 기존 image env를 그대로 둔 채 worker service를 STOP → helper가 CID/role/기존 immutable image를 대조해 정확한 container만 stop/제거 확인 → CID 정리가 성공한 뒤 root image env를 새 검증 digest로 교체 → START. image env를 먼저 바꾸면 ExecStop이 옛 container 이미지 불일치로 안전 거부하므로 순서를 바꾸지 않는다. 자동 앱 배포와 worker의 pinned image 갱신은 별도 작업이다.

## 중지·롤백·보존

worker stop helper는 own0700 state의 CID 파일 owner/mode/단일 link/64hex와 container role/image를 대조한다. 이름만으로 stop하지 않는다. Docker stop 반환 뒤 --rm 삭제는 비동기일 수 있어 정확한 CID의 부재를 최대5초 기다린다. Docker daemon 상태를 확인할 수 없거나 stop/제거가 완료되지 않으면 CID를 지우지 않고 실패한다. RuntimeDirectoryPreserve=yes이므로 복구 근거가 남으며 관리자는 정확한 ID/label/image를 재확인해야 한다.

장애 시 worker와 extractor socket/service만 중지한다. persisted queue/버전과 DB/볼륨/백업은 보존하며 migration007 down이나 데이터 삭제를 하지 않는다. 앱은 확인된 종전 image와 검증된 배포 절차로 복귀한다. gateway key와 worker client key는 서로 별개다. 이미지/rootfs는 검토를 위해 보존하고 전역 prune이나 다른 서비스 restart는 하지 않는다.

2026-11-05 합성 credential의 실제 전달·socket activation·최종 이미지 격리5/5/추출10/10·mTLS 거부/성공·실제 worker Docker scope BPF 사전 검사를 통과했다([근거와 범위](../../docs/qa/2026-11-05/pr55-runtime-readiness.md)). 실제 운영 PKI·queue worker DB 작업·일반 사용자 업로드 완료는 별도 검증해야 한다. staged 성공과 운영 활성화를 구분한다.
