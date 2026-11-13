/**
 * 비공개 데이터가 저장소에 들어오지 않게 지킨다.
 * 옛 Firebase 내보내기 파일과 변환 결과(캐릭터 데이터)는 비공개 저장소 garden-data에만 둔다.
 */
export interface TrackedFile {
  path: string;
  /** 파일 내용. JSON 파일만 넘기면 된다 */
  content?: string | undefined;
}

const FORBIDDEN_PATHS: { pattern: RegExp; why: string }[] = [
  { pattern: /export[^/]*\.json$/i, why: "내보내기 파일로 보이는 이름" },
  { pattern: /(^|\/)migration-out\//, why: "변환 결과 폴더" },
];
/** 옛 사이트의 저장 키. 내보내기 파일이나 그 일부에만 나온다 */
const OLD_STORE_KEY = /"jpg-(home|btl|story|day|town)-[^"]*"\s*:/;
/** 견본(가짜 데이터)은 허용한다 */
const ALLOWED = /^tests\/fixtures\/.*\.sample\.json$/;

export function findPrivateData(files: readonly TrackedFile[]): { path: string; why: string }[] {
  const found: { path: string; why: string }[] = [];
  for (const file of files) {
    if (ALLOWED.test(file.path)) continue;
    const byPath = FORBIDDEN_PATHS.find((rule) => rule.pattern.test(file.path));
    if (byPath) {
      found.push({ path: file.path, why: byPath.why });
      continue;
    }
    if (file.path.endsWith(".json") && file.content !== undefined && OLD_STORE_KEY.test(file.content)) {
      found.push({ path: file.path, why: "옛 사이트의 저장 데이터가 들어 있음" });
    }
  }
  return found;
}
