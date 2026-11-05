export function readEnvironment(): { vworldApiKey: string } {
  const vworldApiKey = import.meta.env.VITE_VWORLD_API_KEY?.trim() ?? '';
  if (!vworldApiKey) {
    throw new Error('V-World 인증키가 없습니다. .env.example을 .env.local로 복사하고 VITE_VWORLD_API_KEY를 설정한 뒤 서버를 다시 시작하세요.');
  }
  return { vworldApiKey };
}
