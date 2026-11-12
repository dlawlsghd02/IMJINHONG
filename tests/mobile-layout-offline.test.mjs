import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
globalThis.fetch=()=>{throw Error('외부 통신 금지');};
const result=await build({entryPoints:[fileURLToPath(new URL('../src/ui/layout.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
for(const width of [320,375,390,430,768,1280])test(`접기 메뉴 상태: ${width}px 기준 (실제 렌더링 검증 아님)`,()=>{
 const previous=globalThis.window,nodes=new Map(),listeners=new Map();
 const media={matches:width<=900,addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)};
 globalThis.window={matchMedia:query=>{assert.equal(query,'(max-width: 900px)');return media;}};
 const root={innerHTML:'',querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}};
 try{
  const ui=api.createLayout(root);
  assert.equal(nodes.get('.search-tools').open,width>900);assert.equal(nodes.get('.layer-tools').open,width>900);
  assert.match(root.innerHTML,/aria-label="지도 확대"/);assert.match(root.innerHTML,/aria-label="지도 축소"/);
  assert.match(root.innerHTML, /class="basemap-segment"[\s\S]*data-basemap="base"[\s\S]*data-basemap="satellite"[\s\S]*<\/div>\s*<button[^>]*data-map-names/);
  const target=ui.target;media.matches=!media.matches;listeners.get('change')();
  assert.equal(nodes.get('.layer-tools').open,!media.matches);assert.equal(ui.target,target);
  ui.dispose();assert.equal(listeners.size,0);
 }finally{globalThis.window=previous;}
});

test('현대화 UI 정적 확인: 세그먼트·세로 도구·선택 상태·작은 범례 버튼·터치 및 출처 유지',async()=>{
  const read=p=>readFile(new URL('../src/styles/'+p,import.meta.url),'utf8');
  const [map,parcel,zoning,base]=await Promise.all(['map.css','parcel.css','zoning.css','base.css'].map(read));
  assert.match(base,/--ui-surface: #fff/); assert.match(base,/prefers-reduced-motion/);
  assert.match(map,/\.basemap-segment\s*\{[^}]*display: flex/);
  assert.match(map,/\[data-basemap\]\[aria-pressed="true"\][^}]*background: var\(--ui-accent\)/);
  assert.match(map,/\.layer-tools > summary\s*\{[^}]*pointer-events: auto/);
  assert.match(parcel,/width: min\(280px, calc\(100% - 92px\)\)/);
  assert.match(parcel,/\.parcel-toggle\[aria-pressed="true"\] \.parcel-toggle-state/);
  assert.match(zoning,/zoning-details-toggle\s*\{[^}]*min-height: 30px;[^}]*font-size: 12px/);
  assert.match(zoning,/\.zoning-controls \.zoning-color-note\s*\{[^}]*order: 3/);
  assert.match(zoning,/zoning-details-toggle\s*\{[^}]*min-height: 44px;[^}]*border-top: 7px solid transparent/);
  assert.match(zoning,/\[data-enabled="true"\]/);
  // 표시 규칙 확인이며 실제 브라우저 크기·겹침 검증을 대신하지 않는다.
});
test('모바일 배치 정적 규칙: 터치·safe-area·하단 패널·스크롤·접기 상태',async()=>{
 const read=p=>readFile(new URL('../src/styles/'+p,import.meta.url),'utf8');
 const [map,parcel,search]=await Promise.all(['map.css','parcel.css','search.css'].map(read));
 assert.match(map,/max-width: 900px/);assert.match(map,/safe-area-inset-top/);assert.match(map,/safe-area-inset-bottom/);
 assert.match(map,/\.layer-tools-content[^}]*min-width: 0/s);
 assert.match(parcel,/#parcel-panel-host[^}]*max-height: min\(40dvh/s);
 assert.match(parcel,/overscroll-behavior: contain/);assert.match(parcel,/overflow: auto/);
 assert.match(search,/max-height: 22dvh; overflow: auto/);
 for(const css of [map,parcel,search])assert.match(css,/min-height: 44px/);
 assert.match(parcel,/ownership-wms-controls.*data-state="normal"/);
});
