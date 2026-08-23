import React, { useState, useEffect, useRef, useCallback } from "react";
import { botFetch, BotEventStream } from "../lib/botApi";
import { getReplyDailyUsage, incrementReplyQuota, REPLY_DAILY_LIMIT, getBlogscoreDailyUsage, incrementBlogscoreQuota, BLOGSCORE_DAILY_LIMIT, PUMASI_ACCOUNT_LIMIT, PUMASI_POSTS_LIMIT, getPumasiDailyUsage } from "../lib/supabase";

const BOT = "http://127.0.0.1:3334";

// ★LogBox는 컴포넌트 밖에 고정 정의(테리 요청: 로그 스크롤이 위로 튀는 버그).
//   NeighborPage 안에 정의하면 부모 리렌더마다 새 컴포넌트로 취급→통째 리마운트→스크롤 위치가 맨 위로 리셋됐다.
//   밖으로 빼면 같은 컴포넌트로 유지돼 사용자가 스크롤한 위치가 그대로 남는다.
const LogBox = ({ logs, logRef, onClear }: { logs: string[]; logRef: React.RefObject<HTMLDivElement>; onClear: () => void }) => {
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    const text = logs.join("\n");
    if (!text) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 API 실패 시 폴백(구형/권한): 임시 textarea로 복사
      try { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); document.body.removeChild(ta); if (!ok) throw new Error("copy failed"); }
      catch { alert("로그 복사에 실패했어요. 로그를 드래그해 직접 복사해주세요."); return; }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
  <div className="card" style={{ padding: 0, overflow: "hidden" }}>
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div className="card-title" style={{ margin: 0 }}>📟 작업 로그</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={copyAll} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: copied ? "rgba(0,200,150,.12)" : "transparent", color: copied ? "#00c896" : "var(--text2)", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 700 }}>{copied ? "✅ 복사되었습니다" : "📋 전체 복사"}</button>
        <button onClick={onClear} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>지우기</button>
      </div>
    </div>
    {/* userSelect:text + WebkitUserSelect:text → Electron에서도 드래그로 로그 직접 복사 가능 */}
    <div ref={logRef} style={{ height: "min(62vh, 720px)", minHeight: 360, overflowY: "auto", padding: "14px 18px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, lineHeight: 1.85, background: "#050a0f", userSelect: "text", WebkitUserSelect: "text", cursor: "text" }}>
      {logs.length === 0 ? <span style={{ color: "#3a5a7a" }}>대기 중...</span> : logs.map((l, i) => (
        <div key={i} style={{ color: l.includes("✅")||l.includes("🎉")||l.includes("❤️")||l.includes("💬") ? "#00d68f" : l.includes("❌")||l.includes("🚫") ? "#ff5363" : l.includes("⏭️") ? "#7a9ab5" : "#00c8ff", userSelect: "text", WebkitUserSelect: "text" }}>{l}</div>
      ))}
    </div>
  </div>
  );
};

/* ── 숫자 입력 헬퍼: 앞자리 0 고정/첫 숫자 안지워짐 버그 방지 (빈 값 허용, blur 시 기본값 복원) ── */
function numProps(val: number, set: (n: number) => void, min: number, max: number, def: number) {
  return {
    value: val === 0 ? "" : val,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/[^0-9]/g, "");
      set(v === "" ? 0 : Math.min(max, Number(v)));
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      if (!e.target.value || Number(e.target.value) < min) set(def);
    },
  };
}

/* ── 타입 ── */
interface Account { accountId: string; id: string; pw: string; blogId: string; sessionOk: boolean; loginLoading: boolean; showPw: boolean; }
interface Target { keyword: string; blogId: string; nickName?: string; blogName?: string; addDate?: number; postUrl?: string; thumbnail?: string; }
interface WorkResult { keyword: string; blogId: string; nickName?: string; blogName?: string; addDate?: number; postUrl?: string; thumbnail?: string; status: "success"|"fail"|"skip"|"limit"|"pending"|"running"; message: string; }

