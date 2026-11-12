/** Exact legacy mappings; no prefix/name inference. Evidence is versioned separately. */
export type RegulationCategory = 'zoning' | 'district' | 'zone' | 'planning-facility' | 'other-designation' | 'unclassified';
export interface VerificationEvidence {
  status: 'confirmed' | 'unverified';
  documentName?: string; url?: string; version?: string; checkedAt?: string;
  finding?: string; limitations: string;
}
export interface RegulationVerification {
  officialCode: VerificationEvidence;
  apiObservation: VerificationEvidence;
  legalType: VerificationEvidence;
}
export interface RegulationCodeEntry {
  code: string; acceptedNames: readonly string[]; category: RegulationCategory;
  subtype?: string; legalBasis?: string; codeSource: string; legalSource?: string;
  sourceVersion?: string; verifiedAt?: string;
  codeVerification: 'official-document' | 'api-observed';
  legalVerification: 'documented-type' | 'unverified';
  jurisdiction?: string; parentCode?: string;
  legacyZoningDisplay: boolean;
  verification?: RegulationVerification;
}
// Limited evidence: official zoning SLD codes + observed upper-level API code.
// This is deliberately not a nationwide exhaustive UQA prefix classifier.
export const zoningNames = {
  UQA01X: '도시지역', UQA111: '제1종전용주거지역', UQA112: '제2종전용주거지역',
  UQA121: '제1종일반주거지역', UQA122: '제2종일반주거지역', UQA123: '제3종일반주거지역', UQA130: '준주거지역',
  UQA210: '중심상업지역', UQA220: '일반상업지역', UQA230: '근린상업지역', UQA240: '유통상업지역',
  UQA310: '전용공업지역', UQA320: '일반공업지역', UQA330: '준공업지역',
  UQA410: '보전녹지지역', UQA420: '생산녹지지역', UQA430: '자연녹지지역',
  UQB001: '관리지역', UQB100: '계획관리지역', UQB200: '생산관리지역', UQB300: '보전관리지역',
  UQC001: '농림지역', UQD001: '자연환경보전지역',
} as const;
// Exact pairs observed in the approved XML response; not a prefix-based exclusion.
export const legacyNonTargets: Record<string, string> = { UQS100: '도로', UQT200: '공원', UQT220: '근린공원', UQV300: '학교',
  UNE200: '대공방어협조구역', UOA100: '교육환경보호구역', UMK600: '(한강)폐기물매립시설 설치제한지역',
  UQQ600: '토지거래계약에관한허가구역', UDT100: '정비구역', UBA100: '과밀억제권역',
  ZQ0001: '중점경관관리구역', UQQ810: '도시자연공원구역', ZA0011: '비오톱1등급', UOA110: '절대보호구역', UOA120: '상대보호구역' };

const urbanChildren = ['UQA111','UQA112','UQA121','UQA122','UQA123','UQA130','UQA210','UQA220','UQA230','UQA240','UQA310','UQA320','UQA330','UQA410','UQA420','UQA430'];
const managementChildren = ['UQB100','UQB200','UQB300'];
const documentSource = 'https://smartcity.go.kr/wp-content/uploads/2019/08/대전광역시-스마트도시계획안.pdf';
const baseDictionary: readonly RegulationCodeEntry[] = [
  ...Object.entries(zoningNames).map(([code,name]): RegulationCodeEntry => ({
    code, acceptedNames: Object.freeze([name]), category: 'zoning', legacyZoningDisplay: true,
    codeSource: code === 'UQA01X' ? '승인된 getLandUseAttr 실측 요약' : documentSource,
    codeVerification: code === 'UQA01X' ? 'api-observed' : 'official-document',
    legalSource: code === 'UQA01X' ? undefined : documentSource,
    legalVerification: code === 'UQA01X' ? 'unverified' : 'documented-type',
    sourceVersion: code === 'UQA01X' ? '2026-11-09 API 실측' : '공개 문서 표 2-2-20 (현행 코드북 아님)',
    verifiedAt: '2026-11-09', jurisdiction: '대한민국',
    parentCode: urbanChildren.includes(code) ? 'UQA01X' : managementChildren.includes(code) ? 'UQB001' : undefined,
  })),
  ...Object.entries(legacyNonTargets).map(([code,name]): RegulationCodeEntry => ({
    code, acceptedNames: Object.freeze([name]), category: 'unclassified', legacyZoningDisplay: false,
    codeSource: '승인된 getLandUseAttr XML 실측 요약', codeVerification: 'api-observed',
    legalVerification: 'unverified', sourceVersion: '2026-11-09 API 실측', verifiedAt: '2026-11-09',
  })),
];

