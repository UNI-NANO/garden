// 보안 규칙 파일(database.rules.json)을 범위와 상한(data/defs/limits.json)에서 만든다.
//   npm run build:rules
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSecurityRules } from "../src/data/security-rules";
import { LimitsSchema } from "../src/schema/defs/limits";

const root = join(import.meta.dirname, "..");
const limits = LimitsSchema.parse(JSON.parse(readFileSync(join(root, "data", "defs", "limits.json"), "utf8")));
writeFileSync(join(root, "database.rules.json"), JSON.stringify(buildSecurityRules(limits), null, 2) + "\n");
console.log("database.rules.json을 새로 썼다");
