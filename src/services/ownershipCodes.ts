/** V-World 국가중점데이터 컬럼정의서. 운영 WFS 코드북 버전은 미확인이다. */
export const ownershipCodes = {
  '00': {officialName:'일본인, 창씨명등',category:'other'},
  '01': {officialName:'개인',category:'individual'},
  '02': {officialName:'국유지',category:'national'},
  '03': {officialName:'외국인, 외국공공기관',category:'other'},
  '04': {officialName:'시, 도유지',category:'public'},
  '05': {officialName:'군유지',category:'municipal'},
  '06': {officialName:'법인',category:'corporation'},
  '07': {officialName:'종중',category:'clan'},
  '08': {officialName:'종교단체',category:'other'},
  '09': {officialName:'기타단체',category:'other'},
} as const;

/** 앞자리 0, 공백 등 원본을 정규화하지 않는다. 정의되지 않은 값은 미확인이다. */
export function ownershipCodeDefinition(code:unknown) {
  return typeof code==='string' && Object.prototype.hasOwnProperty.call(ownershipCodes,code)
    ? ownershipCodes[code as keyof typeof ownershipCodes] : null;
}