const checkedAt = '2026-11-09'; // Investigation date, not enactment/designation date.
const codeTableUrl = 'https://law.go.kr/flDownload.do?flSeq=154497349';
const legalUrl = 'https://www.law.go.kr/LSW/LsiJoLinkP.do?docType=JO&joNo=008100000&languageType=KO&lsNm=국토의 계획 및 이용에 관한 법률&paras=1';
const officialCodeEvidence = (finding: string): VerificationEvidence => ({ status: 'confirmed',
  documentName: '산지구분타당성조사 기초자료 별표 1, 기준 레이어 및 코드', url: codeTableUrl,
  version: 'flSeq=154497349; 개정일 미확인', checkedAt, finding,
  limitations: '공식 공간정보 코드표이며 getLandUseAttr 전용 현행 코드북은 미확보. 현행성 일괄 보장 없음.' });
const unverified = (limitations: string): VerificationEvidence => ({status: 'unverified', limitations});
const apiEvidence: VerificationEvidence = {status:'confirmed', documentName:'승인된 getLandUseAttr XML/JSONP 실측 요약',
  version:'2026-11-09 시험', checkedAt, finding:'PNU 1건의 응답에서 정확한 코드·명칭 확인',
  limitations:'원본 응답 영구 보관 없음. 전국·모든 시점 및 현재 유효한 지정 보장 없음.'};
const candidates = {
  UQF110:'자연경관지구', UQJ100:'방재지구', UQJ200:'시가지방재지구', UQJ300:'자연방재지구',
  UDV100:'개발제한구역', UQQ500:'수산자원보호구역',
  // Same label as UQQ810, but a different source layer; never alias automatically.
  UQT600:'도시자연공원구역',
} as const;
export const regulationDictionary: readonly RegulationCodeEntry[] = Object.freeze([
  ...([
    ['UQA001','도시지역','zoning'], ['UQF130','시가지경관지구','district'],
    ['UQQ300','지구단위계획구역','other-designation'],
  ] as const).map(([code,name,category]): RegulationCodeEntry => ({
    code,acceptedNames:Object.freeze([name]),category,subtype:name,legacyZoningDisplay:false,
    codeVerification:'official-document',legalVerification:'documented-type',verifiedAt:checkedAt,
    codeSource:'https://www.codil.or.kr/filebank/moctroadguide/LU/CIKCLU214056/CIKCLU214056.pdf',
    sourceVersion:'과거 공식 구축지침; 기준일·현행 API 코드북 미확보',
    legalBasis:code === 'UQA001' ? '국토계획법 제36조' : code === 'UQF130' ? '국토계획법 시행령 제31조' : '국토계획법 제49조~제52조; 지구단위계획수립지침 2024-05-29',
    verification:{
      officialCode:{status:'confirmed',documentName:'토지종합정보망 도면데이터베이스 구축지침',
        url:'https://www.codil.or.kr/filebank/moctroadguide/LU/CIKCLU214056/CIKCLU214056.pdf',checkedAt,
        finding:`과거 공식 자료 검색 색인의 ${code}=${name} 대응`,
        limitations:'PDF 직접 원문 재확인 HTTP 502 실패. 기준일 미확인. 현행 API 전용 코드북 및 전국 적용성 미확인.'},
      apiObservation:{status:'confirmed',documentName:'사용자 브라우저 확인 결과',checkedAt,
        finding:code === 'UQF130' ? 'PNU 4311311400101390003에서 시가지경관지구 저촉' : 'PNU 4311311400101390003 및 4311311500115600000에서 코드·명칭 포함 확인',
        limitations:'사용자 제공 실측 요약. 이번 작업에서 API 재호출 및 원본 재검증 없음.'},
      legalType:{status:'confirmed',checkedAt,
        url:code === 'UQA001' ? 'https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1033138593' : code === 'UQF130' ? 'https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0031&lsiSeq=287269&urlMode=lsScJoRltInfoR' : 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000241690&chrClsCd=010201',
        finding:`${name}: ${category}`,limitations:'개별 지정 효력 확인 아님. 지구단위계획구역은 법정 용도구역으로 분류하지 않음.'},
    },
  })),
  ...baseDictionary.map((entry): RegulationCodeEntry => {
    const observed = !entry.legacyZoningDisplay || ['UQA01X','UQA121','UQA122'].includes(entry.code);
    const verification: RegulationVerification = {
      officialCode: entry.codeVerification === 'official-document' ? {status:'confirmed', documentName:'대전광역시 스마트도시계획 표 2-2-20',
        url:documentSource, version:'기존 공개 문서; 현행 API 코드북 아님',checkedAt,
        finding:'기존 코드·명칭 대응 유지',limitations:'현행 전국 코드북으로 해석하지 않음'} : unverified('공식 코드표 대응 미확보'),
      apiObservation: observed ? apiEvidence : unverified('해당 코드의 getLandUseAttr 실측 없음'),
      legalType: entry.legalVerification === 'documented-type' ? {status:'confirmed',documentName:'기존 용도지역 공개 코드표',url:documentSource,
        checkedAt,finding:'기존 용도지역 유형 유지',limitations:'개별 필지 지정의 현재 효력 확인 아님'} : unverified('법적 유형 미확정'),
    };
    if (entry.code !== 'UQQ810') return {...entry,verification};
    verification.officialCode = officialCodeEvidence('국토계획/구역의 UQQ810=도시자연공원구역. 기존 실측 코드·명칭과 일치');
    verification.legalType = {status:'confirmed',documentName:'국토의 계획 및 이용에 관한 법률 제38조의2',url:legalUrl,
      checkedAt,finding:'도시자연공원구역의 지정: 동일 명칭과 국토계획/구역 레이어를 교차 대조',
      limitations:'공식 코드표와 법적 유형 연결이며, 개별 지정의 현재 효력·전용 API 현행 코드북 확인 아님'};
    return {...entry,category:'zone',subtype:'도시자연공원구역',legalBasis:'국토의 계획 및 이용에 관한 법률 제38조의2',
      codeVerification:'official-document',legalVerification:'documented-type',codeSource:codeTableUrl,legalSource:legalUrl,verification};
  }),
  ...Object.entries(candidates).map(([code,name]): RegulationCodeEntry => ({code,acceptedNames:Object.freeze([name]),category:'unclassified',
    legacyZoningDisplay:false,codeVerification:'official-document',legalVerification:'unverified',codeSource:codeTableUrl,
    sourceVersion:'flSeq=154497349; 현행성 미확인',verifiedAt:checkedAt,
    verification:{officialCode:officialCodeEvidence(`${code}=${name}${code === 'UQT600' ? '; 국토계획/공간시설 레이어' : ''}`),
      apiObservation:unverified('API 실측 없음'),legalType:unverified('현행 법적 유형 및 유효성 확인 전 분류 차단')}})),
].map(entry => Object.freeze({...entry,verification: entry.verification && Object.freeze({
  officialCode:Object.freeze(entry.verification.officialCode),apiObservation:Object.freeze(entry.verification.apiObservation),legalType:Object.freeze(entry.verification.legalType)})})));

