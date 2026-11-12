import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
globalThis.fetch=()=>{throw Error('외부 통신 금지');};
const result=await build({stdin:{contents:"export * from './src/features/ownership'; export {default as Feature} from 'ol/Feature.js'; export {default as Polygon} from 'ol/geom/Polygon.js';",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
class Element {
 children=[];attributes=new Map();listeners=new Map();style={};dataset={};textContent='';hidden=false;
 append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes.set(k,v);}
 addEventListener(k,v){this.listeners.set(k,v);}removeEventListener(k){this.listeners.delete(k);}remove(){}
}
globalThis.document={createElement:()=>new Element(),createTextNode:text=>({textContent:text})};

test('보존된 WMS 범례 UI: 잠정 6색·모바일 접힘·PC 펼침·OFF 숨김',()=>{
 const calls=[],ui=api.createOwnershipWmsControls(value=>calls.push(value),true);
 const [button,panel]=ui.root.children,[status,legend,help]=panel.children;
 assert.equal(panel.hidden,true);assert.equal(legend.open,false);
 // 제목·6색 목록·잠정 안내·출처·소유권 경고 순서의 현재 구조를 각각 검증한다.
 assert.equal(legend.children.length,5);
 const [summary,list,notice,source,caution]=legend.children;
 assert.equal(summary.textContent,'소유구분(잠정)');
 assert.equal(list.className,'ownership-wms-legend-list');assert.equal(list.children.length,6);
 assert.deepEqual(list.children.map(row=>row.children[1].textContent),[
  '법인','국유지','시·도유지','소유구분 확인 필요','군유지','외국인·외국공공기관',
 ]);
 assert.deepEqual(list.children.map(row=>row.children[0].children[0].style.backgroundColor),[
  'rgba(231,189,255,0.50196)','rgba(225,225,225,0.50196)','rgba(255,233,189,0.50196)',
  'rgba(255,227,239,0.50196)','rgba(255,255,189,0.50196)','rgba(233,255,189,0.50196)',
 ]);
 assert.notStrictEqual(api.ownershipWmsProvisionalLegend,api.ownershipLegend);
 assert.equal(notice.textContent,'V-World 소유정보 WMS 색상을 일부 필지의 토지임야정보와 대조한 잠정 범례입니다. 공식 범례가 아니며 실제 소유구분과 다를 수 있습니다.');
 assert.equal(source.textContent,'지도 이미지: 국토교통부 · V-World. 범례: 일부 필지 실측에 따른 잠정 대응.');
 assert.equal(caution.textContent,'지도 색상만으로 소유권을 확정하지 마세요.');
 assert.equal(help.open,undefined);
 button.listeners.get('click')();assert.equal(panel.hidden,false);assert.equal(button.attributes.get('aria-pressed'),'true');
 legend.open=true;legend.open=false;assert.deepEqual(calls,[true]);
 ui.setStatus('이미지 조회 실패');assert.equal(status.dataset.state,'error');
 button.listeners.get('click')();assert.equal(panel.hidden,true);assert.deepEqual(calls,[true,false]);
 const desktop=api.createOwnershipWmsControls(()=>{},false);assert.equal(desktop.root.children[1].children[1].open,true);
 ui.dispose();desktop.dispose();
});
test('소유분류: 검증된 쌍만 개인, 공유인수 무관·불일치·미확인',()=>{
 assert.equal(api.classifyOwnership({ownershipCode:'01',ownershipName:'개인',coOwnerCount:4}),'individual');
 for(const v of [null,{ownershipCode:'1',ownershipName:'개인'},{ownershipCode:'02',ownershipName:null},{ownershipCode:'01',ownershipName:'법인'},{ownershipCode:null,ownershipName:'개인'}])assert.equal(api.classifyOwnership(v),'unknown');
 assert.equal(api.classifyOwnership({ownershipCode:'02',ownershipName:'국유지'}),'national');
});

test('공식 소유코드: 00~09·원본 보존·공식 명칭과 범례 구분',()=>{
 const categories=['other','individual','national','other','public','municipal','corporation','clan','other','other'];
 for(let n=0;n<10;n++){
  const code=String(n).padStart(2,'0'),value={ownershipCode:code,ownershipName:null};
  assert.equal(api.classifyOwnership(value,'wfs'),categories[n]);
  assert.equal(value.ownershipCode,code);
  const definition=api.ownershipCodeDefinition(code);
  assert.equal(api.classifyOwnership({...value,ownershipName:definition.officialName}),categories[n]);
  assert.equal(api.classifyOwnership({...value,ownershipName:'불일치'}),'unknown');
 }
 assert.equal(api.ownershipCodeDefinition('05').officialName,'군유지');
 assert.equal(api.ownershipLegend.find(x=>x.id==='municipal').label,'군유지');
 assert.equal(api.ownershipCodeDefinition('07').officialName,'종중');
 assert.equal(api.ownershipLegend.find(x=>x.id==='clan').label,'종중·문중');
 for(const code of [null,undefined,'','1',' 01','10','XX','__proto__']){
  assert.equal(api.ownershipCodeDefinition(code),null);
  assert.equal(api.classifyOwnership({ownershipCode:code,ownershipName:null},'wfs'),'unknown');
 }
});

test('WFS 레이어: 동일 PNU 복수 기록 유지·기타 원본·04/05 독립 색상',()=>{
 const model=api.createOwnershipLayer();
 const items=['00','03','08','09','04','05'].map(code=>{
  const feature=new api.Feature(new api.Polygon([[[0,0],[1,0],[1,1],[0,0]]]));feature.set('pnu','4311311400101390003');
  return {feature,classificationSource:'wfs',ownership:{ownershipCode:code,ownershipName:null}};
 });
 model.setData({status:'ready',mode:'actual',partial:true,items});
 const features=model.layer.getSource().getFeatures();assert.equal(features.length,6);
 assert.deepEqual(features.map(f=>f.get('ownershipCode')),['00','03','08','09','04','05']);
 assert.deepEqual(features.map(f=>f.get('ownershipCategory')),['other','other','other','other','public','municipal']);
 assert.equal(features[5].get('ownershipOfficialName'),'군유지');
 assert.equal(features[5].get('ownershipName'),null);
 const style=model.layer.getStyleFunction();
 assert.equal(style(features[4],1).getFill().getColor(),'#A48BD4');
 assert.equal(style(features[5],1).getFill().getColor(),'#8B5A2B');
 assert.equal(items[0].feature.get('ownershipCategory'),undefined);model.dispose();
});
test('소유레이어: 범례 색상·순서35·독립 ON/OFF·복제·미조회/오류 초기화',()=>{
 const model=api.createOwnershipLayer();assert.equal(model.layer.getVisible(),false);assert.equal(model.layer.getZIndex(),35);assert.equal(model.layer.getOpacity(),0.4);
 assert.deepEqual(api.ownershipLegend.map(x=>x.color),['#F2D77A','#76B7E5','#DC7777','#A48BD4','#8B5A2B','#81B88C','#A6ACB4','#E5E7EB']);
 assert.deepEqual(api.ownershipLegend.filter(x=>['public','municipal'].includes(x.id)).map(x=>x.label),['시·도유지','군유지']);
 const feature=new api.Feature(new api.Polygon([[[0,0],[1,0],[1,1],[0,0]]]));
 model.setData({status:'ready',mode:'mock',partial:true,items:[{feature,ownership:{ownershipCode:'01',ownershipName:'개인'}},{feature,ownership:null}]});
 const items=model.layer.getSource().getFeatures();assert.equal(items.length,2);assert.equal(feature.get('ownershipCategory'),undefined);
 const style=model.layer.getStyleFunction();assert.equal(style(items[0],1).getFill().getColor(),'#F2D77A');assert.equal(style(items[1],1).getFill().getColor(),'#E5E7EB');
 model.setEnabled(true);assert.equal(model.layer.getVisible(),true);model.setEnabled(false);assert.equal(model.layer.getVisible(),false);
 model.setData({status:'error',mode:'actual'});assert.equal(model.layer.getSource().getFeatures().length,0);model.dispose();
});
test('소유 UI: 최초 미연결·토글·범례·모의/실제·실패/미조회 구분',()=>{
 const calls=[],ui=api.createOwnershipControls(v=>calls.push(v));const [button,legend]=ui.root.children;
 assert.equal(legend.hidden,true);assert.match(legend.children[0].textContent,/미연결/);assert.equal(legend.children[1].children.length,8);
 button.listeners.get('click')();assert.equal(legend.hidden,false);assert.equal(button.attributes.get('aria-pressed'),'true');
 ui.setData({status:'ready',mode:'mock',partial:true,items:[]});assert.match(legend.children[0].textContent,/모의 데이터.*일부 자료/);
 ui.setData({status:'error',mode:'actual'});assert.match(legend.children[0].textContent,/조회 실패/);
 button.listeners.get('click')();assert.equal(legend.hidden,true);assert.deepEqual(calls,[true,false]);ui.dispose();
});
test('기존 선택 보호: 소유 채움은 클릭 차단 대상 제외, 데이터 자동 요청 없음',async()=>{
 const cadastral=await readFile(new URL('../src/features/cadastral.ts',import.meta.url),'utf8');assert.match(cadastral,/!layer.get\('ownershipOverlay'\)/);
 const source=await readFile(new URL('../src/features/ownership.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\(|loadLandLedger|requestSandboxJsonp/);
});

test('선택 도형: PNU/폴리곤 검사·도형만 복제·실제/미확인 분류·OFF 보존',()=>{
 const feature=new api.Feature(new api.Polygon([[[0,0],[1,0],[1,1],[0,0]]]));feature.set('pnu','4311311400101390003');feature.set('unneeded','discard');
 const ledger={pnu:'4311311400101390003',ownershipCode:'01',ownershipName:'개인',coOwnerCount:4};
 const data=api.selectedOwnershipData(feature,ledger);assert.equal(data.mode,'actual');assert.equal(data.status,'ready');assert.equal(data.items[0].feature.get('unneeded'),undefined);
 assert.equal(api.selectedOwnershipData(feature,{...ledger,pnu:'other'}).status,'error');assert.equal(api.selectedOwnershipData(new api.Feature(),ledger).status,'error');
 const model=api.createOwnershipLayer();model.setData(data);assert.equal(model.layer.getVisible(),false);model.setEnabled(true);
 assert.equal(model.layer.getSource().getFeatures()[0].get('ownershipCategory'),'individual');
 model.setData(api.selectedOwnershipData(feature,{...ledger,ownershipCode:'ZZ'}));assert.equal(model.layer.getSource().getFeatures()[0].get('ownershipCategory'),'unknown');
 model.setData({status:'not-loaded',mode:'actual'});assert.equal(model.layer.getSource().getFeatures().length,0);model.dispose();
});
