# 구조와 확장 방법

## 3차 지적 기능 추가 — 미실행 코드

`features/cadastral.ts`가 기존 지도 객체에 경계/선택 레이어와 독립 UI를 추가합니다.
`services/vworld/cadastral.ts`는 고정 서비스 요청, 허용 속성만 추출, 도형 검증 및 좌표변환을 담당합니다.
이 지적 어댑터는 OpenLayers Geometry를 사용하지만 지도 객체나 DOM UI를 생성하지 않습니다.
`cadastralJsonp.ts`는 지적 API 전용 sandbox 전송기이며 기존 `search.ts`는 변경하지 않았습니다.
`landLedger.ts`/`landPrice.ts`는 서로 다른 응답 봉투를 개별 파싱하고, 미검증 브라우저 전송은 실행하지 않습니다.
`parcelValidation.ts`는 문자열 PNU, 수치·날짜·중복 처리에 필요한 공통 검증을 제공합니다.
`MapFeature.mount`에 지적 컨트롤/패널 host를 추가했으며, 기능별 초기화 오류 격리는 유지합니다.
상세 설계와 활성화 조건은 [parcels.md](parcels.md)를 참고하세요. 아래 과거 개발 기록의 검증 결과는 이번 변경에 대한 검증을 뜻하지 않습니다.

## 데이터 흐름

`config/env → services/vworld → map/basemaps → map/createMap → ui`

`main.ts`는 각 구성 요소를 연결하고 오류 단계와 자원 해제를 관리합니다.
프레임워크·상태관리 라이브러리·의존성 주입 시스템은 도입하지 않았습니다.

| 위치 | 책임 |
| --- | --- |
| config/env.ts | 키 읽기, 누락 검사 |
| config/map.ts | 초기 범위·줌·좌표계 설정 |
| services/vworld | OpenLayers에 의존하지 않는 서비스 설정·타일 URL 규칙 |
| map/basemaps.ts | OpenLayers XYZ 레이어 생성·전환·오류 수집 |
| map/createMap.ts | View·지도 생성, 최초 화면 맞춤, 크기 변경 대응 |
| map/coordinates.ts | 좌표 변환·문자열 표시 |
| ui | DOM·컨트롤·좌표 표시 기준 |
| features | 향후 기능 등록과 해제 계약 |

## 지도와 좌표

대한민국 초기 범위는 `config/map.ts`의 교체 가능한 프리셋입니다.
이동 범위는 대한민국으로 제한하지 않습니다. V-World의 해외 지도 제공 범위까지 보장하는 것은 아닙니다.
최초 유효한 지도 크기를 받은 시점에만 범위를 맞추고, 이후 화면 회전·크기 변경 시 사용자의 뷰를 유지합니다.
위성지도는 원본 최대 줌을 18로 설정하고 더 높은 View 줌에서는 OpenLayers가 확대 표시합니다.
이 값 및 서비스 지원 범위는 공식 문서와 실제 응답 검증 전 잠정 설정입니다.

View와 타일: EPSG:3857. 표시 좌표: EPSG:4326, 경도 다음 위도 순서.
OpenLayers 기본 transform/transformExtent를 사용하며 proj4는 포함하지 않습니다.
중앙 좌표 정책과 포인터 정책은 hover/pointer 미디어 쿼리로 선택합니다.
PC에서 포인터가 지도 밖에 있으면 중심 좌표를 표시하고 기준 문구도 바꿉니다.
GPS 수집은 미구현이며, 추후 EPSG:4326 좌표를 View 좌표로 변환해 연결할 수 있습니다.

5178/5186 지원은 업로드 단계에서 검토합니다. CRS 미상 데이터를 임의 지정하지 않습니다.
향후 측정 기능은 목적에 맞는 투영좌표계 또는 측지 계산을 사용해야 하며,
3857 평면 면적·거리를 그대로 실측값으로 제시하지 않습니다.

## 오류 상태

1. 설정 오류: 키가 없으면 지도 요청을 시작하지 않고 설정 방법을 표시합니다.
2. 초기화 오류: 동기 초기화 실패를 별도 문구로 표시합니다.
3. 타일 오류: 활성 레이어의 pending과 누적 실패 수를 표시합니다.

일부 타일 성공이 다른 실패를 가리지 않도록 실패는 재요청 전까지 유지합니다.
레이어별 상태를 분리해 비활성 레이어의 완료 이벤트가 현재 상태를 덮지 않게 합니다.
재요청은 활성 source.refresh()로 수행합니다. 네트워크 요청이 추가 발생합니다.
이미지 이벤트만으로 HTTP 상태·인증 실패 원인을 확정할 수 없습니다.
오류 이미지가 HTTP 200으로 반환되면 tileloaderror로 탐지하지 못할 수 있습니다.
UI의 '타일 요청 오류 없음'은 전체 지도 내용이나 인증의 유효성을 보장하지 않습니다.
키·요청 URL은 애플리케이션 콘솔에 기록하지 않습니다.

## 기능 확장

