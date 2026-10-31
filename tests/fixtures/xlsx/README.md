# 합성 엑셀 픽스처

모든 값은 테스트용 합성 값이며 실제 업무 자료가 아니다.

재생성: `node tests/fixtures/xlsx/generate.ts` (Node 24, `npm ci` 필요).

- `정산_1029.xlsx`: 원본 시트, F2:F40의 SUM 수식.
- `정산_1030.xlsx`: 정산 시트 추가, F2:F40의 39개 수식을 SUMIF로 변경, A2:D34의 132개 값 변경. 수식 캐시 값은 비교의 값 변경 수에 포함하지 않는다.
- `huge.xlsx`: 값이 있는 셀 50,001개. `limit_exceeded`를 확인한다.
- `macro.xlsx`: `xl/vbaProject.bin`이라는 합성 표식만 포함한 거부 테스트용 ZIP. 실행 가능한 매크로가 아니다.
- `encrypted.xlsx`: 암호화 Office 파일의 OLE 서명 8바이트만 가진 거부 테스트용 입력. 실제 암호화 문서가 아니다.
- `not-zip.xlsx`: 일반 텍스트인 거부 테스트용 입력.

정상 두 파일과 huge 파일은 OOXML 패키지 구조를 생성한다. 실제 Excel 앱에서 열기 검증은 별도이며, 엔진 단위·전체 소비자 테스트에서 직접 읽기/비교한다.
