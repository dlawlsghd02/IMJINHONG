import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
globalThis.fetch = () => { throw new Error('외부 통신 금지'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({ stdin: { contents: "export * from './src/services/vworld/landUse';", resolveDir: root, loader: 'ts' }, define: { 'import.meta.env.VITE_CADASTRAL_AUTO_BOX': 'false' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { parseLandUse, landUseNotices } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const id = '1120011300105280006';
const row = (code='UQA121', relation='2', name='제1종일반주거지역') => ({ pnu:id, prposAreaDstrcCode:code, prposAreaDstrcCodeNm:name, cnflcAt:relation, cnflcAtNm:({'1':'포함','2':'저촉','3':'접함'})[relation], manageNo:'M1', registDt:'2019-03-11', lastUpdtDt:'2026-10-06' });
const payload = (rows, total=rows.length) => ({landUses:{field:rows,totalCount:String(total),pageNo:'1',numOfRows:'1000',resultCode:null,resultMsg:null}});
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