각 기능을 `features/addressSearch`, `features/cadastre`, `features/zoning`,
`features/upload` 등의 독립 폴더로 추가하고 완성된 모듈만 registry에 등록합니다.
`MapFeature.mount({ map, searchHost, vworldApiKey })`는 레이어·이벤트·UI를 구성하고 해제 함수를 반환합니다.
기능별 서비스 요청은 services 아래에 두고, 모듈에서 타일 URL 규칙을 복제하지 않습니다.
공통 계약을 확장할 필요가 생겼을 때만 UI 슬롯 등의 인자를 추가합니다.

WMS/WFS·지적·용도지역은 API 권한, 데이터 범위, 이용 조건을 검토한 뒤 개발합니다.
전국 데이터를 한 번에 클라이언트로 다운로드하지 않도록 범위 조회·타일·줌별 표시를 검토합니다.
SHP ZIP·GeoJSON은 파일 크기와 CRS 검사를 먼저 설계하고 필요하면 Web Worker를 사용합니다.
검색은 registry에 등록했습니다. 미구현 레이어 관리 등은 표시하지 않습니다.

## 검증 상태

### 주소 검색 JSONP 연결 (2026-11-06)

- services/vworld/search.ts: 공식 고정 endpoint, URLSearchParams 인코딩, JSONP callback, 응답 검증.
- ui/searchPanel.ts: form submit, 공백 방지, textContent로 첫 주소 한 줄 출력. 결과 이벤트는 교체 시 해제.
- features/addressSearch.ts: 현재 지도 재사용, 세대 번호·AbortSignal로 이전 결과 무효화, 단일 마커 관리.
- styles/search.css: 헤더 안의 검색창과 한 줄 결과. 목록 스크롤·페이지 이동·접기 UI와 지도 위 결과 오버레이 제거.
- main.ts/registry.ts/types.ts/layout.ts: 검색 등록·키/호스트 전달. mount 오류는 기본 지도 정리 경로와 분리.

요청마다 고유 식별자·콜백을 생성하고 숨김 iframe의 별도 window에만 콜백을 둡니다.
iframe은 sandbox=allow-scripts이며 allow-same-origin을 허용하지 않습니다.
srcdoc 초기화 코드는 nonce, 외부 스크립트는 공식 /req/search 경로로 CSP 제한합니다.
부모는 message의 source(해당 iframe), origin(null), 채널, 요청 ID를 모두 확인합니다.
완료·로드 오류·15초 타임아웃·무효화 시 message/abort 리스너와 타이머를 정리하고 iframe을 제거합니다.
콜백·외부 스크립트는 iframe 문서 수명에 묶여 부모 window에 잔류하지 않습니다.
즉시 콜백 삭제 후 나중에 응답이 실행되는 부모 window의 ReferenceError 경로와
무기한 no-op 콜백을 누적하는 방식을 피합니다. 실제 네트워크 취소는 보장하지 않습니다.
브라우저별 iframe 제거 시 늦은 실행·메시지 무시 동작은 반드시 검증해야 합니다.

OK 응답은 EPSG:4326, ADDRESS 유형, items 배열, record/page의 정수·건수·현재 페이지 정합성을 검사합니다.
필수 주소·ID 누락과 잘못된 좌표는 전체 페이지를 오류 처리합니다. NOT_FOUND는 빈 결과로 처리합니다.
건물명은 없으면 생략합니다. ERROR 코드·메시지는 키·URL을 제거하고 길이를 제한합니다.
원본 예외·요청 URL은 로그하지 않습니다.

선행 실제 2건의 JSON 검증에서 확인한 x=경도, y=위도를 사용합니다. 숫자·범위·CRS 검사 후
OpenLayers transform으로 EPSG:3857로 변환하고 선택 시 마커 하나만 유지합니다.
마커는 주소 대표점이며 필지·면적·측량 분석용 위치가 아닙니다.
새 검색·입력 변경은 이전 결과·마커를 지우고 세대 번호를 증가시킵니다.
UI 요청은 page=1/size=1이며 첫 항목만 사용합니다. 전체 결과 수로 유일성을 주장하지 않습니다.
AbortSignal은 논리적 무효화에만 사용하며 fetch 취소와 같지 않습니다.
해제 시 요청·UI 이벤트·벡터 레이어·소스를 정리합니다. 비동기 요청 오류도 검색 패널에서 처리합니다.

이전 준비 코드의 타입 검사·빌드는 통과했지만 이번 연결 코드에는 재실행하지 않았습니다.
실제 JSONP·iframe Referrer/인증·CSP·메시지·타임아웃·모바일·기존 지도 회귀는 미검증입니다.

### 타일 오류 정적 조사

타일 실패 수는 시작/재요청 이후 누적값입니다. 성공 이벤트로 실패 수를 지우지 않으므로
화면의 실패 수가 현재 뷰의 실패 타일 수와 같다고 볼 수 없습니다. main.ts 안내에 누적임을 명시했습니다.
URL은 WMTS REST z/y/x, Base PNG/위성 JPEG이며, 타일 source와 View 모두 EPSG:3857입니다.
동일 환경변수 키를 사용하지만 검색 성공만으로 WMTS 인증·서비스 정상 여부가 입증되지는 않습니다.
실제 실패 응답을 확보하지 않아 네트워크·도메인·줌별 제공 범위·서비스 장애 중 어느 원인인지 미확정입니다.
엔드포인트·키·줌 설정은 변경하지 않았고 실패를 숨기는 자동 초기화도 추가하지 않았습니다.
