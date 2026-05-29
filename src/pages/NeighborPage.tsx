import React, { useState, useEffect, useRef, useCallback } from "react";

const BOT = "http://127.0.0.1:3334";

interface Account {
  accountId: string; // 내부 식별자
  id: string;        // 네이버 아이디
  pw: string;        // 비밀번호
  blogId: string;    // 블로그 ID (로그인 후 확인)
  sessionOk: boolean;
  loginLoading: boolean;
  showPw: boolean;   // 비밀번호 표시 여부
}

interface Target {
  keyword: string;
  blogId: string;
}

interface WorkResult {
  keyword: string;
  blogId: string;
  status: "success" | "fail" | "skip" | "limit" | "pending" | "running";
  message: string;
}

interface Props {
  theme: "dark" | "light";
}

export default function NeighborPage({ theme }: Props) {
  // ── 계정 ──
  const [accounts, setAccounts] = useState<Account[]>([
    { accountId: "acc_1", id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false },
  ]);

  // ── 수집 설정 ──
  const [keywords, setKeywords] = useState(""); // 쉼표 구분
  const [countPerKw, setCountPerKw] = useState(34);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(10);
  const [skipDone, setSkipDone] = useState(true);
  const [autoStart, setAutoStart] = useState(false); // 수집 후 바로 신청

  // ── 멘트 ──
  const [msgMode, setMsgMode] = useState<"single" | "multi">("single");
  const [singleMsg, setSingleMsg] = useState("안녕하세요! 좋은 글 잘 읽고 갑니다. 서로이웃 신청드려요 😊");
  const [multiMsgs, setMultiMsgs] = useState(
    "안녕하세요! 좋은 글 잘 읽고 갑니다. 서로이웃 신청드려요 😊\n공감가는 글이 많네요. 서로이웃 해요!\n좋은 정보 잘 보고 갑니다. 이웃 신청드려요^^"
  );
  const [msgIndex, setMsgIndex] = useState(0);

  // ── 수집 결과 / 작업 현황 ──
  const [targets, setTargets] = useState<Target[]>([]);
  const [results, setResults] = useState<WorkResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [working, setWorking] = useState(false);
  const [doneCnt, setDoneCnt] = useState(0);
  const [failCnt, setFailCnt] = useState(0);
  const [botOnline, setBotOnline] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const jobIdRef = useRef<string>(Date.now().toString());
  const esRef = useRef<EventSource | null>(null);

  // ── 봇 상태 체크 ──
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${BOT}/health`, { signal: AbortSignal.timeout(2000) });
        setBotOnline(r.ok);
      } catch { setBotOnline(false); }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  // ── 로그 자동 스크롤 ──
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((p) => [...p.slice(-200), `${time} :: ${msg}`]);
  }, []);

  // ── 세션 상태 확인 ──
  useEffect(() => {
    accounts.forEach((acc) => {
      if (!acc.id) return;
      fetch(`${BOT}/api/session/${acc.accountId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.exists) {
            setAccounts((p) =>
              p.map((a) => (a.accountId === acc.accountId ? { ...a, sessionOk: true } : a))
            );
          }
        })
        .catch(() => {});
    });
  }, []);

  // ── 계정 로그인 ──
  const handleLogin = async (accountId: string) => {
    const acc = accounts.find((a) => a.accountId === accountId);
    if (!acc || !acc.id || !acc.pw) return alert("아이디와 비밀번호를 입력하세요");
    setAccounts((p) => p.map((a) => (a.accountId === accountId ? { ...a, loginLoading: true } : a)));
    try {
      const r = await fetch(`${BOT}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, id: acc.id, pw: acc.pw }),
      });
      const d = await r.json();
      if (d.success) {
        setAccounts((p) =>
          p.map((a) => (a.accountId === accountId ? { ...a, sessionOk: true, blogId: d.blogId, loginLoading: false } : a))
        );
        addLog(`✅ [${acc.id}] 로그인 성공 (blogId: ${d.blogId})`);
      } else {
        throw new Error(d.error || "로그인 실패");
      }
    } catch (e: any) {
      setAccounts((p) => p.map((a) => (a.accountId === accountId ? { ...a, loginLoading: false } : a)));
      addLog(`❌ [${acc.id}] 로그인 오류: ${e.message}`);
      alert(`로그인 오류: ${e.message}`);
    }
  };

  const addAccount = () => {
    setAccounts((p) => [
      ...p,
      { accountId: `acc_${Date.now()}`, id: "", pw: "", blogId: "", sessionOk: false, loginLoading: false, showPw: false },
    ]);
  };

  const removeAccount = (accountId: string) => {
    if (accounts.length <= 1) return;
    setAccounts((p) => p.filter((a) => a.accountId !== accountId));
  };

  // ── 현재 메시지 가져오기 ──
  const getCurrentMsg = () => {
    if (msgMode === "single") return singleMsg;
    const lines = multiMsgs.split("\n").filter((l) => l.trim());
    if (!lines.length) return singleMsg;
    const msg = lines[msgIndex % lines.length];
    setMsgIndex((p) => p + 1);
    return msg;
  };

  // ── 추출 시작 ──
  const handleCrawl = async () => {
    const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean);
    if (!kwList.length) return alert("키워드를 입력하세요");
    const connectedAcc = accounts.find((a) => a.sessionOk);
    if (!connectedAcc) return alert("먼저 계정을 연결하세요");

    setCrawling(true);
    setTargets([]);
    setResults([]);
    setDoneCnt(0);
    setFailCnt(0);
    addLog(`🔍 수집 시작 — 키워드: ${kwList.join(", ")} / 키워드당 ${countPerKw}개`);

    const url = `${BOT}/api/crawl?accountId=${encodeURIComponent(connectedAcc.accountId)}&keywords=${encodeURIComponent(kwList.join(","))}&countPerKeyword=${countPerKw}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "log") addLog(data.msg);
      if (data.type === "crawl_done") {
        const newTargets: Target[] = data.results;
        setTargets(newTargets);
        setResults(newTargets.map((t) => ({ ...t, status: "pending", message: "대기중" })));
        addLog(`✅ 수집 완료: 총 ${newTargets.length}개`);
        setCrawling(false);
        es.close();
        if (autoStart && newTargets.length > 0) {
          setTimeout(() => startWork(newTargets), 500);
        }
      }
      if (data.type === "error") {
        addLog(`❌ 오류: ${data.msg}`);
        setCrawling(false);
        es.close();
      }
    };
    es.onerror = () => { addLog("❌ 수집 연결 오류"); setCrawling(false); es.close(); };
  };

  // ── 작업 시작 ──
  const startWork = async (targetList?: Target[]) => {
    const list = targetList || targets;
    if (!list.length) return alert("수집된 블로그가 없습니다. 먼저 추출하세요");
    const connectedAcc = accounts.find((a) => a.sessionOk);
    if (!connectedAcc) return alert("먼저 계정을 연결하세요");

    setWorking(true);
    setDoneCnt(0);
    setFailCnt(0);
    jobIdRef.current = Date.now().toString();
    addLog(`🚀 작업 시작 — ${list.length}개 대상 / 한도 ${dailyLimit}개 / 딜레이 ${delayMin}~${delayMax}초`);

    const msg = msgMode === "single" ? singleMsg : multiMsgs.split("\n").filter((l) => l.trim()).join("|||");

    const params = new URLSearchParams({
      accountId: connectedAcc.accountId,
      targets: encodeURIComponent(JSON.stringify(list)),
      message: msg,
      delayMin: delayMin.toString(),
      delayMax: delayMax.toString(),
      dailyLimit: dailyLimit.toString(),
      skipDone: skipDone.toString(),
      jobId: jobIdRef.current,
    });

    const es = new EventSource(`${BOT}/api/add-neighbor?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "log") addLog(data.msg);
      if (data.type === "result") {
        setResults((p) =>
          p.map((r) => r.blogId === data.blogId ? { ...r, status: data.status, message: data.message } : r)
        );
      }
      if (data.type === "progress") {
        setDoneCnt(data.done);
        setFailCnt(data.fail);
      }
      if (data.type === "done") {
        addLog("🎉 작업 완료!");
        setWorking(false);
        es.close();
      }
      if (data.type === "error") {
        addLog(`❌ 오류: ${data.msg}`);
        setWorking(false);
        es.close();
      }
    };
    es.onerror = () => { addLog("❌ 작업 연결 오류"); setWorking(false); es.close(); };
  };

  const handleStop = async () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    try { await fetch(`${BOT}/api/stop/${jobIdRef.current}`, { method: "POST" }); } catch {}
    addLog("⛔ 중단 요청 전송");
    setCrawling(false);
    setWorking(false);
  };

  const handleSaveHistory = () => {
    const csv = ["키워드,블로그ID,결과,메시지", ...results.map((r) => `${r.keyword},${r.blogId},${r.status},${r.message}`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = `서로이웃_작업내역_${new Date().toLocaleDateString("ko-KR").replace(/\. /g, "-").replace(".", "")}.csv`;
    a.click();
    addLog("💾 작업 내역 저장 완료");
  };

  const handleLoadList = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const newTargets: Target[] = [];
      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length >= 2) {
          newTargets.push({ keyword: parts[0].trim(), blogId: parts[1].trim() });
        } else if (parts.length === 1 && parts[0]) {
          newTargets.push({ keyword: "직접입력", blogId: parts[0].trim() });
        }
      }
      setTargets(newTargets);
      setResults(newTargets.map((t) => ({ ...t, status: "pending", message: "대기중" })));
      addLog(`📂 리스트 불러오기 완료: ${newTargets.length}개`);
    };
    input.click();
  };

  const statusColor = (s: WorkResult["status"]) => {
    if (s === "success") return "var(--success)";
    if (s === "fail") return "var(--danger)";
    if (s === "skip") return "var(--text3)";
    if (s === "limit") return "var(--warn)";
    if (s === "running") return "var(--info)";
    return "var(--text3)";
  };

  const statusLabel = (s: WorkResult["status"]) => {
    if (s === "success") return "신청 완료";
    if (s === "fail") return "실패";
    if (s === "skip") return "스킵";
    if (s === "limit") return "한도 초과";
    if (s === "running") return "진행중...";
    return "대기중";
  };

  return (
    <div style={{ animation: "fadeUp .25s ease both" }}>

      {/* 봇 상태 */}
      {!botOnline && (
        <div style={{ marginBottom: 14, padding: "12px 16px", borderRadius: 12, background: "rgba(255,83,99,.08)", border: "1px solid rgba(255,83,99,.25)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
          ⚠️ 서로이웃 봇 서버(포트 3334)가 오프라인입니다. <code style={{ fontSize: 11, background: "var(--card2)", padding: "2px 6px", borderRadius: 5 }}>neighbor-bot</code> 폴더에서 <code style={{ fontSize: 11, background: "var(--card2)", padding: "2px 6px", borderRadius: 5 }}>npm start</code> 를 실행하세요.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 14, alignItems: "start" }}>

        {/* ── 왼쪽: 작업 설정 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* 계정 */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="card-title" style={{ marginBottom: 12 }}>👤 작업 계정</div>
            {accounts.map((acc, i) => (
              <div key={acc.accountId} style={{ marginBottom: 10, padding: "12px 14px", borderRadius: 12, border: `1.5px solid ${acc.sessionOk ? "rgba(0,214,143,.4)" : "var(--border)"}`, background: acc.sessionOk ? "rgba(0,214,143,.05)" : "var(--bg)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: acc.sessionOk ? "var(--success)" : "var(--text3)", flexShrink: 0, boxShadow: acc.sessionOk ? "0 0 6px var(--success)" : "none" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>계정 {i + 1}</span>
                  {acc.blogId && <span style={{ fontSize: 11, color: "var(--success)", marginLeft: 4 }}>({acc.blogId})</span>}
                  {accounts.length > 1 && (
                    <button onClick={() => removeAccount(acc.accountId)} style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input className="inp" placeholder="네이버 아이디" value={acc.id}
                    onChange={(e) => setAccounts((p) => p.map((a) => a.accountId === acc.accountId ? { ...a, id: e.target.value, sessionOk: false } : a))}
                    style={{ flex: 1, fontSize: 12, padding: "8px 10px" }} />
                  <div style={{ flex: 1, position: "relative", display: "flex" }}>
                    <input className="inp" type={acc.showPw ? "text" : "password"} placeholder="비밀번호" value={acc.pw}
                      onChange={(e) => setAccounts((p) => p.map((a) => a.accountId === acc.accountId ? { ...a, pw: e.target.value, sessionOk: false } : a))}
                      style={{ flex: 1, fontSize: 12, padding: "8px 32px 8px 10px", width: "100%" }} />
                    <button
                      onClick={() => setAccounts((p) => p.map((a) => a.accountId === acc.accountId ? { ...a, showPw: !a.showPw } : a))}
                      style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", fontSize: 14, color: "var(--text3)", padding: "2px 4px", lineHeight: 1 }}>
                      {acc.showPw ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <button onClick={() => handleLogin(acc.accountId)} disabled={acc.loginLoading || !acc.id || !acc.pw}
                  style={{ width: "100%", padding: "9px", borderRadius: 9, border: "none", background: acc.sessionOk ? "rgba(0,214,143,.15)" : "var(--accent)", color: acc.sessionOk ? "var(--success)" : "#000", cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: "inherit", transition: "all .2s" }}>
                  {acc.loginLoading ? "🔄 로그인 중..." : acc.sessionOk ? "✅ 연결됨" : "🔗 계정 연결"}
                </button>
              </div>
            ))}
            <button onClick={addAccount} style={{ width: "100%", padding: "9px", borderRadius: 9, border: "1.5px dashed var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
              + 계정 추가
            </button>
          </div>

          {/* 수집 설정 */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="card-title" style={{ marginBottom: 12 }}>🔍 추출 설정</div>
            <div style={{ marginBottom: 10 }}>
              <label className="inp-label">키워드 (쉼표로 구분)</label>
              <input className="inp" placeholder="예: 원주, 강원도, 제주도 맛집" value={keywords} onChange={(e) => setKeywords(e.target.value)} style={{ fontSize: 13 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label className="inp-label">키워드당 추출 수</label>
                <input className="inp" type="number" min={1} max={300} value={countPerKw} onChange={(e) => setCountPerKw(Number(e.target.value))} style={{ fontSize: 13 }} />
              </div>
              <div>
                <label className="inp-label">하루 신청 한도</label>
                <input className="inp" type="number" min={1} max={100} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} style={{ fontSize: 13 }} />
              </div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>
              총 수집 예정: <strong style={{ color: "var(--text)" }}>{keywords.split(",").filter((k) => k.trim()).length * countPerKw}개</strong>
            </div>
          </div>

          {/* 딜레이 & 옵션 */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="card-title" style={{ marginBottom: 12 }}>⚙️ 작업 옵션</div>
            <div style={{ marginBottom: 10 }}>
              <label className="inp-label">딜레이 (초)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input className="inp" type="number" min={1} max={60} value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} style={{ flex: 1, fontSize: 13 }} />
                <span style={{ color: "var(--text3)", fontSize: 12 }}>~</span>
                <input className="inp" type="number" min={1} max={120} value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value))} style={{ flex: 1, fontSize: 13 }} />
                <span style={{ color: "var(--text3)", fontSize: 12 }}>초</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { key: "skipDone", val: skipDone, set: setSkipDone, label: "작업 진행된 블로그 스킵" },
                { key: "autoStart", val: autoStart, set: setAutoStart, label: "추출 완료 후 바로 신청 시작" },
              ].map(({ key, val, set, label }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
                  <div onClick={() => set((p: boolean) => !p)}
                    style={{ width: 38, height: 22, borderRadius: 99, background: val ? "var(--accent)" : "var(--border)", position: "relative", transition: "background .2s", cursor: "pointer", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 3, left: val ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                  </div>
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* 서로이웃 멘트 */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="card-title" style={{ marginBottom: 12 }}>💬 서로이웃 멘트</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {(["single", "multi"] as const).map((m) => (
                <button key={m} onClick={() => setMsgMode(m)}
                  style={{ flex: 1, padding: "8px", borderRadius: 9, border: `1.5px solid ${msgMode === m ? "var(--accent)" : "var(--border)"}`, background: msgMode === m ? "var(--accent-bg)" : "transparent", color: msgMode === m ? "var(--accent-text)" : "var(--text2)", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                  {m === "single" ? "단일 멘트" : "다중 멘트 [순차]"}
                </button>
              ))}
            </div>
            {msgMode === "single" ? (
              <textarea className="inp" rows={3} value={singleMsg} onChange={(e) => setSingleMsg(e.target.value)} style={{ resize: "vertical", fontSize: 13 }} />
            ) : (
              <>
                <textarea className="inp" rows={5} value={multiMsgs} onChange={(e) => setMultiMsgs(e.target.value)} style={{ resize: "vertical", fontSize: 13 }} placeholder="멘트를 줄바꿈으로 구분하면 순차 사용됩니다" />
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>총 {multiMsgs.split("\n").filter((l) => l.trim()).length}개 멘트 — 순차 사용</div>
              </>
            )}
          </div>

          {/* 버튼들 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-primary btn-full" onClick={handleCrawl} disabled={crawling || working || !botOnline}>
              {crawling ? <><span className="spinner" />추출 중...</> : "🔍 추출 시작"}
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => startWork()} disabled={crawling || working || !targets.length || !botOnline}>
                {working ? <><span className="spinner" />작업 중...</> : "🚀 작업 시작"}
              </button>
              <button className="btn btn-secondary" onClick={handleLoadList} disabled={crawling || working}>
                📂 리스트 불러오기
              </button>
            </div>
            {(crawling || working) && (
              <button className="btn-stop" onClick={handleStop} style={{ width: "100%", justifyContent: "center" }}>
                ⛔ 작업 중단
              </button>
            )}
          </div>
        </div>

        {/* ── 오른쪽: 작업 현황 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* 카운터 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { label: "수집됨", val: targets.length, color: "var(--info)" },
              { label: "신청 완료", val: doneCnt, color: "var(--success)" },
              { label: "신청 불가", val: failCnt, color: "var(--danger)" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ padding: "14px 16px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 900, color, fontFamily: "'Space Grotesk',sans-serif", lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontWeight: 600 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* 결과 테이블 */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="card-title" style={{ margin: 0 }}>📋 작업 현황 {results.length > 0 && <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text3)" }}>({results.length}개)</span>}</div>
              {results.length > 0 && (
                <button onClick={handleSaveHistory} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text2)", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}>
                  💾 작업 내역 저장
                </button>
              )}
            </div>
            {results.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                추출 시작 후 결과가 여기에 표시됩니다
              </div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--bg2)", position: "sticky", top: 0 }}>
                      {["키워드", "블로그ID", "작업 여부"].map((h) => (
                        <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "var(--text3)", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "9px 12px", color: "var(--accent-text)", fontWeight: 700, whiteSpace: "nowrap" }}>{r.keyword}</td>
                        <td style={{ padding: "9px 12px", color: "var(--text)" }}>
                          <a href={`https://blog.naver.com/${r.blogId}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none" }}>{r.blogId}</a>
                        </td>
                        <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 99, background: `${statusColor(r.status)}18`, color: statusColor(r.status), border: `1px solid ${statusColor(r.status)}40`, fontWeight: 700 }}>
                            {statusLabel(r.status)}
                          </span>
                          {r.message && r.status === "fail" && (
                            <span style={{ fontSize: 10, color: "var(--text3)", marginLeft: 6 }}>{r.message}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 작업 로그 */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="card-title" style={{ margin: 0 }}>📟 작업 로그</div>
              <button onClick={() => setLogs([])} style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text3)", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>지우기</button>
            </div>
            <div ref={logRef} style={{ height: 220, overflowY: "auto", padding: "10px 14px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.7, background: "#050a0f" }}>
              {logs.length === 0 ? (
                <span style={{ color: "#3a5a7a" }}>대기 중...</span>
              ) : (
                logs.map((l, i) => (
                  <div key={i} style={{ color: l.includes("✅") || l.includes("🎉") ? "#00d68f" : l.includes("❌") || l.includes("🚫") ? "#ff5363" : l.includes("⏭️") ? "#7a9ab5" : "#00c8ff" }}>
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
