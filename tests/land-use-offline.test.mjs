import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
globalThis.fetch = () => { throw new Error('외부 통신 금지'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({ stdin: { contents: "export * from './src/services/vworld/landUse'; export * from './src/services/vworld/regulationDictionary';", resolveDir: root, loader: 'ts' }, define: { 'import.meta.env.VITE_CADASTRAL_AUTO_BOX': 'false' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { parseLandUse, landUseNotices, regulationDictionary, classifyRegulations, legacyNonTargets } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const id = '1120011300105280006';
const row = (code='UQA121', relation='2', name='제1종일반주거지역') => ({ pnu:id, prposAreaDstrcCode:code, prposAreaDstrcCodeNm:name, cnflcAt:relation, cnflcAtNm:({'1':'포함','2':'저촉','3':'접함'})[relation], manageNo:'M1', registDt:'2019-03-11', lastUpdtDt:'2026-10-06' });
const payload = (rows, total=rows.length) => ({landUses:{field:rows,totalCount:String(total),pageNo:'1',numOfRows:'1000',resultCode:null,resultMsg:null}});

test('3차: 두 필지 사례의 요약·분류·원본 보존',()=>{
 for(const [pnu,child,name,extras] of [
  ['4311311400101390003','UQA130','준주거지역',[['UQF130','시가지경관지구','2'],['UQQ329','기타용지','1']]],
  ['4311311500115600000','UQA121','제1종일반주거지역',[['UQQ321','주거용지','1'],['UOA110','절대보호구역','1']]],
 ]){
  const values=[[child,name,'1'],['UQA001','도시지역','1'],['UQQ300','지구단위계획구역','1'],['UMZ100','가축사육제한구역','1'],...extras];
  const rows=values.map(([c,n,r],i)=>({...row(c,r,n),pnu,manageNo:`M${i}`}));
  const before=JSON.stringify(rows);const v=parseLandUse(payload(rows),pnu).value;
  assert.deepEqual(v.summary.map(x=>x.code),[child]);assert.equal(v.records.length,rows.length);
  assert.equal(JSON.stringify(rows),before);v.classified.forEach((c,i)=>{assert.equal(c.record,v.records[i]);assert.equal(c.recordIndex,i);});
  assert.equal(v.classified.find(x=>x.record.prposAreaDstrcCode==='UQQ300').category,'other-designation');
  assert.equal(v.diagnostics.unknownCode,1+(extras.some(x=>x[0]==='UQQ329'||x[0]==='UQQ321')?1:0));
  if(extras.some(x=>x[0]==='UQF130')) assert.equal(v.classified.find(x=>x.record.prposAreaDstrcCode==='UQF130').category,'district');
 }
});

test('3차: 두 도시지역 원본 코드 독립·동일 관계에서만 상위 생략',()=>{
 const rows=[row('UQA001','1','도시지역'),row('UQA01X','1','도시지역'),row('UQA121','2'),{...row('UQA001','1','도시지역'),manageNo:'M2'}];
 const v=parseLandUse(payload(rows),id).value;
 assert.deepEqual(v.summary.map(x=>x.code),['UQA001','UQA01X','UQA121']);assert.equal(v.records.length,4);
 const same=parseLandUse(payload([...rows,row('UQA121','1')]),id).value;assert.deepEqual(same.summary.map(x=>x.code),['UQA121']);
 assert.equal(same.classified.filter(x=>x.record.prposAreaDstrcCode==='UQA001').length,2);
});

test('3차: 신규 확정 코드의 미확인 집계 제외·불일치와 접함·미분류 유지',()=>{
 for(const code of ['UQA001','UQF130','UQQ300']){
  const e=regulationDictionary.find(x=>x.code===code);
  assert.match(e.verification.officialCode.limitations,/502/);assert.equal(e.parentCode,undefined);
  const v=parseLandUse(payload([row(code,'1',e.acceptedNames[0])]),id).value;assert.equal(v.unknown,false);
  assert.equal(parseLandUse(payload([row(code,'1','불일치')]),id).value.unknown,true);
  assert.equal(parseLandUse(payload([row(code,'3',e.acceptedNames[0])]),id).value.classified[0].includedInDisplay,false);
 }
 for(const [code,name] of [['UOA110','절대보호구역'],['UMZ100','가축사육제한구역'],['UQQ321','주거용지'],['UQQ329','기타용지']]){
  assert.equal(classifyRegulations([row(code,'1',name)])[0].category,'unclassified');
 }
});
test('용도지역 복수·포함·저촉·접함 제외·상위 생략·원본 보존',()=>{
 const rows=[row('UQA01X','1','도시지역'),row(),row('UQA122','2','제2종일반주거지역'),row('UQA122','3','제2종일반주거지역'),row()];
 const r=parseLandUse(payload(rows),id); assert.equal(r.status,'ok'); assert.equal(r.value.records.length,5); assert.deepEqual(r.value.summary.map(x=>x.code),['UQA01X','UQA121','UQA122']);
});
test('분류 미확인·부분 페이지',()=>{const rows=Array.from({length:1000},()=>row('OTHER','1','미확인'));const r=parseLandUse(payload(rows,1001),id);assert.equal(r.value.partial,true);assert.equal(r.value.unknown,true);assert.equal(r.value.summary.length,0);});
test('빈 자료·오류·PNU·페이지·건수 검증',()=>{
 assert.equal(parseLandUse(payload([]),id).status,'not-found');
 const p=payload([row()]);p.landUses.resultMsg='error';assert.throws(()=>parseLandUse(p,id));
 assert.throws(()=>parseLandUse(payload([{...row(),pnu:'1174010800104440003'}]),id));
 const q=payload([row()]);q.landUses.pageNo='2';assert.throws(()=>parseLandUse(q,id));
 assert.throws(()=>parseLandUse(payload([row()],22),id));
});

const national = { UQA111:'제1종전용주거지역',UQA112:'제2종전용주거지역',UQA121:'제1종일반주거지역',UQA122:'제2종일반주거지역',UQA123:'제3종일반주거지역',UQA130:'준주거지역',UQA210:'중심상업지역',UQA220:'일반상업지역',UQA230:'근린상업지역',UQA240:'유통상업지역',UQA310:'전용공업지역',UQA320:'일반공업지역',UQA330:'준공업지역',UQA410:'보전녹지지역',UQA420:'생산녹지지역',UQA430:'자연녹지지역',UQB001:'관리지역',UQB100:'계획관리지역',UQB200:'생산관리지역',UQB300:'보전관리지역',UQC001:'농림지역',UQD001:'자연환경보전지역' };
for (const [code,name] of Object.entries(national)) test(`전국 코드 ${code} ${name}`,()=>{
 const r=parseLandUse(payload([row(code,'1',name)]),id);assert.equal(r.value.summary[0].name,name);assert.deepEqual(landUseNotices(r.value),[]);
});
test('상위 생략은 동일 관계만, 관리지역과 도시지역 부모 처리',()=>{
 const r=parseLandUse(payload([row('UQA01X','1','도시지역'),row('UQA121','2'),row('UQB001','1','관리지역'),row('UQB100','1','계획관리지역')]),id);
 assert.deepEqual(r.value.summary.map(x=>x.code),['UQA01X','UQA121','UQB100']);
});
test('정확한 비대상은 무경고, 혼합 결과와 원본 중복 보존',()=>{
 const n=row('UQT200','1','공원');const only=parseLandUse(payload([n]),id).value;
 assert.equal(only.unknown,false);assert.match(landUseNotices(only)[0],/표시 대상/);
 const mixed=parseLandUse(payload([n,row(),row()]),id).value;assert.equal(mixed.records.length,3);assert.equal(mixed.summary.length,1);assert.deepEqual(landUseNotices(mixed),[]);
});
test('미확인·명칭·관계 불일치와 접함만 상태 구별',()=>{
 const u=parseLandUse(payload([row('NEW','1','기타')]),id).value;assert.equal(u.diagnostics.unknownCode,1);assert.match(landUseNotices(u)[0],/분류를 확인하지/);
 const n=parseLandUse(payload([row('UQA121','1','다른명칭')]),id).value;assert.equal(n.diagnostics.nameMismatch,1);
 const t=parseLandUse(payload([row('UQA121','3')]),id).value;assert.equal(t.unknown,false);assert.match(landUseNotices(t)[0],/접함 정보만/);
 const m=parseLandUse(payload([{...row(),cnflcAtNm:'포함'}]),id).value;assert.equal(m.diagnostics.relationMismatch,1);
 const nt=parseLandUse(payload([row('UQT200','1','확인되지않은공원명')]),id).value;assert.equal(nt.diagnostics.nameMismatch,1);
});
test('사전: 기존 23개/비대상15개 유지, 비대상 법적 유형 미확정',()=>{
 assert.equal(regulationDictionary.filter(x=>x.legacyZoningDisplay).length,23);
 const other=regulationDictionary.filter(x=>Object.hasOwn(legacyNonTargets,x.code));assert.equal(other.length,15);
 for(const e of other){assert.equal(e.category,e.code === 'UQQ810' ? 'zone' : 'unclassified');assert.equal(e.verification.apiObservation.status,'confirmed');assert.equal(e.legalVerification,e.code === 'UQQ810' ? 'documented-type' : 'unverified');
 const r=parseLandUse(payload([row(e.code,'1',e.acceptedNames[0])]),id).value;
 assert.equal(r.records[0].prposAreaDstrcCode,e.code);assert.equal(r.summary.length,0);assert.equal(r.unknown,false);
 assert.equal(r.classified[0].category,e.code === 'UQQ810' ? 'zone' : 'unclassified');assert.equal(r.classified[0].evidence,e.code === 'UQQ810' ? 'official-code-and-type' : 'api-observed-only');}
});
test('분류: 원본 참조·관리번호 다른 행 보존·관계 및 별도 결과',()=>{
 const r=parseLandUse(payload([{...row(),manageNo:'M1'},{...row(),manageNo:'M2'},row('UQA121','3')]),id).value;
 assert.equal(r.records.length,3);assert.equal(r.summary.length,1);
 r.classified.forEach((v,i)=>{assert.equal(v.recordIndex,i);assert.equal(v.record,r.records[i]);});
 assert.equal(r.classified[2].includedInDisplay,false);assert.equal(r.classified[0].evidence,'official-code-and-type');
 assert.equal(r.classified[0].relationCode,'2');assert.equal(r.classified[2].relationName,'접함');
});
test('분류: 코드/명칭 및 관계 불일치·미확인·상위 API 근거 분리',()=>{
 const rows=[row('UNKNOWN','1','알수없음'),row('UQA121','1','불일치'),{...row(),cnflcAtNm:'포함'},row('UQA01X','1','도시지역')];
 const c=classifyRegulations(rows);
 assert.ok(c[0].issues.includes('unknown-code'));assert.ok(c[1].issues.includes('name-mismatch'));assert.ok(c[2].issues.includes('relation-mismatch'));
 assert.equal(c[3].evidence,'api-observed-only');assert.ok(c[3].issues.includes('legal-type-unverified'));
 assert.equal(c[3].category,'zoning');
});
test('2차 사전: UQQ810 세 근거 독립·실측·법적 유형과 기존 summary 유지',()=>{
 const e=regulationDictionary.find(x=>x.code==='UQQ810');
 for(const axis of ['officialCode','apiObservation','legalType']) assert.equal(e.verification[axis].status,'confirmed');
 assert.notEqual(e.verification.officialCode.url,e.verification.legalType.url);
 assert.match(e.verification.officialCode.limitations,/전용 현행 코드북은 미확보/);
 const r=parseLandUse(payload([row('UQQ810','2','도시자연공원구역'),row()]),id).value;
 assert.deepEqual(r.summary.map(x=>x.code),['UQA121']);assert.equal(r.classified[0].category,'zone');
 assert.equal(r.classified[0].includedInDisplay,true);
});
test('2차 사전: 공식 후보는 실측·법적 유형 미확인, 응답 존재만으로 승격 금지',()=>{
 for(const code of ['UQF110','UQJ100','UQJ200','UQJ300','UDV100','UQQ500','UQT600']){
 const e=regulationDictionary.find(x=>x.code===code);
 assert.equal(e.verification.officialCode.status,'confirmed');assert.equal(e.verification.apiObservation.status,'unverified');assert.equal(e.verification.legalType.status,'unverified');
 const [c]=classifyRegulations([row(code,'1',e.acceptedNames[0])]);assert.equal(c.category,'unclassified');assert.equal(c.includedInDisplay,false);assert.equal(c.evidence,'official-code-only');
 const [bad]=classifyRegulations([row(code,'1','명칭불일치')]);assert.ok(bad.issues.includes('name-mismatch'));
 }
});
test('2차 사전: 동명 다른 코드/레이어·과거자료 한계·접함·원본 참조',()=>{
 const rows=[row('UQT600','1','도시자연공원구역'),row('UQQ810','3','도시자연공원구역'),{...row('UQQ810','2','도시자연공원구역'),manageNo:'M2'}];
 const r=parseLandUse(payload(rows),id).value;assert.equal(r.records.length,3);
 assert.equal(r.classified[0].category,'unclassified');assert.equal(r.classified[1].includedInDisplay,false);assert.equal(r.classified[2].category,'zone');
 r.classified.forEach((c,i)=>assert.equal(c.record,r.records[i]));
 const e=regulationDictionary.find(x=>x.code==='UQT600');assert.match(e.verification.officialCode.version,/개정일 미확인/);
 assert.match(e.verification.officialCode.finding,/공간시설/);
});
