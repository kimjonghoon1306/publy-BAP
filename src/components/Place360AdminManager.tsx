import { useEffect, useState } from "react";
import { deleteAdminPlace360Snapshot, getAdminPlace360Snapshots, Place360Snapshot } from "../lib/supabase";

type Props = { showToast?: (message: string, type?: any) => void };

export default function Place360AdminManager({ showToast }: Props) {
  const [rows, setRows] = useState<Place360Snapshot[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (query = search) => {
    setLoading(true);
    try { setRows(await getAdminPlace360Snapshots(query.trim())); }
    catch (error: any) { showToast?.(error?.message || "플레이스 360 기록을 불러오지 못했어요", "error"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(""); }, []); // 관리자 화면 진입 시 한 번만 최신 기록 조회

  const remove = async (row: Place360Snapshot) => {
    if (!window.confirm(`${row.store_name}의 ${row.measured_on} 측정 기록을 삭제할까요?`)) return;
    try { await deleteAdminPlace360Snapshot(row.id); setRows(list => list.filter(item => item.id !== row.id)); showToast?.("측정 기록을 삭제했어요", "success"); }
    catch (error: any) { showToast?.(error?.message || "삭제하지 못했어요", "error"); }
  };

  return <section style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
    <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}><b style={{ fontSize: 16 }}>🏪 회원 매장 진단 기록 관리</b><span style={{ padding: "4px 9px", borderRadius: 99, background: "rgba(240,65,122,.1)", color: "var(--accent-text)", fontSize: 10.5, fontWeight: 900 }}>관리자 전용</span></div>
    <p style={{ margin: "6px 0 12px", color: "var(--text2)", fontSize: 12, lineHeight: 1.65 }}>회원이 측정한 매장·날짜·리뷰 비교 기록을 확인해요. 개인정보 보호를 위해 진단 수치만 관리하며 네이버 비밀번호는 저장하지 않아요.</p>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}><input className="inp" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void load(); }} placeholder="회원 이름·이메일·매장 이름 검색"/><button className="btn btn-primary" onClick={() => void load()} disabled={loading}>{loading ? "불러오는 중…" : "기록 검색"}</button></div>
    <div style={{ marginTop: 12, overflowX: "auto", WebkitOverflowScrolling: "touch" }}><div style={{ minWidth: 720, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr .8fr .8fr 1.2fr 70px", padding: "9px 11px", background: "var(--bg)", color: "var(--text3)", fontSize: 10.5, fontWeight: 900 }}><span>매장</span><span>방문자 리뷰</span><span>블로그 리뷰</span><span>측정일·주변 업체</span><span>관리</span></div>
      {rows.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>{loading ? "기록을 불러오고 있어요…" : "저장된 진단 기록이 없습니다."}</div> : rows.map(row => <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.5fr .8fr .8fr 1.2fr 70px", alignItems: "center", padding: "10px 11px", borderTop: "1px solid var(--border)", fontSize: 12 }}><span><b style={{ display: "block" }}>{row.store_name}</b><small style={{ color: "var(--text3)" }}>{[row.region, row.category].filter(Boolean).join(" · ") || "정보 없음"}</small></span><span>{row.visitor_reviews.toLocaleString()}개<br/><small style={{ color: "var(--text3)" }}>주변 {row.competitor_avg_visitor.toLocaleString()}</small></span><span>{row.blog_reviews.toLocaleString()}개<br/><small style={{ color: "var(--text3)" }}>주변 {row.competitor_avg_blog.toLocaleString()}</small></span><span>{row.measured_on}<br/><small style={{ color: "var(--text3)" }}>{row.competitor_count}곳 비교</small></span><button type="button" onClick={() => void remove(row)} style={{ minHeight: 38, border: "1px solid rgba(207,34,46,.3)", borderRadius: 9, background: "rgba(207,34,46,.08)", color: "var(--danger)", fontFamily: "inherit", fontWeight: 800, cursor: "pointer" }}>삭제</button></div>)}
    </div></div>
  </section>;
}
