# 지적 경계·선택·상세정보

## 현재 상태

2026-11-06 코드 및 문서 작성 단계다. 이번 변경에 테스트·빌드·API 호출·브라우저 검증을 수행하지 않았다.
사용자가 제공한 선행 검증 결과(지적 MultiPolygon/PNU, 토지임야, 2026년 공시지가)를 근거로 작성했다.
선행 셸 응답 검증은 브라우저 CORS·JSONP·서비스 URL 인증을 입증하지 않는다.

지적도는 기본 꺼짐이다. 켜기만 해서는 자동 API 조회가 없다. 줌 17 이상에서 클릭할 때 공식 점조회가 발생하는 구조다.
자동 BOX 조회는 설정과 어댑터 양쪽에서 차단되어 있으므로, 현재는 **선택 필지 강조만 가능하도록 작성**되었다.
화면 전체 경계와 상세 면적·공시지가가 정상 표시된다고 표현하면 안 된다.

## 파일과 흐름

| 파일 | 역할 |
| --- | --- |
| config/parcel.ts | 검증 전 비활성 설정, 줌·면적·건수·지연·연도 |
| services/vworld/cadastral.ts | POINT/BOX 요청 어댑터, PNU/도형/좌표계/건수 검증 |
| services/vworld/cadastralJsonp.ts | 지적 전용 sandbox JSONP, 타임아웃·논리적 무효화·정리 |
| services/vworld/parcelValidation.ts | 기본 값과 속성 응답 검증 |
| services/vworld/landLedger.ts | 토지임야 응답 파싱, 조회 불가 전송 상태 |
| services/vworld/landPrice.ts | 공시지가 응답 파싱, 조회 불가 전송 상태 |
| features/cadastral.ts | 기존 지도 레이어·클릭·요청 세대·해제 관리 |
| ui/parcelPanel.ts / styles/parcel.css | 켜기/끄기, 상태, 선택 필지 상세 패널 |

클릭 → 이전 요청/선택 무효화 → 3857 클릭 좌표를 4326 경위도로 변환 → POINT 요청 →
응답 검증 → 변환된 도형이 클릭 위치를 포함하는 후보 확인 → 단일 후보 강조 → 개별 속성 어댑터 상태 표시.
현재 속성 어댑터는 네트워크 요청 없이 조회 불가를 반환한다. 기본 지도와 검색은 유지한다.
지도 이동 시작, 숨김, 패널 닫기, 기능 해제는 진행 중 응답을 무효화한다. 이동 시 선택도 초기화한다.
검색 마커를 직접 클릭하면 필지 API 요청을 건너뛴다. 검색 마커와 선택 필지는 별도 레이어다.

## API와 파싱

- 지적: `https://api.vworld.kr/req/data`, `service=data`, `version=2.0`, `request=GetFeature`, `data=LP_PA_CBND_BUBUN`.
  `crs=EPSG:4326`, `format=json`, `errorFormat=json`, `geometry=true`, `attribute=true`, `columns=pnu,jibun`, `page=1`.
  POINT는 `POINT(경도 위도)`, `size=5`; BOX는 `BOX(서경,남위,동경,북위)`, `size=200`으로 작성했다.
  **BOX의 범위 요청 동작은 실증 전이다.** 공식 문서: https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=cadastral
- 결과는 `response.result.featureCollection`의 GeoJSON FeatureCollection을 사용한다.
  `record.current/total`, `page.current/size/total`을 검사한다. 누락·중복 PNU·잘못된 도형은 오류이며 추가 페이지는 요청하지 않는다.
  선행 응답에는 CRS 필드가 없었다. 고정 서비스에 명시한 EPSG:4326 요청과 검증된 x=경도/y=위도를 근거로 처리한다.
  CRS가 명시되었는데 다르면 거부한다. 범위·닫힌 링·유한값·좌표변환 후 투영 범위도 검사한다.
  이는 전체 Geometry 위상 유효성 검사나 측량 정확도 검증을 의미하지 않는다.
- 토지임야: `https://api.vworld.kr/ned/data/ladfrlList`, 공식 문서 https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=128
  선행 응답 봉투 `ladfrlVOList`, 허용 속성 `pnu`, `lndcgrCode`, `lndcgrCodeNm`, `lndpclAr`, `lastUpdtDt`만 결과 객체에 보존한다.
- 공시지가: `https://api.vworld.kr/ned/data/getIndvdLandPriceAttr`, 공식 문서 https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=25
  선행 응답 봉투 `indvdLandPrices`, 허용 속성 `pnu`, `stdrYear`, `stdrMt`, `pblntfPclnd`, `pblntfDe`, `lastUpdtDt`만 보존한다.
  요청 기준연도는 설정의 2026년이다. 기준월 누락은 미제공으로 표시하며 서로 다른 월/값을 자동 선택하지 않는다.
