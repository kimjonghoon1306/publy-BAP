import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const client = read("src/lib/supabase.ts");
const screen = read("src/components/Place360.tsx");
const crawlScreen = read("src/components/CrawlCenter.tsx");
const metricsSql = read("supabase/migrations/20260828160000_place360_business_metrics.sql");
const storesSql = read("supabase/migrations/20260828170000_place360_store_profiles.sql");

const requireText = (source, text, label) => {
  if (!source.includes(text)) throw new Error(`place360 contract missing: ${label}`);
};

requireText(client, "free: 1, basic: 2, pro: 5", "client store limits");
requireText(storesSql, "when 'basic' then 2 when 'pro' then 5", "server store limits");
requireText(storesSql, "publy_place360_enforce_store_limit", "unified store limit trigger");
requireText(storesSql, "publy_place360_save_store", "server store save RPC");
requireText(storesSql, "publy_place360_get_stores", "cross-device store list RPC");
requireText(storesSql, "publy_place360_delete_store", "member-owned store delete RPC");
requireText(metricsSql, "INVALID_ADMIN_SESSION", "admin metrics authorization");
requireText(client, 'supabase.rpc("publy_place360_save_business_metrics"', "metrics client RPC");
requireText(screen, "최근30일,0,0,0,0,0", "CSV current-period template");
requireText(screen, "이전30일,0,0,0,0,0", "CSV previous-period template");
requireText(screen, 'new TextDecoder("euc-kr"', "Windows Korean CSV fallback");
requireText(screen, "매출 감소만으로 유동인구 감소라고 단정할 수 없어요", "traffic inference warning");
requireText(crawlScreen, '{plan !== "admin" && <div className="ob-plan-table"', "crawl plan table remains visible to every member plan");
requireText(crawlScreen, '(["free", "basic", "pro"] as const)', "crawl plan table excludes internal unlimited row");

console.log("place360 contract test: PASS");
