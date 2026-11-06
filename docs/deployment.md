# 인증키와 배포 안내

## 지적 API 선택적 domain 설정

`VITE_VWORLD_DOMAIN`은 V-World에 실제 등록된 서비스 URL을 전달하는 공개 설정입니다.
설정이 없거나 공백이면 기존처럼 domain을 생략합니다. 설정 시 HTTP(S) 절대 URL만 허용하며
사용자명·비밀번호, 프래그먼트(#), 공백을 포함한 값은 요청 전에 거부합니다.
검증은 지적 요청 시 수행하므로 잘못된 domain 설정이 기본 지도·검색 초기화를 중단하지 않습니다.
등록 URL은 앞뒤 공백만 제거하고 경로·포트·끝 슬래시를 임의로 바꾸지 않습니다.

로컬에서는 사용자가 `.env.local`에 다음 공개 설정을 추가할 수 있습니다. 기존 키 줄은 유지합니다.

```dotenv
VITE_VWORLD_DOMAIN=https://dlawlsghd02.github.io/IMJINHONG/
```

위 값은 사용자가 확인한 기존 등록 URL이며, 실제 키 관리 화면의 값과 일치해야 합니다.
로컬에서 이 값을 전달한다고 로컬 사용이 자동 허용되는 것은 아닙니다. 변경 후 서버 재시작이 필요합니다.
이번 코드 작업에서는 `.env.local`이나 실제 등록 URL, 인증키를 변경하지 않았습니다.

Pages는 별도 승인 후 Repository Settings → Secrets and variables → Actions → Variables에서
`VITE_VWORLD_DOMAIN` Repository Variable을 설정합니다. 키 Secret은 그대로 유지합니다.
워크플로는 해당 공개 Variable을 빌드 환경으로 전달하며, 미설정이면 생략됩니다.
Variable 변경만으로 기존 번들은 바뀌지 않으므로 별도 승인된 빌드·배포가 필요합니다.
domain은 지적 어댑터에만 전달하며 검색·타일, sandbox·CSP·Referer 정책은 변경하지 않습니다.
자동 BOX 및 토지임야·공시지가 전송도 비활성 상태를 유지합니다.
domain 추가로 INCORRECT_KEY가 해결되는지는 아직 실제 API·브라우저 검증 전입니다.

## 3차 지적 기능 배포 전 조건

이번 변경은 코드·문서 작성만 진행했습니다. 테스트·빌드·API 호출·배포는 수행하지 않았습니다.
기존 `VITE_VWORLD_API_KEY` Secret은 재사용합니다. 이후 추가한 선택적 공개 환경변수는 위 domain 설정을 참고하세요.
지적 JSONP는 별도 sandbox iframe에서 공식 `/req/data`만 허용합니다. 검색 JSONP의 동작 확인은 지적 API 인증 호환성을 보장하지 않습니다.
로컬 및 Pages에서 Origin/Referer, CSP, 콜백 실행, 메시지 전달을 별도로 확인해야 합니다.
자동 BOX 조회는 기본 비활성이고, 토지임야·공시지가 브라우저 전송은 요청 자체를 생성하지 않습니다.
설정값만 바꿔 미확인 CORS/JSONP를 활성화하지 마세요. 공식 규격과 실제 브라우저 응답 확인 후 별도 구현 승인이 필요합니다.
키/전체 URL/iframe srcdoc/HAR 및 원본 응답을 로그나 공개 자료에 포함하지 마세요.
구체적인 단계는 [지적 기능 검증 순서](parcels.md)를 참고하세요.

## 주소 검색 JSONP 연동 (2026-11-06)

공식 검색 API 2.0 문서 https://www.vworld.kr/dev/v4dv_search2_s001.do 를 읽기 전용 HTTP 요청으로 확보했습니다.
도로명은 type=ADDRESS/category=ROAD, 지번은 type=ADDRESS/category=PARCEL입니다.
request=search, format=json, errorFormat=json, crs=EPSG:4326, page/size, key, query를 사용합니다.
공식 문서의 callback 지원과 활용모델의 dataType=jsonp/jsonp=callback 코드를 근거로 구현했습니다.
추가 패키지는 없으며 기존 VITE_VWORLD_API_KEY 및 Repository Secret을 재사용합니다.

선행 별도 승인 검증에서 도로명·지번 각 1회 일반 JSON 요청은 HTTP 200/status=OK였습니다.
EPSG:4326과 x=경도/y=위도를 실제 위치와 대조했습니다. 두 응답에 Access-Control-Allow-Origin이
없어 JSONP를 선택했습니다. 모든 Origin의 CORS 정책이나 실제 브라우저 JSONP를 검증한 것은 아닙니다.

요청은 공식 https://api.vworld.kr/req/search 로만 생성하며 임의 endpoint를 받지 않습니다.
고유 callback을 sandbox iframe에 두고 완료·오류·타임아웃·무효화 시 문서 전체를 제거합니다.
이 방식이 V-World의 Referrer·도메인 인증과 호환되는지 로컬과 Pages에서 별도 검증해야 합니다.
Referrer를 위조하거나 임의 domain 파라미터, 프록시, no-cors를 사용하지 않습니다.
외부 JSONP JavaScript 실행은 JSON 데이터 수신과 보안 성격이 다릅니다.
allow-same-origin 없는 sandbox와 CSP, source/요청ID 검사를 적용하되 브라우저 검증이 필요합니다.
요청 URL 및 iframe srcdoc에는 브라우저용 키가 포함될 수 있습니다. DevTools·HAR 공유 시 가립니다.

새 검색/입력 변경은 이전 결과를 논리적으로 무효화하며 이미 전송된 요청의 사용량 취소는 보장하지 않습니다.
버튼/Enter에만 page=1/size=1로 요청하며 자동완성 호출·페이지 이동·자동 재시도는 없습니다.
첫 주소 한 줄만 표시하고 건물명·좌표·건수 등의 상세 정보는 검색 결과에 표시하지 않습니다.
서비스 URL 판정 세부 조건과 현재 키의 일일 한도 수치는 계속 미확인입니다.
127.0.0.1과 localhost는 다른 호스트이며 Pages도 별도 origin입니다. 현재 실패 원인이
등록 호스트 차이인지는 실제 응답 전까지 확정하지 않습니다. 도메인 변경은 임의로 진행하지 않습니다.
타일 실패 안내는 누적 실패 수이며, 실제 원인 확정을 위한 타일 요청은 별도 승인이 필요합니다.
기존 워크플로·Secret은 변경하지 않았고 이번 연결 코드에는 검사·빌드·추가 API 호출·배포를 하지 않았습니다.

## 로컬 키 설정

1. `.env.example`을 `.env.local`로 복사합니다. 기존 파일이 있으면 덮어쓰지 않습니다.
2. `VITE_VWORLD_API_KEY=` 뒤에 본인의 브라우저용 키를 입력합니다.
3. `.env.local`은 `.gitignore`로 제외됩니다. 향후 커밋 전에 Git 상태를 확인합니다.
4. 환경변수는 서버 시작·빌드 시 읽습니다. 변경 후 개발 서버 재시작 또는 재빌드가 필요합니다.

키가 없으면 지도 요청 없이 설정 오류를 표시합니다. `.env.local`은 로컬 전용이며 커밋하지 않습니다.

## 클라이언트 키와 서비스 URL

`VITE_` 환경변수는 빌드 시 클라이언트 코드에 포함됩니다.
키는 JavaScript와 Network 요청에서 확인할 수 있으며 GitHub Secrets로 주입해도 같습니다.
서버 전용 비밀키를 이 방식으로 전달하면 안 됩니다.
V-World 브라우저용 키는 제공자의 서비스 URL 제한 정책을 활용해야 합니다.

등록하신 배포 주소: `https://dlawlsghd02.github.io/IMJINHONG/`.
키 관리 화면의 서비스 URL 및 허용 API가 실제 배포 환경에 맞는지 확인하세요.
GitHub 저장소 주소는 서비스가 실행되는 주소와 다릅니다.
로컬 `http://127.0.0.1:5173`과 `http://localhost:5173`도 배포 주소와 다릅니다.

현재 V-World 공식 페이지를 조회하지 못해 URL의 도메인/경로/포트 판정 방식,
개발키 허용 조건과 추가 URL 등록 가능 여부는 확정하지 않았습니다.
기본 Referrer-Policy는 cross-origin 요청에 origin만 전송하므로 경로가 그대로 전달된다고 가정하지 마세요.
등록 URL 문자열과 요청 헤더를 공식 정책에 따라 확인해야 합니다.
임의 domain 파라미터나 Referer 위조로 제한을 우회하지 않습니다.
로컬이 거부되면 허용된 개발키·개발 URL 사용 가능 여부를 공식 지원에 확인하거나,
별도 배포 승인 후 등록된 Pages 주소에서 연동을 검증합니다.

## 타일 연동과 확인 한계

사용한 잠정 WMTS REST 템플릿:

```text
https://api.vworld.kr/req/wmts/1.0.0/{key}/Base/{z}/{y}/{x}.png
https://api.vworld.kr/req/wmts/1.0.0/{key}/Satellite/{z}/{y}/{x}.jpeg
```

HTTPS, z/y/x 순서, 일반 PNG·위성 JPEG로 분리했습니다.
공식 규격 페이지 접근이 실패하여 경로·확장자·최대 줌의 공식 재확인이 남았습니다.
일반·위성지도, 좌표 표시, 확대·축소는 사용자가 로컬 브라우저에서 정상 확인했습니다.
공식 규격 전체 및 Pages 도메인에서의 API 검증은 완료하지 않았습니다.

타일 실패 시 개발자 도구 Network에서 응답 상태·내용·Referer를 확인합니다.
키 누락/만료, 서비스 URL 제한, 이용량, 네트워크 차단, 데이터 미제공을 구분해야 합니다.
이미지 로딩 이벤트만으로 정확한 원인을 판단할 수 없습니다.
Network 캡처·HAR·오류 보고서를 공유할 때 URL에 포함된 키를 지우세요.

## GitHub Actions 배포 구조

Vite `base`는 `/IMJINHONG/`으로 설정했습니다.
1차 배포 시 Pages Source를 GitHub Actions로 전환했음을 확인했습니다.
Vite 소스 자체는 빌드된 웹사이트가 아니므로 main 루트 배포만으로 이 앱이 실행되지는 않습니다.

워크플로: `.github/workflows/deploy-pages.yml`.
main push와 workflow_dispatch를 지원합니다. push 후 자동 배포되므로 준비 파일을
main에 올리는 행위도 배포 실행으로 이어질 수 있습니다. 별도 승인 전에 push하지 않습니다.

build job은 Ubuntu에서 Node.js 24를 구성하고 npm 캐시를 사용합니다.
`npm ci`, `npm run typecheck`, `npm run build` 순서로 실행합니다.
package-lock.json을 함께 커밋해야 하며 build 스크립트도 내부적으로 타입 검사를 실행합니다.
키는 빌드 step에만 Repository Secret으로 전달하며 누락·공백이면 실패 처리합니다.
키 값은 로그에 출력하지 않습니다.

GitHub 공식 actions/configure-pages@v5, upload-pages-artifact@v3가 dist만 준비·업로드하고,
별도 deploy job의 deploy-pages@v4가 github-pages environment에 배포합니다.
build는 contents:read, deploy는 pages:write와 id-token:write 권한을 사용합니다.
concurrency로 배포를 직렬화하며 진행 중인 배포를 취소하지 않습니다.
checkout@v7와 setup-node@v7는 조회한 공식 README 예시를 따릅니다.
1차 배포에서는 GitHub-hosted runner의 build/deploy 성공을 확인했습니다. 검색 연결 버전은 아직 배포하지 않았습니다.

## Repository Secret 등록 (사용자 직접 수행)

1. 저장소 Settings → Secrets and variables → Actions를 엽니다.
2. New repository secret을 선택합니다.
3. Name: `VITE_VWORLD_API_KEY`.
4. Secret: 기존 V-World 키를 직접 입력하고 저장합니다. 따옴표나 변수 선언문 없이 값만 입력합니다.
5. 값이나 화면 캡처를 대화·이슈에 공유하지 않습니다.

Secret 변경만으로 기존 번들이 바뀌지 않습니다. 승인된 재배포가 필요합니다.
Secret은 소스에서 값을 분리하지만 최종 브라우저 번들의 키를 숨기지는 못합니다.

## Pages 설정과 실제 배포 (별도 승인 후)

1. Repository Secret 등록을 완료합니다.
2. Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 변경합니다.
3. github-pages environment의 허용 브랜치 정책이 main 배포를 허용하는지 확인합니다.
4. 소스·lock 파일·워크플로·문서만 검토해 커밋하고 main으로 push합니다.
5. Actions의 Deploy GitHub Pages 실행에서 build/deploy 성공을 확인합니다.

Secret 등록과 Pages Source 설정은 1차 배포에서 완료했습니다.
이번 검색 연결 작업에서는 Secret·Pages 설정 변경, commit·push·워크플로 실행·배포를 하지 않았습니다.

## 로컬과 CI의 차이 및 배포 후 점검

| 항목 | 로컬 | GitHub Actions/Pages |
| --- | --- | --- |
| 실행 환경 | Windows, 프로젝트 내부 Node.js ZIP | Ubuntu runner, setup-node 24 |
| 키 공급 | Git 제외된 .env.local | Repository Secret을 build 환경변수로 주입 |
| 제공 방식 | Vite 개발 서버 또는 preview | dist 정적 자산 |
| 서비스 주소 | 127.0.0.1:5173/IMJINHONG/ | https://dlawlsghd02.github.io/IMJINHONG/ |

- 실제 배포 주소와 V-World 등록 서비스 URL 및 허용 API를 확인합니다.
- HTTPS /IMJINHONG/에서 새로고침하고 JS·CSS의 404 여부를 확인합니다.
- 일반·위성지도, 중심·줌 유지, 이동, 좌표 표시를 확인합니다.
- PC·모바일 크기와 터치 조작, 버튼 겹침·잘림을 확인합니다.
- Network의 타일 HTTP 상태·이미지 응답과 Console의 CORS·초기화 오류를 확인합니다.
- 인증 실패와 서비스 URL 제한은 응답 내용을 근거로 구분합니다. 캡처에서 키를 가립니다.

## 배포 사전 검증

package-lock.json으로 npm ci, typecheck, build를 실행하고 종료 코드를 확인합니다.
Windows에서 개발 서버가 esbuild.exe를 점유하면 npm ci가 EPERM으로 실패할 수 있으므로
서버를 종료한 후 재실행합니다. 설치 중에는 개발 서버를 동시에 사용하지 않습니다.
`.env.local`, `.tools/`, `node_modules/`, `dist/`는 git check-ignore로 확인하고
git ls-files에서 추적되지 않는지 확인합니다. dist는 Git으로 올리지 않고 CI 산출물만 사용합니다.

## 로컬 재검증 참고

작업 경로: `C:\주피터\IMJINHONG`.
먼저 `node --version`, `npm --version`으로 환경을 확인합니다.
조건이 맞으면 `npm install`, `npm run typecheck`, `npm run build`를 실행합니다.
출력은 프로젝트 내부 `node_modules`, `package-lock.json`, `dist`입니다.
패키지 다운로드 및 개발 서버/브라우저의 V-World 타일 요청에 네트워크가 필요합니다.

`npm run dev`의 `/IMJINHONG/`에서 설정 누락/실제 키, 일반·위성 전환,
전환 전후 중심·줌, 좌표 기준, 모바일 화면·회전, 키보드 조작, 타일 오류·재요청을 확인합니다.
`npm run preview`로 빌드 결과도 확인한 뒤 서버를 종료합니다.
로컬 인증이 거부되면 그 결과와 원인을 보고하고 배포를 자동 진행하지 않습니다.
설치 환경 변경이나 코드 오류 수정은 발견 내용을 보고하고 승인 범위를 확인합니다.

## 참고 문서

- [OpenLayers XYZ API](https://openlayers.org/en/latest/apidoc/module-ol_source_XYZ-XYZ.html)
- [Vite 환경변수](https://vite.dev/guide/env-and-mode.html)
- [Vite GitHub Pages 배포](https://vite.dev/guide/static-deploy.html#github-pages)
- [V-World 공식 사이트](https://www.vworld.kr/) — 오픈API 레퍼런스·인증키 정책 재확인 필요

문서 확인일: 2026-11-05. OpenLayers·Vite 문서는 조회했으며 V-World 규격 페이지는 조회 실패했습니다.