- 속성 봉투 내부의 목록 포장 경로는 실증 상세가 부족해 PNU 행을 제한된 깊이/노드 수에서 탐색한다.
  실제 브라우저 응답 확보 후 정확한 목록 경로와 메타데이터 위치를 확인해야 한다. 상위 totalCount가 있으면 행 수 일치를 검사한다.
  완전 동일한 허용 속성 중복만 합치며 충돌 중복은 오류다. 개인 소유자 필드는 추출·저장·표시하지 않는다.
  빈 resultCode는 오류로 단정하지 않는다. 기타 API 오류 원문은 표시하지 않는다.
  전송 미검증이므로 두 속성 API의 실제 요청 생성 및 전송은 보류했다.

## 성능·보안과 표시 원칙

설정의 줌 17, 화면 면적 250,000㎡, 경계 200건, 점 후보 5건, 이동 종료 지연 350ms, 타임아웃 15초는
공식 서비스 한도가 아닌 초기 앱 운영값이다. BOX 면적 제한은 3857 평면면적이 아닌 구면 면적으로 검사한다.
자동 재시도·자동 범위 분할·추가 페이지·전국 수집은 없다. BOX 활성화 후에도 범위와 동시 요청을 제한한다.
동일 대기 클릭/완료 범위 요청은 중복을 억제하며 지도 이동 시 오래된 범위와 선택을 비운다.

JSONP 콜백은 요청별 UUID와 별도 iframe window에 존재한다. sandbox는 allow-scripts만 허용하고
allow-same-origin은 허용하지 않는다. CSP는 nonce와 공식 `/req/data` 스크립트 경로만 허용한다.
부모는 source, origin=null, 채널, 요청 ID를 함께 확인한다. 완료·오류·타임아웃·무효화 시
타이머, 메시지/abort 리스너, iframe을 정리한다. 무기한 전역 콜백을 남기지 않는다.
이는 네트워크 취소를 보장하지 않는다. 늦은 응답은 세대 검사로 화면 갱신을 막지만 실제 브라우저 동작은 별도 검증해야 한다.
Referrer 정책은 strict-origin-when-cross-origin이다. srcdoc/sandbox의 실제 Referer 및 인증 호환성은 미확인이다.
외부 JSONP 스크립트 실행과 일반 JSON 수신은 다르다. 전체 URL·키·원문 오류·원본 응답을 로그로 남기지 않는다.

상세 패널은 모든 API 문자열을 textContent로 출력한다. 지목 코드가 없으면 명칭만으로 분류하지 않는다.
공부상 면적만 ㎡로 표시하고 도형 계산면적을 대체값으로 사용하지 않는다.
개별공시지가는 원/㎡ 단가다. 기준연월·공시일자·각 자료 갱신일을 분리하며 없는 값은 미제공이다.
연속지적도 기준시점은 응답에 확인되지 않아 미제공으로 표시한다. 소유정보와 개인정보는 이번 범위에서 제외한다.

## 별도 승인 후 검증 순서

1. `npm.cmd run typecheck`, `npm.cmd run build`: 새 코드의 정적 검사와 번들 검증. 오류 수정은 승인 범위 확인 후 진행.
2. 제한된 브라우저 점조회: 공개 필지 1곳, 지적 버튼/줌 제한, 인증/Referer/CSP/JSONP 메시지, PNU·좌표·클릭 일치 확인.
3. 요청 무효화/타임아웃/중복 후보/조회 없음, 기존 검색·마커·일반/위성·좌표 표시 회귀 및 모바일 배치 확인.
4. 작은 BOX 1회 등 호출 수를 별도로 승인받아 범위 문법·축 순서·응답 건수·잘림·개인정보 제외를 확인.
   성공 이후에만 자동 BOX 설정 활성화와 추가 검증을 별도로 승인받는다.
5. 토지임야/공시지가의 공식 브라우저 전송 규격과 실제 CORS 또는 JSONP를 개별 검증한다.
   검증된 방식의 전송 어댑터 구현 승인을 받은 후 면적·지목·공시지가·기준시점의 PNU 연계를 확인한다.
6. 검증 완료 후에만 별도 승인으로 commit/push/Pages 배포 및 배포 Origin 재검증을 진행한다.

향후 지목 분류는 검증된 PNU별 코드 속성을 기존 경계 Feature에 결합하고 스타일 함수만 전환하는 방향이다.
현재는 도형의 지번 접미사나 미확인 값을 지목으로 추정하지 않으며 분류 UI도 노출하지 않는다.
