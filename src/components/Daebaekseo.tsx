/* 📖 퍼블리 대백서 — "어떤 순서로, 어떨 때 쓰면 좋은지" 상황별 사용 레시피.
   ★기능 나열이 아니라 목표/상황 → 단계 순서 → 팁. 어르신도 이해되게 큰 글씨·쉬운 말.
   ★새 기능이 생기면 아래 RECIPES 배열에 한 항목만 추가하면 대백서에 자동 반영된다.
   ★회원=관리자 공용. 다크/라이트 양쪽에서 글자 또렷하게(테마별 명시색). 마스코트 '펄리' 사용. */
import React, { useState } from "react";
import { Pearly } from "./UsageGuide";

export const DAEBAEKSEO_VERSION = 1;   // 내용 크게 바뀌면 +1 → 로그인 자동팝업 다시 노출

type Step = { tab?: string; title: string; desc: string };
type Recipe = {
  ico: string;
  goal: string;         // 이럴 때(상황·목표)
  when: string;         // 한 줄 설명
  steps: Step[];        // 추천 순서
  tip?: string;         // 고수 팁
  accent: string;
};

/* ── 상황별 레시피(순서가 핵심) ── 새 기능은 여기에 항목 추가 ── */
const RECIPES: Recipe[] = [
  {
    ico: "🌱", goal: "블로그를 이제 막 시작할 때", when: "계정만 있고 뭐부터 할지 막막하다면 이 순서대로!",
    accent: "#ff7eb6",
    steps: [
      { tab: "계정 관리", title: "① 네이버/티스토리 연결", desc: "먼저 내 블로그 계정을 연결해요. 사진 글쓰기·발행에 쓰여요." },
      { tab: "키워드/제목", title: "② 쓸 주제 정하기", desc: "인기 키워드와 잘 눌리는 제목 후보를 추천받아 고릅니다." },
      { tab: "글 생성", title: "③ 본문 자동 작성", desc: "고른 제목으로 본문을 자동으로 써줘요. 말투·유형 선택." },
      { tab: "이미지 생성", title: "④ 어울리는 그림", desc: "무료(Google Flow)로 글에 맞는 이미지를 만들어 넣어요." },
      { tab: "발행하기", title: "⑤ 블로그에 올리기", desc: "🚀 누르면 자동 발행. 처음엔 '전체'로 올려보세요." },
    ],
    tip: "처음 3~4일은 하루 1개씩만! 자리 잡히면 서이추·공감으로 이웃을 늘려요.",
  },
  {
    ico: "📅", goal: "매일 꾸준히 글 하나 올리고 싶을 때", when: "무엇을 쓸지 고민 없이 매일 돌리는 루틴",
    accent: "#22a35d",
    steps: [
      { tab: "콘텐츠 캘린더", title: "① 오늘의 글감 받기", desc: "날짜별 추천 주제·핫이슈를 보고 오늘 쓸 걸 고릅니다." },
      { tab: "글 생성", title: "② 바로 작성", desc: "캘린더의 '글쓰기'로 이어서 본문을 자동 생성." },
      { tab: "발행하기", title: "③ 예약 발행", desc: "바쁘면 예약 시간을 걸어두면 PC를 꺼도 그 시간에 올라가요." },
      { tab: "콘텐츠 캘린더", title: "④ 완료 체크 🔥", desc: "쓴 날은 체크! 며칠 연속 썼는지 스트릭이 쌓여 동기부여." },
    ],
    tip: "예약 발행을 활용하면 하루 한 번만 세팅하고 계속 올라가게 만들 수 있어요.",
  },
  {
    ico: "📈", goal: "검색 상위노출을 올리고 싶을 때", when: "쓴 글이 검색에 안 잡힐 때 진단부터",
    accent: "#3b82f6",
    steps: [
      { tab: "블로그 지수", title: "① 건강검진", desc: "내 블로그 지수·저품질 여부·검색 노출을 먼저 진단해요." },
      { tab: "블로그 지수", title: "② 글별 진료차트(주치의)", desc: "글마다 순위를 기억하고 완치까지 관찰. 오늘의 회진 확인." },
      { tab: "키워드/제목", title: "③ 제목·키워드 최적화", desc: "노출 잘 되는 키워드로 제목을 다듬어요." },
      { tab: "발행 관리", title: "④ 재발행·성과 추적", desc: "30일 누적으로 순위 ▲▼ 변화를 보고 다음 글에 반영." },
    ],
    tip: "제목을 바꾼 뒤에는 30일 관찰! 자꾸 바꾸면 오히려 순위가 흔들려요.",
  },
  {
    ico: "🤝", goal: "이웃·방문자를 늘리고 싶을 때", when: "글은 쌓이는데 방문자가 적을 때",
    accent: "#00b8d4",
    steps: [
      { tab: "서이추", title: "① 서로이웃 신청", desc: "내 주제와 맞는 블로거에게 서이추를 보내요(등급별 하루 한도)." },
      { tab: "공감·댓글", title: "② 공감·댓글로 인사", desc: "이웃 글에 공감·댓글로 관계를 쌓아요." },
      { tab: "답방", title: "③ 답방하기", desc: "내 글에 댓글 단 사람에게 답방으로 보답." },
      { tab: "품앗이", title: "④ 내 계정끼리 품앗이", desc: "여러 계정이 있으면 서로 공감·댓글로 초반 온기를 만들어요." },
    ],
    tip: "모든 소통 기능은 ⚙️자동(봇이 알아서)/수동(내가 버튼) 둘 다 있어요. 처음엔 수동으로 감을 잡고 익숙해지면 자동으로!",
  },
  {
    ico: "📷", goal: "사진만 있고 글쓰기는 귀찮을 때", when: "여행·맛집 사진으로 후기 글 뚝딱",
    accent: "#f59e0b",
    steps: [
      { tab: "사진 글쓰기", title: "① 발행 계정 고르기", desc: "◉ 로 올릴 네이버 계정을 먼저 선택(계정 섞임 방지)." },
      { tab: "사진 글쓰기", title: "② 사진 올리기", desc: "글에 넣을 사진을 업로드해요(최대 20장)." },
      { tab: "사진 글쓰기", title: "③ 핵심만 적고 생성", desc: "간단한 포인트만 적으면 사진에 맞춘 글이 만들어져요." },
    ],
    tip: "사진 순서대로 이야기가 이어지게 올리면 글 흐름이 훨씬 자연스러워요.",
  },
  {
    ico: "🔍", goal: "협업 블로거·체험단을 찾을 때", when: "내 주제 블로거를 발굴해 연락하고 싶을 때",
    accent: "#8b5cf6",
    steps: [
      { tab: "크롤링", title: "① 블로거 발굴", desc: "키워드로 블로거를 찾아요. 활성도🔥·상업성📊·주제🏷️도 함께 봐요." },
      { tab: "크롤링", title: "② 연락처 수집", desc: "이메일·카톡·오픈챗 등 연락 수단을 모아요." },
      { tab: "크롤링", title: "③ 아웃리치", desc: "웹메일 자동발송 또는 블로그 댓글로 연락(도배 방지 딜레이)." },
    ],
    tip: "협찬% 낮은 '순수 후기' 블로거가 반응이 더 좋아요. 필터로 걸러서 접근하세요.",
  },
  {
    ico: "🗺️", goal: "내 지역 업체·블로거를 찾을 때", when: "플레이스 기반으로 업체 발굴 & 블로거 역추적",
    accent: "#16856b",
    steps: [
      { tab: "플레이스", title: "① 업체 발굴", desc: "지역+업종으로 업체 목록(리뷰 수 등)을 모아요." },
      { tab: "플레이스", title: "② 블로거 역추적", desc: "그 업체를 리뷰한 블로거를 거꾸로 찾아요(등급별 상한)." },
      { tab: "크롤링", title: "③ 연락·아웃리치로 연결", desc: "찾은 블로거를 크롤링 아웃리치로 이어서 접촉." },
    ],
    tip: "역추적은 업체 하나당 인원이 적으니 여러 업체를 합쳐 명단을 키우면 좋아요.",
  },
  {
    ico: "📱", goal: "인스타로 고객을 모으고 싶을 때", when: "블로그 밖에서도 관심 고객에게 다가가기",
    accent: "#e5397f",
    steps: [
      { tab: "인스타 DM", title: "① 인스타 로그인", desc: "인스타 계정으로 로그인해요." },
      { tab: "인스타 DM", title: "② 대상 수집", desc: "키워드로 보낼 대상을 모아요." },
      { tab: "인스타 DM", title: "③ 천천히 발송", desc: "메시지를 적고 안전한 간격으로 보내요(계정 보호)." },
    ],
    tip: "한 번에 많이 보내면 제한될 수 있어요. 매일 조금씩 꾸준히가 안전해요.",
  },
];