export interface ClassifiedRegulation {
  recordIndex: number; record: Readonly<Record<string, unknown>>; dictionaryEntry?: RegulationCodeEntry;
  category: RegulationCategory;
  evidence: 'official-code-and-type' | 'official-code-only' | 'api-observed-only' | 'unclassified';
  issues: ('unknown-code' | 'name-mismatch' | 'relation-mismatch' | 'legal-type-unverified')[];
  relationCode: string; relationName: string; includedInDisplay: boolean;
}
export function classifyRegulations(records: readonly Readonly<Record<string, unknown>>[]): ClassifiedRegulation[] {
  const relations: Record<string,string> = {'1':'포함','2':'저촉','3':'접함'};
  return records.map((record,recordIndex) => {
    const entry = regulationDictionary.find(item => item.code === record.prposAreaDstrcCode);
    const relationCode = String(record.cnflcAt), relationName = String(record.cnflcAtNm);
    const issues: ClassifiedRegulation['issues'] = [];
    if (!entry) issues.push('unknown-code');
    else {
      if (!entry.acceptedNames.includes(String(record.prposAreaDstrcCodeNm))) issues.push('name-mismatch');
      if (entry.legalVerification === 'unverified') issues.push('legal-type-unverified');
    }
    if (!Object.hasOwn(relations, relationCode) || relations[relationCode] !== relationName) issues.push('relation-mismatch');
    const matched = !!entry && !issues.includes('name-mismatch') && !issues.includes('relation-mismatch');
    return {recordIndex,record,dictionaryEntry:entry, category: matched ? entry.category : 'unclassified',
      evidence: !matched ? 'unclassified' : entry.codeVerification === 'official-document' && entry.legalVerification === 'documented-type' ? 'official-code-and-type' : entry.codeVerification === 'official-document' ? 'official-code-only' : 'api-observed-only',
      issues,relationCode,relationName,includedInDisplay:matched && entry.category !== 'unclassified' && relationCode !== '3'};
  });
}