// 최근 글 작성일 → 상대시간 (활동성 한눈에)
function relTime(ms?: number): string {
  if (!ms) return "";
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "오늘";
  if (d === 1) return "어제";
  if (d < 30) return `${d}일 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// 체험단 모집용 서이추 멘트 프리셋 — 순환 사용으로 도배·스팸 탐지 회피. pick.온종일.com = 온종일체험단
const CAMPAIGN_LINK = "pick.온종일.com";
const CAMPAIGN_PRESETS = [
  `안녕하세요 😊 블로그 글 잘 보고 있어요! 서로이웃 신청드려요~ 혹시 무료 체험단·협찬에 관심 있으시면 '온종일체험단'(${CAMPAIGN_LINK}) 한번 놀러오세요 🎁`,
  `포스팅에 정성이 가득하네요 👍 서이추 해요! 맛집·뷰티·생활용품 무료 체험 원하시면 ${CAMPAIGN_LINK} 에서 신청할 수 있어요 :)`,
  `좋은 글 잘 읽었습니다 ✨ 이웃 신청드려요! 체험단 활동 좋아하시면 온종일체험단(${CAMPAIGN_LINK})도 추천드려요~`,
  `반가워요~ 글 잘 보고 갑니다 😊 서로이웃해요! 무료 체험단 관심 있으시면 ${CAMPAIGN_LINK} 놀러오세요~`,
  `블로그 분위기가 참 좋네요 🌿 이웃 신청할게요! 협찬·체험단 활동은 온종일체험단(${CAMPAIGN_LINK})에서 만나요 :)`,
  `유익한 정보 감사합니다 🙌 서이추 신청드려요! 무료 체험 제품 받아보고 싶으시면 ${CAMPAIGN_LINK} 확인해보세요~`,
  `꾸준한 포스팅 멋져요 👏 서로이웃 해요! 맛집·뷰티 체험단 찾으시면 온종일체험단(${CAMPAIGN_LINK}) 추천해요 🎁`,
  `글 잘 보고 이웃 신청드려요 😄 혹시 체험단·협찬에 관심 있으신가요? ${CAMPAIGN_LINK} 에서 무료로 신청 가능해요!`,
  `안녕하세요! 자주 들를게요 ☺️ 서이추 신청드립니다~ 무료 체험단 소식은 온종일체험단(${CAMPAIGN_LINK})에서 받아보세요`,
  `포스팅 잘 봤어요 💕 서로이웃 신청해요! 협찬 제품 무료로 받고 싶으시면 ${CAMPAIGN_LINK} 놀러오세요~`,
  `좋은 이웃이 되고 싶어 신청드려요 🤝 체험단 활동 관심 있으시면 온종일체험단(${CAMPAIGN_LINK})도 함께해요!`,
];
// 기본 멘트(복원용) — 사용자가 수정해도 이 값으로 되돌릴 수 있게 상수로 보관
const DEFAULT_SINGLE_MSG = "안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊";
const DEFAULT_MULTI_MSGS = "안녕하세요! 좋은 글 잘 읽고 갑니다. 서이추 신청드려요 😊\n공감가는 글이 많네요. 서이추 해요!\n좋은 정보 잘 보고 갑니다. 이웃 신청드려요^^";
interface EngageResult { keyword: string; blogId: string; postUrl: string; liked: boolean; commented: boolean; status: "success"|"fail"|"skip"|"pending"|"running"; message: string; }
// 상단·사이드바 배지와 동일한 플랜별 하루 한도 (lib/supabase.ts의 NEIGHBOR/ENGAGE_DAILY_LIMIT와 일치)
const DAILY_LIMIT_BY_PLAN: Record<string, number> = { free: 10, basic: 50, pro: 100, admin: 9999 };
interface Props { theme: "dark"|"light"; userId?: string; plan?: string; initialTab?: "neighbor"|"engage"|"reply"|"score"|"pumasi"; singleTab?: boolean; onEngageUsageChange?: (used:number)=>void; initialNeighborUsed?: number; initialEngageUsed?: number; onBusyChange?: (busy:boolean)=>void; }

/* ── 내 이웃 키워드 분석 카드 (서이추·공감댓글 공용) ── */
const KeywordAnalyzer = ({ keywords, loading, onAnalyze, onPick }: {
  keywords: { word: string; count: number }[];
  loading: boolean;
  onAnalyze: () => void;
  onPick: (word: string) => void;
}) => {
  const maxC = keywords[0]?.count || 1;
  return (
    <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: "var(--bg2)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: keywords.length ? 10 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>🔎 내 이웃 관심 키워드</span>
        <button onClick={onAnalyze} disabled={loading}
          style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: loading ? "var(--card2)" : "var(--accent-bg)", color: "var(--accent-text)", cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
          {loading ? "분석 중..." : "분석하기"}
        </button>
      </div>
      {keywords.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>이웃들이 자주 쓰는 주제예요. 클릭하면 키워드에 추가됩니다.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {keywords.map(k => (
              <button key={k.word} onClick={() => onPick(k.word)}
                style={{ padding: "5px 10px", borderRadius: 99, border: "1px solid var(--border)", background: `rgba(255,107,157,${0.06 + 0.18 * (k.count / maxC)})`, color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                {k.word} <span style={{ color: "var(--text3)", fontSize: 10 }}>{k.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ── 계정 카드 (외부 컴포넌트 — 렌더마다 재생성 방지) ── */
const AccountCard = React.memo(({ accounts, onLogin, onAdd, onRemove, onChange, onConnectAll, connectingAll }: {
  accounts: Account[];
  onLogin: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (accountId: string, field: keyof Account, value: any) => void;
  onConnectAll?: () => void;          // 있으면 '전체 연결' 버튼 표시(품앗이용)
  connectingAll?: boolean;
}) => {
  const pendingCount = accounts.filter(a => a.id && a.pw && !a.sessionOk).length;
  return (
  <div className="card" style={{ padding: "18px 20px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
      <div className="card-title" style={{ margin: 0, fontSize: 15 }}>👤 작업 계정</div>
      {onConnectAll && accounts.length >= 2 && (
        <button onClick={onConnectAll} disabled={connectingAll || pendingCount === 0}
          style={{ padding: "7px 14px", borderRadius: 9, border: "none", background: connectingAll || pendingCount === 0 ? "var(--card2)" : "linear-gradient(135deg,#ec4899,#a855f7)", color: connectingAll || pendingCount === 0 ? "var(--text3)" : "#fff", cursor: connectingAll || pendingCount === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", whiteSpace: "nowrap" }}>
          {connectingAll ? "🔄 연결 중..." : `🔗 전체 연결${pendingCount ? ` (${pendingCount})` : ""}`}
        </button>
      )}
    </div>
    {onConnectAll && accounts.length >= 2 && (
      <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.55, marginBottom: 14, padding: "9px 12px", borderRadius: 9, background: "var(--card2)", border: "1px solid var(--border)" }}>
        💡 계정마다 <b>아이디·비밀번호를 미리 입력</b>해두면, <b style={{ color: "#c026d3" }}>전체 연결</b> 버튼 하나로 <b>아직 연결 안 된 계정을 순서대로 한 번에 로그인</b>해요. 계정을 하나씩만 연결하려면 각 계정의 <b>계정 연결하기</b>를 누르세요. <span style={{ color: "var(--text3)" }}>(연결은 처음 한 번만 — 이후엔 저장된 로그인으로 봇이 자동 진행해요)</span>
      </div>
    )}
    {accounts.map((acc, i) => (
      <div key={acc.accountId} style={{ marginBottom: 12, padding: "14px 16px", borderRadius: 14, border: `2px solid ${acc.sessionOk ? "rgba(0,214,143,.5)" : "var(--border)"}`, background: acc.sessionOk ? "rgba(0,214,143,.06)" : "var(--bg)", transition: "border .2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: acc.sessionOk ? "var(--success)" : "var(--border)", flexShrink: 0, boxShadow: acc.sessionOk ? "0 0 8px var(--success)" : "none", transition: "all .3s" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>계정 {i + 1}</span>
          {acc.blogId && <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 600 }}>• {acc.blogId}</span>}
          {acc.sessionOk && <span style={{ fontSize: 11, color: "var(--success)", marginLeft: 2 }}>연결됨 ✓</span>}
          <button onClick={() => { if (window.confirm("이 계정을 삭제할까요? (저장된 로그인도 함께 삭제됩니다)")) onRemove(acc.accountId); }}
            style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(255,71,87,.4)", background: "rgba(255,71,87,.08)", color: "var(--danger)", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
            🗑 삭제
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input className="inp" placeholder="네이버 아이디" value={acc.id}
            onChange={e => onChange(acc.accountId, "id", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && acc.id && acc.pw && !acc.loginLoading) onLogin(acc.accountId); }}
            style={{ fontSize: 13, padding: "10px 12px" }} />
          <div style={{ position: "relative" }}>
            <input className="inp" type={acc.showPw ? "text" : "password"} placeholder="비밀번호" value={acc.pw}
              onChange={e => onChange(acc.accountId, "pw", e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && acc.id && acc.pw && !acc.loginLoading) onLogin(acc.accountId); }}
              style={{ fontSize: 13, padding: "10px 36px 10px 12px", width: "100%" }} />
            <button onClick={() => onChange(acc.accountId, "showPw", !acc.showPw)}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", fontSize: 15, color: "var(--text3)", padding: 2 }}>
              {acc.showPw ? "🙈" : "👁️"}
            </button>
          </div>
        </div>
        <button onClick={() => onLogin(acc.accountId)} disabled={acc.loginLoading || !acc.id || !acc.pw}
          style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: acc.sessionOk ? "rgba(0,214,143,.18)" : "var(--accent)", color: acc.sessionOk ? "var(--success)" : "#000", cursor: acc.loginLoading || !acc.id || !acc.pw ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 800, fontFamily: "inherit", transition: "all .2s", opacity: acc.loginLoading || !acc.id || !acc.pw ? 0.6 : 1 }}>
          {acc.loginLoading ? "🔄 로그인 중..." : acc.sessionOk ? "✅ 연결됨 (재연결)" : "🔗 계정 연결하기"}
        </button>
      </div>
    ))}
    <button onClick={onAdd} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "2px dashed var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", transition: "border-color .2s" }}>
      + 계정 추가
    </button>
  </div>
  );
});

/* ── 사용설명서 내용 ── */
const GUIDE = {
  neighbor: [
    { step: "1", title: "계정 연결", desc: "네이버 아이디/비밀번호 입력 후 '계정 연결' 클릭 → 브라우저 창이 열리며 자동 로그인됩니다." },
    { step: "2", title: "키워드 입력", desc: "서이추할 블로그를 찾을 키워드를 쉼표로 구분해 입력하세요.\n예) 원주맛집, 강원도여행, 육아일기" },
    { step: "3", title: "추출 시작", desc: "'🔍 추출 시작' 클릭 → 키워드로 블로그를 검색해 대상 목록을 자동으로 만듭니다." },
    { step: "4", title: "서이추 멘트 설정", desc: "신청할 때 보낼 메시지를 작성하세요. 다중 멘트는 순서대로 돌아가며 사용됩니다." },
    { step: "5", title: "작업 시작", desc: "'🚀 작업 시작' 클릭 → 수집된 블로그에 자동으로 서이추 신청합니다.\n딜레이를 5~10초로 설정하면 봇 탐지를 피할 수 있어요." },
    { step: "팁", title: "재사용", desc: "📂 리스트 불러오기로 저장해둔 CSV 파일을 불러올 수 있어요.\n'완료된 블로그 스킵' 켜두면 중복 신청이 방지됩니다." },
  ],
  engage: [
    { step: "1", title: "계정 연결", desc: "서이추 탭과 동일한 계정을 공유합니다. 이미 연결됐으면 바로 사용 가능해요." },
    { step: "2", title: "키워드 입력", desc: "공감·댓글을 남길 블로그를 찾을 키워드를 입력하세요.\n서이추 탭과 별도로 관리됩니다." },
    { step: "3", title: "기간 설정", desc: "최근 7일 / 14일 / 30일 / 직접 입력 중 선택하세요.\n선택한 기간 내에 작성된 글에만 공감·댓글을 달아줍니다." },
    { step: "4", title: "작업 종류 선택", desc: "❤️ 공감 / 💬 댓글 각각 켜고 끌 수 있어요.\n댓글을 켜면 아래에 내용 입력란이 나타납니다." },
    { step: "5", title: "댓글 내용 작성", desc: "단일 댓글이나 여러 댓글을 줄바꿈으로 구분해 입력하면 순서대로 사용됩니다.\n예) 좋은 글 감사해요 😊\n자주 놀러올게요! ✨" },
    { step: "6", title: "추출 후 작업", desc: "'🔍 추출 시작' → '🚀 작업 시작' 순서로 진행하거나\n'추출 완료 후 바로 작업 시작' 옵션을 켜면 자동으로 이어집니다." },
  ],
  reply: [
    { step: "1", title: "계정 연결", desc: "답방할 내 네이버 블로그 계정을 연결하세요. 서이추·공감 탭과 같은 계정을 공유합니다." },
    { step: "2", title: "확인할 글 수 설정", desc: "내 블로그 최근 글 몇 개까지 댓글을 확인할지 정하세요.\n예) 10개 → 최근 글 10개에 달린 댓글을 훑어봅니다." },
    { step: "3", title: "답글 방식 선택", desc: "✨ AI 자동: 댓글 내용을 읽고 맞춤 답글을 매번 다르게 생성해요.\n✍️ 고정 답글: 미리 써둔 문구로 답합니다." },
    { step: "4", title: "미답변만 / 전체", desc: "'아직 답글 없는 댓글만' 켜면 이미 답한 댓글은 건너뛰어 중복 답글을 막아요." },
    { step: "5", title: "답방 시작", desc: "'🚀 답방 시작' 클릭 → 내 글 댓글에 순서대로 대댓글을 자동으로 답니다.\n딜레이를 5~10초로 두면 자연스러워요." },
    { step: "팁", title: "왜 답방이 중요한가요?", desc: "댓글에 답글을 달면 이웃과 소통이 활발해지고, 블로그 체류·재방문이 늘어 블로그 지수에 좋아요." },
  ],
  score: [
    { step: "1", title: "계정 연결", desc: "진단할 내 네이버 블로그 계정을 연결하세요. 서이추·공감 탭과 같은 계정을 공유해요." },
    { step: "2", title: "진단 시작", desc: "'📈 블로그 진단 시작'을 누르면 봇이 내 블로그의 실제 지표를 읽어와 건강 리포트를 만들어요.\n(등급에 따라 하루 진단 횟수가 정해져 있고, 자정에 초기화돼요.)" },
    { step: "3", title: "🔴 검색 노출 진단 (핵심)", desc: "내 최근 글 제목을 실제로 네이버에 검색해 '내 글이 뜨는지'를 확인해요.\n안 뜨는 글(누락)이 많으면 '저품질 의심'으로 알려드려요. 저품질 조기경보예요." },
    { step: "4", title: "✏️ 제목·키워드 살리기", desc: "검색에 안 뜨는 글이 있으면 'AI 개선안 받기'를 눌러보세요.\n제목을 상위노출용으로 고치고 추천 키워드까지 알려줘요. (무료 Gemini 키 필요)" },
    { step: "5", title: "👥 방문자·유입 확인", desc: "최근 방문자 추이(급감 여부)와 사람들이 어떤 키워드로 들어오는지 볼 수 있어요.\n내가 뭘로 노출되는지 알면 그 주제를 더 키울 수 있어요." },
    { step: "팁", title: "등급별 검사 개수", desc: "검색 노출 검사는 하루 검사 글 수가 등급별로 달라요(무료 5·베이직 10·프로 20개, 무제한은 전체).\n이미 검사한 글은 건너뛰고 새 글부터 검사하니, 매일 진단하면 전체 글을 골고루 살펴봐요." },
    { step: "팁", title: "네이버 공식 지수가 아니에요", desc: "네이버는 공식 '지수'를 공개하지 않아요. 이 진단은 실제 검색 결과·방문 데이터를 바탕으로 한 퍼블리 자체 건강검진으로, 블로그 관리 방향을 잡는 용도예요." },
  ],
  pumasi: [
    { step: "1", title: "계정 2개 이상 연결", desc: "품앗이에 사용할 내 네이버 계정을 등록하고 한 번씩 연결해 세션을 저장하세요." },
    { step: "2", title: "계정별 글 수·받을 수 설정", desc: "대상 글 수는 계정마다 최근 몇 개 글을 돌지, 받을 수는 최대 몇 개의 다른 계정에게 방문·공감·댓글을 받을지 정해요. 기본은 각각 3이에요." },
    { step: "3", title: "공감·댓글 방식 설정", desc: "공감과 댓글을 켜고, 고정·순환·AI 맞춤 댓글 중 원하는 방식을 고르세요." },
    { step: "4", title: "자연스러운 방문 강화(선택)", desc: "체류시간 엔진은 글 분량을 읽어 짧은 글은 빨리·긴 글은 오래 머물러요(자동). 관련 글 1편 더 읽기를 켜면 댓글 뒤 다른 글도 읽어 진짜 방문자처럼 보여요. 시간 분산은 전체 방문을 정한 시간(분 단위)에 고르게 나눠 투데이 폭증을 막아 더 안전해요. (계정당이 아니라 전체를 합친 시간이에요)" },
    { step: "5", title: "품앗이 시작", desc: "봇이 계정을 자동 전환하며 상대 계정의 실제 글을 읽고 공감·댓글을 남겨요. 받을 수에 도달한 계정은 더 방문하지 않고, 최근 안 간 계정부터 골고루 순환해요." },
    { step: "6", title: "효과 리포트로 확인", desc: "우측 '품앗이 효과 리포트'에서 방문자 추이 위에 품앗이한 날을 표시해요. 실제로 도움이 됐는지 보고 과도하게 하지 않도록 조절하세요." },
    { step: "팁", title: "과도한 집중을 피하세요", desc: "받을 수를 낮게 유지하고 딜레이를 넉넉히, 시간 분산을 활용하세요. 많은 계정이 한 글에 한꺼번에 몰리는 패턴은 피하는 게 안전해요." },
  ],
};

/* ── 사용설명서 모달 ── */
const GuideModal = ({ tab, onClose }: { tab: "neighbor"|"engage"|"reply"|"score"|"pumasi"; onClose: () => void }) => {
  const steps = (GUIDE as any)[tab] ?? [];
  const title = tab === "neighbor" ? "🤝 서이추 사용방법" : tab === "engage" ? "❤️ 공감·댓글 사용방법" : tab === "reply" ? "💬 답방 사용방법" : tab === "pumasi" ? "💞 품앗이 사용방법" : "📈 블로그 건강검진";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 20px 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, padding: "28px 32px", maxWidth: 560, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {steps.map(({ step, title, desc }: { step: string; title: string; desc: string }) => (
            <div key={step} style={{ display: "flex", gap: 14, padding: "16px", borderRadius: 14, background: "var(--bg2)", border: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: step === "팁" ? "rgba(255,183,0,.15)" : "var(--accent-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: step === "팁" ? "#ffb700" : "var(--accent-text)", flexShrink: 0, border: `1px solid ${step === "팁" ? "rgba(255,183,0,.3)" : "var(--accent)"}` }}>
                {step === "팁" ? "💡" : `0${step}`}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, whiteSpace: "pre-line" }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{ width: "100%", marginTop: 20, padding: "13px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 14, fontWeight: 800, fontFamily: "inherit" }}>
          확인했어요!
        </button>
      </div>
    </div>
  );
};

/* ── 메인 컴포넌트 ── */
export default function NeighborPage({ theme, userId, plan = "free", initialTab, singleTab, onEngageUsageChange, initialNeighborUsed = 0, initialEngageUsed = 0, onBusyChange }: Props) {
  const [tab, setTab] = useState<"neighbor"|"engage"|"reply"|"score"|"pumasi">(initialTab || "neighbor");
  // ── 답방(내 블로그 댓글에 대댓글) 상태 ──
  const [rTargetPosts, setRTargetPosts] = useState(10);   // '최근 개수' 방식일 때 글 수
  const [rSelectMode, setRSelectMode] = useState<"count"|"all"|"period">("count"); // 대상 글 선택 방식
  const [rPeriod, setRPeriod] = useState<7|14|30|"custom">(7);   // '기간' 방식일 때 최근 N일
  const [rCustomDays, setRCustomDays] = useState(3);            // 직접 기간설정(일)
  const [rMyPosts, setRMyPosts] = useState<{url:string;title:string;date:string;comments?:number}[]>([]); // 불러온 내 글 목록
  const [rLoadingPosts, setRLoadingPosts] = useState(false);
  const [rMode, setRMode] = useState<"ai"|"fixed">("ai");
  const [rComment, setRComment] = useState("댓글 감사합니다 😊 자주 놀러오세요!");
  const [rTone, setRTone] = useState<"담백"|"다정"|"짧게">("다정");
  const [rOnlyNew, setROnlyNew] = useState(true);          // 아직 답글 없는 댓글만
  const [rDelayMin, setRDelayMin] = useState(5);
  const [rDelayMax, setRDelayMax] = useState(10);
  const [rWorking, setRWorking] = useState(false);
  const [rLogs, setRLogs] = useState<string[]>([]);
  const [rDoneCnt, setRDoneCnt] = useState(0);
  const [rFailCnt, setRFailCnt] = useState(0);
  const rJobIdRef = useRef<string>("");
  const rEsRef = useRef<BotEventStream|null>(null);
  const rLogRef = useRef<HTMLDivElement>(null);
  const addRLog = (m: string) => setRLogs(p => [...p, `${new Date().toLocaleTimeString("ko-KR",{hour12:false})}  ${m}`]);
  // ── 블로그 건강검진 상태 ──
  const [scLoading, setScLoading] = useState(false);
  const [scResult, setScResult] = useState<null | {
    blogId: string; totalPosts: number; neighbors: number; recentDates: string[];
    exposureChecks?: { title: string; exposed: boolean | null; rank: number | null; postUrl?: string }[];
    lowQualitySuspected?: boolean | null;
    visitorDays?: { date: string; visitors: number }[];
    inflowKeywords?: { keyword: string; count?: number }[];
    visitorDrop?: { detected: boolean; rate: number | null; message: string } | null;
    totalPostsForExposure?: number;
    checkedTodayCount?: number;
    exposureCompletedCount?: number;
    exposureLimit?: number | null;
  }>(null);
  const [scLogs, setScLogs] = useState<string[]>([]);
  const scLogRef = useRef<HTMLDivElement>(null);
  const addScLog = (m: string) => setScLogs(p => [...p, `${new Date().toLocaleTimeString("ko-KR",{hour12:false})}  ${m}`]);
  // ── 저품질/누락 글 제목·키워드 개선 솔루션(AI) ──
  const [scSolLoading, setScSolLoading] = useState(false);
  const [scSolutions, setScSolutions] = useState<null | { original: string; diagnosis: string; newTitle: string; newTitle2: string; keywords: string[]; bodyTip: string; expectedEffect: string; reason: string }[]>(null);
  const [scSolPage, setScSolPage] = useState(0);   // AI 팁 페이지네이션(5개 단위)
  const [scSolSearch, setScSolSearch] = useState(""); // AI 팁 원래 제목 검색
  const [scExpPage, setScExpPage] = useState(0);   // 검색노출 결과 페이지네이션(30개 단위)
  const [scExpSearch, setScExpSearch] = useState(""); // 검색노출 결과 제목 검색
  const [scPostPage, setScPostPage] = useState(0);    // 검사할 글 목록 페이지네이션(30개 단위)
  const [scPostSearch, setScPostSearch] = useState(""); // 검사할 글 제목 검색
  const [scPostMode, setScPostMode] = useState<"period"|"all">("period");
  const [scPeriod, setScPeriod] = useState<7|14|30|"custom">(7);
  const [scCustomDays, setScCustomDays] = useState(7);
  const [scPosts, setScPosts] = useState<{url:string;title:string;date:string}[]>([]);
  const [scSelectedLogNos, setScSelectedLogNos] = useState<string[]>([]);
  const [scPostsLoading, setScPostsLoading] = useState(false);
  const [scExposureLoading, setScExposureLoading] = useState(false);
  // ── 등급별 일일 사용량 (답방·블로그진단) ──
  const isUnlimitedPlan = plan === "unlimited" || plan === "admin";
  const [replyUsed, setReplyUsed] = useState(0);
  const replyLimit = REPLY_DAILY_LIMIT[plan] ?? REPLY_DAILY_LIMIT.free;
  const [scUsed, setScUsed] = useState(0);
  const scLimit = BLOGSCORE_DAILY_LIMIT[plan] ?? BLOGSCORE_DAILY_LIMIT.free;
  // ── 품앗이 상태 ──
  const pumasiAccountLimit = PUMASI_ACCOUNT_LIMIT[plan] ?? PUMASI_ACCOUNT_LIMIT.free;  // 등록 가능한 계정 수
  const pumasiPostsLimit = PUMASI_POSTS_LIMIT[plan] ?? PUMASI_POSTS_LIMIT.free;        // 계정당 대상 글 수 상한
  const [pumUsed, setPumUsed] = useState(0);                                            // 오늘 품앗이 공감·댓글 건수
  const [pumPostsByAcc, setPumPostsByAcc] = useState<Record<string, number>>({});       // 계정별 대상 글 수
  const [pumReceiveByAcc, setPumReceiveByAcc] = useState<Record<string, number>>({});   // 계정별 방문 받을 actor 수
  const [pumDoLike, setPumDoLike] = useState(true);
  const [pumDoComment, setPumDoComment] = useState(true);
  const [pumCommentMode, setPumCommentMode] = useState<"single"|"multi"|"ai">("ai");
  const [pumComment, setPumComment] = useState("좋은 글 잘 보고 가요 😊");
  const [pumMultiComments, setPumMultiComments] = useState("좋은 글 잘 보고 가요 😊\n오늘도 좋은 하루 보내세요!\n잘 보고 갑니다 ✨");
  const [pumTone, setPumTone] = useState<"담백"|"다정"|"짧게">("다정");
  const [pumDelayMin, setPumDelayMin] = useState(8);
  const [pumDelayMax, setPumDelayMax] = useState(15);
  const [pumReadRelated, setPumReadRelated] = useState(true);   // 관련 글 1편 더 읽기(체류·투데이↑)
  const [pumSpread, setPumSpread] = useState(0);                // 시간 분산(분, 0=즉시 연속). 서버엔 시간으로 변환해 전달
  const [pumWorking, setPumWorking] = useState(false);
  const [pumLogs, setPumLogs] = useState<string[]>([]);
  const [pumDone, setPumDone] = useState(0);
  const [pumFail, setPumFail] = useState(0);
  const [pumReport, setPumReport] = useState<{ blogId: string; days: { date: string; visitors: number; pumasiVisits: number }[]; totalReceived7d: number; avgWithPumasi: number|null; avgWithoutPumasi: number|null } | null>(null);
  const [pumReportBlog, setPumReportBlog] = useState<string>("");
  const [pumReportLoading, setPumReportLoading] = useState(false);
  const pumJobIdRef = useRef<string>("");
  const pumEsRef = useRef<BotEventStream|null>(null);
  const pumLogRef = useRef<HTMLDivElement>(null);
  const addPumLog = (m: string) => setPumLogs(p => [...p, `${new Date().toLocaleTimeString("ko-KR",{hour12:false})}  ${m}`]);
  useEffect(() => {
    if (!userId) return;
    if (tab === "reply") getReplyDailyUsage(userId).then(setReplyUsed);
    if (tab === "score") getBlogscoreDailyUsage(userId).then(setScUsed);
    if (tab === "pumasi") getPumasiDailyUsage(userId).then(setPumUsed);
  }, [userId, tab]);
  const [showGuide, setShowGuide] = useState(false);

  /* 공통: 계정 */
  const [accounts, setAccounts] = useState<Account[]>(() => {
    // 저장된 계정 복원 (한 번 연결하면 매번 안 넣게)
    try {
      const saved = JSON.parse(localStorage.getItem("publy_neighbor_accounts") || "null");
      if (Array.isArray(saved) && saved.length) return saved.map((a: any) => ({ accountId: a.accountId, id: a.id || "", pw: a.pw || "", blogId: a.blogId || "", sessionOk: !!a.sessionOk, loginLoading: false, showPw: false }));
    } catch {}
    return [{ accountId: "acc_1", id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }];
  });
  const [botOnline, setBotOnline] = useState(false);

  /* 서이추 state */
  const [quotaUsed, setQuotaUsed] = useState(initialNeighborUsed);
  const [quotaLimit, setQuotaLimit] = useState(DAILY_LIMIT_BY_PLAN[plan] ?? 10);
  // 공감·댓글 사용량 (상단 배지 engageUsed와 동일 소스)
  const [eUsed, setEUsed] = useState(initialEngageUsed);
  const eLimit = DAILY_LIMIT_BY_PLAN[plan] ?? 10;
  const [keywords, setKeywords] = useState("");
  const [countPerKw, setCountPerKw] = useState(34);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [skipDone, setSkipDone] = useState(true);
  const [qualityFilter, setQualityFilter] = useState(true);   // 죽은/광고 블로그 자동 스킵
  const [retryDays, setRetryDays] = useState(30);             // 실패/무응답 재신청 대기일
  const [autoStart, setAutoStart] = useState(false);
  // 예약·분산 실행 (기존 '한번에'와 별개 모드)
  const [spreadMode, setSpreadMode] = useState(false);      // 분산 실행 켜기
  const [spreadBatches, setSpreadBatches] = useState(3);    // 몇 번에 나눠서
  const [spreadGapMin, setSpreadGapMin] = useState(90);     // 배치 사이 간격(분)
  const [spreadRunning, setSpreadRunning] = useState(false);
  const [spreadInfo, setSpreadInfo] = useState<{ total: number; cur: number; nextAt: number | null }>({ total: 0, cur: 0, nextAt: null });
  const spreadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spreadRunningRef = useRef(false);
  // 내 이웃 키워드 분석 (서이추·공감댓글 공용)
  const [buddyKw, setBuddyKw] = useState<{ word: string; count: number }[]>([]);
  const [buddyKwLoading, setBuddyKwLoading] = useState(false);
  // 체험단 모집 최적화 옵션
  const [orderBy, setOrderBy] = useState<"recentdate"|"sim">("recentdate");
  const [activeDays, setActiveDays] = useState<number>(30);
  const [excludeMarket, setExcludeMarket] = useState(true);
  const [msgMode, setMsgMode] = useState<"single"|"multi">("single");
  const [singleMsg, setSingleMsg] = useState(DEFAULT_SINGLE_MSG);
  const [multiMsgs, setMultiMsgs] = useState(DEFAULT_MULTI_MSGS);
  const [msgIndex, setMsgIndex] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [results, setResults] = useState<WorkResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [working, setWorking] = useState(false);
  const [doneCnt, setDoneCnt] = useState(0);
  const [failCnt, setFailCnt] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const jobIdRef = useRef<string>(Date.now().toString());
  const esRef = useRef<BotEventStream|null>(null);

  /* 공감·댓글 state */
  const [eKeywords, setEKeywords] = useState("");
  const [eSource, setESource] = useState<"keyword" | "buddy">("keyword");  // 수집 소스: 키워드 검색 vs 내 이웃새글
  const [eCountPerKw, setECountPerKw] = useState(20);
  const [ePeriod, setEPeriod] = useState<7|14|30|"custom">(7);
  const [eCustomDays, setECustomDays] = useState(3);
  const [ePostsPerBlog, setEPostsPerBlog] = useState(1);
  const [eDoLike, setEDoLike] = useState(true);
  const [eDoComment, setEDoComment] = useState(true);
  const [eLikeRate, setELikeRate] = useState(100);      // 공감 확률 %
  const [eCommentRate, setECommentRate] = useState(40); // 댓글 확률 % (도배 회피 기본 40)
  const [eComment, setEComment] = useState("좋은 글 잘 읽고 갑니다 😊 자주 놀러올게요!");
  const [eCommentMode, setECommentMode] = useState<"single"|"multi"|"ai">("single");
  const [eCommentTone, setECommentTone] = useState<"담백"|"다정"|"짧게">("다정"); // AI 댓글 말투
  const [eMultiComments, setEMultiComments] = useState("좋은 글 잘 읽고 갑니다 😊 자주 놀러올게요!\n유익한 정보 감사해요! 구독하고 갑니다 🙌\n정말 도움이 됐어요! 앞으로도 좋은 글 부탁드려요 ✨");
  const [eCommentIndex, setECommentIndex] = useState(0);
  const [eDelayMin, setEDelayMin] = useState(5);
  const [eDelayMax, setEDelayMax] = useState(12);
  const [eDailyLimit, setEDailyLimit] = useState(50);
  const [eSkipDone, setESkipDone] = useState(true);
  const [eAutoStart, setEAutoStart] = useState(false);
  const [eTargets, setETargets] = useState<Target[]>([]);
  const [eResults, setEResults] = useState<EngageResult[]>([]);
  const [eLogs, setELogs] = useState<string[]>([]);
  const [eCrawling, setECrawling] = useState(false);
  const [eWorking, setEWorking] = useState(false);
  const [eDoneCnt, setEDoneCnt] = useState(0);
  const [eFailCnt, setEFailCnt] = useState(0);
  const eLogRef = useRef<HTMLDivElement>(null);
  const eJobIdRef = useRef<string>(Date.now().toString());
  const eEsRef = useRef<BotEventStream|null>(null);

  /* 봇 상태 체크 */
  useEffect(() => {
    const check = async () => {
      try { const r = await botFetch(`${BOT}/health`, { signal: AbortSignal.timeout(2000) }); setBotOnline(r.ok); }
      catch { setBotOnline(false); }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  /* 쿼타 로드 */
  useEffect(() => {
    if (!userId) return;
    botFetch(`${BOT}/api/quota/${userId}`).then(r => r.json())
      .then(d => { if (d.ok) { setQuotaUsed(d.used); setQuotaLimit(d.limit); } }).catch(() => {});
  }, [userId, botOnline]);

  /* 로그 스크롤: 자동 이동 없음(테리 요청). 새 로그가 와도 화면을 강제로 옮기지 않고,
     사용자가 스크롤한 위치에 그대로 멈춰 있게 둔다. 아래를 보려면 직접 내리면 됨. */
  // 계정 목록 자동 저장 (id/pw/연결상태 유지 → 매번 재입력 불필요)
  useEffect(() => {
    try { localStorage.setItem("publy_neighbor_accounts", JSON.stringify(accounts.map(a => ({ accountId: a.accountId, id: a.id, pw: a.pw, blogId: a.blogId, sessionOk: a.sessionOk })))); } catch {}
  }, [accounts]);

  const addLog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(p => [...p.slice(-200), `${t} :: ${msg}`]);
  }, []);

  const addELog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setELogs(p => [...p.slice(-200), `${t} :: ${msg}`]);
  }, []);

  /* 세션 상태 확인 + 오늘 서이추 안전 한도 현황 로드 */
  useEffect(() => {
    accounts.forEach(acc => {
      if (!acc.id) return;
      botFetch(`${BOT}/api/session/${acc.accountId}`).then(r => r.json())
        .then(d => { if (d.exists) setAccounts(p => p.map(a => a.accountId === acc.accountId ? { ...a, sessionOk: true } : a)); })
        .catch(() => {});
    });
    // 상단·사이드바와 같은 원래 서이추 한도(플랜별)를 초기 로드 → 게이지 연동
    if (userId) botFetch(`${BOT}/api/quota/${userId}`).then(r => r.json())
      .then(d => { if (d.ok) { setQuotaUsed(d.used); setQuotaLimit(d.limit); } }).catch(() => {});
  }, []);

  /* 계정 핸들러 */
  //  silent=true면 개별 alert 없이 조용히(전체 연결에서 사용). 성공 여부를 boolean으로 반환.
  const handleLogin = async (accountId: string, silent = false): Promise<boolean> => {
    const acc = accounts.find(a => a.accountId === accountId);
    if (!acc || !acc.id || !acc.pw) { if (!silent) alert("아이디와 비밀번호를 입력하세요"); return false; }
    setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, loginLoading: true } : a));
    try {
      const r = await botFetch(`${BOT}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, id: acc.id, pw: acc.pw }) });
      const d = await r.json();
      if (d.success) {
        setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, sessionOk: true, blogId: d.blogId, loginLoading: false } : a));
        addLog(`✅ [${acc.id}] 로그인 성공 (blogId: ${d.blogId})`);
        addELog(`✅ [${acc.id}] 로그인 성공`);
        return true;
      } else throw new Error(d.error || "로그인 실패");
    } catch (e: any) {
      setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, loginLoading: false } : a));
      addLog(`❌ [${acc.id}] 로그인 오류: ${e.message}`);
      if (!silent) alert(`로그인 오류: ${e.message}`);
      return false;
    }
  };

  /* 전체 계정 연결: 아이디·비번 입력된 계정을 순서대로 자동 로그인(개별 연결과 별개, 둘 다 사용 가능) */
  const [connectingAll, setConnectingAll] = useState(false);
  const handleConnectAll = async () => {
    const targets = accounts.filter(a => a.id && a.pw && !a.sessionOk);
    if (!targets.length) return alert("연결할 계정이 없어요. (아이디·비번을 입력한 미연결 계정이 있어야 해요)");
    setConnectingAll(true);
    addLog(`🔗 전체 연결 시작 — ${targets.length}개 계정을 순서대로 로그인합니다`);
    let ok = 0, fail = 0;
    for (const a of targets) {
      const success = await handleLogin(a.accountId, true);   // 조용히(개별 alert 없이)
      if (success) ok++; else fail++;
      await new Promise(res => setTimeout(res, 800));          // 계정 사이 약간 텀
    }
    setConnectingAll(false);
    addLog(`🔗 전체 연결 완료 — 성공 ${ok} / 실패 ${fail}`);
    alert(`전체 연결 완료!\n성공 ${ok}개${fail ? ` · 실패 ${fail}개(아이디·비번 확인)` : ""}`);
  };

  const handleAddAccount = useCallback(() =>
    setAccounts(p => [...p, { accountId: `acc_${Date.now()}`, id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }])
  , []);

  const handleRemoveAccount = useCallback((id: string) => {
    // 봇에 저장된 로그인 세션도 함께 삭제
    botFetch(`${BOT}/api/session/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setAccounts(p => {
      const next = p.filter(a => a.accountId !== id);
      return next.length ? next : [{ accountId: `acc_${Date.now()}`, id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false }];
    });
  }
  , []);

  const handleAccountChange = useCallback((accountId: string, field: keyof Account, value: any) =>
    setAccounts(p => p.map(a => a.accountId === accountId ? { ...a, [field]: value, ...(field === "id" || field === "pw" ? { sessionOk: false } : {}) } : a))
  , []);

  /* 내 이웃 키워드 분석 — 이웃들이 자주 쓰는 주제 TOP (서이추·공감댓글 공용) */
  const analyzeBuddyKeywords = async () => {
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 계정을 연결하세요 (내 이웃 분석은 로그인 필요)");
    setBuddyKwLoading(true); setBuddyKw([]);
    try {
      const r = await botFetch(`${BOT}/api/buddy-keywords/${encodeURIComponent(acc.accountId)}`, { signal: AbortSignal.timeout(60000) } as any);
      const d = await r.json();
      if (d.ok && Array.isArray(d.keywords)) setBuddyKw(d.keywords);
      else alert("키워드 분석 실패: " + (d.error || "이웃새글이 없어요"));
    } catch (e: any) { alert("키워드 분석 오류: " + e.message); }
    finally { setBuddyKwLoading(false); }
  };

  /* 서이추 수집 */
  // 체험단 멘트 채우기 — 매번 무작위로 섞어 채움 (도배 회피)
  //  단일 멘트 모드: 랜덤 1개를 넣음 / 여러 멘트 모드: count개를 넣음
  const applyCampaignPreset = (count = 5) => {
    const shuffled = [...CAMPAIGN_PRESETS].sort(() => Math.random() - 0.5);
    if (msgMode === "single") setSingleMsg(shuffled[0]);
    else setMultiMsgs(shuffled.slice(0, count).join("\n"));
  };
  // 기본 멘트로 되돌리기 (수정한 걸 원래대로)
  const restoreDefaultMsg = () => {
    if (msgMode === "single") setSingleMsg(DEFAULT_SINGLE_MSG);
    else setMultiMsgs(DEFAULT_MULTI_MSGS);
  };

  const handleCrawl = async () => {
    const kwList = keywords.split(",").map(k => k.trim()).filter(Boolean);
    if (!kwList.length) return alert("키워드를 입력하세요");
    setCrawling(true); setTargets([]); setResults([]); setDoneCnt(0); setFailCnt(0);
    addLog(`🔍 수집 시작 — 키워드: ${kwList.join(", ")} / 키워드당 ${countPerKw}개`);
    const es = new BotEventStream(`${BOT}/api/crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${countPerKw}&orderBy=${orderBy}&activeDays=${activeDays}&excludeMarket=${excludeMarket}${userId ? `&userId=${userId}` : ""}`);
    esRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addLog(d.msg);
      if (d.type === "quota_info") { setQuotaUsed(d.used); setQuotaLimit(d.limit); addLog(`📊 오늘 서이추 현황: ${d.used}/${d.limit} (남은 ${d.remaining}명)`); }
      if (d.type === "quota_exceeded") { addLog(`🚫 오늘 한도(${d.limit}명) 모두 사용!`); setCrawling(false); es.close(); return; }
      if (d.type === "crawl_done") {
        const t: Target[] = d.results; setTargets(t); setResults(t.map(x => ({ ...x, status: "pending" as const, message: "대기중" })));
        addLog(`✅ 수집 완료: 총 ${t.length}개`); setCrawling(false); es.close();
        if (autoStart && t.length > 0) setTimeout(() => startWork(t), 500);
      }
      if (d.type === "error") { addLog(`❌ 오류: ${d.msg}`); setCrawling(false); es.close(); }
    };
    es.onerror = () => { addLog("❌ 수집 연결 오류"); setCrawling(false); es.close(); };
  };

  /* 서이추 작업 — 완료(done/error/한도)시 resolve하는 Promise 반환(분산 실행에서 배치 대기용) */
  const startWork = (targetList?: Target[]): Promise<"done" | "limit" | "error"> => {
    const list = targetList || targets;
    if (!list.length) { alert("수집된 블로그가 없습니다"); return Promise.resolve("error"); }
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) { alert("먼저 계정을 연결하세요"); return Promise.resolve("error"); }
    setWorking(true); setDoneCnt(0); setFailCnt(0);
    jobIdRef.current = Date.now().toString();
    addLog(`🚀 작업 시작 — ${list.length}개 대상 / 한도 ${dailyLimit}개 / 딜레이 ${delayMin}~${delayMax}초`);
    const msg = msgMode === "single" ? singleMsg : multiMsgs.split("\n").filter(l => l.trim()).join("|||");
    // ★ targets(수십~수백개)를 GET URL에 실으면 길이 초과로 연결 실패 → POST body로 전송
    const body = JSON.stringify({ accountId: acc.accountId, targets: list, message: msg, delayMin, delayMax, skipDone, qualityFilter, retryDays, jobId: jobIdRef.current, ...(userId ? { userId } : {}) });
    return new Promise<"done" | "limit" | "error">((resolve) => {
      let outcome: "done" | "limit" | "error" = "done";
      const es = new BotEventStream(`${BOT}/api/add-neighbor`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); esRef.current = es;
      es.onmessage = e => {
        const d = JSON.parse(e.data);
        if (d.type === "log") addLog(d.msg);
        if (d.type === "quota_info") { setQuotaUsed(d.used); setQuotaLimit(d.limit); }
        if (d.type === "quota_exceeded") { addLog("🚫 오늘 한도 초과!"); outcome = "limit"; setWorking(false); es.close(); return; }
        if (d.type === "result") { setResults(p => p.map(r => r.blogId === d.blogId ? { ...r, status: d.status, message: d.message } : r)); if (d.status === "success") setQuotaUsed(q => q + 1); }
        if (d.type === "progress") { setDoneCnt(d.done); setFailCnt(d.fail); }
        if (d.type === "done") { addLog("🎉 작업 완료!"); setWorking(false); es.close(); }
        if (d.type === "error") { addLog(`❌ 오류: ${d.msg}`); outcome = "error"; setWorking(false); es.close(); }
      };
      es.onerror = () => { addLog("❌ 작업 연결 오류 (다시 '서이추 시작'을 누르면 재시도합니다)"); outcome = "error"; setWorking(false); es.close(); };
      es.onclose = () => { setWorking(false); resolve(outcome); };  // 어떤 식으로 끝나도 해제+배치 resolve
    });
  };

  /* 예약·분산 실행 — 대상을 여러 배치로 나눠 간격을 두고 자동 실행 (앱 켜둔 상태) */
  const startSpread = async () => {
    if (spreadRunningRef.current) return;   // 이미 분산 실행 중이면 중복 시작 방지(로그 반복·다중 루프 차단)
    const list = targets;
    if (!list.length) return alert("수집된 블로그가 없습니다");
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 계정을 연결하세요");
    const n = Math.max(2, Math.min(10, spreadBatches));
    const gapMs = Math.max(1, spreadGapMin) * 60 * 1000;
    // 대상을 n개 배치로 균등 분할
    const batches: Target[][] = Array.from({ length: n }, () => []);
    list.forEach((t, i) => batches[i % n].push(t));
    const nonEmpty = batches.filter(b => b.length);
    spreadRunningRef.current = true;   // useEffect 갱신을 기다리지 않고 즉시 동기 설정(루프 첫 체크 오작동 방지)
    setSpreadRunning(true);
    setSpreadInfo({ total: nonEmpty.length, cur: 0, nextAt: null });
    addLog(`📅 분산 실행 시작 — ${list.length}개를 ${nonEmpty.length}회로 나눠 ${spreadGapMin}분 간격으로 진행합니다.`);
    for (let i = 0; i < nonEmpty.length; i++) {
      if (!spreadRunningRef.current) { addLog("⏹ 분산 실행 중단됨"); break; }
      setSpreadInfo({ total: nonEmpty.length, cur: i + 1, nextAt: null });
      addLog(`📦 [${i + 1}/${nonEmpty.length}회차] ${nonEmpty[i].length}개 신청 시작`);
      const r = await startWork(nonEmpty[i]);
      if (r === "limit") { addLog("🛑 한도 도달로 분산 실행을 멈춥니다. 자정 이후 다시 시작해 주세요."); break; }
      // 마지막 배치가 아니면 다음 회차까지 대기
      if (i < nonEmpty.length - 1) {
        const nextAt = Date.now() + gapMs;
        setSpreadInfo({ total: nonEmpty.length, cur: i + 1, nextAt });
        addLog(`⏳ 다음 회차까지 ${spreadGapMin}분 대기 (예정: ${new Date(nextAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`);
        await new Promise<void>(res => { spreadTimerRef.current = setTimeout(res, gapMs); });
      }
    }
    setSpreadRunning(false);
    setSpreadInfo({ total: 0, cur: 0, nextAt: null });
    addLog("✅ 분산 실행 종료");
  };
  useEffect(() => { spreadRunningRef.current = spreadRunning; }, [spreadRunning]);

  // ★절전 방지(테리 요청): 서이추·공감댓글 자동작업(추출·실행·분산 자동실행) 중이면 부모(DashboardPage)에 알림.
  //   실제 keepAwake는 항상 떠있는 DashboardPage가 통합 관리 → 작업 중 다른 탭 이동/언마운트돼도 화면 안 꺼짐.
  useEffect(() => {
    const busy = crawling || working || spreadRunning || eCrawling || eWorking || rWorking || rLoadingPosts || scLoading || pumWorking;
    onBusyChange?.(busy);
    return () => { onBusyChange?.(false); };
  }, [crawling, working, spreadRunning, eCrawling, eWorking, rWorking, rLoadingPosts, scLoading, pumWorking, onBusyChange]);

  const stopSpread = () => {
    spreadRunningRef.current = false;
    setSpreadRunning(false);
    if (spreadTimerRef.current) clearTimeout(spreadTimerRef.current);
    esRef.current?.close();
    addLog("⏹ 분산 실행을 중단했습니다.");
  };

  const handleStop = async () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${jobIdRef.current}`, { method: "POST" }); } catch {}
    addLog("⛔ 중단"); setCrawling(false); setWorking(false);
  };

  /* 공감·댓글 수집 */
  const handleEngageCrawl = async () => {
    let crawlUrl: string;
    if (eSource === "buddy") {
      // 내 이웃새글 모드 — 연결된 계정 세션으로 내 서로이웃 최근글 수집 (키워드 불필요)
      const acc = accounts.find(a => a.sessionOk);
      if (!acc) return alert("먼저 계정을 연결하세요 (내 이웃 목록을 불러오려면 로그인 필요)");
      setECrawling(true); setETargets([]); setEResults([]); setEDoneCnt(0); setEFailCnt(0);
      addELog(`👥 내 이웃새글 수집 시작 — 최대 ${eCountPerKw}명`);
      crawlUrl = `${BOT}/api/engage-crawl?source=buddy&accountId=${encodeURIComponent(acc.accountId)}&countPerKeyword=${eCountPerKw}${userId ? `&userId=${userId}` : ""}`;
    } else {
      const kwList = eKeywords.split(",").map(k => k.trim()).filter(Boolean);
      if (!kwList.length) return alert("키워드를 입력하세요");
      setECrawling(true); setETargets([]); setEResults([]); setEDoneCnt(0); setEFailCnt(0);
      addELog(`🔍 수집 시작 — 키워드: ${kwList.join(", ")} / 키워드당 ${eCountPerKw}개`);
      crawlUrl = `${BOT}/api/engage-crawl?keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${eCountPerKw}${userId ? `&userId=${userId}` : ""}`;
    }
    const es = new BotEventStream(crawlUrl);
    eEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addELog(d.msg);
      if (d.type === "crawl_done") {
        const t: Target[] = d.results; setETargets(t);
        setEResults(t.map(x => ({ ...x, postUrl: "", liked: false, commented: false, status: "pending" as const, message: "대기중" })));
        addELog(`✅ 수집 완료: 총 ${t.length}개`); setECrawling(false); es.close();
        if (eAutoStart && t.length > 0) setTimeout(() => startEngageWork(t), 500);
      }
      if (d.type === "error") { addELog(`❌ 오류: ${d.msg}`); setECrawling(false); es.close(); }
    };
    es.onerror = () => { addELog("❌ 수집 연결 오류"); setECrawling(false); es.close(); };
  };

  /* 공감·댓글 작업 */
  const startEngageWork = async (targetList?: Target[]) => {
    const list = targetList || eTargets;
    if (!list.length) return alert("수집된 블로그가 없습니다");
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 계정을 연결하세요");
    setEWorking(true); setEDoneCnt(0); setEFailCnt(0);
    eJobIdRef.current = Date.now().toString();
    const days = ePeriod === "custom" ? eCustomDays : ePeriod;
    addELog(`🚀 작업 시작 — ${list.length}개 / 최근 ${days}일 / ${eDoLike ? "공감" : ""}${eDoLike && eDoComment ? "+" : ""}${eDoComment ? "댓글" : ""}`);
    const commentText = eCommentMode === "single" ? eComment : eCommentMode === "multi" ? eMultiComments.split("\n").filter(l => l.trim()).join("|||") : "";
    const aiComment = eCommentMode === "ai";
    const geminiKey = aiComment ? ((localStorage.getItem("publy_gemini_key") || "")) : "";
    // ★ targets를 POST body로 (URL 길이 초과 방지)
    const body = JSON.stringify({ accountId: acc.accountId, targets: list, comment: commentText, doLike: eDoLike, doComment: eDoComment, likeRate: eLikeRate, commentRate: eCommentRate, periodDays: days, postsPerBlog: ePostsPerBlog, delayMin: eDelayMin, delayMax: eDelayMax, dailyLimit: eDailyLimit, skipDone: eSkipDone, aiComment, commentTone: eCommentTone, geminiKey, jobId: eJobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/engage`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); eEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addELog(d.msg);
      if (d.type === "quota_info" && Number.isFinite(Number(d.used))) { setEUsed(Number(d.used)); onEngageUsageChange?.(Number(d.used)); }
      if (d.type === "result") setEResults(p => p.map(r => r.blogId === d.blogId ? { ...r, status: d.status, postUrl: d.postUrl || "", liked: d.liked, commented: d.commented, message: d.message } : r));
      if (d.type === "progress") { setEDoneCnt(d.done); setEFailCnt(d.fail); }
      if (d.type === "done") { addELog("🎉 작업 완료!"); setEWorking(false); es.close(); }
      if (d.type === "error") { addELog(`❌ 오류: ${d.msg}`); setEWorking(false); es.close(); }
    };
    es.onerror = () => { addELog("❌ 작업 연결 오류 (다시 '작업 시작'을 누르면 재시도합니다)"); setEWorking(false); es.close(); };
    es.onclose = () => setEWorking(false);
  };

  const handleEngageStop = async () => {
    if (eEsRef.current) { eEsRef.current.close(); eEsRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${eJobIdRef.current}`, { method: "POST" }); } catch {}
    addELog("⛔ 중단"); setECrawling(false); setEWorking(false);
  };

  /* 답방 1단계: 내 블로그 글 목록 불러오기(추출) */
  const handleLoadMyPosts = () => {
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 내 블로그 계정을 연결하세요");
    setRLoadingPosts(true); setRMyPosts([]); addRLog("📥 내 블로그 글 불러오는 중...");
    const periodDays = rPeriod === "custom" ? rCustomDays : rPeriod;   // 직접설정이면 입력 일수 사용
    const q = new URLSearchParams({ accountId: acc.accountId, selectMode: rSelectMode, count: String(rTargetPosts), period: String(periodDays), ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/my-posts?${q.toString()}`);
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addRLog(d.msg);
      if (d.type === "posts") { setRMyPosts(d.posts || []); addRLog(`✅ 내 글 ${d.posts?.length || 0}개 불러왔어요`); setRLoadingPosts(false); es.close(); }
      if (d.type === "error") { addRLog(`❌ ${d.msg}`); setRLoadingPosts(false); es.close(); }
    };
    es.onerror = () => { addRLog("❌ 불러오기 연결 오류 (다시 시도해주세요)"); setRLoadingPosts(false); es.close(); };
  };

  /* 답방 2단계: 불러온 글의 댓글에 대댓글 실행 */
  const handleReplyStart = () => {
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 답방할 내 블로그 계정을 연결하세요");
    if (!rMyPosts.length) return alert("먼저 '📥 내 글 불러오기'로 대상 글을 불러오세요");
    if (!isUnlimitedPlan && replyUsed >= replyLimit) return alert(`오늘 답방 한도(${replyLimit}건)를 모두 사용했어요. 자정에 초기화됩니다.`);
    if (rMode === "ai" && !(localStorage.getItem("publy_gemini_key") || "")) {
      if (!confirm("AI 답글은 Gemini(무료) 키가 필요해요. 키가 없으면 답글이 건너뛰어집니다. 그래도 시작할까요?")) return;
    }
    setRDoneCnt(0); setRFailCnt(0); setRWorking(true);
    rJobIdRef.current = Date.now().toString();
    const geminiKey = rMode === "ai" ? ((localStorage.getItem("publy_gemini_key") || "")) : "";
    addRLog(`🚀 답방 시작 — 글 ${rMyPosts.length}개 / ${rMode === "ai" ? `AI 답글(${rTone})` : "고정 답글"}${rOnlyNew ? " / 미답변만" : ""}`);
    const body = JSON.stringify({ accountId: acc.accountId, posts: rMyPosts.map(p => p.url), mode: rMode, comment: rComment, tone: rTone, onlyNew: rOnlyNew, delayMin: rDelayMin, delayMax: rDelayMax, geminiKey, jobId: rJobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); rEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addRLog(d.msg);
      if (d.type === "result") {
        addRLog(`${d.status === "success" ? "✅" : d.status === "skip" ? "⏭️" : "❌"} ${d.postTitle || d.blogId || ""} ${d.message || ""}`);
        if (d.status === "success" && userId) { incrementReplyQuota(userId).catch(() => {}); setReplyUsed(u => u + 1); }
      }
      if (d.type === "progress") { setRDoneCnt(d.done); setRFailCnt(d.fail); }
      if (d.type === "done") { addRLog("🎉 답방 완료!"); setRWorking(false); es.close(); }
      if (d.type === "error") { addRLog(`❌ 오류: ${d.msg}`); setRWorking(false); es.close(); }
    };
    es.onerror = () => { addRLog("❌ 연결 오류 (다시 '답방 시작'을 누르면 재시도합니다)"); setRWorking(false); es.close(); };
    es.onclose = () => setRWorking(false);
  };
  const handleReplyStop = async () => {
    if (rEsRef.current) { rEsRef.current.close(); rEsRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${rJobIdRef.current}`, { method: "POST" }); } catch {}
    addRLog("⛔ 중단"); setRWorking(false);
  };

  /* 품앗이 실행: 연결된 계정들끼리 서로 공감·댓글 */
  const handlePumasiStart = () => {
    const connected = accounts.filter(a => a.sessionOk && a.blogId);
    if (connected.length < 2) return alert("품앗이는 연결된(비번 확인된) 계정이 2개 이상 필요해요.\n계정을 추가하고 '계정 연결하기'로 먼저 연결해주세요.");
    if (pumDoComment && pumCommentMode === "ai" && !localStorage.getItem("publy_gemini_key")) {
      if (!confirm("AI 자동 댓글은 Gemini(무료) 키가 필요해요. 키가 없으면 댓글이 건너뛰어져요. 그래도 시작할까요?")) return;
    }
    setPumLogs([]); setPumDone(0); setPumFail(0); setPumWorking(true);
    pumJobIdRef.current = Date.now().toString();
    const comment = pumCommentMode === "single" ? pumComment
      : pumCommentMode === "multi" ? pumMultiComments.split("\n").filter(l => l.trim()).join("|||") : "";
    const geminiKey = pumCommentMode === "ai" ? (localStorage.getItem("publy_gemini_key") || "") : "";
    const maxReceivers = Math.max(1, connected.length - 1);
    const accs = connected.map(a => ({ accountId: a.accountId, blogId: a.blogId, posts: Math.min(pumasiPostsLimit, pumPostsByAcc[a.accountId] || 3), receiveLimit: Math.min(maxReceivers, Math.max(1, pumReceiveByAcc[a.accountId] || 3)) }));
    addPumLog(`🤝 품앗이 시작 — 계정 ${accs.length}개 (${accs.map(a => `${a.blogId}:글${a.posts}·받기${a.receiveLimit}명`).join(", ")})`);
    const body = JSON.stringify({ accounts: accs, comment, doLike: pumDoLike, doComment: pumDoComment, aiComment: pumCommentMode === "ai", commentTone: pumTone, geminiKey, delayMin: pumDelayMin, delayMax: pumDelayMax, readRelated: pumReadRelated, spreadHours: pumSpread / 60, jobId: pumJobIdRef.current, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/pumasi`, { method: "POST", headers: { "Content-Type": "application/json" }, body }); pumEsRef.current = es;
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addPumLog(d.msg);
      if (d.type === "result" && userId) { getPumasiDailyUsage(userId).then(setPumUsed); }
      if (d.type === "progress") { setPumDone(d.done); setPumFail(d.fail); }
      if (d.type === "done") { addPumLog("🎉 품앗이 완료!"); setPumWorking(false); es.close(); }
      if (d.type === "error") { addPumLog(`❌ 오류: ${d.msg}`); setPumWorking(false); es.close(); }
    };
    es.onerror = () => { addPumLog("❌ 연결 오류 (다시 시작을 누르면 재시도)"); setPumWorking(false); es.close(); };
    es.onclose = () => setPumWorking(false);
  };
  const handlePumasiStop = async () => {
    if (pumEsRef.current) { pumEsRef.current.close(); pumEsRef.current = null; }
    try { await botFetch(`${BOT}/api/stop/${pumJobIdRef.current}`, { method: "POST" }); } catch {}
    addPumLog("⛔ 중단"); setPumWorking(false);
  };
  const handlePumasiReport = async (blogId: string) => {
    if (!blogId) return;
    setPumReportLoading(true); setPumReport(null); setPumReportBlog(blogId);
    try {
      const r = await botFetch(`${BOT}/api/pumasi-report?blogId=${encodeURIComponent(blogId)}`);
      const d = await r.json();
      if (d.error) { alert(`리포트를 불러오지 못했어요: ${d.error}`); }
      else setPumReport(d);
    } catch (e: any) { alert(`리포트 오류: ${e.message}`); }
    setPumReportLoading(false);
  };

  /* 블로그 건강검진 실행 */
  const handleBlogDiagnose = () => {
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 진단할 내 블로그 계정을 연결하세요");
    if (!isUnlimitedPlan && scUsed >= scLimit) return alert(`오늘 블로그 진단 횟수(${scLimit}회)를 모두 사용했어요. 자정에 초기화됩니다.`);
    setScLoading(true); setScResult(null); setScLogs([]); setScSolutions(null); addScLog("📈 블로그 지표를 수집하는 중...");
    if (userId) { incrementBlogscoreQuota(userId).catch(() => {}); setScUsed(u => u + 1); }  // 진단 시작 시 1회 차감
    const q = new URLSearchParams({ accountId: acc.accountId, plan, ...(userId ? { userId } : {}) });
    const es = new BotEventStream(`${BOT}/api/blog-stats?${q.toString()}`);
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addScLog(d.msg);
      if (d.type === "stats") { setScResult(d.stats); addScLog("✅ 진단 완료!"); setScLoading(false); es.close(); }
      if (d.type === "error") { addScLog(`❌ ${d.msg}`); setScLoading(false); es.close(); }
    };
    es.onerror = () => { addScLog("❌ 연결 오류 (다시 시도해주세요)"); setScLoading(false); es.close(); };
  };

  const scLogNo = (url: string) => url.match(/(?:logNo=|\/)(\d{6,})(?:[/?&]|$)/)?.[1] || "";

  /* 블로그 지수 1단계: 기간에 맞는 내 글 불러오기 */
  const handleLoadScorePosts = () => {
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 검사할 내 블로그 계정을 연결하세요");
    setScPostsLoading(true); setScPosts([]); setScSelectedLogNos([]); setScSolutions(null);
    const periodDays = scPeriod === "custom" ? scCustomDays : scPeriod;
    const q = new URLSearchParams({ accountId: acc.accountId, selectMode: scPostMode, count: "100", period: String(periodDays) });
    addScLog(`📥 검색노출 검사 글 불러오는 중 (${scPostMode === "all" ? "전체" : `최근 ${periodDays}일`})...`);
    const es = new BotEventStream(`${BOT}/api/my-posts?${q.toString()}`);
    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === "log") addScLog(d.msg);
      if (d.type === "posts") {
        const posts = (d.posts || []) as {url:string;title:string;date:string}[];
        const ids = posts.map(post => scLogNo(post.url)).filter(Boolean);
        setScPosts(posts); setScSelectedLogNos(ids); setScPostsLoading(false);
        addScLog(`✅ 검사 후보 ${posts.length}개를 불러왔어요`); es.close();
      }
      if (d.type === "error") { addScLog(`❌ ${d.msg}`); setScPostsLoading(false); es.close(); }
    };
    es.onerror = () => { addScLog("❌ 글 목록 연결 오류"); setScPostsLoading(false); es.close(); };
  };

  /* 블로그 지수 2단계: 체크한 글만 검색 노출 검사 */
  const handleCheckSelectedExposure = async () => {
    const acc = accounts.find(a => a.sessionOk);
    if (!acc) return alert("먼저 검사할 내 블로그 계정을 연결하세요");
    if (!scResult) return alert("먼저 '블로그 진단 시작'으로 기본 건강 리포트를 만들어주세요");
    if (!scSelectedLogNos.length) return alert("검색노출을 확인할 글을 하나 이상 선택하세요");
    setScExposureLoading(true); setScSolutions(null);
    addScLog(`🔎 선택한 글 ${scSelectedLogNos.length}개의 검색노출을 확인하는 중...`);
    try {
      const response = await botFetch(`${BOT}/api/exposure-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: acc.accountId, plan, logNos: scSelectedLogNos }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setScResult(prev => prev ? { ...prev, exposureChecks: data.checks || [], lowQualitySuspected: data.lowQualitySuspected, checkedTodayCount: data.checkedTodayCount, exposureCompletedCount: data.completedCount, totalPostsForExposure: data.totalPostsForExposure, exposureLimit: data.limit } : prev);
      addScLog(`✅ 검색노출 ${data.checks?.length || 0}개 검사 완료`);
    } catch (e: any) { addScLog(`❌ 검색노출 검사 실패: ${e.message}`); }
    finally { setScExposureLoading(false); }
  };

  /* 저품질/누락 글 제목·키워드 개선 솔루션 (AI) */
  const handleGetSolutions = async () => {
    const key = (localStorage.getItem("publy_gemini_key") || "");
    if (!key) return alert("제목·키워드 개선 솔루션은 무료 Gemini 키가 필요해요.\n설정 → 글쓰기 AI에서 Gemini 키를 먼저 등록해주세요.");
    const checks = scResult?.exposureChecks || [];
    // 검색에 누락된(exposed===false) 글 = 고칠 대상 (최대 10개)
    const missing = checks.filter(c => c.exposed === false).map(c => c.title).slice(0, 10);
    if (!missing.length) return alert("검색에 누락된 글이 없어요. (개선이 급한 글이 없다는 좋은 신호예요!)");
    // ★내 블로그에서 실제로 검색 상위에 잡힌 성공 제목(순위 낮을수록 상위) = AI가 학습할 실전 성공 패턴
    const winners = checks.filter(c => c.exposed === true && c.rank != null).sort((a, b) => (a.rank! - b.rank!)).slice(0, 12).map(c => `${c.title} (검색 약 ${c.rank}위)`);
    setScSolLoading(true); setScSolutions(null); setScSolPage(0);
    const winnerBlock = winners.length
      ? `\n\n[⭐이 블로그에서 실제로 검색 상위에 잡힌 '성공 제목'들 — 반드시 이 패턴을 학습해서 반영]\n${winners.join("\n")}\n→ 위 성공 제목들의 공통 패턴(구체적 지명·제품명·상황·숫자·검색어 배치)을 분석해서, 아래 누락 제목을 '같은 블로그에서 통한 방식'으로 고쳐라. 일반론 말고 이 블로그에 실제로 통한 스타일로.`
      : "";
    const prompt = `너는 네이버 블로그 상위노출(SEO) 전문가야. 이 블로그의 아래 글들은 네이버 검색에 노출이 안 되고 있어(누락). 각 제목을 검색에 잘 잡히게 정교하게 고쳐줘.${winnerBlock}\n\n각 누락 제목마다 아래 JSON 형식으로만 답해. 다른 말 절대 금지. 순수 JSON 배열만:\n[{"original":"원래제목","diagnosis":"이 제목이 왜 검색 안 되는지 핵심 원인 1문장(과장/낚시/검색어없음/너무추상 등)","newTitle":"개선안1 (실제 검색어를 앞에 배치, 25~35자, 구체적)","newTitle2":"개선안2 (다른 각도의 대안)","keywords":["이 글 본문에 넣을 실제 검색 키워드5개"],"bodyTip":"본문/태그를 어떻게 손보면 좋은지 실전 팁 1문장","expectedEffect":"이렇게 바꾸면 기대되는 효과 1문장"}]\n\n[핵심 규칙]\n- newTitle: 사람들이 진짜 네이버에 치는 검색어(지명+대상+상황) 형태. 과장·감탄사(대박/진짜/1등/충격) 절대 금지.\n- 위 '성공 제목' 패턴이 있으면 그 스타일을 최대한 따라라.\n- keywords: 검색량 있을 법한 구체 키워드 5개(롱테일 포함).\n- 모든 답변은 실행 가능하고 구체적으로. 뻔한 일반론 금지.\n\n[누락 제목들]\n${missing.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
    // 2.0-flash 우선(thinking 토큰 안 먹어 JSON 안정적). 토큰 넉넉히(8000)+JSON 강제로 응답 잘림·설명 섞임 방지.
    const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash"];
    let lastErr = "";
    for (const model of models) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8000, temperature: 0.8, responseMimeType: "application/json" } }),
        });
        const d: any = await r.json();
        if (!r.ok) { lastErr = d?.error?.message || `API ${r.status}`; if (r.status === 404 || r.status === 400) continue; continue; }
        let txt: string = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        txt = txt.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        // 배열 부분만 안전하게 추출(앞뒤에 설명이 붙어도 파싱되게)
        const s = txt.indexOf("["), e2 = txt.lastIndexOf("]");
        if (s >= 0 && e2 > s) txt = txt.slice(s, e2 + 1);
        const arr = JSON.parse(txt);
        if (Array.isArray(arr) && arr.length) {
          setScSolutions(arr.map((x: any) => ({ original: String(x.original || ""), diagnosis: String(x.diagnosis || ""), newTitle: String(x.newTitle || ""), newTitle2: String(x.newTitle2 || ""), keywords: Array.isArray(x.keywords) ? x.keywords.map(String) : [], bodyTip: String(x.bodyTip || ""), expectedEffect: String(x.expectedEffect || ""), reason: String(x.reason || "") })));
          setScSolLoading(false);
          return;
        }
      } catch (e: any) { lastErr = e.message; }
    }
    setScSolLoading(false);
    alert("솔루션 생성에 실패했어요. 잠시 후 다시 시도해주세요.\n(" + (lastErr || "응답 형식 오류") + ")");
    setScSolLoading(false);
  };

  /* CSV 저장 */
  const handleSaveHistory = () => {
    const csv = ["키워드,블로그ID,결과,메시지", ...results.map(r => `${r.keyword},${r.blogId},${r.status},${r.message}`)].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = `서이추_${new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "")}.csv`; a.click();
  };

  const handleEngageSaveHistory = () => {
    const csv = ["키워드,블로그ID,포스트URL,공감,댓글,결과,메시지", ...eResults.map(r => `${r.keyword},${r.blogId},${r.postUrl},${r.liked},${r.commented},${r.status},${r.message}`)].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = `공감댓글_${new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "")}.csv`; a.click();
  };

  const handleLoadList = (isEngage = false) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const newTargets: Target[] = lines.map(line => {
        const parts = line.split(",");
        return parts.length >= 2 ? { keyword: parts[0].trim(), blogId: parts[1].trim() } : { keyword: "직접입력", blogId: parts[0].trim() };
      }).filter(t => t.blogId);
      if (isEngage) {
        setETargets(newTargets);
        setEResults(newTargets.map(t => ({ ...t, postUrl: "", liked: false, commented: false, status: "pending" as const, message: "대기중" })));
        addELog(`📂 ${newTargets.length}개 불러오기 완료`);
      } else {
        setTargets(newTargets);
        setResults(newTargets.map(t => ({ ...t, status: "pending" as const, message: "대기중" })));
        addLog(`📂 ${newTargets.length}개 불러오기 완료`);
      }
    };
    input.click();
  };

  /* 헬퍼 */
  const statusColor = (s: WorkResult["status"]) => s === "success" ? "var(--success)" : s === "fail" ? "var(--danger)" : s === "skip" ? "var(--text3)" : s === "running" ? "var(--info)" : "var(--text3)";
  const statusLabel = (s: WorkResult["status"]) => s === "success" ? "신청 완료" : s === "fail" ? "실패" : s === "skip" ? "스킵" : s === "running" ? "진행중..." : "대기중";
  const eStatusColor = (s: EngageResult["status"]) => s === "success" ? "var(--success)" : s === "fail" ? "var(--danger)" : s === "skip" ? "var(--text3)" : s === "running" ? "var(--info)" : "var(--text3)";
  const eStatusLabel = (s: EngageResult["status"]) => s === "success" ? "완료" : s === "fail" ? "실패" : s === "skip" ? "스킵" : s === "running" ? "진행중..." : "대기중";

  const Toggle = ({ val, set, label }: { val: boolean; set: (v: boolean) => void; label: string }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)", padding: "6px 0" }}>
      <div onClick={() => set(!val)} style={{ width: 42, height: 24, borderRadius: 99, background: val ? "var(--accent)" : "var(--border)", position: "relative", transition: "background .2s", cursor: "pointer", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: val ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.2)" }} />
      </div>
      {label}
    </label>
  );

  /* ── 공통 레이아웃 헬퍼 ── */
  // 등급별 일일 사용량 게이지 (답방·블로그진단 공용)
  const UsageGauge = ({ label, used, limit, unit, color }: { label: string; used: number; limit: number; unit: string; color: string }) => {
    const pct = isUnlimitedPlan ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);
    const danger = !isUnlimitedPlan && used >= limit;
    const remain = Math.max(0, limit - used);
    return (
      <div className="card" style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>{label} <span style={{ fontSize: 10.5, color: "var(--text3)", fontWeight: 600 }}>(자정 초기화)</span></span>
          <span style={{ fontSize: 13, fontWeight: 800, color: danger ? "var(--danger)" : color }}>
            {isUnlimitedPlan ? "∞ 무제한" : <>{used} / {limit}{unit} · <span style={{ color: danger ? "var(--danger)" : "#00c896" }}>{danger ? "한도 도달" : `${remain}${unit} 남음`}</span></>}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: "var(--card2)", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 99, width: isUnlimitedPlan ? "100%" : `${pct}%`, background: danger ? "var(--danger)" : color, opacity: isUnlimitedPlan ? .4 : 1, transition: "width .5s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 7, fontWeight: 500 }}>
          {isUnlimitedPlan ? "무제한 회원이라 한도 없이 사용할 수 있어요" : `내 등급(${plan==="free"?"무료":plan==="basic"?"베이직":plan==="pro"?"프로":plan}) 하루 ${limit}${unit} · 자정에 다시 채워져요`}
        </div>
      </div>
    );
  };


  return (
    <div style={{ animation: "fadeUp .25s ease both" }}>
      <style>{`
        .npg-2col{display:grid;grid-template-columns:400px 1fr;gap:20px;align-items:start;}
        @media(max-width:820px){
          .npg-2col{grid-template-columns:1fr;}
          .npg-2col .card,.npg-2col button,.npg-2col input,.npg-2col textarea{max-width:100%;box-sizing:border-box;}
        }
      `}</style>

      {/* 봇 오프라인 배너 */}
      {!botOnline && (
        <div style={{ marginBottom: 16, padding: "14px 18px", borderRadius: 14, background: "rgba(255,83,99,.08)", border: "1.5px solid rgba(255,83,99,.3)", color: "var(--danger)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>봇 서버가 오프라인입니다. <code style={{ background: "var(--card2)", padding: "2px 7px", borderRadius: 5, fontSize: 12 }}>neighbor-bot</code> 폴더에서 <code style={{ background: "var(--card2)", padding: "2px 7px", borderRadius: 5, fontSize: 12 }}>npm start</code> 를 실행해주세요.</span>
        </div>
      )}

      {/* 탭 + 사용방법 버튼 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        {!singleTab && ([{ key: "neighbor", label: "🤝 서이추" }, { key: "engage", label: "❤️ 공감·댓글" }] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: "11px 26px", borderRadius: 12, border: `2px solid ${tab === key ? "var(--accent)" : "var(--border)"}`, background: tab === key ? "var(--accent-bg)" : "transparent", color: tab === key ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 14, fontWeight: 800, fontFamily: "inherit", transition: "all .2s" }}>
            {label}
          </button>
        ))}
        <button onClick={() => setShowGuide(true)} style={{ marginLeft: singleTab ? 0 : "auto", padding: "11px 20px", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, transition: "all .2s" }}>
          📖 사용방법
        </button>
      </div>

      {/* 사용설명서 모달 */}
      {showGuide && <GuideModal tab={tab} onClose={() => setShowGuide(false)} />}

      {/* 기능 설명 배너 (탭별로 항상 표시) */}
      {tab === "neighbor" ? (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>🤝 서이추(서로이웃 신청) 자동화</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            키워드로 블로그를 모아 <b>서로이웃 신청</b>을 자동으로 보내요. 새 이웃을 늘려 방문·소통을 키우는 기능이에요.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 네이버 하루 한도는 100건.</span> 계정 보호를 위해 <b>하루 50건 정도로 분산</b>하고, 딜레이(5~10초)와 예약 분산을 함께 쓰는 걸 권장해요.
          </div>
        </div>
      ) : tab === "engage" ? (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>❤️ 공감·댓글 자동화</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            키워드로 찾은 블로그 글에 <b>공감(하트)과 댓글</b>을 자동으로 남겨요. 이웃과 꾸준히 소통해 블로그 지수를 올리는 기능이에요.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 권장: 공감은 하루 100개, 댓글은 하루 50개 미만.</span> 강제 제한은 없지만, 계정 보호를 위해 간격을 넉넉히 두고 이 범위 안에서 쓰는 걸 추천해요. (댓글이 공감보다 스팸 판정 위험이 큽니다)
          </div>
        </div>
      ) : tab === "reply" ? (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>💬 답방(내 블로그 댓글에 대댓글) 자동화</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            내 블로그 글에 <b>이웃들이 남긴 댓글</b>을 찾아, 하나하나 <b>답글(대댓글)</b>을 자동으로 달아줘요. 답방을 부지런히 하면 이웃과의 소통이 살아나고 <b>재방문·체류시간이 늘어 블로그 지수에 도움</b>이 됩니다.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 AI 답글을 켜면</span> 댓글 내용을 읽고 <b>매번 다른 자연스러운 답글</b>을 만들어, 똑같은 답글 반복으로 인한 어색함과 스팸 위험을 줄여줘요.
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 18, padding: "16px 20px", borderRadius: 16, background: "var(--card)", border: "1.5px solid var(--border)", boxShadow: "0 2px 12px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>📈 블로그 건강검진</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600, lineHeight: 1.65 }}>
            내 블로그의 <b>총 글 수·이웃 수·최근 발행 활동</b>을 실제로 읽어와 <b style={{color:"#00c896"}}>건강 상태를 진단</b>하고, 지금 뭘 하면 좋을지 <b style={{color:"#ff5fa2"}}>맞춤 조언</b>을 드려요.<br />
            <span style={{ color: "#c88010", fontWeight: 700 }}>💡 참고:</span> 네이버는 공식 '지수'를 공개하지 않아요. 이 진단은 <b>실제 지표를 바탕으로 한 퍼블리 자체 건강검진</b>으로, 블로그 관리 방향을 잡는 용도예요.
          </div>
        </div>
      )}

      {/* ═══════════ 서이추 탭 ═══════════ */}
      {tab === "neighbor" && (
        <div className="npg-2col">
          {/* 왼쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} />

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>🔍 추출 설정</div>
              <KeywordAnalyzer keywords={buddyKw} loading={buddyKwLoading} onAnalyze={analyzeBuddyKeywords}
                onPick={w => setKeywords(prev => { const list = prev.split(",").map(s => s.trim()).filter(Boolean); if (!list.includes(w)) list.push(w); return list.join(", "); })} />
              <div style={{ marginBottom: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드 (쉼표로 구분)</label>
                <input className="inp" placeholder="예: 원주맛집, 강원도여행, 육아일기" value={keywords} onChange={e => setKeywords(e.target.value)} style={{ fontSize: 13, padding: "11px 14px" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드당 추출 수</label>
                  <input className="inp" type="number" min={1} max={300} {...numProps(countPerKw, setCountPerKw, 1, 300, 34)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    💡 키워드 하나당 서이추 신청할 블로거를 <b style={{color:"#00c896"}}>몇 명 불러올지</b> 정해요. (숫자가 클수록 더 많은 대상을 모읍니다)
                  </div>
                </div>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>하루 신청 한도</label>
                  <input className="inp" type="number" min={1} max={100} {...numProps(dailyLimit, setDailyLimit, 1, 100, 100)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    💡 오늘 실제로 서로이웃 신청을 보낼 <b style={{color:"#ff5fa2"}}>최대 건수</b>예요. <b style={{color:"#00c896"}}>계정 안전</b>을 위해 이 수까지만 신청하고 멈춥니다.
                  </div>
                </div>
              </div>

              {/* ── 체험단 모집 최적화 ── */}
              <div style={{ marginBottom: 12, padding: "14px", borderRadius: 12, background: "var(--accent-bg)", border: "1px solid var(--accent)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--accent-text)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  🎯 체험단 모집 최적화
                </div>
                <label className="inp-label" style={{ fontSize: 11.5, marginBottom: 6, display: "block", color: "var(--text3)", fontWeight: 600 }}>수집 정렬</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {([["recentdate", "최신 활동순"], ["sim", "정확도순"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setOrderBy(v)} style={{ flex: 1, padding: "10px", borderRadius: 9, border: `2px solid ${orderBy === v ? "var(--accent)" : "var(--border)"}`, background: orderBy === v ? "var(--card)" : "transparent", color: orderBy === v ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{l}</button>
                  ))}
                </div>
                <label className="inp-label" style={{ fontSize: 11.5, marginBottom: 6, display: "block", color: "var(--text3)", fontWeight: 600 }}>최근 글 쓴 블로거만 <span style={{ color: "var(--text3)", fontWeight: 400 }}>(죽은 블로그 제외)</span></label>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {([[0, "전체"], [7, "7일"], [30, "30일"], [90, "90일"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setActiveDays(v)} style={{ flex: 1, padding: "10px", borderRadius: 9, border: `2px solid ${activeDays === v ? "var(--accent)" : "var(--border)"}`, background: activeDays === v ? "var(--card)" : "transparent", color: activeDays === v ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{l}</button>
                  ))}
                </div>
                <Toggle val={excludeMarket} set={setExcludeMarket} label="판매·마켓 블로거 제외" />
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text3)" }}>
                총 수집 예정: <strong style={{ color: "var(--accent-text)" }}>{keywords.split(",").filter(k => k.trim()).length * countPerKw}개</strong>
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>⚙️ 작업 옵션</div>
              <div style={{ marginBottom: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초) — 너무 짧으면 봇 탐지될 수 있어요</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input className="inp" type="number" min={1} max={60} {...numProps(delayMin, setDelayMin, 1, 60, 5)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 14, fontWeight: 700 }}>~</span>
                  <input className="inp" type="number" min={1} max={120} {...numProps(delayMax, setDelayMax, 1, 120, 10)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>초</span>
                </div>
              </div>
              <Toggle val={skipDone} set={setSkipDone} label="이미 처리된 블로그 건너뛰기" />
              <div style={{ fontSize: 12, color: "var(--text2)", margin: "2px 2px 6px", lineHeight: 1.55, fontWeight: 500 }}>
                💡 오늘 이미 서이추한 블로거는 이 설정과 상관없이 <b style={{color:"#ff5fa2"}}>자동으로 제외</b>돼요. (<b style={{color:"#00c896"}}>같은 날 중복 신청 방지</b>)
              </div>
              <Toggle val={qualityFilter} set={setQualityFilter} label="죽은·광고 블로그 자동 거르기 (헛신청 방지)" />
              {skipDone && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 2px 2px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>거절·무응답은</span>
                  <input className="inp" type="number" min={0} max={365} {...numProps(retryDays, setRetryDays, 0, 365, 30)} style={{ width: 74, fontSize: 13, padding: "9px 12px", textAlign: "center" }} />
                  <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>일 뒤 다시 신청</span>
                  <span style={{ fontSize: 11.5, color: "var(--text3)" }}>{retryDays === 0 ? "(0=영구 제외)" : "(성공한 곳은 계속 제외)"}</span>
                </div>
              )}
              <Toggle val={autoStart} set={setAutoStart} label="추출 완료 후 바로 신청 시작" />
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>💬 서이추 멘트</span>
                <button onClick={restoreDefaultMsg} title="수정한 멘트를 처음 기본 멘트로 되돌립니다"
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, transition: "all .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--accent)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(.96)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "")}>↩︎ 기본값 복원</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {(["single", "multi"] as const).map(m => (
                  <button key={m} onClick={() => setMsgMode(m)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: `2px solid ${msgMode === m ? "var(--accent)" : "var(--border)"}`, background: msgMode === m ? "var(--accent-bg)" : "transparent", color: msgMode === m ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                    {m === "single" ? "단일 멘트" : "여러 멘트 순환"}
                  </button>
                ))}
              </div>
              {/* 체험단 멘트 채우기 — 색상 강조 박스. 단일=1개 넣기/다른문구, 여러=개수선택+섞기 */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 12, background: "var(--accent-bg)", border: "1px solid var(--accent-border)" }}>
                <span style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 800, marginRight: 2, display: "flex", alignItems: "center", gap: 4 }}>🎁 체험단 멘트</span>
                {msgMode === "single" ? (
                  <>
                    <button onClick={() => applyCampaignPreset()} title="체험단 홍보 멘트를 넣습니다"
                      style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", transition: "all .15s" }}
                      onMouseDown={e => (e.currentTarget.style.transform = "scale(.94)")} onMouseUp={e => (e.currentTarget.style.transform = "")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>넣기</button>
                    <button onClick={() => applyCampaignPreset()} title="다른 문구로 바꾸기"
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent-text)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit" }}>🔀 다른 문구</button>
                  </>
                ) : (
                  <>
                    {[3, 5, 8].map(n => (
                      <button key={n} onClick={() => applyCampaignPreset(n)} title={`체험단 멘트 ${n}개를 무작위로 골라 채웁니다`}
                        style={{ padding: "6px 13px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", transition: "all .15s" }}
                        onMouseDown={e => (e.currentTarget.style.transform = "scale(.94)")} onMouseUp={e => (e.currentTarget.style.transform = "")} onMouseLeave={e => (e.currentTarget.style.transform = "")}>{n}개</button>
                    ))}
                    <button onClick={() => applyCampaignPreset(5)} title="다른 조합으로 다시 섞기"
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent-text)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit" }}>🔀 섞기</button>
                  </>
                )}
              </div>
              {msgMode === "single" ? (
                <textarea className="inp" rows={3} value={singleMsg} onChange={e => setSingleMsg(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} />
              ) : (
                <>
                  <textarea className="inp" rows={6} value={multiMsgs} onChange={e => setMultiMsgs(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용됩니다" />
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {multiMsgs.split("\n").filter(l => l.trim()).length}개 멘트 등록됨 · 전체 체험단 멘트 {CAMPAIGN_PRESETS.length}종</div>
                </>
              )}
            </div>

            {/* 예약·분산 실행 (기존 '한번에'와 별개) */}
            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: spreadMode ? 12 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15 }}>📅</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>예약 분산 실행</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>사람처럼 나눠서</span>
                </div>
                <Toggle val={spreadMode} set={setSpreadMode} label="" />
              </div>
              {spreadMode && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>
                    <input className="inp" type="number" min={2} max={10} {...numProps(spreadBatches, setSpreadBatches, 2, 10, 3)} style={{ width: 60, fontSize: 13, padding: "9px 10px", textAlign: "center" }} />
                    <span>회로 나눠서</span>
                    <input className="inp" type="number" min={1} max={720} {...numProps(spreadGapMin, setSpreadGapMin, 1, 720, 90)} style={{ width: 72, fontSize: 13, padding: "9px 10px", textAlign: "center" }} />
                    <span>분 간격으로</span>
                  </div>
                  {spreadRunning && (
                    <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 12, background: "var(--accent-bg)", border: "1px solid var(--accent)", fontSize: 12.5, color: "var(--accent-text)", fontWeight: 700 }}>
                      진행 {spreadInfo.cur}/{spreadInfo.total}회차
                      {spreadInfo.nextAt && <span> · 다음 {new Date(spreadInfo.nextAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 예정</span>}
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text3)", marginTop: 3 }}>앱을 켜둔 채로 기다려 주세요.</div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleCrawl} disabled={crawling || working || spreadRunning || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {crawling ? <><span className="spinner" />블로그 추출 중...</> : "🔍 블로그 추출 시작"}
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => spreadMode ? startSpread() : startWork()} disabled={crawling || working || spreadRunning || !targets.length || !botOnline} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  {working || spreadRunning ? <><span className="spinner" />작업 중...</> : spreadMode ? "📅 분산 실행 시작" : "🚀 서이추 시작"}
                </button>
                <button className="btn btn-secondary" onClick={() => handleLoadList(false)} disabled={crawling || working || spreadRunning} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  📂 리스트 불러오기
                </button>
              </div>
              {(crawling || working) && !spreadRunning && (
                <button className="btn-stop" onClick={handleStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 작업 중단</button>
              )}
              {spreadRunning && (
                <button className="btn-stop" onClick={stopSpread} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 분산 실행 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 오늘 서이추 사용량 — 본인 플랜 한도 기준. 무제한은 네이버 권장(100) 안내 */}
            {userId && (() => {
              const NAVER_REC = 100;                          // 네이버 권장 상한(강제 아님)
              const unlimited = plan === "unlimited" || plan === "admin";  // 무제한: 플랜 한도 없음
              const limit = quotaLimit;                       // 본인 플랜 한도(무료10/베이직50/프로100)
              const pct = unlimited ? Math.min(100, (quotaUsed / NAVER_REC) * 100) : Math.min(100, (quotaUsed / limit) * 100);
              const danger = !unlimited && quotaUsed >= limit;             // 본인 한도 도달(무제한 제외)
              const warn = unlimited ? quotaUsed >= NAVER_REC : quotaUsed >= limit * 0.8;
              const bar = danger ? "#ff5363" : warn ? "#ffb020" : "#00d68f";
              return (
                <div style={{ padding: "20px 24px", borderRadius: 20, background: "var(--card)", border: `1.5px solid ${danger ? "rgba(255,83,99,.45)" : warn ? "rgba(255,176,32,.4)" : "var(--border)"}`, boxShadow: "0 2px 14px rgba(0,0,0,.04)" }}>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        🛡️ 오늘 서이추 사용량 <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", opacity: .8 }}>(자정 자동 리셋)</span>
                      </div>
                      <div style={{ fontSize: 40, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>
                        {quotaUsed}<span style={{ fontSize: 20, color: "var(--text3)", fontWeight: 600 }}> {unlimited ? "건 · 무제한" : `/ ${limit}건`}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 26, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{unlimited ? "∞" : danger ? "마감" : `${limit - quotaUsed}건`}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginTop: 4 }}>{unlimited ? "한도 없음" : danger ? "자정까지 대기" : "남음"}</div>
                    </div>
                  </div>
                  <div style={{ position: "relative", height: 12, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg, ${bar}, ${bar}cc)`, transition: "width .5s ease" }} />
                  </div>
                  {danger
                    ? <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>오늘 플랜 한도에 도달했어요. 계정 보호를 위해 자정 이후 다시 돌려주세요.</div>
                    : <div style={{ fontSize: 12.5, color: warn ? "#c88010" : "var(--text3)", fontWeight: 600, marginTop: 10 }}>💡 네이버 권장은 <b>하루 100건 미만</b>이에요. 간격을 넉넉히 두고 나눠서 진행하는 걸 추천해요.</div>}
                </div>
              );
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[{ label: "수집된 블로그", val: targets.length, color: "var(--info)" }, { label: "신청 완료", val: doneCnt, color: "var(--success)" }, { label: "실패", val: failCnt, color: "var(--danger)" }].map(({ label, val, color }) => (
                <div key={label} style={{ padding: "24px 18px", borderRadius: 18, background: "var(--card)", border: "1px solid var(--border)", textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,.03)" }}>
                  <div style={{ fontSize: 40, fontWeight: 900, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 8, fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="card-title" style={{ margin: 0 }}>📋 작업 현황 {results.length > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>({results.length}개)</span>}</div>
                {results.length > 0 && <button onClick={handleSaveHistory} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>💾 저장</button>}
              </div>
              {results.length === 0 ? (
                <div style={{ padding: "72px 20px", textAlign: "center", color: "var(--text3)" }}>
                  <div style={{ fontSize: 44, marginBottom: 12, opacity: .5 }}>📋</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text2)" }}>아직 작업 내역이 없어요</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>블로그를 추출하고 서이추를 시작하면 여기에 실시간으로 표시됩니다</div>
                </div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg2)", position: "sticky", top: 0 }}>
                      {["키워드", "블로거", "결과"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--text3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{results.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--card-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 14px", color: "var(--accent-text)", fontWeight: 700 }}>{r.keyword}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            {r.thumbnail && <img src={r.thumbnail} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} onError={e => (e.currentTarget.style.display = "none")} />}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{r.nickName || r.blogName || r.blogId}</div>
                              <a href={r.postUrl || `https://blog.naver.com/${r.blogId}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 11 }}>
                                {r.blogId}{r.addDate ? <span style={{ color: "var(--text3)" }}> · {relTime(r.addDate)}</span> : null}
                              </a>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: `${statusColor(r.status)}18`, color: statusColor(r.status), border: `1px solid ${statusColor(r.status)}40`, fontWeight: 700 }}>{statusLabel(r.status)}</span>
                          {(r.status === "fail" || r.status === "skip") && r.message && <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>{r.message}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <LogBox logs={logs} logRef={logRef} onClear={() => setLogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 공감·댓글 탭 ═══════════ */}
      {tab === "engage" && (
        <div className="npg-2col">
          {/* 왼쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} />

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>🔍 추출 설정</div>
              {/* 수집 소스 선택: 키워드 검색 vs 내 이웃새글 */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button onClick={() => setESource("keyword")}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${eSource === "keyword" ? "var(--accent)" : "var(--border)"}`, background: eSource === "keyword" ? "var(--accent-bg)" : "transparent", color: eSource === "keyword" ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>
                  🔍 키워드로 찾기
                </button>
                <button onClick={() => setESource("buddy")}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${eSource === "buddy" ? "var(--accent)" : "var(--border)"}`, background: eSource === "buddy" ? "var(--accent-bg)" : "transparent", color: eSource === "buddy" ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>
                  👥 내 이웃새글
                </button>
              </div>
              {eSource === "keyword" ? (
                <>
                  <KeywordAnalyzer keywords={buddyKw} loading={buddyKwLoading} onAnalyze={analyzeBuddyKeywords}
                    onPick={w => setEKeywords(prev => { const list = prev.split(",").map(s => s.trim()).filter(Boolean); if (!list.includes(w)) list.push(w); return list.join(", "); })} />
                  <div style={{ marginBottom: 14 }}>
                    <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>키워드 (쉼표로 구분)</label>
                    <input className="inp" placeholder="예: 맛집, 육아, 인테리어" value={eKeywords} onChange={e => setEKeywords(e.target.value)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, background: "var(--accent-bg)", border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6 }}>
                  👥 연결된 계정의 <b>내 서로이웃들 최근 글</b>을 자동으로 불러와 공감·댓글을 남깁니다. 키워드 없이 아래 <b>추출 시작</b>만 누르세요.
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>{eSource === "buddy" ? "가져올 이웃 수 (최대)" : "키워드당 추출 수"}</label>
                  <input className="inp" type="number" min={1} max={200} {...numProps(eCountPerKw, setECountPerKw, 1, 200, 20)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    {eSource === "buddy"
                      ? "💡 내 서로이웃 중 최근 글을 쓴 사람을 최대 몇 명 불러올지 정해요. (숫자가 클수록 더 많은 이웃 글을 가져옵니다)"
                      : "💡 키워드 하나당 블로그 글을 몇 개 불러올지 정해요."}
                  </div>
                </div>
                <div>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>하루 작업 한도</label>
                  <input className="inp" type="number" min={1} max={200} {...numProps(eDailyLimit, setEDailyLimit, 1, 200, 50)} style={{ fontSize: 13, padding: "11px 14px" }} />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>
                    💡 오늘 실제로 공감·댓글을 남길 <b style={{color:"#ff5fa2"}}>최대 건수</b>예요. <b style={{color:"#00c896"}}>계정 안전</b>을 위해 이 수까지만 작업하고 멈춥니다.
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>📅 대상 글 기간</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {([7, 14, 30, "custom"] as const).map(p => (
                  <button key={p} onClick={() => setEPeriod(p)} style={{ padding: "11px", borderRadius: 10, border: `2px solid ${ePeriod === p ? "var(--accent)" : "var(--border)"}`, background: ePeriod === p ? "var(--accent-bg)" : "transparent", color: ePeriod === p ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>
                    {p === "custom" ? "직접 입력" : `최근 ${p}일`}
                  </button>
                ))}
              </div>
              {ePeriod === "custom" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <input className="inp" type="number" min={1} max={365} {...numProps(eCustomDays, setECustomDays, 1, 365, 7)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ fontSize: 13, color: "var(--text3)" }}>일 이내 글</span>
                </div>
              )}
              <div>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>블로그당 작업할 글 수 (최대 5개)</label>
                <input className="inp" type="number" min={1} max={5} {...numProps(ePostsPerBlog, setEPostsPerBlog, 1, 5, 1)} style={{ fontSize: 13, padding: "11px 14px" }} />
              </div>
            </div>

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>⚙️ 작업 설정</div>
              <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--bg2)", border: "1px solid var(--border)", marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8, fontWeight: 600 }}>작업 종류 선택</div>
                <Toggle val={eDoLike} set={setEDoLike} label="❤️ 공감 클릭하기" />
                {eDoLike && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 8px 6px" }}>
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>글마다 공감 확률</span>
                    <input className="inp" type="number" min={10} max={100} step={10} {...numProps(eLikeRate, setELikeRate, 10, 100, 100)} style={{ width: 64, fontSize: 13, padding: "8px 10px", textAlign: "center" }} />
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>%</span>
                  </div>
                )}
                <Toggle val={eDoComment} set={setEDoComment} label="💬 댓글 작성하기" />
                {eDoComment && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 0 6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>글마다 댓글 확률</span>
                    <input className="inp" type="number" min={10} max={100} step={10} {...numProps(eCommentRate, setECommentRate, 10, 100, 40)} style={{ width: 64, fontSize: 13, padding: "8px 10px", textAlign: "center" }} />
                    <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>%</span>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>낮출수록 자연스러움(도배 방지)</span>
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input className="inp" type="number" min={1} max={60} {...numProps(eDelayMin, setEDelayMin, 1, 60, 5)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 14, fontWeight: 700 }}>~</span>
                  <input className="inp" type="number" min={1} max={120} {...numProps(eDelayMax, setEDelayMax, 1, 120, 10)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>초</span>
                </div>
              </div>
              <Toggle val={eSkipDone} set={setESkipDone} label="완료된 블로그 건너뛰기" />
              <div style={{ fontSize: 12, color: "var(--text2)", margin: "2px 2px 6px", lineHeight: 1.55, fontWeight: 500 }}>
                💡 오늘 이미 공감·댓글한 이웃은 이 설정과 상관없이 <b style={{color:"#ff5fa2"}}>자동으로 제외</b>돼요. (<b style={{color:"#00c896"}}>같은 날 중복 방지</b> · 내일은 새 글에 다시 작업)
              </div>
              <Toggle val={eAutoStart} set={setEAutoStart} label="추출 완료 후 바로 작업 시작" />
            </div>

            {eDoComment && (
              <div className="card" style={{ padding: "18px 20px" }}>
                <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>💬 댓글 내용</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {([["single","단일 댓글"],["multi","여러 댓글 순환"],["ai","✨ AI 자동"]] as const).map(([m,lbl]) => {
                    const on = eCommentMode === m; const isAi = m === "ai";
                    return (
                      <button key={m} onClick={() => setECommentMode(m)} style={{ flex: 1, padding: "10px 8px", borderRadius: 10, border: `2px solid ${on ? (isAi?"#8b5cf6":"var(--accent)") : "var(--border)"}`, background: on ? (isAi?"rgba(139,92,246,.12)":"var(--accent-bg)") : "transparent", color: on ? (isAi?"#8b5cf6":"var(--accent-text)") : (isAi?"#8b5cf6":"var(--text2)"), cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                        {lbl}
                      </button>
                    );
                  })}
                </div>
                {eCommentMode === "single" ? (
                  <textarea className="inp" rows={3} value={eComment} onChange={e => setEComment(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} />
                ) : eCommentMode === "multi" ? (
                  <>
                    <textarea className="inp" rows={5} value={eMultiComments} onChange={e => setEMultiComments(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용됩니다" />
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {eMultiComments.split("\n").filter(l => l.trim()).length}개 댓글 등록됨</div>
                  </>
                ) : (
                  <div>
                    <div style={{ display:"flex", gap:9, alignItems:"flex-start", padding:"12px 14px", borderRadius:11, background:"rgba(139,92,246,.08)", border:"1px solid rgba(139,92,246,.25)", fontSize:12.5, color:"var(--text2)", lineHeight:1.65 }}>
                      <span style={{fontSize:17,flexShrink:0}}>✨</span>
                      <div><b style={{color:"#8b5cf6"}}>AI가 상대방 글을 읽고</b> 매번 다른 자연스러운 댓글을 자동으로 써줘요. 똑같은 댓글 도배로 인한 <b>스팸 위험을 줄여</b> 계정을 지켜줍니다. 아래에서 <b>말투</b>만 골라주세요.</div>
                    </div>
                    <div style={{ fontSize:12, fontWeight:700, color:"var(--text2)", margin:"13px 0 7px" }}>댓글 말투</div>
                    <div style={{ display:"flex", gap:8 }}>
                      {([["담백","깔끔·담백하게"],["다정","다정·따뜻하게"],["짧게","짧고 간결하게"]] as const).map(([t,desc])=>(
                        <button key={t} onClick={()=>setECommentTone(t)} style={{ flex:1, padding:"11px 8px", borderRadius:10, border:`2px solid ${eCommentTone===t?"#8b5cf6":"var(--border)"}`, background:eCommentTone===t?"rgba(139,92,246,.1)":"transparent", color:eCommentTone===t?"#8b5cf6":"var(--text2)", cursor:"pointer", fontFamily:"inherit", textAlign:"center" }}>
                          <div style={{ fontSize:13.5, fontWeight:800 }}>{t}</div>
                          <div style={{ fontSize:10.5, marginTop:3, opacity:.85 }}>{desc}</div>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:11, color:"var(--text3)", marginTop:11, lineHeight:1.55 }}>⚠️ AI 댓글은 <b>설정 → 글쓰기 AI의 Gemini(무료)</b> API 키가 필요해요. 키가 없으면 위 '단일·여러 댓글'을 사용하세요.</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleEngageCrawl} disabled={eCrawling || eWorking || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {eCrawling ? <><span className="spinner" />블로그 추출 중...</> : "🔍 블로그 추출 시작"}
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => startEngageWork()} disabled={eCrawling || eWorking || !eTargets.length || !botOnline} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  {eWorking ? <><span className="spinner" />작업 중...</> : "🚀 작업 시작"}
                </button>
                <button className="btn btn-secondary" onClick={() => handleLoadList(true)} disabled={eCrawling || eWorking} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                  📂 리스트 불러오기
                </button>
              </div>
              {(eCrawling || eWorking) && (
                <button className="btn-stop" onClick={handleEngageStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 작업 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 오늘 공감·댓글 사용량 — 본인 플랜 한도 기준. 무제한은 네이버 권장 안내(공감100·댓글50미만) */}
            {userId && (() => {
              const unlimited = plan === "unlimited" || plan === "admin";
              const limit = eLimit;
              const REC = 100;  // 공감 권장 상한(참고)
              const pct = unlimited ? Math.min(100, (eUsed / REC) * 100) : Math.min(100, (eUsed / limit) * 100);
              const danger = !unlimited && eUsed >= limit;
              const warn = unlimited ? eUsed >= REC : eUsed >= limit * 0.8;
              const bar = danger ? "#ff5363" : warn ? "#ffb020" : "#00d68f";
              return (
                <div style={{ padding: "20px 24px", borderRadius: 20, background: "var(--card)", border: `1.5px solid ${danger ? "rgba(255,83,99,.45)" : warn ? "rgba(255,176,32,.4)" : "var(--border)"}`, boxShadow: "0 2px 14px rgba(0,0,0,.04)" }}>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        ❤️ 오늘 공감·댓글 사용량 <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", opacity: .8 }}>(자정 자동 리셋)</span>
                      </div>
                      <div style={{ fontSize: 40, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>
                        {eUsed}<span style={{ fontSize: 20, color: "var(--text3)", fontWeight: 600 }}> {unlimited ? "건 · 무제한" : `/ ${limit}건`}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 26, fontWeight: 900, color: bar, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{unlimited ? "∞" : danger ? "마감" : `${limit - eUsed}건`}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginTop: 4 }}>{unlimited ? "한도 없음" : danger ? "자정까지 대기" : "남음"}</div>
                    </div>
                  </div>
                  <div style={{ height: 12, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg, ${bar}, ${bar}cc)`, transition: "width .5s ease" }} />
                  </div>
                  {danger
                    ? <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>오늘 플랜 한도에 도달했어요. 계정 보호를 위해 자정 이후 다시 돌려주세요.</div>
                    : <div style={{ fontSize: 12.5, color: warn ? "#c88010" : "var(--text3)", fontWeight: 600, marginTop: 10 }}>💡 네이버 권장은 <b>공감 하루 100개, 댓글 50개 미만</b>이에요. 댓글은 더 보수적으로 쓰는 걸 추천해요.</div>}
                </div>
              );
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[{ label: "수집된 블로그", val: eTargets.length, color: "var(--info)" }, { label: "작업 완료", val: eDoneCnt, color: "var(--success)" }, { label: "실패", val: eFailCnt, color: "var(--danger)" }].map(({ label, val, color }) => (
                <div key={label} style={{ padding: "24px 18px", borderRadius: 18, background: "var(--card)", border: "1px solid var(--border)", textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,.03)" }}>
                  <div style={{ fontSize: 40, fontWeight: 900, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 8, fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="card-title" style={{ margin: 0 }}>📋 작업 현황 {eResults.length > 0 && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)" }}>({eResults.length}개)</span>}</div>
                {eResults.length > 0 && <button onClick={handleEngageSaveHistory} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>💾 저장</button>}
              </div>
              {eResults.length === 0 ? (
                <div style={{ padding: "72px 20px", textAlign: "center", color: "var(--text3)" }}>
                  <div style={{ fontSize: 44, marginBottom: 12, opacity: .5 }}>❤️</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text2)" }}>아직 작업 내역이 없어요</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>블로그를 추출하고 공감·댓글을 시작하면 여기에 실시간으로 표시됩니다</div>
                </div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg2)", position: "sticky", top: 0 }}>
                      {["키워드", "블로그 ID", "공감", "댓글", "결과"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--text3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{eResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--card-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 14px", color: "var(--accent-text)", fontWeight: 700 }}>{r.keyword}</td>
                        <td style={{ padding: "10px 14px" }}><a href={r.postUrl || `https://blog.naver.com/${r.blogId}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none" }}>{r.blogId}</a></td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{r.status === "pending" || r.status === "running" ? <span style={{ color: "var(--text3)" }}>—</span> : r.liked ? "❤️" : <span style={{ color: "var(--text3)" }}>✗</span>}</td>
                        <td style={{ padding: "10px 14px", textAlign: "center", fontSize: 16 }}>{r.status === "pending" || r.status === "running" ? <span style={{ color: "var(--text3)" }}>—</span> : r.commented ? "💬" : <span style={{ color: "var(--text3)" }}>✗</span>}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: `${eStatusColor(r.status)}18`, color: eStatusColor(r.status), border: `1px solid ${eStatusColor(r.status)}40`, fontWeight: 700 }}>{eStatusLabel(r.status)}</span>
                          {r.status !== "pending" && r.status !== "running" && r.message && <span style={{ fontSize: 11, color: r.status === "success" ? "var(--success)" : "var(--text3)", marginLeft: 8 }}>{r.message}</span>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <LogBox logs={eLogs} logRef={eLogRef} onClear={() => setELogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 답방 탭 ═══════════ */}
      {tab === "reply" && (
        <div className="npg-2col">
          {/* 왼쪽: 설정 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} />

            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 14, fontSize: 15 }}>💬 답방 설정</div>

              <div style={{ marginBottom: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>답방할 내 글 선택</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {([["count","최근 개수"],["all","전체"],["period","기간"]] as const).map(([m,lbl]) => (
                    <button key={m} onClick={() => setRSelectMode(m)} style={{ flex: 1, padding: "9px 6px", borderRadius: 9, border: `2px solid ${rSelectMode===m?"var(--accent)":"var(--border)"}`, background: rSelectMode===m?"var(--accent-bg)":"transparent", color: rSelectMode===m?"var(--accent-text)":"var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>{lbl}</button>
                  ))}
                </div>
                {rSelectMode === "count" && (
                  <input className="inp" type="number" min={1} max={100} {...numProps(rTargetPosts, setRTargetPosts, 1, 100, 10)} style={{ fontSize: 13, padding: "11px 14px" }} placeholder="최근 몇 개" />
                )}
                {rSelectMode === "period" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {([7,14,30,"custom"] as const).map(p => (
                        <button key={p} onClick={() => setRPeriod(p)} style={{ padding: "10px", borderRadius: 9, border: `2px solid ${rPeriod===p?"var(--accent)":"var(--border)"}`, background: rPeriod===p?"var(--accent-bg)":"transparent", color: rPeriod===p?"var(--accent-text)":"var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>{p==="custom"?"직접 설정":`최근 ${p}일`}</button>
                      ))}
                    </div>
                    {rPeriod === "custom" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <input className="inp" type="number" min={1} max={365} {...numProps(rCustomDays, setRCustomDays, 1, 365, 7)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                        <span style={{ fontSize: 13, color: "var(--text3)" }}>일 이내 글</span>
                      </div>
                    )}
                  </>
                )}
                {rSelectMode === "all" && (
                  <div style={{ fontSize: 12.5, color: "var(--text2)", padding: "9px 12px", borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)" }}>내 블로그의 <b style={{color:"#ff5fa2"}}>모든 글</b>을 대상으로 불러와요.</div>
                )}
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 8, lineHeight: 1.55, fontWeight: 500 }}>💡 <b style={{color:"#00c896"}}>최근 개수·전체·기간</b> 중 골라 아래 <b style={{color:"#ff5fa2"}}>📥 내 글 불러오기</b>를 누르면, 대상 글이 오른쪽에 리스트로 떠요. 그 글들에 달린 댓글에 답방합니다.</div>
              </div>

              <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>답글 방식</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {([["ai","✨ AI 자동"],["fixed","✍️ 고정 답글"]] as const).map(([m,lbl]) => {
                  const on = rMode === m; const isAi = m === "ai";
                  return (
                    <button key={m} onClick={() => setRMode(m)} style={{ flex: 1, padding: "11px 8px", borderRadius: 10, border: `2px solid ${on ? (isAi?"#8b5cf6":"var(--accent)") : "var(--border)"}`, background: on ? (isAi?"rgba(139,92,246,.12)":"var(--accent-bg)") : "transparent", color: on ? (isAi?"#8b5cf6":"var(--accent-text)") : (isAi?"#8b5cf6":"var(--text2)"), cursor: "pointer", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>{lbl}</button>
                  );
                })}
              </div>

              {rMode === "ai" ? (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display:"flex", gap:9, alignItems:"flex-start", padding:"12px 14px", borderRadius:11, background:"rgba(139,92,246,.08)", border:"1px solid rgba(139,92,246,.25)", fontSize:12.5, color:"var(--text2)", lineHeight:1.65, marginBottom:12 }}>
                    <span style={{fontSize:17,flexShrink:0}}>✨</span>
                    <div><b style={{color:"#8b5cf6"}}>AI가 이웃의 댓글을 읽고</b> 그에 맞는 자연스러운 답글을 매번 다르게 만들어줘요. 말투만 골라주세요. <b>(설정 → 글쓰기 AI의 Gemini 무료 키 필요)</b></div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    {([["담백","깔끔·담백"],["다정","다정·따뜻"],["짧게","짧고 간결"]] as const).map(([t,desc])=>(
                      <button key={t} onClick={()=>setRTone(t)} style={{ flex:1, padding:"11px 8px", borderRadius:10, border:`2px solid ${rTone===t?"#8b5cf6":"var(--border)"}`, background:rTone===t?"rgba(139,92,246,.1)":"transparent", color:rTone===t?"#8b5cf6":"var(--text2)", cursor:"pointer", fontFamily:"inherit", textAlign:"center" }}>
                        <div style={{ fontSize:13, fontWeight:800 }}>{t}</div>
                        <div style={{ fontSize:10, marginTop:2, opacity:.85 }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <textarea className="inp" rows={3} value={rComment} onChange={e => setRComment(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.7, padding: "12px 14px" }} placeholder="댓글 감사합니다 😊 자주 놀러오세요!" />
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>💡 모든 댓글에 이 문구로 답합니다. (똑같은 답글 반복이 걱정되면 위 <b style={{color:"#ff5fa2"}}>'✨ AI 자동'</b>을 추천해요)</div>
                </div>
              )}

              <Toggle val={rOnlyNew} set={setROnlyNew} label="아직 답글 없는 댓글만 (중복 답글 방지)" />

              <div style={{ marginTop: 12 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input className="inp" type="number" min={1} max={60} {...numProps(rDelayMin, setRDelayMin, 1, 60, 5)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)" }}>~</span>
                  <input className="inp" type="number" min={1} max={120} {...numProps(rDelayMax, setRDelayMax, 1, 120, 10)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, lineHeight: 1.55, fontWeight: 500 }}>💡 답글 사이 대기 시간이에요. <b style={{color:"#00c896"}}>넉넉히 둘수록</b> 사람이 쓰는 것처럼 자연스러워 <b style={{color:"#ff5fa2"}}>계정이 안전</b>해요.</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handleLoadMyPosts} disabled={rLoadingPosts || rWorking || !botOnline} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {rLoadingPosts ? <><span className="spinner" />내 글 불러오는 중...</> : "📥 내 글 불러오기"}
              </button>
              <button className="btn btn-secondary" onClick={handleReplyStart} disabled={rWorking || rLoadingPosts || !rMyPosts.length || !botOnline || (!isUnlimitedPlan && replyUsed >= replyLimit)} style={{ padding: "13px", fontSize: 13, borderRadius: 12 }}>
                {rWorking ? <><span className="spinner" />답방 중...</> : (!isUnlimitedPlan && replyUsed >= replyLimit) ? "오늘 한도 도달 (자정 초기화)" : `🚀 답방 시작${rMyPosts.length ? ` (${rMyPosts.length}개 글)` : ""}`}
              </button>
              {rWorking && (
                <button className="btn-stop" onClick={handleReplyStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 중단</button>
              )}
            </div>
          </div>

          {/* 오른쪽: 게이지 + 결과 + 로그 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <UsageGauge label="💬 오늘 답방" used={replyUsed} limit={replyLimit} unit="건" color="#8b5cf6" />
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 14 }}>💬 답방 결과</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ textAlign: "center", padding: "14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 30, fontWeight: 900, color: "var(--success)" }}>{rDoneCnt}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>답글 완료</div>
                </div>
                <div style={{ textAlign: "center", padding: "14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 30, fontWeight: 900, color: "var(--danger)" }}>{rFailCnt}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>실패</div>
                </div>
              </div>
            </div>
            {/* 불러온 내 글 리스트 (로그 위) */}
            <div className="card" style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", marginBottom: 12 }}>📄 불러온 내 글 <b style={{ color: "var(--accent-text)" }}>{rMyPosts.length}</b>개</div>
              {rMyPosts.length === 0 ? (
                <div style={{ padding: "22px", textAlign: "center", color: "var(--text2)", fontSize: 12.5, lineHeight: 1.6 }}>왼쪽에서 대상을 고르고<br /><b style={{color:"#ff5fa2"}}>📥 내 글 불러오기</b>를 누르면 여기에 목록이 떠요.</div>
              ) : (
                <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {rMyPosts.map((p, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || "(제목 없음)"}</span>
                      {typeof p.comments === "number" && <span style={{ fontSize: 11, color: "var(--accent-text)", fontWeight: 700, flexShrink: 0 }}>💬 {p.comments}</span>}
                      {p.date && <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>{p.date}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <LogBox logs={rLogs} logRef={rLogRef} onClear={() => setRLogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 블로그 건강검진 탭 ═══════════ */}
      {tab === "score" && (
        <div className="npg-2col">
          {/* 왼쪽: 계정 + 진단 버튼 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} />
            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 10, fontSize: 15 }}>📈 진단 방법</div>
              <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.7, fontWeight: 500 }}>
                <b style={{color:"#00c896"}}>① 진단 시작</b>으로 점수·방문자·이웃 지표를 확인하고, <b style={{color:"#ff5fa2"}}>② 글 불러오기 → 선택 글 검사</b>로 검색 노출을 따로 확인해요.<br /><br />
                건강진단과 검색노출 검사는 분리되어 있어 원하는 글만 검사할 수 있어요.
              </div>
            </div>
            <button className="btn btn-primary btn-full" onClick={handleBlogDiagnose} disabled={scLoading || !botOnline || (!isUnlimitedPlan && scUsed >= scLimit)} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
              {scLoading ? <><span className="spinner" />진단 중...</> : (!isUnlimitedPlan && scUsed >= scLimit) ? "오늘 한도 도달 (자정 초기화)" : "📈 블로그 진단 시작"}
            </button>
            <div className="card" style={{ padding: "18px 20px" }}>
              <div className="card-title" style={{ marginBottom: 12, fontSize: 15 }}>🔎 검색노출 글 선택</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button onClick={() => setScPostMode("period")} style={{ flex: 1, padding: 9, borderRadius: 9, border: `2px solid ${scPostMode==="period"?"var(--accent)":"var(--border)"}`, background: scPostMode==="period"?"var(--accent-bg)":"transparent", color: "var(--text2)", fontWeight: 700, cursor: "pointer" }}>기간</button>
                <button onClick={() => setScPostMode("all")} style={{ flex: 1, padding: 9, borderRadius: 9, border: `2px solid ${scPostMode==="all"?"var(--accent)":"var(--border)"}`, background: scPostMode==="all"?"var(--accent-bg)":"transparent", color: "var(--text2)", fontWeight: 700, cursor: "pointer" }}>전체</button>
              </div>
              {scPostMode === "period" && <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {([7,14,30,"custom"] as const).map(value => <button key={value} onClick={() => setScPeriod(value)} style={{ padding: 9, borderRadius: 9, border: `2px solid ${scPeriod===value?"var(--accent)":"var(--border)"}`, background: scPeriod===value?"var(--accent-bg)":"transparent", color: "var(--text2)", fontWeight: 700, cursor: "pointer" }}>{value === "custom" ? "직접 설정" : `최근 ${value}일`}</button>)}
                </div>
                {scPeriod === "custom" && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}><input className="inp" type="number" min={1} max={3650} {...numProps(scCustomDays, setScCustomDays, 1, 3650, 7)} /><span style={{ fontSize: 12, color: "var(--text3)" }}>일 이내</span></div>}
              </>}
              <button className="btn btn-full" onClick={handleLoadScorePosts} disabled={scPostsLoading || !botOnline} style={{ marginTop: 10 }}>{scPostsLoading ? <><span className="spinner" />불러오는 중...</> : "📥 검사할 글 불러오기"}</button>
            </div>
          </div>

          {/* 오른쪽: 게이지 + 리포트 + 로그 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <UsageGauge label="📈 오늘 진단" used={scUsed} limit={scLimit} unit="회" color="#00b8d4" />
            {scPosts.length > 0 && (() => {
              const q = scPostSearch.trim().toLowerCase();
              const filtered = q ? scPosts.filter(p => (p.title || "").toLowerCase().includes(q)) : scPosts;
              const PER = 30; const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
              const page = Math.min(scPostPage, totalPages - 1);
              const shown = filtered.slice(page * PER, page * PER + PER);
              const filteredLogNos = filtered.map(p => scLogNo(p.url)).filter(Boolean);
              const allFilteredSelected = filteredLogNos.length > 0 && filteredLogNos.every(id => scSelectedLogNos.includes(id));
              return (
              <div className="card" style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>📄 검사할 글 <b style={{ color: "var(--accent-text)" }}>{scSelectedLogNos.length}/{scPosts.length}</b></div>
                  <button onClick={() => setScSelectedLogNos(prev => allFilteredSelected ? prev.filter(id => !filteredLogNos.includes(id)) : Array.from(new Set([...prev, ...filteredLogNos])))} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>{allFilteredSelected ? "전체 해제" : (q ? "검색결과 전체선택" : "전체 선택")}</button>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <input className="inp" value={scPostSearch} onChange={e => { setScPostSearch(e.target.value); setScPostPage(0); }} placeholder="🔍 제목으로 검색..." style={{ fontSize: 12.5, padding: "9px 12px" }} />
                </div>
                {filtered.length === 0 ? <div style={{ fontSize: 12, color: "var(--text3)", padding: "16px 0", textAlign: "center" }}>검색 결과가 없어요.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {shown.map(post => { const logNo = scLogNo(post.url); const checked = scSelectedLogNos.includes(logNo); return <label key={post.url} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, background: checked ? "var(--accent-bg)" : "var(--bg)", border: "1px solid var(--border)", cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} onChange={() => setScSelectedLogNos(prev => checked ? prev.filter(id => id !== logNo) : [...prev, logNo])} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{post.title || "(제목 없음)"}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text3)" }}>{post.date}</span>
                    </label>; })}
                  </div>
                )}
                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 }}>
                    <button onClick={() => setScPostPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page === 0 ? "var(--text3)" : "var(--text2)", cursor: page === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>← 이전</button>
                    <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>{page + 1} / {totalPages} <span style={{ color: "var(--text3)", fontWeight: 500 }}>({filtered.length}개)</span></span>
                    <button onClick={() => setScPostPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page >= totalPages - 1 ? "var(--text3)" : "var(--text2)", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>다음 →</button>
                  </div>
                )}
                <button className="btn btn-primary btn-full" onClick={handleCheckSelectedExposure} disabled={scExposureLoading || !scSelectedLogNos.length} style={{ marginTop: 12 }}>{scExposureLoading ? <><span className="spinner" />검사 중...</> : `🔎 선택한 ${scSelectedLogNos.length}개 검색노출 확인`}</button>
              </div>
              );
            })()}
            {!scResult ? (
              <div className="card" style={{ padding: "48px 24px", textAlign: "center", color: "var(--text2)", fontSize: 13.5, lineHeight: 1.7 }}>
                왼쪽에서 계정을 연결하고 <b style={{color:"#ff5fa2"}}>📈 블로그 진단 시작</b>을 누르면<br />내 블로그의 건강 리포트가 여기에 나타나요.
              </div>
            ) : (() => {
              const now = Date.now();
              const dates = [...(scResult.recentDates || [])].sort().reverse();
              const recent30 = dates.filter(d => (now - new Date(d).getTime()) <= 30 * 86400000).length;
              const lastDaysAgo = dates.length ? Math.floor((now - new Date(dates[0]).getTime()) / 86400000) : 999;
              // 점수(0~100): 글수·이웃·최근발행·활동성 가중
              const sPost = Math.min(30, (scResult.totalPosts / 100) * 30);
              const sNbr = Math.min(25, (scResult.neighbors / 1000) * 25);
              const sFreq = Math.min(30, (recent30 / 12) * 30);      // 월 12회면 만점
              const sActive = lastDaysAgo <= 3 ? 15 : lastDaysAgo <= 7 ? 10 : lastDaysAgo <= 14 ? 5 : 0;
              const score = Math.round(sPost + sNbr + sFreq + sActive);
              const grade = score >= 80 ? { label: "최적화", emoji: "🏆", color: "#8b5cf6" } : score >= 60 ? { label: "우수", emoji: "⭐", color: "#3b82f6" } : score >= 40 ? { label: "성장중", emoji: "🌿", color: "#00c896" } : score >= 20 ? { label: "초기", emoji: "🌱", color: "#f59e0b" } : { label: "휴면", emoji: "😴", color: "#ef4444" };
              const tips: string[] = [];
              if (recent30 < 8) tips.push("발행이 뜸해요. 네이버는 꾸준한 발행을 좋아해요 — 최소 주 2~3회 이상을 권장해요.");
              if (lastDaysAgo > 7) tips.push(`마지막 글이 ${lastDaysAgo}일 전이에요. 방치되면 노출이 줄어요 — 새 글을 올려보세요.`);
              if (scResult.neighbors < 300) tips.push("이웃이 적어요. '서이추' 기능으로 이웃을 늘리면 방문·소통이 커져요.");
              if (scResult.totalPosts < 30) tips.push("글이 아직 적어요. 주제를 정해 꾸준히 쌓으면 블로그 힘이 붙어요.");
              if (scResult.lowQualitySuspected === true) tips.push("선택해 검사한 글 대부분이 제목 검색 100위 안에서 누락됐어요. 제목·본문의 반복 키워드와 과도한 상업성 표현을 점검하고 며칠 간격으로 다시 검사해보세요.");
              if (scResult.visitorDrop?.detected) tips.push(`${scResult.visitorDrop.message}했어요. 유입 검색어 순위 변화와 최근 수정·삭제한 글이 있는지 확인해보세요.`);
              if (recent30 >= 8 && lastDaysAgo <= 3) tips.push("발행 습관이 아주 좋아요! 지금처럼 꾸준히 유지하세요. 👍");
              if (tips.length === 0) tips.push("전반적으로 건강해요. 공감·댓글과 답방으로 소통을 더 키워보세요!");
              const metrics = [
                { label: "총 글 수", value: scResult.totalPosts.toLocaleString(), icon: "📝", color: "#00c896" },
                { label: "이웃 수", value: scResult.neighbors.toLocaleString(), icon: "🤝", color: "#00b8d4" },
                { label: "최근 30일 발행", value: `${recent30}회`, icon: "🔥", color: "#ff5fa2" },
                { label: "마지막 활동", value: lastDaysAgo >= 999 ? "-" : lastDaysAgo === 0 ? "오늘" : `${lastDaysAgo}일 전`, icon: "⏱️", color: "#f59e0b" },
              ];
              const exposureChecks = scResult.exposureChecks || [];
              const checkedExposure = exposureChecks.filter(item => item.exposed !== null);
              const exposedCount = checkedExposure.filter(item => item.exposed).length;
              const visitorDays = scResult.visitorDays || [];
              const maxVisitors = Math.max(1, ...visitorDays.map(day => day.visitors));
              return (
                <div className="card" style={{ padding: "24px 26px" }}>
                  {/* 종합 등급 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 18, paddingBottom: 20, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ position: "relative", width: 92, height: 92, flexShrink: 0 }}>
                      <svg width="92" height="92" style={{ transform: "rotate(-90deg)" }}>
                        <circle cx="46" cy="46" r="40" fill="none" stroke="var(--border)" strokeWidth="8" />
                        <circle cx="46" cy="46" r="40" fill="none" stroke={grade.color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * 251} 251`} style={{ transition: "stroke-dasharray .8s ease" }} />
                      </svg>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ fontSize: 26, fontWeight: 900, color: grade.color, lineHeight: 1 }}>{score}</div>
                        <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600 }}>점</div>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 4 }}>내 블로그 <b style={{color:"var(--text2)"}}>{scResult.blogId}</b></div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: grade.color }}>{grade.emoji} {grade.label}</div>
                      <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4, fontWeight: 500 }}>실제 지표로 계산한 퍼블리 건강 점수예요</div>
                    </div>
                  </div>
                  {/* 지표 카드 */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                    {metrics.map(m => (
                      <div key={m.label} style={{ padding: "14px 16px", borderRadius: 13, background: "var(--bg)", border: "1px solid var(--border)", borderLeft: `4px solid ${m.color}` }}>
                        <div style={{ fontSize: 11.5, color: "var(--text2)", fontWeight: 600, marginBottom: 6 }}>{m.icon} {m.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)" }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* 검색 노출/저품질 진단 */}
                  <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: scResult.lowQualitySuspected ? "rgba(239,68,68,.08)" : "var(--bg)", border: `1px solid ${scResult.lowQualitySuspected ? "rgba(239,68,68,.35)" : "var(--border)"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 11 }}>
                      <div style={{ fontSize: 14, fontWeight: 850 }}>🔎 검색 노출 진단</div>
                      <div style={{ fontSize: 13, fontWeight: 850, color: scResult.lowQualitySuspected ? "#ef4444" : checkedExposure.length ? "#00c896" : "var(--text3)" }}>
                        {scResult.lowQualitySuspected === true ? "🔴 저품질 의심" : checkedExposure.length ? `${exposedCount}/${checkedExposure.length}개 노출` : "확인 불가"}
                      </div>
                    </div>
                    <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 9, background: "rgba(0,184,212,.08)", color: "var(--text2)", fontSize: 11.5, fontWeight: 650, lineHeight: 1.5 }}>
                      오늘 {(scResult.checkedTodayCount || 0).toLocaleString()}개 검사 · 전체 {(scResult.totalPostsForExposure || 0).toLocaleString()}개 중 {(scResult.exposureCompletedCount || 0).toLocaleString()}개 완료
                      {scResult.exposureLimit == null ? " (무제한 등급)" : ` (등급 한도 ${scResult.exposureLimit.toLocaleString()}개/일)`}
                    </div>
                    {exposureChecks.length ? (() => {
                      const q = scExpSearch.trim().toLowerCase();
                      const filtered = q ? exposureChecks.filter(item => item.title.toLowerCase().includes(q)) : exposureChecks;
                      const PER = 30; const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
                      const page = Math.min(scExpPage, totalPages - 1);
                      const shown = filtered.slice(page * PER, page * PER + PER);
                      return (
                        <>
                          {/* 제목 검색 */}
                          <div style={{ marginBottom: 10 }}>
                            <input className="inp" value={scExpSearch} onChange={e => { setScExpSearch(e.target.value); setScExpPage(0); }} placeholder="🔍 제목으로 검색..." style={{ fontSize: 12.5, padding: "9px 12px" }} />
                          </div>
                          {filtered.length === 0 ? <div style={{ fontSize: 12, color: "var(--text3)", padding: "16px 0", textAlign: "center" }}>검색 결과가 없어요.</div> : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                              {shown.map((item, i) => <div key={`${item.title}-${page}-${i}`} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 7, alignItems: "center", fontSize: 12 }}>
                                <span>{item.exposed === true ? "✅" : item.exposed === false ? "❌" : "➖"}</span>
                                <span title={item.title} style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", color: "var(--text2)" }}>{item.title}</span>
                                <b style={{ color: item.exposed === false ? "#ef4444" : "var(--text2)" }}>{item.exposed === true ? `약 ${item.rank}위` : item.exposed === false ? "100위 내 누락" : "확인 불가"}</b>
                              </div>)}
                            </div>
                          )}
                          {totalPages > 1 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }}>
                              <button onClick={() => setScExpPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page === 0 ? "var(--text3)" : "var(--text2)", cursor: page === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>← 이전</button>
                              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>{page + 1} / {totalPages} <span style={{ color: "var(--text3)", fontWeight: 500 }}>({filtered.length}개)</span></span>
                              <button onClick={() => setScExpPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page >= totalPages - 1 ? "var(--text3)" : "var(--text2)", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>다음 →</button>
                            </div>
                          )}
                        </>
                      );
                    })() : <div style={{ fontSize: 12, color: "var(--text3)" }}>위에서 글을 불러와 선택한 뒤 검색노출 확인을 실행하세요.</div>}
                    <div style={{ marginTop: 10, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>네이버 공식 지수가 아닌, 순환 선택한 글의 제목 검색 결과를 바탕으로 한 퍼블리 자체 진단이에요. 누락만으로 저품질을 확정할 수는 없어요.</div>
                  </div>

                  {/* ✏️ 제목·키워드 살리기 솔루션 (AI 처방) — 누락 글 있을 때만 */}
                  {exposureChecks.some(c => c.exposed === false) && (
                    <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: "linear-gradient(135deg,rgba(139,92,246,.1),rgba(255,95,162,.06))", border: "1.5px solid rgba(139,92,246,.3)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: scSolutions ? 14 : 0 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 850, color: "#a855f7" }}>✏️ 제목·키워드 살리기 솔루션</div>
                          <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 3, fontWeight: 500 }}>검색에 안 뜨는 글의 제목·키워드를 <b style={{color:"#ff5fa2"}}>AI가 상위노출용으로 고쳐</b>드려요.</div>
                        </div>
                        <button onClick={handleGetSolutions} disabled={scSolLoading} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: scSolLoading ? "var(--card2)" : "linear-gradient(135deg,#8b5cf6,#a855f7)", color: scSolLoading ? "var(--text2)" : "#fff", cursor: scSolLoading ? "default" : "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", flexShrink: 0 }}>
                          {scSolLoading ? "AI 분석 중..." : "✨ 개선안 받기"}
                        </button>
                      </div>
                      {scSolutions && (() => {
                        const sq = scSolSearch.trim().toLowerCase();
                        const solFiltered = sq ? scSolutions.filter(s => (s.original || "").toLowerCase().includes(sq)) : scSolutions;
                        const PER = 5; const totalPages = Math.max(1, Math.ceil(solFiltered.length / PER));
                        const page = Math.min(scSolPage, totalPages - 1);
                        const shown = solFiltered.slice(page * PER, page * PER + PER);
                        return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={{ fontSize: 11.5, color: "var(--text3)", fontWeight: 600 }}>총 {scSolutions.length}개 글의 개선안 · {page + 1}/{totalPages} 페이지</div>
                          <input className="inp" value={scSolSearch} onChange={e => { setScSolSearch(e.target.value); setScSolPage(0); }} placeholder="🔍 원래 제목으로 검색..." style={{ fontSize: 12.5, padding: "9px 12px" }} />
                          {solFiltered.length === 0 && <div style={{ fontSize: 12, color: "var(--text3)", padding: "16px 0", textAlign: "center" }}>검색 결과가 없어요.</div>}
                          {shown.map((s, i) => (
                            <div key={i} style={{ padding: "15px 16px", borderRadius: 13, background: "var(--card)", border: "1px solid var(--border)" }}>
                              <div style={{ fontSize: 12.5, color: "var(--text3)", textDecoration: "line-through", marginBottom: 6 }}>{s.original}</div>
                              {s.diagnosis && <div style={{ fontSize: 11.5, color: "#ff5fa2", fontWeight: 600, marginBottom: 11, lineHeight: 1.5 }}>🔍 {s.diagnosis}</div>}
                              <div style={{ fontSize: 11, color: "#00c896", fontWeight: 800, marginBottom: 4 }}>✅ 개선 제목 1</div>
                              <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--text)", marginBottom: s.newTitle2 ? 8 : 11, lineHeight: 1.4 }}>{s.newTitle}</div>
                              {s.newTitle2 && <><div style={{ fontSize: 11, color: "#00c896", fontWeight: 800, marginBottom: 4 }}>✅ 개선 제목 2</div><div style={{ fontSize: 14, fontWeight: 700, color: "var(--text2)", marginBottom: 11, lineHeight: 1.4 }}>{s.newTitle2}</div></>}
                              {s.keywords.length > 0 && (
                                <><div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700, marginBottom: 5 }}>넣으면 좋은 키워드</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 11 }}>
                                  {s.keywords.map((k, j) => <span key={j} style={{ padding: "4px 10px", borderRadius: 20, background: "rgba(139,92,246,.12)", color: "#a855f7", fontSize: 11.5, fontWeight: 700 }}># {k}</span>)}
                                </div></>
                              )}
                              {s.bodyTip && <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55, fontWeight: 500, marginBottom: 6 }}>✏️ <b>본문 팁</b> · {s.bodyTip}</div>}
                              {s.expectedEffect && <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55, fontWeight: 500, padding: "8px 11px", borderRadius: 9, background: "rgba(0,200,150,.08)" }}>📈 <b style={{color:"#00c896"}}>기대 효과</b> · {s.expectedEffect}</div>}
                            </div>
                          ))}
                          {totalPages > 1 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}>
                              <button onClick={() => setScSolPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page === 0 ? "var(--text3)" : "var(--text2)", cursor: page === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>← 이전</button>
                              <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>{page + 1} / {totalPages}</span>
                              <button onClick={() => setScSolPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: page >= totalPages - 1 ? "var(--text3)" : "var(--text2)", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>다음 →</button>
                            </div>
                          )}
                          <div style={{ fontSize: 10.5, color: "var(--text3)", lineHeight: 1.5 }}>AI 제안이에요. 내 블로그에서 실제로 검색 상위에 오른 제목 패턴을 학습해 만든 처방이라, 참고해서 제목·본문을 다듬으면 노출에 도움이 돼요.</div>
                        </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* 방문자 통계 */}
                  <div style={{ marginBottom: 20, padding: "16px", borderRadius: 14, background: "var(--bg)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 850 }}>👥 최근 방문자</div>
                      {scResult.visitorDrop && <b style={{ fontSize: 12, color: scResult.visitorDrop.detected ? "#ef4444" : "var(--text2)" }}>{scResult.visitorDrop.detected ? "⚠️ " : ""}{scResult.visitorDrop.message}</b>}
                    </div>
                    {visitorDays.length ? <div style={{ display: "flex", height: 92, alignItems: "flex-end", gap: 7, marginBottom: 14 }}>
                      {visitorDays.map(day => <div key={day.date} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 4 }}>{day.visitors.toLocaleString()}</div>
                        <div title={`${day.date} ${day.visitors.toLocaleString()}명`} style={{ height: Math.max(4, (day.visitors / maxVisitors) * 55), borderRadius: "5px 5px 2px 2px", background: scResult.visitorDrop?.detected && day === visitorDays[visitorDays.length - 1] ? "#ef4444" : "#00b8d4" }} />
                        <div style={{ fontSize: 9.5, color: "var(--text3)", marginTop: 4 }}>{day.date.slice(5).replace("-", "/")}</div>
                      </div>)}
                    </div> : <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>관리자 통계에서 일별 방문자를 읽지 못했어요.</div>}
                    <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 7 }}>유입 검색어 TOP</div>
                    {(scResult.inflowKeywords || []).length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{(scResult.inflowKeywords || []).map((item, i) => <span key={`${item.keyword}-${i}`} style={{ padding: "5px 9px", borderRadius: 20, background: "rgba(0,184,212,.1)", color: "var(--text2)", fontSize: 11.5, fontWeight: 650 }}>{i + 1}. {item.keyword}{item.count !== undefined ? ` · ${item.count}` : ""}</span>)}</div> : <div style={{ fontSize: 12, color: "var(--text3)" }}>유입 검색어를 읽지 못했거나 데이터가 없어요.</div>}
                  </div>
                  {/* 맞춤 조언 */}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>💡 맞춤 조언</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {tips.map((t, i) => (
                        <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 14px", borderRadius: 11, background: "rgba(0,200,150,.08)", border: "1px solid rgba(0,200,150,.2)", fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500 }}>
                          <span style={{ color: "#00c896", flexShrink: 0, fontWeight: 900 }}>✓</span><span>{t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
            <LogBox logs={scLogs} logRef={scLogRef} onClear={() => setScLogs([])} />
          </div>
        </div>
      )}

      {/* ═══════════ 💞 품앗이 탭 ═══════════ */}
      {tab === "pumasi" && (() => {
        const connected = accounts.filter(a => a.sessionOk && a.blogId);
        const overAccountLimit = !isUnlimitedPlan && accounts.length > pumasiAccountLimit;
        return (
        <div className="npg-2col">
          {/* 왼쪽: 계정 + 설정 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 기능설명 배너 */}
            <div style={{ padding: "16px 18px", borderRadius: 14, background: "linear-gradient(135deg,rgba(236,72,153,.1),rgba(139,92,246,.08))", border: "1.5px solid rgba(236,72,153,.3)" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#ec4899", marginBottom: 6 }}>💞 품앗이(내 계정끼리 서로 공감·댓글)</div>
              <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.65, fontWeight: 500 }}>
                내 <b style={{color:"#ec4899"}}>여러 계정</b>을 등록해두면, 봇이 <b>계정을 자동으로 전환</b>하며 서로의 글을 읽고 공감·댓글을 남겨줘요. 계정별 <b>받을 수</b>를 정해 한 계정에 방문이 과하게 몰리는 것도 막을 수 있어요.<br />
                <span style={{ color: "#c88010", fontWeight: 700 }}>💡 한 번만 계정 연결</span>해두면, 다음부턴 <b>'품앗이 시작'</b>만 눌러도 자동 로그인·전환하며 알아서 돌아가요. 딜레이를 넉넉히 두면 계정이 안전해요.
              </div>
            </div>

            {/* 내 등급 안내 — 몇 개 연결 가능 / 지금 몇 개 */}
            <div style={{ padding: "13px 16px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 600 }}>
                내 등급 <b style={{color:"#ec4899"}}>{plan === "free" ? "무료" : plan === "basic" ? "베이직" : plan === "pro" ? "프로" : plan === "unlimited" ? "무제한" : plan}</b> · 계정 <b style={{color: overAccountLimit ? "var(--danger)" : "#00c896"}}>{accounts.length}</b>{isUnlimitedPlan ? "" : `/${pumasiAccountLimit}`}개 등록 · 연결됨 <b style={{color:"#00c896"}}>{connected.length}</b>개
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text3)" }}>계정당 대상 글 최대 {isUnlimitedPlan ? "무제한" : `${pumasiPostsLimit}개`}</div>
            </div>
            {overAccountLimit && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, padding: "2px 4px" }}>⚠️ 등록 계정이 등급 한도({pumasiAccountLimit}개)를 넘었어요. 초과분은 품앗이에서 제외돼요. 더 많이 쓰려면 상위 등급이나 추가 결제가 필요해요.</div>}

            <AccountCard accounts={accounts} onLogin={handleLogin} onAdd={handleAddAccount} onRemove={handleRemoveAccount} onChange={handleAccountChange} onConnectAll={handleConnectAll} connectingAll={connectingAll} />

            {/* 계정별 대상 글 수 + 받을 계정 수 */}
            {connected.length >= 2 && (
              <div className="card" style={{ padding: "16px 18px" }}>
                <div className="card-title" style={{ marginBottom: 6, fontSize: 15 }}>📝 계정별 글 수 · 받을 수</div>
                <div style={{ fontSize: 11.5, color: "var(--text2)", marginBottom: 12, lineHeight: 1.5, fontWeight: 500 }}>💡 <b>대상 글</b>은 최근 몇 개 글을 돌지, <b>받을 수</b>는 최대 몇 개의 다른 계정에게 방문·공감·댓글을 받을지 정해요. 기본은 3명이에요.</div>
                {(() => {
                  const maxReceive = Math.max(1, connected.length - 1);  // 나를 뺀 다른 계정 수만큼만 받을 수 있음
                  const colStyle = { display: "grid", gridTemplateColumns: "1fr 76px 76px", alignItems: "center", gap: 10 } as const;
                  return (<>
                    {/* 헤더: 입력칸과 같은 grid로 맞춰 칸 위에 정확히 정렬 */}
                    <div style={{ ...colStyle, padding: "0 11px 6px", fontSize: 10.5, color: "var(--text3)", fontWeight: 700 }}>
                      <span />
                      <span style={{ textAlign: "center" }}>대상 글</span>
                      <span style={{ textAlign: "center" }}>받을 수</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {connected.map(a => (
                        <div key={a.accountId} style={{ ...colStyle, padding: "8px 11px", borderRadius: 9, background: "var(--bg)", border: "1px solid var(--border)" }}>
                          <span style={{ minWidth: 0, fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {a.blogId || a.accountId}</span>
                          <input className="inp" type="number" min={1} max={isUnlimitedPlan ? 999 : pumasiPostsLimit} value={pumPostsByAcc[a.accountId] ?? 3} onChange={e => { const v = Math.max(1, Math.min(isUnlimitedPlan ? 999 : pumasiPostsLimit, parseInt(e.target.value) || 1)); setPumPostsByAcc(prev => ({ ...prev, [a.accountId]: v })); }} style={{ width: "100%", fontSize: 13, padding: "8px 6px", textAlign: "center" }} />
                          <input className="inp" type="number" min={1} max={maxReceive} disabled={maxReceive <= 1} value={Math.min(maxReceive, pumReceiveByAcc[a.accountId] ?? Math.min(3, maxReceive))} onChange={e => { const v = Math.max(1, Math.min(maxReceive, parseInt(e.target.value) || 1)); setPumReceiveByAcc(prev => ({ ...prev, [a.accountId]: v })); }} style={{ width: "100%", fontSize: 13, padding: "8px 6px", textAlign: "center", opacity: maxReceive <= 1 ? 0.55 : 1, cursor: maxReceive <= 1 ? "not-allowed" : "auto" }} />
                        </div>
                      ))}
                    </div>
                    {maxReceive <= 1 && (
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 9, lineHeight: 1.5, background: "var(--card2)", borderRadius: 8, padding: "8px 11px" }}>
                        ℹ️ 지금은 계정이 <b>2개</b>라 서로 1명씩만 주고받을 수 있어 <b>받을 수가 1로 고정</b>돼요. 계정을 <b>더 추가</b>하면(3개 이상) 받을 수를 늘릴 수 있어요.
                      </div>
                    )}
                  </>);
                })()}
              </div>
            )}

            {/* 작업 종류 (공감/댓글 둘 다) */}
            <div className="card" style={{ padding: "16px 18px" }}>
              <div className="card-title" style={{ marginBottom: 10, fontSize: 15 }}>⚙️ 작업 설정</div>
              <Toggle val={pumDoLike} set={setPumDoLike} label="❤️ 공감 클릭하기" />
              <Toggle val={pumDoComment} set={setPumDoComment} label="💬 댓글 작성하기" />

              {pumDoComment && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 7 }}>댓글 방식</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    {([["single","단일"],["multi","여러개 순환"],["ai","✨ AI 자동"]] as const).map(([m,lbl]) => {
                      const on = pumCommentMode === m; const isAi = m === "ai";
                      return <button key={m} onClick={() => setPumCommentMode(m)} style={{ flex: 1, padding: "10px 6px", borderRadius: 10, border: `2px solid ${on ? (isAi?"#8b5cf6":"var(--accent)") : "var(--border)"}`, background: on ? (isAi?"rgba(139,92,246,.12)":"var(--accent-bg)") : "transparent", color: on ? (isAi?"#8b5cf6":"var(--accent-text)") : (isAi?"#8b5cf6":"var(--text2)"), cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>{lbl}</button>;
                    })}
                  </div>
                  {pumCommentMode === "single" && <textarea className="inp" rows={2} value={pumComment} onChange={e => setPumComment(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.6, padding: "11px 13px" }} />}
                  {pumCommentMode === "multi" && <>
                    <textarea className="inp" rows={4} value={pumMultiComments} onChange={e => setPumMultiComments(e.target.value)} style={{ resize: "vertical", fontSize: 13, lineHeight: 1.6, padding: "11px 13px" }} placeholder="줄바꿈으로 구분 → 순서대로 사용" />
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>총 {pumMultiComments.split("\n").filter(l => l.trim()).length}개 댓글 등록됨</div>
                  </>}
                  {pumCommentMode === "ai" && <>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500, marginBottom: 9, padding: "10px 12px", borderRadius: 10, background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.2)" }}>✨ <b style={{color:"#8b5cf6"}}>AI가 글을 읽고</b> 매번 다른 자연스러운 댓글을 써요. 말투만 골라주세요. <b>(설정→글쓰기AI의 Gemini 무료키 필요)</b></div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(["담백","다정","짧게"] as const).map(t => <button key={t} onClick={() => setPumTone(t)} style={{ flex: 1, padding: "9px", borderRadius: 9, border: `2px solid ${pumTone===t?"#8b5cf6":"var(--border)"}`, background: pumTone===t?"rgba(139,92,246,.1)":"transparent", color: pumTone===t?"#8b5cf6":"var(--text2)", cursor: "pointer", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit" }}>{t}</button>)}
                    </div>
                  </>}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <label className="inp-label" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>딜레이 (초)</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input className="inp" type="number" min={1} max={120} {...numProps(pumDelayMin, setPumDelayMin, 1, 120, 8)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                  <span style={{ color: "var(--text3)" }}>~</span>
                  <input className="inp" type="number" min={1} max={300} {...numProps(pumDelayMax, setPumDelayMax, 1, 300, 15)} style={{ flex: 1, fontSize: 13, padding: "11px 14px" }} />
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text2)", marginTop: 6, lineHeight: 1.5, fontWeight: 500 }}>💡 댓글 사이 대기 시간이에요. <b style={{color:"#00c896"}}>넉넉히 둘수록</b> 사람처럼 자연스러워 <b style={{color:"#ff5fa2"}}>계정이 안전</b>해요.</div>
              </div>

              {/* ★자연스러운 방문 강화 (체류시간·관련글·시간분산) */}
              <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(139,92,246,.25)", background: "rgba(139,92,246,.06)" }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#8b5cf6", marginBottom: 4 }}>🌿 자연스러운 방문 강화</div>
                <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500, marginBottom: 12 }}>
                  똑같이 빨리 처리하는 매크로가 아니라 <b>실제 사람처럼 읽고 머물게</b> 만들어요.
                  <b style={{color:"#ec4899"}}> 체류시간·투데이가 자연스럽게 늘어</b> 블로그 지수에 도움되고, 오히려 <b style={{color:"#00c896"}}>더 안전</b>해요.
                </div>

                {/* 체류시간 엔진 (항상 켜짐 안내) */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderTop: "1px dashed var(--border)" }}>
                  <span style={{ fontSize: 15 }}>⏱️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>체류시간 엔진 <span style={{ fontSize: 10.5, color: "#00c896", fontWeight: 700 }}>자동 적용</span></div>
                    <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginTop: 2 }}>글의 <b>글자·이미지 수를 읽어</b> 짧은 글은 빨리, 긴 글은 오래(최대 40초) 스크롤하며 머물러요. 즉시 이탈 패턴을 줄여요.</div>
                  </div>
                </div>

                {/* 관련 글 1편 더 읽기 토글 */}
                <div style={{ padding: "8px 0", borderTop: "1px dashed var(--border)" }}>
                  <Toggle val={pumReadRelated} set={setPumReadRelated} label="📖 관련 글 1편 더 읽기" />
                  <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginTop: 4, paddingLeft: 2 }}>댓글을 단 뒤 <b>같은 블로그의 다른 글 1편</b>을 공감·댓글 없이 더 읽어요. 댓글 달자마자 나가는 패턴을 줄여 <b style={{color:"#ec4899"}}>진짜 방문자처럼</b> 보이게 해요.</div>
                </div>

                {/* 시간 분산 큐 (분 단위) */}
                {(() => {
                  const maxReceive = Math.max(1, connected.length - 1);
                  const totalVisits = connected.reduce((s, a) => s + Math.min(maxReceive, pumReceiveByAcc[a.accountId] ?? Math.min(3, maxReceive)), 0) || 1;
                  const gapMin = pumSpread > 0 ? pumSpread / totalVisits : 0;   // 방문 사이 평균 간격(분)
                  const fmtGap = gapMin >= 1 ? `약 ${Math.round(gapMin)}분` : `약 ${Math.round(gapMin * 60)}초`;
                  const fmtTotal = pumSpread >= 60 ? `${Math.floor(pumSpread/60)}시간 ${pumSpread%60 ? `${pumSpread%60}분` : ""}`.trim() : `${pumSpread}분`;
                  return (
                <div style={{ padding: "8px 0 2px", borderTop: "1px dashed var(--border)" }}>
                  <label className="inp-label" style={{ fontSize: 12, marginBottom: 4, display: "block", fontWeight: 800 }}>⏰ 시간 분산 (방문을 이 시간 안에 고르게 나눔)</label>
                  <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginBottom: 8 }}>모든 방문을 <b>합쳐서 정한 시간 안에</b> 나눠 진행해요(전체 시간이지 계정당 시간이 아니에요). 짧은 시간에 방문이 몰리는 걸 막아 <b style={{color:"#00c896"}}>안전</b>해요.</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {[{v:0,t:"즉시"},{v:10,t:"10분"},{v:20,t:"20분"},{v:30,t:"30분"},{v:60,t:"1시간"},{v:120,t:"2시간"}].map(o => (
                      <button key={o.v} onClick={() => setPumSpread(o.v)} style={{ flex: "1 1 auto", padding: "8px 4px", borderRadius: 9, border: `2px solid ${pumSpread===o.v?"#8b5cf6":"var(--border)"}`, background: pumSpread===o.v?"rgba(139,92,246,.12)":"transparent", color: pumSpread===o.v?"#8b5cf6":"var(--text2)", cursor: "pointer", fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", minWidth: 0 }}>{o.t}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: "var(--text2)", fontWeight: 700, whiteSpace: "nowrap" }}>직접 입력</span>
                    <input className="inp" type="number" min={0} max={720} value={pumSpread} onChange={e => setPumSpread(Math.max(0, Math.min(720, parseInt(e.target.value) || 0)))} style={{ width: 90, fontSize: 13, padding: "8px 10px", textAlign: "center" }} />
                    <span style={{ fontSize: 11.5, color: "var(--text2)", fontWeight: 700 }}>분</span>
                    <span style={{ fontSize: 10.5, color: "var(--text3)" }}>(0=즉시, 최대 720분=12시간)</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5, background: "var(--card2)", borderRadius: 8, padding: "8px 11px", color: "var(--text2)" }}>
                    {pumSpread === 0
                      ? <>지금은 <b>즉시 연속</b>이에요 — 딜레이만 두고 쉬지 않고 이어서 방문해요.</>
                      : <>이번 설정: 총 방문 <b style={{color:"#8b5cf6"}}>{totalVisits}회</b>를 <b style={{color:"#8b5cf6"}}>{fmtTotal}</b>에 걸쳐 → 방문 사이 <b style={{color:"#ec4899"}}>{fmtGap}</b> 간격. <span style={{color:"var(--text3)"}}>그동안 앱이 켜져 있어야 해요.</span></>}
                  </div>
                </div>
                  );
                })()}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={handlePumasiStart} disabled={pumWorking || !botOnline || connected.length < 2} style={{ padding: "14px", fontSize: 14, borderRadius: 12 }}>
                {pumWorking ? <><span className="spinner" />품앗이 진행 중...</> : `🤝 품앗이 시작${connected.length >= 2 ? ` (${connected.length}개 계정)` : ""}`}
              </button>
              {connected.length < 2 && <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center" }}>계정을 <b>2개 이상 연결</b>하면 시작할 수 있어요.</div>}
              {pumWorking && <button className="btn-stop" onClick={handlePumasiStop} style={{ width: "100%", justifyContent: "center", padding: "13px", borderRadius: 12, fontSize: 13 }}>⛔ 중단</button>}
            </div>
          </div>

          {/* 오른쪽: 게이지 + 결과 + 로그 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>💞 오늘 품앗이 <span style={{ fontSize: 10.5, color: "var(--text3)", fontWeight: 600 }}>(자정 초기화)</span></span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#ec4899" }}>{pumUsed}건 남김</span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: "var(--card2)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 99, width: `${Math.min(100, pumUsed)}%`, background: "#ec4899", transition: "width .5s ease" }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 7, fontWeight: 500 }}>품앗이는 등급별 계정 수·글 수만 제한하고, 하루 총 건수 제한은 없어요(딜레이로 자연 조절).</div>
            </div>
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 700, marginBottom: 14 }}>🤝 품앗이 결과</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ textAlign: "center", padding: "14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 30, fontWeight: 900, color: "var(--success)" }}>{pumDone}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>완료</div>
                </div>
                <div style={{ textAlign: "center", padding: "14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 30, fontWeight: 900, color: "var(--danger)" }}>{pumFail}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>실패</div>
                </div>
              </div>
            </div>

            {/* ★품앗이 효과 리포트 */}
            <div className="card" style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#ec4899", marginBottom: 4 }}>📊 품앗이 효과 리포트</div>
              <div style={{ fontSize: 11.5, color: "var(--text2)", lineHeight: 1.6, fontWeight: 500, marginBottom: 12 }}>
                품앗이가 <b>실제로 방문자(투데이)에 도움이 됐는지</b> 확인해요. 최근 방문자 추이 위에 <b style={{color:"#8b5cf6"}}>품앗이한 날</b>을 표시해 비교하니, 효과 없이 과하게 하는 걸 줄일 수 있어요.
                <br/><span style={{ color: "var(--text3)" }}>※ 방문자 증가를 품앗이 효과라고 단정할 순 없어요. 발행·검색·계절 등 다른 요인과 함께 참고하세요.</span>
              </div>
              {connected.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>계정을 연결하면 블로그별 리포트를 볼 수 있어요.</div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {connected.map(a => (
                    <button key={a.accountId} onClick={() => handlePumasiReport(a.blogId)} disabled={pumReportLoading}
                      style={{ padding: "8px 12px", borderRadius: 9, border: `2px solid ${pumReportBlog===a.blogId?"#ec4899":"var(--border)"}`, background: pumReportBlog===a.blogId?"rgba(236,72,153,.1)":"transparent", color: pumReportBlog===a.blogId?"#ec4899":"var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit" }}>
                      {a.blogId}
                    </button>
                  ))}
                </div>
              )}
              {pumReportLoading && <div style={{ fontSize: 12.5, color: "var(--text2)" }}><span className="spinner" /> 방문자·품앗이 이력 집계 중...</div>}
              {pumReport && !pumReportLoading && (() => {
                const days = pumReport.days;
                if (days.length === 0) return <div style={{ fontSize: 12, color: "var(--text3)" }}>아직 방문자 데이터가 없어요. 하루 이상 지난 뒤 다시 확인해주세요.</div>;
                const maxV = Math.max(1, ...days.map(d => d.visitors));
                return (
                  <div>
                    {/* 요약 */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                      <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#ec4899" }}>{pumReport.totalReceived7d}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>최근 받은 품앗이</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#8b5cf6" }}>{pumReport.avgWithPumasi ?? "–"}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>품앗이한 날<br/>평균 방문자</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "10px 6px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text2)" }}>{pumReport.avgWithoutPumasi ?? "–"}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 2 }}>안 한 날<br/>평균 방문자</div>
                      </div>
                    </div>
                    {/* 막대 그래프 */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, padding: "0 2px" }}>
                      {days.map(d => (
                        <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: d.pumasiVisits>0?"#8b5cf6":"var(--text3)" }}>{d.visitors}</div>
                          <div style={{ width: "100%", height: `${Math.round((d.visitors/maxV)*80)}px`, minHeight: 3, borderRadius: "5px 5px 0 0", background: d.pumasiVisits>0 ? "linear-gradient(180deg,#ec4899,#8b5cf6)" : "var(--border)", transition: "height .4s ease" }} title={`${d.date} · 방문자 ${d.visitors} · 품앗이 ${d.pumasiVisits}회`} />
                          <div style={{ fontSize: 9.5, color: "var(--text3)" }}>{d.date.slice(5)}</div>
                          {d.pumasiVisits>0 && <div style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 800 }}>💞{d.pumasiVisits}</div>}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text3)", marginTop: 10, textAlign: "center" }}><span style={{color:"#8b5cf6"}}>■</span> 품앗이한 날 · <span style={{color:"var(--text3)"}}>■</span> 안 한 날</div>
                  </div>
                );
              })()}
            </div>

            <LogBox logs={pumLogs} logRef={pumLogRef} onClear={() => setPumLogs([])} />
          </div>
        </div>
        );
      })()}
    </div>
  );
}
