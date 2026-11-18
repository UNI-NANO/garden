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
  const SELF = `(${AUTH} && auth.uid === $uid)`;
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
    failStreak: { ".validate": int(0, 1000) },
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
      // 주인은 세계의 이번 달에, 계산 중이 아닐 때만, 행동을 줄이기만 한다. 달 넘기기(행동 다시 채우기)는 하루 계산(관리자)과 GM만
      ".write": ownerWrite(
        1,
        " && newData.exists()" +
          " && root.child('world/clock/computing').val() === false" +
          " && newData.child('key').val() === root.child('world/clock/monthKey').val()" +
          " && newData.child('key').val() === data.child('key').val()" +
          " && newData.child('mainActions').val() <= data.child('mainActions').val()" +
          " && newData.child('minorActions').val() <= data.child('minorActions').val()" +
          " && newData.child('savedActions').val() <= data.child('savedActions').val()" +
          " && newData.child('career').val() >= data.child('career').val()",
      ),
      ".validate": "newData.hasChildren(['key', 'mainActions', 'minorActions', 'savedActions', 'career'])",
      key: { ".validate": "newData.isString()" },
      mainActions: { ".validate": int(0, limits.month.mainActions) },
      minorActions: { ".validate": int(0, limits.month.minorActions) },
      savedActions: { ".validate": int(0, limits.month.savedActionsMax) },
      career: { ".validate": int(0, limits.month.careerMax) },
      // 오늘의 피로: 주인은 올리기만 (내리면 보상 곡선을 피한다). 하루마다 0으로는 하루 계산(관리자)이
      fatigue: {
        $field: { ".validate": `$field.matches(${KEY}) && ${int(0, 1000)} && (${GM} || newData.val() >= (data.exists() ? data.val() : 0))` },
      },
    },
    // 진행 중인 던전 탐험 (명세서 「던전」). 만들기·지우기는 수정 번호·요청 기록과 함께(들어가기·정산),
    // 진행 저장은 같은 탐험 ID·씨앗·시작 시각일 때만. 돈·물건은 정산 때 「주고받기」로만 가방에 들어간다
    expedition: {
      ".write":
        `${OWNER} && ((${envelope(1)} && (!data.exists() || !newData.exists()))` +
        " || (data.exists() && newData.exists() && newData.child('id').val() === data.child('id').val()" +
        " && newData.child('seed').val() === data.child('seed').val() && newData.child('startedAt').val() === data.child('startedAt').val()))",
      ".validate":
        "newData.hasChildren(['id', 'dungeonId', 'seed', 'startedAt', 'floor', 'at', 'hp', 'maxHp', 'status'])" +
        ` && newData.child('id').isString() && newData.child('id').val().matches(${KEY})` +
        " && newData.child('startedAt').isNumber() && newData.child('startedAt').val() <= now + 300000",
    },
    // 배운 레시피: 주인은 수정 번호와 함께 더하기만
    recipes: {
      $recipe: { ".write": ownerWrite(2, " && !data.exists() && newData.exists()"), ".validate": `$recipe.matches(${KEY}) && newData.val() === true` },
    },
    // 내 기록 (가장 큰 물고기 등): 주인은 수정 번호와 함께, 커지기만
    records: {
      fish: {
        $item: {
          ".write": ownerWrite(3, " && newData.exists()"),
          ".validate": `$item.matches(${KEY}) && newData.isNumber() && newData.val() > 0 && newData.val() <= 10000 && (!data.exists() || newData.val() > data.val())`,
        },
      },
    },
    // 일생 기록: 주인은 한 줄씩 덧붙이기만
    life: {
      $n: {
        ".write": ownerWrite(2, " && !data.exists() && newData.exists()"),
        ".validate": "newData.hasChildren(['kind', 'text']) && newData.child('text').isString()",
      },
    },
    // 장면 결과 (명세서 「장면」: 끝날 때 한 번에). 본 장면은 더하기만: 지우면 같은 결과를 또 받을 수 있다
    scenes: {
      $scene: {
        ".write": ownerWrite(2, " && !data.exists() && newData.exists()"),
        ".validate": `$scene.matches(${KEY}) && newData.child('at').isNumber() && newData.child('at').val() <= now + 300000`,
      },
    },
    profile: { marks: { ".write": ownerWrite(2) } },
    people: {
      ".write": ownerWrite(1),
      $person: { ".validate": `$person.matches(${KEY}) && newData.child('name').isString() && newData.child('intimacy').isNumber()` },
    },
    clues: { ".write": ownerWrite(1) },
    quests: { ".write": ownerWrite(1) },
    pendingResults: { ".write": ownerWrite(1) },
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

  // 구역 대화: 같은 구역(캐릭터 위치의 zone, 없으면 도서관)의 캐릭터 주인만 읽고 쓴다
  const chat = limits.chat;
  const MY_CID = "root.child('accounts').child(auth.uid).child('characterId').val()";
  const zoneOf = (cid: string) => {
    const zone = `root.child('characters').child(${cid}).child('profile/location/zone')`;
    return `(${zone}.exists() ? ${zone}.val() : 'library')`;
  };
  const IN_ZONE = (zone: string) => `(${AUTH} && ${MY_CID} != null && ${zoneOf(MY_CID)} === ${zone})`;
  const NOT_MUTED = `(!root.child('chatMutes').child(${MY_CID}).exists() || root.child('chatMutes').child(${MY_CID}).val() <= now)`;
  /** 같은 쓰기에서 /chatRate/{uid}를 이 줄의 시각으로 올리고, 앞 줄과 최소 간격을 지킨다 */
  const rateOk = (rootAfterLine: string) =>
    `${rootAfterLine}.child('chatRate').child(auth.uid).val() === newData.child('at').val()` +
    ` && (!root.child('chatRate').child(auth.uid).exists() || newData.child('at').val() - root.child('chatRate').child(auth.uid).val() >= ${chat.minGapMs})`;
  const line = (extra: string[]) =>
    `newData.hasChildren(['at', 'uid', 'cid', 'name', 'text'${extra.map((e) => `, '${e}'`).join("")}])` +
    " && newData.child('at').isNumber() && newData.child('at').val() <= now + 60000 && newData.child('at').val() >= now - 60000" +
    ` && newData.child('uid').val() === auth.uid && newData.child('cid').val() === ${MY_CID}` +
    " && newData.child('name').isString() && newData.child('name').val().length <= 40" +
    ` && newData.child('text').isString() && newData.child('text').val().length >= 1 && newData.child('text').val().length <= ${chat.maxLength}`;
  const rootAfterLine = "newData.parent().parent().parent()";

  // 투기장: 순위표는 로그인한 사람 모두 읽고, 자기 칸만 고친다. 점수·승패는 「결투」 요청과 같은 쓰기에서만, 한 번에 k 이하로
  const arena = limits.arena;
  const arenaRoot = up(4); // /arena/$season/entries/$cid 에서 본 쓰기 뒤의 루트
  const arenaRid = `${arenaRoot}.child('characters').child($cid).child('meta/lastRequestId').val()`;
  const arenaRequestNow =
    `${arenaRoot}.child('characters').child($cid).child('meta/lastRequestId').isString()` +
    ` && ${arenaRoot}.child('requests').child($cid).child(${arenaRid}).exists()` +
    ` && !root.child('requests').child($cid).child(${arenaRid}).exists()`;
  const arenaKind = `${arenaRoot}.child('requests').child($cid).child(${arenaRid}).child('kind').val()`;
  const field = (name: string) => `newData.child('${name}').val()`;
  const was = (name: string) => `data.child('${name}').val()`;
  const arenaEntry: Rules = {
    ".write": `${OWNER} && newData.exists() && ${arenaRequestNow}`,
    ".validate":
      "newData.hasChildren(['build', 'registeredAt', 'score', 'wins', 'losses'])" +
      ` && (!data.exists() ? (${field("score")} === ${arena.startScore} && ${field("wins")} === 0 && ${field("losses")} === 0)` +
      ` : ${arenaKind} === '결투'` +
      ` ? (${field("score")} - ${was("score")} <= ${arena.k} && ${was("score")} - ${field("score")} <= ${arena.k}` +
      ` && ${field("wins")} + ${field("losses")} === ${was("wins")} + ${was("losses")} + 1 && ${field("wins")} >= ${was("wins")} && ${field("losses")} >= ${was("losses")})` +
      ` : (${field("score")} === ${was("score")} && ${field("wins")} === ${was("wins")} && ${field("losses")} === ${was("losses")}))`,
    build: { ".validate": "newData.hasChildren(['name', 'health', 'treeId', 'treeVersion', 'mastery']) && newData.child('name').isString() && newData.child('name').val().length <= 40" },
    registeredAt: { ".validate": "newData.isNumber() && newData.val() <= now + 300000" },
    score: { ".validate": int(0, arena.maxScore) },
    wins: { ".validate": int(0, Number.MAX_SAFE_INTEGER) },
    losses: { ".validate": int(0, Number.MAX_SAFE_INTEGER) },
    $other: { ".validate": false },
  };
  const logRoot = up(5); // /arena/$season/log/$cid/$rid
  const arenaLogLine: Rules = {
    // 도전한 사람이 자기 「결투」 요청과 같은 쓰기에서 상대의 기록에 한 줄 덧붙인다
    ".write":
      `${AUTH} && !data.exists() && newData.exists() && ${MY_CID} != null && $cid !== ${MY_CID}` +
      ` && newData.child('from').val() === ${MY_CID}` +
      ` && ${logRoot}.child('requests').child(${MY_CID}).child($rid).exists() && !root.child('requests').child(${MY_CID}).child($rid).exists()`,
    ".validate":
      `$rid.matches(${KEY}) && newData.hasChildren(['at', 'from', 'fromName', 'challengerWon'])` +
      " && newData.child('at').isNumber() && newData.child('at').val() <= now + 300000" +
      " && newData.child('fromName').isString() && newData.child('fromName').val().length <= 40 && newData.child('challengerWon').isBoolean()",
  };

  return {
    rules: {
      ".read": false,
      chat: {
        $zone: {
          ".read": `${GM} || ${IN_ZONE("$zone")}`,
          ".indexOn": ["at"],
          $id: {
            // 남긴 말은 고치거나 지울 수 없다 (지우기는 하루 계산의 정리만)
            ".write": `${IN_ZONE("$zone")} && !data.exists() && newData.exists() && ${NOT_MUTED} && ${rateOk(rootAfterLine)}`,
            ".validate": `$id.matches(${KEY}) && ${line(["kind"])} && (newData.child('kind').val() === '말' || newData.child('kind').val() === '표정')`,
          },
        },
      },
      whispers: {
        $cid: {
          ".read": `${GM} || ${OWNER}`,
          $id: {
            // 같은 구역의 한 사람에게. 받는 쪽과 보낸 쪽 사본을 같은 쓰기로
            ".write":
              `${AUTH} && !data.exists() && newData.exists() && ${NOT_MUTED} && ${rateOk(rootAfterLine)}` +
              ` && ${zoneOf("newData.child('to').val()")} === ${zoneOf(MY_CID)}` +
              ` && ($cid === newData.child('to').val() || $cid === ${MY_CID})`,
            ".validate": `$id.matches(${KEY}) && ${line(["to", "toName"])} && newData.child('to').isString() && newData.child('toName').isString()`,
          },
        },
      },
      chatRate: {
        $uid: {
          ".read": SELF,
          ".write": `${SELF} && newData.isNumber() && newData.val() <= now + 60000 && newData.val() >= now - 60000`,
        },
      },
      // 말 막기: GM만. 막힌 동안은 말·귓속말을 쓸 수 없다
      chatMutes: { ".read": AUTH, ".write": GM, $cid: { ".validate": "newData.isNumber()" } },
      chatReports: {
        ".read": GM,
        $id: {
          ".write": `${AUTH} && !data.exists() && newData.exists() && newData.child('by').val() === auth.uid`,
          ".validate": `$id.matches(${KEY}) && newData.hasChildren(['at', 'by', 'zone', 'line']) && newData.child('at').isNumber()`,
        },
      },
      ".write": false,
      arena: {
        $season: {
          entries: { ".read": AUTH, $cid: arenaEntry },
          log: { $cid: { ".read": `${OWNER} || ${GM}`, $rid: arenaLogLine } },
        },
      },
      gm: { ".read": AUTH },
      defs: { ".read": AUTH, ".write": GM },
      world: { ".read": AUTH, ".write": GM },
      // 비밀(드러나지 않은 타고난 재능 등)은 GM만 읽고 쓴다. 주인도 읽지 못한다.
      secrets: { ".read": GM, ".write": GM },
      accounts: {
        ".read": GM,
        $uid: {
          ".read": `${SELF} || ${GM}`,
          ".write": GM,
          // 본인은 자기 계정 기록을 만들고 표시 이름·마지막 접속만 고친다. 캐릭터 연결은 GM만.
          displayName: { ".write": SELF, ".validate": "newData.isString() && newData.val().length <= 80" },
          createdAt: { ".write": `${SELF} && !data.exists() && newData.exists()`, ".validate": "newData.isNumber() && newData.val() <= now + 300000" },
          lastSeenAt: { ".write": `${SELF} && newData.exists()`, ".validate": "newData.isNumber() && newData.val() <= now + 300000" },
          characterId: { ".validate": `newData.isString() && newData.val().matches(${KEY})` },
          $other: { ".validate": false },
        },
      },
      // 화면 오류 기록: 로그인한 사람이 자기 것을 덧붙이기만. 읽기는 GM만.
      errors: {
        ".read": GM,
        $id: {
          ".write": `${AUTH} && !data.exists() && newData.exists() && newData.child('uid').val() === auth.uid`,
          ".validate":
            `$id.matches(${KEY}) && newData.hasChildren(['at', 'uid', 'message'])` +
            " && newData.child('at').isNumber() && newData.child('message').isString() && newData.child('message').val().length <= 2000",
        },
      },
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
