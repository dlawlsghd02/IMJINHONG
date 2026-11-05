# IMJINHONG
Nationwide Web GIS for cadastral information, land-use zoning, and spatial data visualization using V-World API.

OpenLayers + Vite + TypeScript 기반의 전국 웹 GIS입니다.
로컬 TypeScript 검사와 Vite 빌드를 통과했습니다. 일반·위성지도, 좌표 표시, 확대·축소는 사용자가 실제 브라우저에서 정상 작동을 확인했습니다. Pages 배포는 아직 수행하지 않았습니다.

## 구현 범위

- 대한민국 초기 범위, 지도 이동·확대·축소, 터치 조작
- V-World 일반지도·위성지도 전환 (현재 중심·줌 유지)
- EPSG:3857 지도 / EPSG:4326 경도·위도 표시
- 정밀 포인터에서는 마우스 위치, 터치 환경에서는 지도 중심 좌표
- 설정 누락·초기화 오류·타일 요청 오류 안내와 타일 재요청
- 화면 크기·모바일 동적 높이에 대응하는 인터페이스

주소 검색, 지적정보, 용도지역, SHP 업로드, GPS 수집, 측정 기능은 아직 구현하지 않았습니다.
V-World 공식 규격 페이지 접근 실패로 타일 경로·확장자·줌 범위는 재확인이 필요합니다.
로컬 지도 표시 확인과 별개로 Pages 도메인의 인증·응답 및 모바일 레이아웃은 배포 후 확인이 필요합니다.

## 설정 및 추후 실행

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
