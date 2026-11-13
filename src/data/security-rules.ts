import type { Limits } from "../schema/defs/limits";

/**
 * Realtime Database 보안 규칙을 만든다. 숫자는 limits에서만 온다.
 * `npm run build:rules`가 이 결과를 database.rules.json으로 쓴다(직접 고치지 않는다).
 *
 * 원칙
 * - 내 캐릭터는 나만, 정의·세계는 GM만. GM 목록(/gm)은 관리 도구로만 고친다.
 * - 플레이어가 캐릭터의 값을 바꾸려면 같은 쓰기 안에서
 *   ① 수정 번호(meta/rev)를 정확히 1 올리고 ② 새 요청 기록(/requests)을 남겨야 한다.
 *   그래서 이전 값을 보고 계산한 쓰기와, 같은 요청 ID를 다시 쓰는 쓰기는 거절된다.
 * - 범위 밖 값(음수 지갑·수량, 한 번에 너무 많이 느는 값)은 저장되지 않는다.
 */
type Rules = { [key: string]: Rules | string | boolean | string[] };

const KEY = "/^[A-Za-z0-9_-]+$/";

export function buildSecurityRules(limits: Limits): { rules: Rules } {
  const cap = limits.exchange;
  const AUTH = "auth != null";
  const GM = `(${AUTH} && root.child('gm').child(auth.uid).val() === true)`;
  const ownerOf = (cid: string) => `(${AUTH} && root.child('characters').child(${cid}).child('meta/owner').val() === auth.uid)`;
  const OWNER = ownerOf("$cid");
  const before = "root.child('characters').child($cid)";

  /** depth: 규칙이 놓인 곳에서 /characters/$cid 까지 올라가는 단계 수 */
  const up = (depth: number) => "newData" + ".parent()".repeat(depth);
  const envelope = (depth: number) => {
    const charAfter = up(depth);
    const rootAfter = up(depth + 2);
    const requestId = `${charAfter}.child('meta/lastRequestId').val()`;
    const revBumped = `${charAfter}.child('meta/rev').val() === ${before}.child('meta/rev').val() + 1`;
    const newRequest =
      `${charAfter}.child('meta/lastRequestId').isString()` +
      ` && ${rootAfter}.child('requests').child($cid).child(${requestId}).exists()` +
      ` && !root.child('requests').child($cid).child(${requestId}).exists()`;
    return `${revBumped} && ${newRequest}`;
  };
  /** 플레이어가 자기 캐릭터의 이 칸을 바꿀 수 있는 조건 */
  const ownerWrite = (depth: number, extra = "") => `${OWNER} && ${envelope(depth)}${extra}`;

  const int = (min: number, max: number) =>
    `newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= ${min} && newData.val() <= ${max}`;
  const gainAtMost = (max: number) => `(${GM} || newData.val() - (data.exists() ? data.val() : 0) <= ${max})`;
  const quality = "newData.val() === '하' || newData.val() === '중' || newData.val() === '상' || newData.val() === '최상'";
  const oneOf = (name: string, values: string[]) => values.map((v) => `${name} === '${v}'`).join(" || ");

  const stack: Rules = {
    ".validate": "newData.hasChildren(['itemId', 'quantity', 'freshness', 'quality'])",
    itemId: { ".validate": "newData.isString()" },
    quantity: { ".validate": `${int(1, cap.maxStackQuantity)} && ${gainAtMost(cap.maxQuantityGainPerChange)}` },
    freshness: { ".validate": int(0, 100) },
    quality: { ".validate": quality },
    $other: { ".validate": false },
  };
  const unique: Rules = {
    ".validate": "newData.hasChildren(['itemId', 'enhance', 'durability', 'quality'])",
    itemId: { ".validate": "newData.isString()" },
    enhance: { ".validate": int(0, 20) },
    durability: { ".validate": int(0, 100) },
    quality: { ".validate": quality },
    $other: { ".validate": false },
  };

  const character: Rules = {
    ".read": `${OWNER} || ${GM}`,
    // 만들기·지우기·통째로 고치기는 GM만. 플레이어는 아래 칸마다 정해진 조건으로만.
    ".write": GM,
    meta: {
      rev: { ".write": ownerWrite(2, " && newData.exists()"), ".validate": int(0, Number.MAX_SAFE_INTEGER) },
      lastRequestId: { ".write": ownerWrite(2, " && newData.exists()"), ".validate": `newData.isString() && newData.val().matches(${KEY})` },
    },
    abilities: {
      ".write": ownerWrite(1, " && newData.exists()"),
      $ability: {
        ".validate": `(${oneOf("$ability", ["health", "spirit", "credit", "connections", "reputation"])}) && ${int(limits.abilities.min, limits.abilities.max)}`,
      },
    },
    mastery: {
      ".write": ownerWrite(1),
      $skill: {
        ".validate": "newData.hasChildren(['value', 'passed60', 'passed80'])",
        value: { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 100" },
        passed60: { ".validate": "newData.isBoolean()" },
        passed80: { ".validate": "newData.isBoolean()" },
        $other: { ".validate": false },
      },
    },
    trees: { ".write": ownerWrite(1) },
    loadout: { ".write": ownerWrite(1) },
    wallet: {
      ".write": ownerWrite(1, " && newData.exists()"),
      ".validate": `${int(0, cap.walletMax)} && ${gainAtMost(cap.maxWalletGainPerChange)}`,
    },
    bag: {
      ".write": ownerWrite(1),
      stacks: { $key: { ...stack, ".validate": `$key.matches(${KEY}) && ${stack[".validate"] as string}` } },
      uniques: { $key: { ...unique, ".validate": `$key.matches(${KEY}) && ${unique[".validate"] as string}` } },
      $other: { ".validate": false },
    },
    month: {
      ".write": ownerWrite(1, " && newData.exists()"),
      ".validate": "newData.hasChildren(['key', 'mainActions', 'minorActions', 'savedActions', 'career'])",
      key: { ".validate": "newData.isString()" },
      mainActions: { ".validate": int(0, limits.month.mainActions) },
      minorActions: { ".validate": int(0, limits.month.minorActions) },
      savedActions: { ".validate": int(0, limits.month.savedActionsMax) },
      career: { ".validate": int(0, limits.month.careerMax) },
    },
    claimedRewards: {
      // 받은 보상은 더하기만 된다. 지우면 같은 보상을 또 받을 수 있으므로 지우기는 GM만.
      $reward: { ".write": ownerWrite(2, " && !data.exists()"), ".validate": `$reward.matches(${KEY}) && newData.val() === true` },
    },
    mailbox: {
      ".write": ownerWrite(1),
      $mail: {
        ".validate": `$mail.matches(${KEY}) && newData.child('expiresAt').isNumber()`,
        stack: { ...stack, quantity: { ".validate": int(1, cap.maxStackQuantity) } },
        unique: { ".validate": "newData.hasChildren(['uniqueId', 'item'])", item: unique },
      },
    },
  };

  // /requests, /ledger 에서 본 쓰기 뒤의 루트: $cid/$rid 두 단계 + 맨 위 한 단계
  const rootAfter = up(3);
  const requestCreatedNow =
    `${rootAfter}.child('requests').child($cid).child($rid).exists()` + ` && !root.child('requests').child($cid).child($rid).exists()`;

  return {
    rules: {
      ".read": false,
      ".write": false,
      gm: { ".read": AUTH },
      defs: { ".read": AUTH, ".write": GM },
      world: { ".read": AUTH, ".write": GM },
      accounts: { $uid: { ".read": `(${AUTH} && auth.uid === $uid) || ${GM}`, ".write": GM } },
      characters: { ".read": GM, $cid: character },
      requests: {
        $cid: {
          ".read": `${OWNER} || ${GM}`,
          $rid: {
            // 한 번 남긴 요청 기록은 고치거나 지울 수 없다
            ".write":
              `${OWNER} && !data.exists() && newData.exists()` +
              ` && ${rootAfter}.child('characters').child($cid).child('meta/lastRequestId').val() === $rid`,
            ".validate":
              `$rid.matches(${KEY}) && newData.hasChildren(['at', 'kind'])` +
              " && newData.child('at').isNumber() && newData.child('at').val() <= now + 300000 && newData.child('kind').isString()",
          },
        },
      },
      ledger: {
        $cid: {
          ".read": `${OWNER} || ${GM}`,
          ".indexOn": ["at"],
          $rid: {
            // 장부는 덧붙이기만. 요청 기록과 같은 쓰기 안에서만 남길 수 있다
            ".write": `${OWNER} && !data.exists() && newData.exists() && ${requestCreatedNow}`,
            ".validate":
              "newData.hasChildren(['at', 'requestId', 'reason', 'walletDelta', 'walletAfter'])" +
              " && newData.child('requestId').val() === $rid && newData.child('reason').isString()" +
              " && newData.child('walletDelta').isNumber()" +
              ` && newData.child('walletAfter').val() === ${rootAfter}.child('characters').child($cid).child('wallet').val()`,
          },
        },
      },
    },
  };
}
