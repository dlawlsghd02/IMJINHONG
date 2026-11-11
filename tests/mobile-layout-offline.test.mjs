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
  const target=ui.target;media.matches=!media.matches;listeners.get('change')();
  assert.equal(nodes.get('.layer-tools').open,!media.matches);assert.equal(ui.target,target);
  ui.dispose();assert.equal(listeners.size,0);
 }finally{globalThis.window=previous;}
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