/* ── 알아두면 좋은 팁 ── */
const TIPS: { ico: string; title: string; desc: string }[] = [
  { ico: "⚙️", title: "자동 vs 수동, 둘 다 있어요", desc: "모든 기능은 봇이 알아서 하는 '자동'과 내가 버튼 누르는 '수동'이 함께 있어요. 상황에 맞게 골라 쓰세요." },
  { ico: "🏅", title: "등급별 하루 한도", desc: "서이추·공감·발굴 등은 등급에 따라 하루 사용량이 달라요. 컨트롤타워에서 오늘 남은 양을 확인!" },
  { ico: "🌐", title: "계정별 IP(프록시)", desc: "여러 계정을 안전하게 돌리려면 계정마다 다른 IP를 쓰는 게 좋아요(같은 IP 차단 회피)." },
  { ico: "🛟", title: "문제가 생기면", desc: "화면 아래 로그의 '📋 복사'를 눌러 그대로 보내주시면 원인을 빨리 찾을 수 있어요." },
];

export default function Daebaekseo({ theme = "light", onClose }: { theme?: "dark" | "light"; onClose: () => void }) {
  const dark = theme === "dark";
  const [openIdx, setOpenIdx] = useState<number>(0);   // 첫 레시피는 펼쳐서 보여줌
  const C = dark
    ? { overlay: "rgba(3,7,12,.72)", card: "#241f1b", panel: "#2e2823", line: "#463f37", head: "#fdf3ea", sub: "#b3a898" }
    : { overlay: "rgba(40,25,35,.42)", card: "#fffdfb", panel: "#fff7fb", line: "#f0dce7", head: "#241f1b", sub: "#7a7266" };
  const bodyColor = dark ? "#d8cdbd" : "#4a4540";

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(8px,3vw,28px)", backdropFilter: "blur(3px)" }}>
      <section role="dialog" aria-modal="true" aria-label="퍼블리 대백서"
        style={{ width: "min(760px,100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", overflow: "hidden", animation: "fadeUp .22s ease both" }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "18px clamp(16px,3vw,24px)", borderBottom: `1px solid ${C.line}`, background: dark ? "#2a231e" : "#fff0f7", position: "relative" }}>
          <Pearly size={54} accent="#ff7eb6" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "clamp(18px,4vw,22px)", fontWeight: 900, color: C.head, letterSpacing: "-.02em" }}>📖 퍼블리 대백서</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>펄리예요! 기능 설명이 아니라 <b>“이럴 때 이 순서로 쓰면 좋아요”</b>를 모았어요.</div>
          </div>
          <button onClick={onClose} aria-label="닫기"
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.card, color: C.head, fontSize: 19, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* 본문 스크롤 */}
        <div style={{ overflowY: "auto", padding: "clamp(12px,3vw,20px)", display: "flex", flexDirection: "column", gap: 12 }}>
          {RECIPES.map((r, i) => {
            const open = openIdx === i;
            return (
              <div key={i} style={{ border: `1px solid ${open ? r.accent + "88" : C.line}`, borderRadius: 15, background: C.panel, overflow: "hidden", transition: "border-color .15s" }}>
                <button onClick={() => setOpenIdx(open ? -1 : i)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                  <span style={{ flexShrink: 0, width: 42, height: 42, borderRadius: 12, background: r.accent + (dark ? "2e" : "1c"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{r.ico}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: "clamp(15px,3.4vw,16.5px)", fontWeight: 900, color: C.head, letterSpacing: "-.01em" }}>{r.goal}</span>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.sub, marginTop: 2 }}>{r.when}</span>
                  </span>
                  <span style={{ flexShrink: 0, color: r.accent, fontSize: 15, fontWeight: 900, transform: open ? "rotate(90deg)" : "none", transition: "transform .18s" }}>▸</span>
                </button>
                {open && (
                  <div style={{ padding: "0 15px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
                    {r.steps.map((s, j) => (
                      <div key={j} style={{ display: "flex", gap: 11, alignItems: "flex-start", background: C.card, borderRadius: 12, padding: "11px 12px", border: `1px solid ${C.line}` }}>
                        <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: r.accent, color: "#fff", fontWeight: 900, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{j + 1}</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 14.5, fontWeight: 800, color: C.head }}>{s.title}</span>
                          {s.tab && <span style={{ marginLeft: 7, fontSize: 11, fontWeight: 800, color: r.accent, background: r.accent + (dark ? "26" : "18"), padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>{s.tab}</span>}
                          <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: bodyColor, marginTop: 3, lineHeight: 1.55 }}>{s.desc}</span>
                        </span>
                      </div>
                    ))}
                    {r.tip && (
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 2, padding: "10px 12px", borderRadius: 12, background: r.accent + (dark ? "1e" : "12"), border: `1px dashed ${r.accent}66` }}>
                        <span style={{ fontSize: 15 }}>💡</span>
                        <span style={{ fontSize: 12.8, fontWeight: 700, color: dark ? "#f0e6da" : "#5a4636", lineHeight: 1.55 }}>{r.tip}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* 알아두면 좋은 팁 */}
          <div style={{ marginTop: 6, padding: "14px 15px", borderRadius: 15, border: `1px solid ${C.line}`, background: C.panel }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.head, marginBottom: 10 }}>🧭 알아두면 좋아요</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 9 }}>
              {TIPS.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: C.card, borderRadius: 12, padding: "11px 12px", border: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 19, flexShrink: 0 }}>{t.ico}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: C.head }}>{t.title}</span>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: bodyColor, marginTop: 2, lineHeight: 1.5 }}>{t.desc}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: C.sub, marginTop: 2 }}>
            ✨ 새로운 기능이 생기면 대백서에 계속 업데이트돼요.
          </div>
        </div>

        {/* 푸터 */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px clamp(16px,3vw,24px)", borderTop: `1px solid ${C.line}`, background: dark ? "#2a231e" : "#fff7fb" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: C.sub, cursor: "pointer" }}>
            <input type="checkbox" onChange={e => { try { localStorage.setItem("publy_daebaekseo_seen", e.target.checked ? String(DAEBAEKSEO_VERSION) : ""); } catch {} }} style={{ width: 16, height: 16, accentColor: "#ff7eb6", cursor: "pointer" }} />
            로그인할 때 다시 띄우지 않기
          </label>
          <button onClick={onClose}
            style={{ padding: "10px 22px", borderRadius: 12, border: "none", background: "#ff7eb6", color: "#fff", fontSize: 14.5, fontWeight: 900, fontFamily: "inherit", cursor: "pointer", boxShadow: "0 4px 14px rgba(255,126,182,.4)" }}>
            시작하기 →
          </button>
        </div>
      </section>
    </div>
  );
}
