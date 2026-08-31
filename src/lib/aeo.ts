// 🤖 AEO(AI Engine Optimization) — 네이버 AI 브리핑/Cue:, 구글 AI Overview, 챗GPT·퍼플렉시티 같은
//   "답변형 AI"가 내 글을 답변에 인용하도록 글을 쓰게 만드는 규칙. 외부 연결이 아니라 '글 본문 형식'을 바꾸는 것.
//   회원(DashboardPage)·원터치·관리자(AdminPage) 글 생성 프롬프트에 공통으로 끼워 넣는다.

// 본문 규칙에 추가하는 블록 — 도입부 핵심요약 + 구조화(목록/표)로 AI가 발췌하기 쉽게.
export const AEO_RULES = `=== 🤖 AI 검색 최적화(AEO) — 네이버 AI 브리핑·Cue: 등 AI 답변에 인용되게(반드시 지킬 것) ===
✅ 글 맨 처음(제목 다음 첫 문단)에 "핵심 요약"을 2~3문장으로 먼저 제시 — 서론·인사말 없이 바로 질문의 답부터. 예: "OO은 △△입니다. 핵심은 3가지인데요, ① ~ ② ~ ③ ~ 순서로 정리했어요." (AI가 이 요약을 그대로 답변에 뽑아 씀)
✅ 정보를 나열할 때는 번호 목록(1. 2. 3. 또는 ① ② ③)이나 항목별로 끊어서 — AI가 파싱하기 쉽게 (긴 줄글 덩어리로 뭉치지 말 것)
✅ 비교·수치·조건이 있으면 "항목: 값" 형태로 또렷하게 (예: "가격: 1만원 / 소요시간: 30분")
✅ 각 소제목 아래 첫 문장은 그 구간의 결론부터 (두괄식) — AI가 문단 첫 문장을 근거로 자주 인용함`;

// 제목 생성 프롬프트에 붙이는 AEO 규칙 — AI가 "이 질문엔 이 글이 답"이라고 뽑게.
export const AEO_TITLE_RULE = `- ★AI 검색 최적화: 제목에 '검색 의도(질문/니즈)'를 담기 — 사람들이 AI·검색창에 실제로 묻는 형태(무엇/어떻게/추천/가격/비교/방법/후기)로. AI가 이 제목을 보고 "이 질문의 답은 이 글"이라고 뽑아 씀. (단, 낚시 감탄사 말고 담백한 실제 검색어 형태로)`;

// 출력 형식 안내에 붙이는 FAQ 강화(4~5개) — AI가 Q&A를 통째로 발췌하기 좋은 형태.
export const AEO_FAQ_FORMAT = `[FAQ시작]
Q1: (사람들이 실제로 검색창에 칠 법한 질문)
A1: (핵심부터 1~2문장으로 또렷하게)
Q2: (질문)
A2: (답변)
Q3: (질문)
A3: (답변)
Q4: (질문)
A4: (답변)
[FAQ끝]`;

// 🩺 AEO 형식 진단 — 글 본문(텍스트)을 읽어 AI 인용에 유리한 3요소를 갖췄는지 로컬 판정(AI 호출 0, 무료·즉시).
//   블로그지수(NeighborPage)에서 내 글이 AEO형인지 체크리스트로 보여줄 때 씀. 단일 소스.
export interface AeoCheck { key: string; label: string; ok: boolean; hint: string }
export function diagnoseAeo(body: string): { checks: AeoCheck[]; score: number; passed: number } {
  const text = (body || "").trim();
  const firstPara = text.split(/\n\s*\n/)[0] || text.slice(0, 200);   // 첫 문단
  // ① 도입부 핵심 요약: 첫 문단이 서론·인사 없이 결론/핵심을 담았나 (요약 신호어 또는 나열/숫자)
  const introSummary = firstPara.length >= 40 && (
    /(핵심|정리|요약|결론부터|한마디로|간단히|세\s*가지|가지는|가지로|순서로|첫째|먼저|①|1\.\s)/.test(firstPara)
    && !/^(안녕|반갑|오늘은|여러분|이번에|요즘|날씨)/.test(firstPara)
  );
  // ② FAQ / Q&A: 자주 묻는 질문 블록이 있나
  const hasFaq = /\[FAQ시작\]|자주\s*묻는\s*질문|Q\s*&\s*A|큐앤에이|(?:^|\n)\s*Q\s*\d?\s*[:：.]/i.test(text);
  // ③ 구조화: 번호/기호 목록이나 "항목: 값" 형태가 충분히 있나
  const listHits = (text.match(/(?:^|\n)\s*(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨]|[-•▶]|첫째|둘째|셋째)/g) || []).length
    + (text.match(/[^\n]{1,14}\s*[:：]\s*\S/g) || []).length;
  const structured = listHits >= 3;
  const checks: AeoCheck[] = [
    { key: "intro", label: "도입부 핵심 요약", ok: introSummary, hint: "글 첫 문단을 인사말 대신 '핵심 요약'으로 시작하면 AI가 그 문장을 답변에 뽑아 써요." },
    { key: "faq", label: "자주 묻는 질문(Q&A)", ok: hasFaq, hint: "글 아래 Q&A를 넣으면 AI가 질문-답변을 통째로 인용하기 좋아요." },
    { key: "structure", label: "목록·구조화", ok: structured, hint: "정보를 번호 목록이나 '항목: 값'으로 정리하면 AI가 파싱하기 쉬워요." },
  ];
  const passed = checks.filter(c => c.ok).length;
  return { checks, score: Math.round((passed / checks.length) * 100), passed };
}
