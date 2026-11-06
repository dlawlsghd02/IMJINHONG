export function readEnvironment(): { vworldApiKey: string; vworldDomain?: string } {
  const vworldApiKey = import.meta.env.VITE_VWORLD_API_KEY?.trim() ?? '';
  if (!vworldApiKey) {
    throw new Error('V-World 인증키가 없습니다. .env.example을 .env.local로 복사하고 VITE_VWORLD_API_KEY를 설정한 뒤 서버를 다시 시작하세요.');
  }
  const vworldDomain = import.meta.env.VITE_VWORLD_DOMAIN?.trim() || undefined;
  // 지적 전용 설정 검증은 요청 어댑터에서 수행해 기본 지도·검색을 유지한다.
  return { vworldApiKey, vworldDomain };
}
