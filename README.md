# IMJINHONG
Nationwide Web GIS for cadastral information, land-use zoning, and spatial data visualization using V-World API.

OpenLayers + Vite + TypeScript 기반의 전국 웹 GIS입니다.
1차 지도는 검사·빌드와 Pages 배포를 완료했고 사용자가 PC·모바일 작동을 확인했습니다.
아래 2차 검색 연결 코드는 로컬 작성 상태로, 이번 변경의 재검증·재배포는 별도 단계입니다.

## 구현 범위

- 대한민국 초기 범위, 지도 이동·확대·축소, 터치 조작
- V-World 일반지도·위성지도 전환 (현재 중심·줌 유지)
- EPSG:3857 지도 / EPSG:4326 경도·위도 표시
- 정밀 포인터에서는 마우스 위치, 터치 환경에서는 지도 중심 좌표
- 설정 누락·초기화 오류·타일 요청 오류 안내와 타일 재요청
- 화면 크기·모바일 동적 높이에 대응하는 인터페이스

도로명·지번주소 검색, 첫 번째 주소 한 줄 표시, 선택 위치 이동과 단일 마커 코드를 추가했습니다.
이번 JSONP 연결 코드는 아직 타입 검사·빌드·브라우저 검증 전이며 배포하지 않았습니다.
지적 경계·필지 선택의 3차 코드 작성 상태는 아래 별도 항목을 참고하세요.
용도지역, SHP 업로드, GPS 수집, 측정 기능은 아직 구현하지 않았습니다.
V-World 공식 규격 페이지 접근 실패로 타일 경로·확장자·줌 범위는 재확인이 필요합니다.
로컬 지도 표시 확인과 별개로 Pages 도메인의 인증·응답 및 모바일 레이아웃은 배포 후 확인이 필요합니다.

## 설정 및 추후 실행

### 3차 지적 기능 — 코드 작성, 실행 검증 전

자동 BOX 표시 보완 코드를 추가했습니다. POINT 줌 17과 BOX 후보 줌 15를 분리하고,
BOX 면적 0.25㎢·200건, 이동 종료 지연 350ms·요청 간격 1.5초, 완전 응답 메모리 캐시를 적용하도록 작성했습니다.
캐시는 TTL 60초·최대 8항목이며 피처/좌표 수를 제한합니다. 부분 응답과 완전성 미확인을 별도 안내합니다.
자동 BOX는 계속 비활성입니다. 이번 보완의 타입 검사·빌드·실제 API·브라우저 검증은 하지 않았습니다.
POINT 선택·패널은 단순 지도 이동 시 유지하고 새 클릭·닫기·OFF에서 초기화하도록 변경했습니다.
기존 키·domain·JSONP sandbox·Actions 인증 설정은 변경하지 않았습니다.

- 기존 지도에 지적 경계·선택 강조 벡터 레이어와 지적도 켜기/끄기 버튼을 추가했습니다. 처음에는 꺼져 있습니다.
- 켠 뒤 줌 17 이상에서 지도 클릭 시 `LP_PA_CBND_BUBUN` 점조회를 사용합니다. PNU 19자리, Polygon/MultiPolygon, 경위도와 클릭 위치 포함 여부를 검사합니다.
- 여러 클릭 후보 또는 잘린 응답은 자동 선택하지 않습니다. 선택 강조는 1필지만 유지합니다.
- 자동 화면 범위 BOX 조회는 `src/config/parcel.ts`의 `autoBoundaryQueryEnabled: false`로 차단했습니다. 현재 화면 전체의 지적 경계를 자동 표시하지 않습니다.
- 토지임야·공시지가 응답 파서는 작성했지만 브라우저 전송이 미검증이므로 실제 요청 없이 **조회 불가**를 표시합니다. 면적·공시지가가 조회되는 완성 상태가 아닙니다.
- 이 변경은 타입 검사·빌드·실제 API·브라우저 검증 전이며 배포하지 않았습니다. 기존 검색 JSONP와 배경지도 코드는 수정하지 않았습니다.
- [지적 기능 구조·제한·검증 순서](docs/parcels.md)

개발·배포는 Node.js 24 LTS를 사용합니다. 로컬에서는 프로젝트 내부 ZIP 설치를 사용하며 영구 PATH를 변경하지 않습니다.

```powershell
Set-Location 'C:\주피터\IMJINHONG'
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
# .env.local의 VITE_VWORLD_API_KEY에 본인의 브라우저용 키 입력
$env:Path = "$PWD\.tools\nodejs\node-v24.22.2-win-x64;$env:Path"
$env:npm_config_cache = "$PWD\.tools\npm-cache"
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

개발 주소: `http://127.0.0.1:5173/IMJINHONG/` (포트 사용 중이면 실제 출력 주소 확인).
키를 변경하면 서버를 다시 시작합니다. `.env.local`이 이미 있으면 복사로 덮어쓰지 마세요.
실제 키를 소스·문서·이슈·대화에 붙여 넣지 마세요.

`VITE_` 변수는 브라우저 번들에 포함됩니다. `.env.local`과 GitHub Secrets도
브라우저에 전달된 키를 숨겨주지 않습니다. 등록 서비스 URL 제한을 활용해야 합니다.

## 문서

주소·지번 검색(2026-11-06): 공식 레퍼런스와 활용모델의 callback 파라미터를 사용합니다.
유형을 고르고 버튼 또는 Enter로 검색하며 입력 중에는 API를 호출하지 않습니다.
새 검색·입력 변경·기능 해제 시 이전 요청은 논리적으로 무효화됩니다. 네트워크 취소를 보장하지 않습니다.
검색은 page=1/size=1로 요청하며 페이지 이동·목록 스크롤·접기 버튼은 없습니다.
유형에 맞는 도로명 또는 지번주소만 한 줄 표시하고 긴 주소는 줄임표와 title로 처리합니다.
첫 결과는 API 반환 순서이며 유일하거나 의도한 주소라는 보장은 없습니다.
마커는 주소 대표점이고 필지 경계·측량 좌표가 아닙니다.
검색 모듈과 스타일을 로컬 소스에 연결했지만 추가 테스트·API 호출·배포는 수행하지 않았습니다.

- [구조와 확장 방법](docs/architecture.md)
- [인증키 설정·Pages 배포·오류 확인](docs/deployment.md)

배포 예정 주소: https://dlawlsghd02.github.io/IMJINHONG/
Vite의 `base`는 `/IMJINHONG/`입니다.

## GitHub Actions 배포

`.github/workflows/deploy-pages.yml`은 main push 또는 수동 실행 시 Node.js 24에서
`npm ci → typecheck → build → dist 업로드 → Pages 배포`를 수행합니다.
Secret이 없으면 빌드를 중단합니다. 실제 push·설정 변경·배포는 별도 승인 대상입니다.

사용자가 Settings → Secrets and variables → Actions → New repository secret에서
`VITE_VWORLD_API_KEY`를 등록해야 합니다. 실제 키는 직접 입력합니다.
Pages의 Source는 별도 승인 후 기존 브랜치 배포에서 **GitHub Actions**로 변경해야 합니다.

로컬 `.env.local`은 CI로 전달되지 않습니다. CI는 Repository Secret을 빌드 단계에서 사용합니다.
브라우저 번들에는 키가 포함되므로 완전한 비밀 보호 수단이 아닙니다.
배포 후 실제 주소와 V-World 등록 서비스 URL, 일반·위성지도, 자산 경로,
좌표·줌·모바일 및 Console/Network를 확인하세요. 상세 절차는 배포 문서를 참고하세요.
