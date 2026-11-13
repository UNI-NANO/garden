/** 데이터베이스 경로. 경로 문자열은 여기서만 만든다. */
export const paths = {
  gm: (uid: string) => `gm/${uid}`,
  character: (characterId: string) => `characters/${characterId}`,
  characterPart: (characterId: string, part: string) => `characters/${characterId}/${part}`,
  request: (characterId: string, requestId: string) => `requests/${characterId}/${requestId}`,
  ledger: (characterId: string, requestId: string) => `ledger/${characterId}/${requestId}`,
};
