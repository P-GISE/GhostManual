# 외부 문서 엔진 격리 보완 완료 — 2026-11-05

> 후속 진행: 이 문서는 격리 검증 종료 당시 기록이다. 이후 최신 기본 통합·커밋과 [PR #55](https://github.com/P-GISE/GhostManual/pull/55) 작성은 완료했다. 운영 실행 구성·최신 CI·문서 migration007·앱/gateway/worker 활성화는 별도 진행 중이며, 관리자 migration006 적용은 [별도 기록](pr53-admin-migration.md)을 따른다.

외부 엔진의 실제 격리 차단을 해결했다. 최종 무캐시 이미지 `sha256:bec10606f2500a62a5db9acac29b78dbd8d4d8b56d3ff82fce2522b0c1429946`에서 소스14개 해시를 검토본과 대조하고, 새 digest rootfs와 **DropInPaths가 빈 전용 서비스**에서 격리5/5·추출10/10을 함께 통과했다. 서비스 종료 결과는 success/0이며 디버깅 오버레이는 검증 후 해시를 확인해 제거했다. 이것은 운영 앱 반영 완료를 뜻하지 않는다.

## 수정 범위

- 전용 RootDirectory·위임 cgroup·AppArmor를 사용한다. 서비스512MiB/CPU50%/128태스크, 작업384MiB/CPU50%/64태스크·swap0을 유지한다. 상위 자원 한도는 UID0에서도 직접·proc 별칭 쓰기를 거부한다.
- UID 변경 뒤 남는 capability를 명시적으로 제거한다. 실제 실행 전 UID/GID65534·E/P/I/Amb0·NNP1·UID0 복귀 거부를 확인하고, 파서 안에서도 제거 상태를 검사한다. 호스트 bounding/ambient는 SETUID/GID만 사용하며 SYS_ADMIN·PTRACE·KILL을 부여하지 않는다.
- 고정 bubblewrap 마운트·retained proc descriptor 계약과 JDK17의 정확한 jspawnhelper 실행 경로를 보완했다. 임의 셸 실행·unconfined·privileged Docker·전역 user namespace 제한 해제는 사용하지 않았다.
- trusted 시험 부모의 ProtectKernelTunables/ProtectKernelLogs/ProtectHostname proc overmount만 해제해야 새 PID/proc를 만들 수 있음을 개별 속성 행렬과 조합 probe로 확인했다. ProtectProc=invisible·ProtectClock·ProtectKernelModules·읽기 전용 루트·AppArmor·자원 상한 및 파서의 별도 user/PID/proc/네트워크 격리는 유지한다.
- 중첩 uid_map의 부모0은 초기 호스트 root가 아니다. 고정 bubblewrap의 두 단계 매핑을 확인하고, 외부의 실제 신원/권한 제거와 내부의 단일65534→부모0 매핑을 함께 검증한다. detached 시험은 setsid 완료 표식 후 시간 초과·전체 cgroup 소멸·다음 파싱 성공을 요구한다.
- Docker Size가 압축 크기일 수 있어 rootfs 준비 여유를 고정 예산으로 계산한다. 약5GiB 사전 여유,64KiB 단위 크기/여유 검사,1564MiB export·1500MiB rootfs 상한 및 자기 임시 자원만 정리하는 경계를 유지한다.

## 실제 검증

| 검증 | 결과 |
| --- | --- |
| 정상 입력·UID 변경 후 실제 파서 | 통과 |
| setsid 자손 시간 초과 종료·복구 | 통과 |
| 출력 폭주 종료·복구 | 통과 |
| 실제 작업 cgroup OOM 종료·복구 | 통과 |
| UID·환경·FD/PID1·다른 파일/작업·네트워크 차단 | 통과 |
| HWP v5·DOC·PPT·텍스트 PDF 각2버전 | 8/8 ready |
| 한글 스캔 PDF2버전·변경 구분 | 2/2 limited/OCR |
| runtime 단위·AppArmor 컴파일러 검사 | 16/16·11/11 |

OOM 로그는 자기 작업의 고의 상한 시험이며 호스트 전체 OOM을 성공 근거로 사용하지 않는다. 최종 감사 로그에 fdwalk 디렉터리 차단은 없었다. Java의 core dump 설정 쓰기 등 불필요한 접근 거부는 유지했다. OCR은 원본 대조가 필요한 limited 상태이고 자동 게시를 허용하지 않는다. 시험은 합성 파일·가짜 키만 사용했다.

무캐시 빌드는101초·RUN cgroup peak 약418MiB, rootfs 준비는43초였다. 준비 중 최저 여유 약6.34GiB, 최종 여유 약7.0GiB로2GiB 하한을 지켰다. 외부 형식의 폰트·배치·이미지 시각 비교나 모든 실무 파일 호환성의 증명은 아니다.

## 디스크·운영 보존

사용자 승인으로 암호화 gp3 EBS와 ext4를40→50GiB 온라인 확장했다. 콘솔 최종 확인은50GiB·암호화·정상·최적화 표시 종료, IOPS3000/처리량125 유지다. 재부팅·기존 이미지/백업 삭제 없이 기존28개 컨테이너 ID/이미지/상태가 같았다. 시험 유닛2개는 inactive이며 공개 Aside와 앱 loopback의 홈200·미인증 API401을 재확인했다. 전역 AppArmor user namespace 제한은1로 유지했다.

## 증거와 남은 단계

원격 작업 트리 `.omo/multiformat/nov5-*`에 실행 근거를 보존한다. 핵심은 `nov5-clean-full-gate.json/.log`, `nov5-clean-gate-properties.log`, `nov5-clean-full-gate-audit.log`, `nov5-clean-rootfs-prepare.json`, `nov5-final-reviewed-source-manifest.json`, `nov5-final-host-health.json`, `nov5-debug-cleanup.json`과 독립 검토 `nov5-final-contract-review.md`다. 이는 커밋된 공개 증거 링크가 아닌 실행 근거 위치다.

운영 앱 배포·migration007·외부 HTTP gateway/worker 활성화·커밋/PR은 하지 않았다. 사람이 diff를 확인한 뒤 최신 기본 브랜치와 통합·일반 build/GitHub CI·PR 반영 및 별도 운영 절차가 남아 있다. 기존 앱의 실제 파일 업로드 화면에 새 형식이 이미 활성화됐다고 안내하면 안 된다. 장기 부하·실물 인쇄·모든 업무 파일·실제 AI 호출은 이번 범위에서 확인하지 않았다.
