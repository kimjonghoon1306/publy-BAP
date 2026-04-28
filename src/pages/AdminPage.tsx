/**
 * BlogAuto Pro - Super Admin Page v6.0
 * ✅ 설정과 동일한 모든 키 항목 (티스토리/쿠팡/데이터랩/Webhook 포함)
 * ✅ 관리자 키 → 유저가 지워도 자동 폴백 적용
 * ✅ 비밀번호 서버 저장 (배포해도 유지)
 * ✅ 회원 목록 / 등급 변경 / 삭제
 * ✅ 모바일 최적화 + 색상 다양하게
 */

import { useState, useRef, useEffect } from "react";
import Layout from "@/components/Layout";
import { toast } from "sonner";
import {
  Shield, Key, Eye, EyeOff, Copy, Lock, Zap, Bell,
  CheckCircle2, Image, Upload, X, Globe, Link,
  Trash2, ExternalLink, Home, Save,
  Users, Crown, UserX, RefreshCw, ChevronDown,
  Activity, Cpu, Database, HardDrive, Wifi,
  Send, ShoppingCart, FileText, Search, BarChart3, Bot, Plus, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { userGet, userSet, saveSettingsToServer, SETTINGS_KEYS } from "@/lib/user-storage";
import { CONTENT_AI_OPTIONS, IMAGE_AI_OPTIONS, type ContentAIProvider, type ImageAIProvider } from "@/lib/ai-config";

const SESSION_KEY = "bap_admin_auth";
const OG_KEY = "blogauto_og_settings";

// ── API 헬퍼 ─────────────────────────────────────────
async function adminApi(action: string, extra: Record<string, any> = {}) {
  const token = localStorage.getItem("ba_token") || "";
  try {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...extra }),
    });
    return await r.json();
  } catch { return { ok: false, error: "네트워크 오류" }; }
}

// ── 파일 → base64 ──────────────────────────────────
function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
}

// ── OG 타입 ─────────────────────────────────────────
interface OGSettings {
  siteTitle: string; siteDesc: string; siteImage: string;
  siteName: string; twitterCard: string;
  postImages: { id: string; title: string; image: string; url: string }[];
}
function loadOG(): OGSettings {
  try { const r = localStorage.getItem(OG_KEY); if (r) return JSON.parse(r); } catch {}
  return { siteTitle: "BlogAuto Pro - AI 블로그 자동화", siteDesc: "AI로 블로그 글을 자동 생성하고 수익을 극대화하세요", siteImage: "", siteName: "BlogAuto Pro", twitterCard: "summary_large_image", postImages: [] };
}
function saveOG(d: OGSettings) { try { localStorage.setItem(OG_KEY, JSON.stringify(d)); } catch {} }

// ✅ OG 설정 KV 서버에 저장
async function saveOGToServer(og: OGSettings) {
  saveOG(og); // localStorage에도 저장
  const token = localStorage.getItem("ba_token") || "";
  try {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "saveSettings", settings: { blogauto_og_settings: JSON.stringify(og) } }),
    });
  } catch {}
}

// ✅ OG 설정 KV 서버에서 불러오기
async function loadOGFromServer(): Promise<OGSettings | null> {
  const token = localStorage.getItem("ba_token") || "";
  try {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "loadSettings" }),
    });
    const d = await r.json();
    if (d.ok && d.settings?.blogauto_og_settings) {
      const og = JSON.parse(d.settings.blogauto_og_settings);
      saveOG(og); // 로컬에도 캐시
      return og;
    }
  } catch {}
  return null;
}

// ✅ imgbb에 이미지 업로드 → 영구 URL 반환
async function uploadImageToImgbb(file: File): Promise<string> {
  const imgbbKey = userGet("imgbb_api_key");
  if (!imgbbKey) throw new Error("imgbb API 키가 없습니다. 이미지 생성 AI 섹션에서 설정해주세요.");
  const b64 = await toBase64(file);
  const base64Data = b64.split(",")[1];
  const form = new URLSearchParams();
  form.append("key", imgbbKey);
  form.append("image", base64Data);
  const resp = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
  const data = await resp.json();
  if (data.success && data.data?.url) return data.data.url;
  throw new Error("imgbb 업로드 실패");
}

// ── 전체 API 키 섹션 정의 (설정 페이지와 완전 동일) ──
const ICON_MAP: Record<string, any> = { Bot, Image, Search, BarChart3, FileText, Send, ShoppingCart, Globe, Link };

const API_SECTIONS = [
  {
    group: "ai", title: "글 생성 AI", icon: "Bot", color: "#10b981", grad: "linear-gradient(135deg,#10b981,#059669)",
    desc: "Gemini·Groq 무료, Claude·GPT 유료",
    fields: [
      { label: "Gemini API Key", key: "gemini_api_key", placeholder: "AIza...", link: "https://aistudio.google.com/app/apikey", badge: "무료", badgeColor: "#10b981" },
      { label: "Groq API Key (Llama 3)", key: "groq_api_key", placeholder: "gsk_...", link: "https://console.groq.com/keys", badge: "무료", badgeColor: "#10b981" },
      { label: "Claude API Key", key: "claude_api_key", placeholder: "sk-ant-...", link: "https://console.anthropic.com/", badge: "유료", badgeColor: "#f59e0b" },
      { label: "OpenAI API Key (GPT-4o)", key: "openai_api_key", placeholder: "sk-...", link: "https://platform.openai.com/api-keys", badge: "유료", badgeColor: "#f59e0b" },
    ],
  },
  {
    group: "ai", title: "이미지 생성 AI", icon: "Image", color: "#a78bfa", grad: "linear-gradient(135deg,#a78bfa,#7c3aed)",
    desc: "OpenAI · Replicate · imgbb",
    fields: [
      { label: "Gemini API Key (글쓰기 공용)", key: "gemini_api_key", placeholder: "AIza...", link: "https://aistudio.google.com/app/apikey", badge: "글쓰기용", badgeColor: "#4285F4" },
      { label: "OpenAI API Key (DALL-E 3)", key: "openai_api_key", placeholder: "sk-...", link: "https://platform.openai.com/api-keys", badge: "유료", badgeColor: "#f59e0b" },
      { label: "Replicate API Token (Flux)", key: "replicate_api_token", placeholder: "r8_...", link: "https://replicate.com/account/api-tokens", badge: "유료", badgeColor: "#f59e0b" },
      { label: "imgbb API Key (이미지 영구 저장)", key: "imgbb_api_key", placeholder: "imgbb API 키...", link: "https://api.imgbb.com", badge: "무료", badgeColor: "#10b981" },
    ],
  },
  {
    group: "keyword", title: "네이버 검색광고 API", icon: "Search", color: "#03C75A", grad: "linear-gradient(135deg,#03C75A,#02a44a)",
    desc: "키워드 수집 · 검색량 조회",
    fields: [
      { label: "API License", key: "naver_access_license", placeholder: "License Key", link: "https://searchad.naver.com", badge: "", badgeColor: "" },
      { label: "Secret Key", key: "naver_secret_key", placeholder: "Secret Key", link: "", badge: "", badgeColor: "" },
      { label: "Customer ID", key: "naver_customer_id", placeholder: "Customer ID", link: "", badge: "", badgeColor: "" },
    ],
  },
  {
    group: "keyword", title: "네이버 데이터랩", icon: "BarChart3", color: "#06b6d4", grad: "linear-gradient(135deg,#06b6d4,#0284c7)",
    desc: "트렌드 · 검색 인사이트",
    fields: [
      { label: "Client ID", key: "naver_datalab_client_id", placeholder: "Client ID", link: "https://developers.naver.com/apps", badge: "", badgeColor: "" },
      { label: "Client Secret", key: "naver_datalab_client_secret", placeholder: "Client Secret", link: "", badge: "", badgeColor: "" },
    ],
  },

  {
    group: "platform", title: "블로거 (Blogger)", icon: "FileText", color: "#FF5722", grad: "linear-gradient(135deg,#FF5722,#E64A19)",
    desc: "구글 블로거 자동 발행 · 애드센스 최적화",
    fields: [
      { label: "Blog ID", key: "blogger_blog_id", placeholder: "블로그 ID (숫자)", link: "https://www.blogger.com", badge: "자동발행", badgeColor: "#10b981" },
      { label: "Google API Key", key: "blogger_api_key", placeholder: "AIza...", link: "https://console.cloud.google.com/apis/credentials", badge: "발급", badgeColor: "#4285F4" },
      { label: "OAuth Client ID", key: "blogger_client_id", placeholder: "Client ID", link: "https://console.cloud.google.com/apis/credentials", badge: "", badgeColor: "" },
      { label: "OAuth Client Secret", key: "blogger_client_secret", placeholder: "Client Secret", link: "", badge: "", badgeColor: "" },
    ],
  },
  {
    group: "platform", title: "미디엄 (Medium)", icon: "Send", color: "#000000", grad: "linear-gradient(135deg,#333333,#000000)",
    desc: "미디엄 자동 발행 · 영문 콘텐츠 최적화",
    fields: [
      { label: "Integration Token", key: "medium_token", placeholder: "Integration Token", link: "https://medium.com/me/settings/security", badge: "자동발행", badgeColor: "#10b981" },
      { label: "Author ID (선택)", key: "medium_author_id", placeholder: "Author ID", link: "https://api.medium.com/v1/me", badge: "", badgeColor: "" },
    ],
  },
  {
    group: "keyword", title: "쿠팡파트너스", icon: "ShoppingCart", color: "#C00F0C", grad: "linear-gradient(135deg,#C00F0C,#9a0b09)",
    desc: "상품 링크 자동 삽입 → 수익",
    fields: [
      { label: "Access Key", key: "coupang_access_key", placeholder: "Access Key", link: "https://partners.coupang.com", badge: "", badgeColor: "" },
      { label: "Secret Key", key: "coupang_secret_key", placeholder: "Secret Key", link: "", badge: "", badgeColor: "" },
      { label: "Sub ID (선택)", key: "coupang_sub_id", placeholder: "Sub ID", link: "", badge: "", badgeColor: "" },
    ],
  },
  {
    group: "platform", title: "워드프레스", icon: "Globe", color: "#21759B", grad: "linear-gradient(135deg,#21759B,#1a5d7a)",
    desc: "자체 도메인 자동 발행",
    fields: [
      { label: "사이트 URL", key: "wp_url", placeholder: "https://myblog.com", link: "", badge: "", badgeColor: "" },
      { label: "사용자명", key: "wp_username", placeholder: "admin", link: "", badge: "", badgeColor: "" },
      { label: "앱 비밀번호", key: "wp_app_password", placeholder: "xxxx xxxx xxxx xxxx", link: "https://wordpress.com/support/application-passwords/", badge: "", badgeColor: "" },
    ],
  },
  // Webhook (커스텀) 섹션은 AdminCustomWebhookSection 컴포넌트로 별도 처리
];

// ─────────────────────────────────────────────────────
// 수익 플랫폼 선택 섹션
// ─────────────────────────────────────────────────────
function AdminAdPlatformSection() {
  const [adPlatform, setAdPlatform] = useState(() => userGet("selected_ad_platform") || "both");

  const platforms = [
    { id: "adsense", label: "Google AdSense", desc: "CPC 최적화 · 클릭 유도형 글", color: "#4285F4", logo: "G", tip: "정보성 키워드 밀도 높게, 광고 친화적 단락" },
    { id: "adpost",  label: "Naver AdPost",   desc: "CPM 최적화 · 체류시간 늘리기", color: "#03C75A", logo: "N", tip: "감성적 스토리, 이미지 풍부하게, 공감 유도" },
    { id: "both",    label: "둘 다",           desc: "통합 최적화",                 color: "#a855f7", logo: "★", tip: "균형잡힌 구성으로 양쪽 모두 최적화" },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "rgba(245,166,35,0.04)" }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}>
          <span className="text-white font-black text-sm">$</span>
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm text-foreground">수익 플랫폼 최적화</div>
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>선택한 플랫폼에 맞게 글 스타일 자동 최적화</div>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full font-bold"
          style={{ background: "rgba(245,166,35,0.12)", color: "#f59e0b" }}>
          현재: {platforms.find(p => p.id === adPlatform)?.label}
        </span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-3 gap-2">
          {platforms.map(p => {
            const selected = adPlatform === p.id;
            return (
              <button key={p.id}
                className="rounded-xl p-3 text-left"
                style={{
                  background: selected ? `${p.color}18` : "var(--background)",
                  border: `2px solid ${selected ? p.color : "var(--border)"}`,
                  boxShadow: selected ? `0 0 0 3px ${p.color}20, 0 4px 16px ${p.color}20` : "none",
                  transform: selected ? "scale(1.02)" : "scale(1)",
                  transition: "all 0.22s cubic-bezier(0.34,1.56,0.64,1)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onClick={() => {
                  setAdPlatform(p.id);
                  userSet("selected_ad_platform", p.id);
                  saveSettingsToServer({ selected_ad_platform: p.id });
                  toast.success(`${p.label} 최적화 모드로 설정됐어요!`);
                }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white"
                    style={{ background: p.color, boxShadow: selected ? `0 4px 10px ${p.color}50` : "none" }}>{p.logo}</div>
                  {selected
                    ? <div style={{fontSize:"0.65rem",fontWeight:800,color:p.color,background:`${p.color}15`,padding:"2px 6px",borderRadius:100,display:"flex",alignItems:"center",gap:3}}>
                        <CheckCircle2 className="w-2.5 h-2.5" />선택
                      </div>
                    : <div style={{width:16,height:16,borderRadius:"50%",border:"2px solid var(--border)"}}/>
                  }
                </div>
                <div className="text-xs font-bold text-foreground">{p.label}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)", fontSize:"0.68rem" }}>{p.desc}</div>
                <div className="text-xs mt-1.5 px-1.5 py-1 rounded-lg" style={{ background: `${p.color}10`, color: p.color, fontSize:"0.65rem", lineHeight:1.4 }}>
                  {p.tip}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 구글 서치콘솔 JSON 파일 업로드 섹션
// ─────────────────────────────────────────────────────
function AdminGSCSection() {
  const [siteUrl, setSiteUrl] = useState(() => userGet("gsc_site_url") || "");
  const [clientEmail, setClientEmail] = useState(() => userGet("gsc_client_email") || "");
  const [privateKey, setPrivateKey] = useState(() => userGet("gsc_private_key") || "");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [guideTab, setGuideTab] = useState<"domain"|"key">("domain");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        if (json.client_email) setClientEmail(json.client_email);
        if (json.private_key) setPrivateKey(json.private_key);
        toast.success("✅ JSON 파일 파싱 완료! 저장 버튼을 눌러주세요.");
      } catch {
        toast.error("JSON 파일 형식이 올바르지 않아요");
      }
    };
    reader.readAsText(file);
  };

  const handleSave = () => {
    if (!siteUrl || !clientEmail || !privateKey) {
      toast.error("사이트 URL과 JSON 파일을 모두 입력해주세요"); return;
    }
    userSet("gsc_site_url", siteUrl);
    userSet("gsc_client_email", clientEmail);
    userSet("gsc_private_key", privateKey);
    saveSettingsToServer({ gsc_site_url: siteUrl, gsc_client_email: clientEmail, gsc_private_key: privateKey });
    setSaved(true);
    toast.success("✅ 구글 서치콘솔 설정 저장됨!");
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTest = async () => {
    if (!clientEmail || !privateKey || !siteUrl) { toast.error("먼저 저장해주세요"); return; }
    setTesting(true); setTestResult("");
    try {
      const resp = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "gscGetKeywords", clientEmail, privateKey, siteUrl, rowLimit: 1 }),
      });
      const data = await resp.json();
      if (data.ok) {
        setTestResult(`✅ 연결 성공! ${data.keywords?.length > 0 ? `"${data.keywords[0].keyword}" 키워드 확인` : "데이터 없음"}`);
      } else {
        setTestResult("❌ " + (data.error || "연결 실패"));
      }
    } catch (e: any) {
      setTestResult("❌ " + e.message);
    } finally { setTesting(false); }
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "rgba(66,133,244,0.05)" }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#4285F4,#34A853)" }}>
          <Search className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm text-foreground">구글 서치콘솔</div>
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>JSON 파일 업로드로 간편 연동</div>
        </div>
        <button onClick={() => { const el = document.getElementById("adminGscGuidePopup"); if(el) el.style.display = el.style.display==="none"?"flex":"none"; }}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold"
          style={{ background: "rgba(66,133,244,0.1)", color: "#4285F4", border: "1px solid rgba(66,133,244,0.2)" }}>
          📖 발급 가이드
        </button>
        {saved && <span className="text-xs font-bold" style={{ color: "#34A853" }}>✅ 저장됨</span>}
      </div>

      {/* 가이드 팝업 - 탭 방식 */}
      <div id="adminGscGuidePopup" style={{display:"none",position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(10px)",alignItems:"center",justifyContent:"center",padding:"16px"}}>
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:"24px",width:"100%",maxWidth:"560px",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.7)"}}>
          {/* 팝업 헤더 */}
          <div style={{padding:"24px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontWeight:900,fontSize:"1.05rem",letterSpacing:"-0.03em"}}>📖 구글 서치콘솔 설정 가이드</div>
            <button onClick={() => { const el = document.getElementById("adminGscGuidePopup"); if(el) el.style.display="none"; }}
              style={{width:32,height:32,borderRadius:9,background:"var(--card2)",border:"none",cursor:"pointer",color:"var(--muted-foreground)",fontSize:"1rem",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
          </div>
          <p style={{padding:"8px 24px 0",fontSize:"0.8rem",color:"var(--muted-foreground)"}}>처음부터 차근차근 따라하시면 누구나 설정할 수 있어요 😊</p>

          {/* 탭 */}
          <div style={{display:"flex",gap:8,padding:"16px 24px 0"}}>
            {([["domain","🌐 1단계: 도메인 등록"],["key","🔑 2단계: 키 발급"]] as ["domain"|"key", string][]).map(([tab, label]) => (
              <button key={tab} onClick={() => setGuideTab(tab)}
                style={{flex:1,padding:"10px 8px",borderRadius:12,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.82rem",fontFamily:"inherit",
                  background: guideTab===tab ? "linear-gradient(135deg,#4285F4,#34A853)" : "var(--card2)",
                  color: guideTab===tab ? "white" : "var(--muted-foreground)",
                  boxShadow: guideTab===tab ? "0 4px 14px rgba(66,133,244,0.3)" : "none",
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* 탭 내용 */}
          <div style={{padding:"20px 24px 24px"}}>

            {/* 도메인 등록 탭 */}
            {guideTab === "domain" && (
              <div style={{display:"flex",flexDirection:"column",gap:14,fontSize:"0.84rem"}}>
                <div style={{background:"rgba(66,133,244,0.06)",border:"1px solid rgba(66,133,244,0.15)",borderRadius:14,padding:16}}>
                  <div style={{fontWeight:800,color:"#4285F4",marginBottom:6}}>이게 뭔가요?</div>
                  <div style={{color:"var(--muted-foreground)",lineHeight:1.75}}>구글 서치콘솔은 내 블로그가 구글 검색에 어떻게 노출되는지 보여주는 구글 공식 무료 서비스예요. 여기에 내 블로그를 등록해야 유입 키워드를 확인할 수 있어요.</div>
                </div>
                {([
                  {num:"1",color:"#4285F4",bg:"rgba(66,133,244,0.06)",border:"rgba(66,133,244,0.15)",
                   title:"구글 서치콘솔 접속",
                   steps:["아래 버튼을 클릭해서 구글 서치콘솔에 접속하세요","구글 계정으로 로그인하세요 (블로그 계정과 같은 계정 권장)"],
                   link:{href:"https://search.google.com/search-console",text:"🔗 구글 서치콘솔 바로가기"},tip:""},
                  {num:"2",color:"#34A853",bg:"rgba(52,168,83,0.06)",border:"rgba(52,168,83,0.15)",
                   title:"속성 추가 (블로그 등록)",
                   steps:["왼쪽 상단의 속성 검색 박스 옆 ▼ 클릭","속성 추가 클릭","도메인 방식 선택 (왼쪽) → 블로그 주소 입력 예) myblog.com","계속 버튼 클릭"],
                   link:null,tip:""},
                  {num:"3",color:"#ea4335",bg:"rgba(234,67,53,0.06)",border:"rgba(234,67,53,0.15)",
                   title:"소유권 인증",
                   steps:["DNS 레코드 방식이 나오면 → DNS 관리 페이지에서 TXT 레코드 추가","또는 HTML 파일 방식 선택 → 파일을 블로그 루트에 업로드","인증 버튼 클릭 → 소유권 확인됨 메시지 확인"],
                   link:null,tip:"💡 티스토리/네이버 블로그는 HTML 태그 방식이 더 쉬워요"},
                  {num:"4",color:"#f59e0b",bg:"rgba(251,188,5,0.06)",border:"rgba(251,188,5,0.2)",
                   title:"사이트 URL 확인",
                   steps:["등록 완료 후 상단에 표시되는 URL을 메모해두세요","도메인 방식이면 sc-domain:myblog.com 형태","URL 방식이면 https://myblog.com 형태"],
                   link:null,tip:"💡 이 URL을 아래 설정에 입력해야 해요"},
                ] as any[]).map((step: any) => (
                  <div key={step.num} style={{background:step.bg,border:`1px solid ${step.border}`,borderRadius:14,padding:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                      <div style={{width:28,height:28,borderRadius:8,background:step.color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:"0.85rem",color:"white",flexShrink:0}}>{step.num}</div>
                      <div style={{fontWeight:800,color:"var(--foreground)"}}>{step.title}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {step.steps.map((s: string,i: number) => (
                        <div key={i} style={{display:"flex",gap:8,color:"var(--muted-foreground)",lineHeight:1.6}}>
                          <span style={{color:step.color,fontWeight:700,flexShrink:0}}>▸</span><span>{s}</span>
                        </div>
                      ))}
                      {step.tip && <div style={{marginTop:6,fontSize:"0.78rem",padding:"6px 10px",borderRadius:8,background:`${step.color}15`,color:step.color,fontWeight:600}}>{step.tip}</div>}
                      {step.link && <a href={step.link.href} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,padding:"8px 14px",borderRadius:10,background:step.color,color:"white",fontWeight:700,fontSize:"0.8rem",textDecoration:"none"}}>{step.link.text}</a>}
                    </div>
                  </div>
                ))}
                <div style={{background:"rgba(52,168,83,0.08)",border:"1.5px solid rgba(52,168,83,0.3)",borderRadius:14,padding:14,textAlign:"center"}}>
                  <div style={{fontWeight:800,color:"#34A853",marginBottom:4}}>✅ 도메인 등록 완료!</div>
                  <div style={{fontSize:"0.8rem",color:"var(--muted-foreground)"}}>이제 2단계 탭을 눌러서 키 발급을 진행하세요 →</div>
                  <button onClick={() => setGuideTab("key")}
                    style={{marginTop:10,padding:"8px 20px",borderRadius:10,background:"linear-gradient(135deg,#4285F4,#34A853)",color:"white",fontWeight:700,fontSize:"0.82rem",border:"none",cursor:"pointer"}}>
                    🔑 2단계: 키 발급하기 →
                  </button>
                </div>
              </div>
            )}

            {/* 키 발급 탭 */}
            {guideTab === "key" && (
              <div style={{display:"flex",flexDirection:"column",gap:14,fontSize:"0.84rem"}}>
                {([
                  {num:"1",color:"#4285F4",bg:"rgba(66,133,244,0.06)",border:"rgba(66,133,244,0.15)",
                   title:"Google Cloud Console 접속",
                   steps:["아래 버튼을 클릭해서 구글 클라우드 콘솔에 접속","구글 계정으로 로그인"],
                   link:{href:"https://console.cloud.google.com",text:"🔗 구글 클라우드 콘솔 바로가기"},tip:""},
                  {num:"2",color:"#34A853",bg:"rgba(52,168,83,0.06)",border:"rgba(52,168,83,0.15)",
                   title:"Search Console API 켜기",
                   steps:["왼쪽 메뉴 → API 및 서비스 → 라이브러리 클릭","검색창에 Search Console API 입력 후 엔터","검색 결과에서 Google Search Console API 클릭","파란색 사용 버튼 클릭"],
                   link:null,tip:"💡 이미 사용 설정됨이면 넘어가도 돼요"},
                  {num:"3",color:"#ea4335",bg:"rgba(234,67,53,0.06)",border:"rgba(234,67,53,0.15)",
                   title:"서비스 계정 만들기",
                   steps:["왼쪽 메뉴 → API 및 서비스 → 사용자 인증 정보 클릭","상단 + 사용자 인증 정보 만들기 → 서비스 계정 클릭","서비스 계정 이름 입력 (예: blogauto-gsc) → 만들고 계속하기","권한 설정 건너뛰고 → 완료 클릭"],
                   link:null,tip:""},
                  {num:"4",color:"#f59e0b",bg:"rgba(251,188,5,0.06)",border:"rgba(251,188,5,0.2)",
                   title:"JSON 키 파일 다운로드",
                   steps:["방금 만든 서비스 계정 이메일 클릭","상단 탭에서 키 클릭","키 추가 → 새 키 만들기 클릭","JSON 선택 (기본값) → 만들기 클릭","JSON 파일이 자동으로 다운로드돼요"],
                   link:null,tip:"⚠️ 이 파일은 절대 다른 사람에게 공유하지 마세요!"},
                  {num:"5",color:"#9c27b0",bg:"rgba(156,39,176,0.06)",border:"rgba(156,39,176,0.15)",
                   title:"서치콘솔에 권한 추가",
                   steps:["구글 서치콘솔로 돌아가기","왼쪽 하단 설정 → 사용자 및 권한 클릭","+ 사용자 추가 클릭","다운받은 JSON 파일을 메모장으로 열어서 client_email 값 복사 후 붙여넣기","권한: 전체 선택 → 추가 클릭"],
                   link:null,tip:"💡 client_email은 xxx@xxx.iam.gserviceaccount.com 형태예요"},
                  {num:"6",color:"#34A853",bg:"rgba(52,168,83,0.08)",border:"rgba(52,168,83,0.25)",
                   title:"BlogAuto Pro 관리자 페이지에 업로드",
                   steps:["이 팝업을 닫고 사이트 URL 입력 (sc-domain:blogautopro.com)","JSON 파일 업로드 버튼 클릭 → 다운받은 파일 선택","저장 버튼 클릭 → 연결 테스트로 확인","완료!"],
                   link:null,tip:""},
                ] as any[]).map((step: any) => (
                  <div key={step.num} style={{background:step.bg,border:`1px solid ${step.border}`,borderRadius:14,padding:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                      <div style={{width:28,height:28,borderRadius:8,background:step.color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:"0.85rem",color:"white",flexShrink:0}}>{step.num}</div>
                      <div style={{fontWeight:800,color:"var(--foreground)"}}>{step.title}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      {step.steps.map((s: string,i: number) => (
                        <div key={i} style={{display:"flex",gap:8,color:"var(--muted-foreground)",lineHeight:1.6}}>
                          <span style={{color:step.color,fontWeight:700,flexShrink:0}}>▸</span><span>{s}</span>
                        </div>
                      ))}
                      {step.tip && <div style={{marginTop:6,fontSize:"0.78rem",padding:"6px 10px",borderRadius:8,background:`${step.color}15`,color:step.color,fontWeight:600}}>{step.tip}</div>}
                      {step.link && <a href={step.link.href} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,padding:"8px 14px",borderRadius:10,background:step.color,color:"white",fontWeight:700,fontSize:"0.8rem",textDecoration:"none"}}>{step.link.text}</a>}
                    </div>
                  </div>
                ))}
                <div style={{background:"rgba(52,168,83,0.08)",border:"1.5px solid rgba(52,168,83,0.3)",borderRadius:14,padding:14,textAlign:"center"}}>
                  <div style={{fontWeight:800,color:"#34A853",fontSize:"1rem",marginBottom:4}}>🎉 모든 설정 완료!</div>
                  <div style={{fontSize:"0.8rem",color:"var(--muted-foreground)"}}>팝업을 닫고 JSON 파일 업로드 후 저장하면 끝이에요!</div>
                  <button onClick={() => { const el = document.getElementById("adminGscGuidePopup"); if(el) el.style.display="none"; }}
                    style={{marginTop:10,padding:"8px 24px",borderRadius:10,background:"linear-gradient(135deg,#34A853,#1a8a3a)",color:"white",fontWeight:700,fontSize:"0.82rem",border:"none",cursor:"pointer"}}>
                    ✅ 설정하러 가기
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* 사이트 URL */}
        <div>
          <label className="text-xs font-bold block mb-1" style={{ color: "var(--muted-foreground)" }}>사이트 URL</label>
          <Input value={siteUrl} onChange={e => setSiteUrl(e.target.value)}
            placeholder="sc-domain:blogautopro.com" className="text-sm font-mono" />
        </div>
        {/* JSON 파일 업로드 */}
        <div>
          <label className="text-xs font-bold block mb-1" style={{ color: "var(--muted-foreground)" }}>서비스 계정 JSON 파일</label>
          <input ref={fileRef} type="file" accept=".json" onChange={handleFileUpload} style={{ display: "none" }} />
          <button onClick={() => fileRef.current?.click()}
            className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all"
            style={{ background: "linear-gradient(135deg,#4285F4,#34A853)", color: "white", boxShadow: "0 4px 14px rgba(66,133,244,0.3)" }}>
            <Upload className="w-4 h-4" />
            JSON 파일 업로드
          </button>
          {clientEmail && (
            <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: "#34A853" }}>
              <CheckCircle2 className="w-3 h-3" /> {clientEmail}
            </p>
          )}
        </div>
        {testResult && (
          <p className="text-xs px-3 py-2 rounded-lg" style={{
            background: testResult.startsWith("✅") ? "rgba(52,168,83,0.1)" : "rgba(239,68,68,0.1)",
            color: testResult.startsWith("✅") ? "#34A853" : "#ef4444",
          }}>{testResult}</p>
        )}
        <div className="flex gap-2">
          <button onClick={handleSave}
            className="flex-1 h-10 rounded-xl font-semibold text-sm text-white"
            style={{ background: "linear-gradient(135deg,#34A853,#1a8a3a)" }}>
            💾 저장
          </button>
          <button onClick={handleTest} disabled={testing}
            className="flex-1 h-10 rounded-xl font-semibold text-sm"
            style={{ background: "var(--card2)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}>
            {testing ? "테스트 중..." : "🔗 연결 테스트"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 커스텀 웹사이트 Webhook 섹션 (어드민용)
// ─────────────────────────────────────────────────────
const AUTH_HEADER_OPTIONS = [
  { value: "Authorization", label: "Authorization", example: "Bearer {키} 또는 {키}" },
  { value: "X-API-Key", label: "X-API-Key", example: "API 키 직접 입력" },
  { value: "X-Auth-Token", label: "X-Auth-Token", example: "토큰 직접 입력" },
  { value: "X-Custom-Auth", label: "X-Custom-Auth", example: "커스텀 인증" },
  { value: "none", label: "인증 없음", example: "공개 API" },
];

function AdminCustomWebhookSection() {
  const [accounts, setAccounts] = useState<Record<string, string>[]>(() => {
    try { return JSON.parse(localStorage.getItem("admin_custom_list") || "[]"); } catch { return []; }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [authKey, setAuthKey] = useState("");

  const handleSave = () => {
    if (!url.trim()) { toast.error("Webhook URL을 입력해주세요"); return; }
    const normalizedDomain = (customDomain.trim() || url.replace(/^https?:\/\//, "").split("/")[0]).trim();
    const entry: Record<string, string> = {
      _name: normalizedDomain || url.replace("https://", "").split("/")[0],
      _type: "custom",
      custom_domain: normalizedDomain,
      webhook_url: url.trim(),
      webhook_auth_header: authHeader,
      webhook_auth_key: authKey.trim(),
    };
    const updated = [...accounts, entry];
    setAccounts(updated);
    localStorage.setItem("admin_custom_list", JSON.stringify(updated));
    userSet(SETTINGS_KEYS.WEBHOOK_URL, url.trim());
    userSet(SETTINGS_KEYS.WEBHOOK_KEY, authKey.trim());
    userSet("webhook_auth_header", authHeader);
    userSet("custom_domain", normalizedDomain);
    localStorage.setItem("custom_domain", normalizedDomain);
    localStorage.setItem("admin_custom_domain", normalizedDomain);
    localStorage.setItem("blogauto_custom_domain", normalizedDomain);
    const platforms = JSON.parse(localStorage.getItem("blogauto_deploy_platforms") || "[]");
    platforms.push({ id: Math.random().toString(36).slice(2), type: "custom", name: entry._name });
    localStorage.setItem("blogauto_deploy_platforms", JSON.stringify(platforms));
    // 슈퍼어드민 전용 글로벌 설정으로 저장
    const adminTk = sessionStorage.getItem("bap_admin_auth") || "";
    if (adminTk) {
      fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminTk}` },
        body: JSON.stringify({ action: "saveAdminGlobalSettings", settings: { admin_custom_list: JSON.stringify(updated) } }),
      }).catch(() => {});
    }
    setShowAdd(false);
    setUrl(""); setAuthKey(""); setAuthHeader("Authorization"); setCustomDomain("");
    toast.success("✅ 웹사이트 등록됐어요!");
  };

  const remove = (idx: number) => {
    const removedName = accounts[idx]?._name;
    const updated = accounts.filter((_: any, i: number) => i !== idx);
    setAccounts(updated);
    localStorage.setItem("admin_custom_list", JSON.stringify(updated));

    // blogauto_deploy_platforms에서도 동기 삭제
    try {
      const deployPlatforms = JSON.parse(localStorage.getItem("blogauto_deploy_platforms") || "[]");
      const updatedDeploy = deployPlatforms.filter((p: any) => p.name !== removedName);
      localStorage.setItem("blogauto_deploy_platforms", JSON.stringify(updatedDeploy));
    } catch {}

    // ✅ 서버에도 삭제 반영 (안 하면 로드 시 복원됨)
    const adminTk = sessionStorage.getItem("bap_admin_auth") || "";
    if (adminTk) {
      fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminTk}` },
        body: JSON.stringify({ action: "saveAdminGlobalSettings", settings: { admin_custom_list: JSON.stringify(updated) } }),
      }).catch(() => {});
    }

    toast.success("삭제됐어요");
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}>
          <Link className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="font-semibold text-sm text-foreground">Webhook (커스텀)</div>
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>커스텀 사이트 자동 발행</div>
        </div>
        <button onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
          style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}>
          <Plus className="w-3.5 h-3.5" /> 추가
        </button>
      </div>

      {/* 등록된 사이트 목록 */}
      {accounts.length > 0 && (
        <div className="px-4 pb-3 space-y-2 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="pt-3 space-y-2">
            {accounts.map((acc: Record<string, string>, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-lg"
                style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#6366f1" }} />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{acc._name}</p>
                    <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>URL: {acc.webhook_url}</p>
                    <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>헤더: {acc.webhook_auth_header || "Authorization"}</p>
                  </div>
                </div>
                <button onClick={() => remove(idx)} className="p-1.5 rounded-lg hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" style={{ color: "#ef4444" }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 추가 폼 */}
      {showAdd && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="pt-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Webhook URL *</label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mysite.com/api/webhook" className="h-11 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Auth Header 방식</label>
              <Select value={authHeader} onValueChange={setAuthHeader}>
                <SelectTrigger className="h-11 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUTH_HEADER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {authHeader !== "none" && (
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">Auth Key</label>
                <Input value={authKey} onChange={e => setAuthKey(e.target.value)} placeholder="Bearer Token 또는 API 키" className="h-11 text-sm" />
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>취소</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// API 키 관리 컴포넌트
// ─────────────────────────────────────────────────────
function ApiKeyManager() {
  // AI 선택 상태
  const [contentAI, setContentAI] = useState<ContentAIProvider>(
    () => (userGet(SETTINGS_KEYS.CONTENT_AI) as ContentAIProvider) || "gemini"
  );
  const [imageAI, setImageAI] = useState<ImageAIProvider>(
    () => (userGet(SETTINGS_KEYS.IMAGE_AI) as ImageAIProvider) || "gemini"
  );

  const handleSelectContentAI = (v: ContentAIProvider) => {
    setContentAI(v);
    userSet(SETTINGS_KEYS.CONTENT_AI, v);
    saveSettingsToServer({ [SETTINGS_KEYS.CONTENT_AI]: v });
    toast.success(`글 생성 AI: ${CONTENT_AI_OPTIONS.find(o => o.value === v)?.label} 선택됨`);
  };
  const handleSelectImageAI = (v: ImageAIProvider) => {
    setImageAI(v);
    userSet(SETTINGS_KEYS.IMAGE_AI, v);
    saveSettingsToServer({ [SETTINGS_KEYS.IMAGE_AI]: v });
    toast.success(`이미지 AI: ${IMAGE_AI_OPTIONS.find(o => o.value === v)?.label} 선택됨`);
  };

  // 모든 키 초기값 로드
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    API_SECTIONS.forEach(s => s.fields.forEach(f => {
      init[f.key] = userGet(f.key);
    }));
    return init;
  });
  const [showMap, setShowMap] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ "글 생성 AI": true });

  const handleSaveAll = async () => {
    setSaving(true);
    const toSave: Record<string, string> = {};

    // AI 선택값도 함께 저장
    userSet(SETTINGS_KEYS.CONTENT_AI, contentAI);
    userSet(SETTINGS_KEYS.IMAGE_AI, imageAI);
    toSave[SETTINGS_KEYS.CONTENT_AI] = contentAI;
    toSave[SETTINGS_KEYS.IMAGE_AI] = imageAI;

    // API 키 저장 (중복 키 처리)
    const seen = new Set<string>();
    API_SECTIONS.forEach(s => s.fields.forEach(f => {
      if (!seen.has(f.key)) {
        seen.add(f.key);
        const v = values[f.key];
        if (v?.trim()) {
          userSet(f.key, v.trim());
          toSave[f.key] = v.trim();
        }
      }
    }));

    await saveSettingsToServer(toSave);
    setSaving(false);
    toast.success("✅ 관리자 페이지에 저장 완료!");
  };

  return (
    <div className="space-y-3">
      {/* 안내 배너 */}
      <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "linear-gradient(135deg, #10b98115, #05966905)", border: "1px solid #10b98130" }}>
        <Shield className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#10b981" }} />
        <div>
          <p className="text-sm font-semibold text-foreground">관리자 API 키 관리</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            관리자 계정(admin)의 API 키를 저장합니다. 네이버 데이터랩 키는 관리자 페이지에서만 저장되고, 일반 설정에는 표시되지 않아요.
          </p>
        </div>
      </div>

      {/* ── 글 생성 AI 선택 ── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <Bot className="w-4 h-4" style={{ color: "#10b981" }} />
          <span className="font-semibold text-sm text-foreground">글 생성 AI 선택</span>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "#10b98120", color: "#10b981" }}>
            현재: {CONTENT_AI_OPTIONS.find(o => o.value === contentAI)?.label}
          </span>
        </div>
        <div className="p-3 grid grid-cols-2 gap-2">
          {CONTENT_AI_OPTIONS.map(opt => {
            const active = contentAI === opt.value;
            const hasKey = !!values[opt.keyStorageKey]?.trim();
            return (
              <button key={opt.value}
                className="rounded-xl p-3 text-left transition-all active:scale-[0.97] relative overflow-hidden"
                style={{
                  background: active ? `${opt.logoColor}18` : "var(--background)",
                  border: `2px solid ${active ? opt.logoColor : "var(--border)"}`,
                  boxShadow: active ? `0 0 20px ${opt.logoColor}30` : "none",
                  outline: active ? `2px solid ${opt.logoColor}50` : "none",
                  outlineOffset: "2px",
                }}
                onClick={() => handleSelectContentAI(opt.value)}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white"
                    style={{ background: opt.logoColor }}>{opt.logo}</div>
                  <div className="flex items-center gap-1">
                    {active && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: opt.logoColor }} />}
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: opt.badge === "무료" ? "#10b98118" : "#f59e0b18", color: opt.badge === "무료" ? "#10b981" : "#f59e0b" }}>
                      {opt.badge}
                    </span>
                  </div>
                </div>
                <div className="text-xs font-semibold text-foreground">{opt.label}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{opt.desc}</div>
                {/* 키 입력 여부 표시 */}
                <div className="mt-1.5 text-xs flex items-center gap-1"
                  style={{ color: hasKey ? "#10b981" : "#f59e0b" }}>
                  {hasKey ? <><CheckCircle2 className="w-3 h-3" />키 있음</> : "⚠ 키 없음"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 이미지 생성 AI 선택 ── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <Image className="w-4 h-4" style={{ color: "#a78bfa" }} />
          <span className="font-semibold text-sm text-foreground">이미지 생성 AI 선택</span>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "#a78bfa20", color: "#a78bfa" }}>
            현재: {IMAGE_AI_OPTIONS.find(o => o.value === imageAI)?.label}
          </span>
        </div>
        <div className="p-3 grid grid-cols-2 gap-2">
          {IMAGE_AI_OPTIONS.map((opt: any) => {
            const active = imageAI === opt.value;
            const hasKey = !opt.keyStorageKey || !!values[opt.keyStorageKey]?.trim();
            return (
              <button key={opt.value}
                className="rounded-xl p-3 text-left transition-all active:scale-[0.97] overflow-hidden"
                style={{
                  background: active ? `${opt.logoColor}18` : "var(--background)",
                  border: `2px solid ${active ? opt.logoColor : "var(--border)"}`,
                  boxShadow: active ? `0 0 20px ${opt.logoColor}30` : "none",
                  outline: active ? `2px solid ${opt.logoColor}50` : "none",
                  outlineOffset: "2px",
                }}
                onClick={() => handleSelectImageAI(opt.value)}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white"
                    style={{ background: opt.logoColor }}>{opt.logo}</div>
                  <div className="flex items-center gap-1">
                    {active && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: opt.logoColor }} />}
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "#10b98118", color: "#10b981" }}>
                      {opt.badge}
                    </span>
                  </div>
                </div>
                <div className="text-xs font-semibold text-foreground">{opt.label}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{opt.desc}</div>
                <div className="mt-1.5 text-xs flex items-center gap-1"
                  style={{ color: hasKey ? "#10b981" : "#f59e0b" }}>
                  {hasKey ? <><CheckCircle2 className="w-3 h-3" />사용 가능</> : "⚠ 키 없음"}
                </div>
              </button>
            );
          })}
        </div>

        {/* 선택된 이미지 AI 키 입력 */}
        {(() => {
          const opt = IMAGE_AI_OPTIONS.find(o => o.value === imageAI);
          if (!opt?.keyStorageKey) return null;
          const uid = opt.keyStorageKey + "_img";
          return (
            <div className="px-3 pb-3">
              <div className="p-3 rounded-xl" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground">{opt.keyLabel}</span>
                  {opt.keyLink && (
                    <a href={opt.keyLink} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs hover:underline" style={{ color: "#a78bfa" }}>
                      발급받기 <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showMap[uid] ? "text" : "password"}
                    placeholder={opt.keyPlaceholder}
                    value={values[opt.keyStorageKey] || ""}
                    onChange={e => setValues(p => ({ ...p, [opt.keyStorageKey!]: e.target.value }))}
                    className="pr-10 font-mono text-sm h-10"
                    style={{ borderColor: values[opt.keyStorageKey]?.trim() ? "#a78bfa60" : undefined }}
                  />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: "var(--muted-foreground)" }}
                    onClick={() => setShowMap(p => ({ ...p, [uid]: !p[uid] }))}>
                    {showMap[uid] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {values[opt.keyStorageKey]?.trim() && (
                  <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "#a78bfa" }}>
                    <CheckCircle2 className="w-3 h-3" /> 키 입력됨
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      <button
        className="w-full h-12 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
        style={{ background: saving ? "var(--muted)" : "linear-gradient(135deg, #10b981, #059669)" }}
        onClick={handleSaveAll} disabled={saving}>
        {saving ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
        {saving ? "저장 중..." : "관리자 키 저장"}
      </button>

      {/* ── 수익 플랫폼 선택 ── */}
      <AdminAdPlatformSection />
      {[
        { groupKey: "ai",       groupLabel: "🤖 글 · 이미지 AI",  groupColor: "#10b981" },
        { groupKey: "platform", groupLabel: "📡 배포 플랫폼 · 커스텀 사이트", groupColor: "#6366f1" },
        { groupKey: "keyword",  groupLabel: "🔍 키워드 · 기타",   groupColor: "#f59e0b" },
      ].map(({ groupKey, groupLabel, groupColor }) => (
        <div key={groupKey} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="h-px flex-1" style={{ background: `${groupColor}40` }} />
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${groupColor}15`, color: groupColor }}>{groupLabel}</span>
            <div className="h-px flex-1" style={{ background: `${groupColor}40` }} />
          </div>
          {API_SECTIONS.filter((s: any) => s.group === groupKey).map(({ title, icon: iconName, color, grad, desc, fields }) => {
        const Icon = ICON_MAP[iconName] || Key;
        const isOpen = openSections[title] !== false;
        // 중복 키 제거 후 실제 입력 필드 수
        const uniqueKeys = [...new Set(fields.map(f => f.key))];
        const filledCount = uniqueKeys.filter(k => values[k]?.trim()).length;
        const total = uniqueKeys.length;

        return (
          <div key={title} className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            {/* 헤더 */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/10"
              onClick={() => setOpenSections(p => ({ ...p, [title]: !isOpen }))}>
              {/* 아이콘 */}
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: grad }}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="font-semibold text-sm text-foreground">{title}</div>
                <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{desc}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* 입력 진행률 */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: total }).map((_, i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full"
                      style={{ background: i < filledCount ? color : "var(--border)" }} />
                  ))}
                </div>
                <span className="text-xs font-medium" style={{ color: filledCount === total ? color : "var(--muted-foreground)" }}>
                  {filledCount}/{total}
                </span>
                <ChevronDown className="w-4 h-4 transition-transform" style={{ color: "var(--muted-foreground)", transform: isOpen ? "rotate(180deg)" : "" }} />
              </div>
            </button>

            {/* 내용 */}
            {isOpen && (
              <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--border)" }}>
                <div className="pt-3 space-y-3">
                  {fields.map(({ label, key, placeholder, link, badge, badgeColor, type, options }: any) => {
                    const uid = key + label;
                    const filled = !!values[key]?.trim();

                    // ── Select 드롭다운 타입 ──
                    if (type === "select" && options) {
                      return (
                        <div key={uid}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-foreground">{label}</span>
                          </div>
                          <Select
                            value={values[key] || options[0]?.value || ""}
                            onValueChange={v => setValues(p => ({ ...p, [key]: v }))}>
                            <SelectTrigger className="h-11 text-sm" style={{ borderColor: filled ? `${color}60` : undefined }}>
                              <SelectValue placeholder={placeholder} />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((opt: { value: string; label: string }) => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {filled && (
                            <p className="text-xs mt-1 flex items-center gap-1" style={{ color }}>
                              <CheckCircle2 className="w-3 h-3" /> {options.find((o: any) => o.value === values[key])?.label}
                            </p>
                          )}
                        </div>
                      );
                    }

                    // ── 기본 Input 타입 ──
                    return (
                      <div key={uid}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-foreground">{label}</span>
                            {badge && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: `${badgeColor}18`, color: badgeColor }}>
                                {badge}
                              </span>
                            )}
                          </div>
                          {link && (
                            <a href={link} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs hover:underline"
                              style={{ color }}>
                              발급받기 <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="relative">
                          <Input
                            type={showMap[uid] ? "text" : "password"}
                            placeholder={placeholder}
                            value={values[key] || ""}
                            onChange={e => setValues(p => ({ ...p, [key]: e.target.value }))}
                            className="pr-20 font-mono text-sm h-11"
                            style={{ borderColor: filled ? `${color}60` : undefined }}
                          />
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            <button className="p-1.5 rounded-lg hover:bg-accent/30"
                              style={{ color: "var(--muted-foreground)" }}
                              onClick={() => setShowMap(p => ({ ...p, [uid]: !p[uid] }))}>
                              {showMap[uid] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            {filled && (
                              <button className="p-1.5 rounded-lg hover:bg-accent/30"
                                style={{ color: "var(--muted-foreground)" }}
                                onClick={() => { navigator.clipboard.writeText(values[key]); toast.success("복사됨"); }}>
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        {filled && (
                          <p className="text-xs mt-1 flex items-center gap-1" style={{ color }}>
                            <CheckCircle2 className="w-3 h-3" /> 저장된 키 있음
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
          })}
          {groupKey === "platform" && <AdminCustomWebhookSection />}
          {groupKey === "keyword" && <AdminGSCSection />}
        </div>
      ))}

      {/* 하단 저장 버튼 */}
      <button
        className="w-full h-12 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
        style={{ background: saving ? "var(--muted)" : "linear-gradient(135deg, #10b981, #059669)" }}
        onClick={handleSaveAll} disabled={saving}>
        {saving ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
        {saving ? "저장 중..." : "관리자 키 저장"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 회원 목록 관리
// ─────────────────────────────────────────────────────
interface UserRow { id: string; name: string; email: string; role: string; createdAt: string; postCount: number; }

function UserManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const d = await adminApi("listUsers");
    if (d.ok) setUsers(d.users || []);
    else toast.error(d.error || "불러오기 실패");
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const changeRole = async (userId: string, newRole: string) => {
    setChanging(userId);
    const d = await adminApi("changeUserRole", { targetUserId: userId, newRole });
    if (d.ok) { toast.success("등급 변경 완료"); await load(); }
    else toast.error(d.error || "변경 실패");
    setChanging(null);
  };

  const deleteUser = async (userId: string, name: string) => {
    if (!confirm(`"${name}" 회원을 삭제할까요?`)) return;
    const d = await adminApi("deleteUser", { targetUserId: userId });
    if (d.ok) { toast.success("삭제 완료"); await load(); }
    else toast.error(d.error || "삭제 실패");
  };

  const formatDate = (s: string) => {
    if (!s) return "-";
    try { return new Date(s).toLocaleDateString("ko-KR", { month: "short", day: "numeric", year: "2-digit" }); } catch { return s; }
  };

  const ROLE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    admin: { bg: "#f59e0b20", text: "#f59e0b", label: "👑 관리자" },
    user:  { bg: "#6366f120", text: "#6366f1", label: "일반" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">총 {users.length}명</div>
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>가입 회원 전체 목록</div>
        </div>
        <button className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl font-medium transition-all active:scale-95"
          style={{ background: "var(--muted)", color: "var(--muted-foreground)" }} onClick={load}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> 새로고침
        </button>
      </div>

      {loading ? (
        <div className="py-16 flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin" style={{ color: "var(--muted-foreground)" }} />
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>불러오는 중...</p>
        </div>
      ) : users.length === 0 ? (
        <div className="py-16 text-center rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <Users className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: "var(--muted-foreground)" }} />
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>아직 가입한 회원이 없어요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(u => {
            const rc = ROLE_COLORS[u.role] || ROLE_COLORS.user;
            const avatarGrad = u.role === "admin"
              ? "linear-gradient(135deg,#f59e0b,#d97706)"
              : "linear-gradient(135deg,#6366f1,#4f46e5)";
            return (
              <div key={u.id} className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black text-white shrink-0"
                    style={{ background: avatarGrad }}>
                    {u.name[0]?.toUpperCase() || "U"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{u.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: rc.bg, color: rc.text }}>{rc.label}</span>
                    </div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
                      {u.id} · {u.email}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-xl px-3 py-2" style={{ background: "var(--background)" }}>
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>가입일</div>
                    <div className="text-xs font-medium text-foreground mt-0.5">{formatDate(u.createdAt)}</div>
                  </div>
                  <div className="rounded-xl px-3 py-2" style={{ background: "var(--background)" }}>
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>발행 글</div>
                    <div className="text-xs font-medium text-foreground mt-0.5">{u.postCount}개</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    className="flex-1 h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95"
                    style={{
                      background: u.role === "admin" ? "#6366f118" : "#f59e0b18",
                      color: u.role === "admin" ? "#6366f1" : "#f59e0b",
                      border: `1px solid ${u.role === "admin" ? "#6366f130" : "#f59e0b30"}`,
                    }}
                    disabled={changing === u.id}
                    onClick={() => changeRole(u.id, u.role === "admin" ? "user" : "admin")}>
                    {changing === u.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <Crown className="w-3.5 h-3.5" />}
                    {u.role === "admin" ? "일반으로 변경" : "관리자 승급"}
                  </button>
                  <button
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
                    style={{ background: "#ef444418", color: "#ef4444", border: "1px solid #ef444430" }}
                    onClick={() => deleteUser(u.id, u.name)}>
                    <UserX className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 보안 (비밀번호 변경 + 시스템 현황)
// ─────────────────────────────────────────────────────
function SecurityPanel() {
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [conf, setConf] = useState("");
  const [showCur, setShowCur] = useState(false); const [showNw, setShowNw] = useState(false); const [showConf, setShowConf] = useState(false);
  const [loading, setLoading] = useState(false);

  const strength = nw.length === 0 ? null
    : nw.length < 4 ? { label: "너무 짧음", color: "#ef4444", score: 1 }
    : nw.length < 6 ? { label: "약함", color: "#f59e0b", score: 2 }
    : nw.length < 8 ? { label: "보통", color: "#6366f1", score: 3 }
    : { label: "강함", color: "#10b981", score: 4 };

  const handle = async () => {
    if (!cur) { toast.error("현재 비밀번호를 입력해주세요"); return; }
    if (!nw || nw.length < 4) { toast.error("새 비밀번호는 4자 이상이어야 해요"); return; }
    if (nw !== conf) { toast.error("새 비밀번호가 일치하지 않아요"); return; }
    setLoading(true);
    const d = await adminApi("changeAdminPassword", { currentPassword: cur, newPassword: nw });
    if (d.ok) {
      toast.success("✅ 비밀번호 변경 완료! 서버에 저장됩니다.");
      setCur(""); setNw(""); setConf("");
      setTimeout(() => { sessionStorage.removeItem(SESSION_KEY); window.location.reload(); }, 1500);
    } else {
      toast.error(d.error || "변경 실패");
    }
    setLoading(false);
  };

  const sysMetrics = [
    { label: "CPU", value: 34, color: "#10b981", icon: Cpu },
    { label: "메모리", value: 67, color: "#f59e0b", icon: HardDrive },
    { label: "API 호출", value: 78, color: "#6366f1", icon: Wifi },
    { label: "디스크", value: 45, color: "#a78bfa", icon: Database },
  ];

  return (
    <div className="space-y-4">
      {/* 비밀번호 변경 */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}>
            <Key className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-semibold text-foreground">비밀번호 변경</div>
            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>변경 후 서버 저장 → 배포해도 유지</div>
          </div>
        </div>

        {([
          { label: "현재 비밀번호", val: cur, set: setCur, show: showCur, setShow: setShowCur },
          { label: "새 비밀번호", val: nw, set: setNw, show: showNw, setShow: setShowNw },
          { label: "새 비밀번호 확인", val: conf, set: setConf, show: showConf, setShow: setShowConf },
        ] as const).map(({ label, val, set, show, setShow }) => (
          <div key={label}>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--muted-foreground)" }}>{label}</label>
            <div className="relative">
              <Input type={show ? "text" : "password"} placeholder={label} value={val}
                onChange={e => (set as any)(e.target.value)} className="pr-10 h-11" autoComplete="new-password" />
              <button className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }}
                onClick={() => (setShow as any)((v: boolean) => !v)}>
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {label === "새 비밀번호" && strength && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[1,2,3,4].map(i => <div key={i} className="flex-1 h-1.5 rounded-full" style={{ background: i <= strength.score ? strength.color : "var(--border)" }} />)}
                </div>
                <span className="text-xs font-medium" style={{ color: strength.color }}>{strength.label}</span>
              </div>
            )}
            {label === "새 비밀번호 확인" && conf.length > 0 && (
              <p className="text-xs mt-1 flex items-center gap-1" style={{ color: nw === conf ? "#10b981" : "#ef4444" }}>
                {nw === conf ? <><CheckCircle2 className="w-3 h-3" />일치</> : "⚠ 불일치"}
              </p>
            )}
          </div>
        ))}

        <button
          className="w-full h-11 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
          style={{ background: loading ? "var(--muted)" : "linear-gradient(135deg,#10b981,#059669)" }}
          onClick={handle} disabled={loading}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
          {loading ? "변경 중..." : "비밀번호 변경"}
        </button>
      </div>

      {/* 시스템 현황 */}
      <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4" style={{ color: "#6366f1" }} />
          <span className="font-semibold text-sm text-foreground">시스템 현황</span>
        </div>
        <div className="space-y-3">
          {sysMetrics.map(m => (
            <div key={m.label} className="flex items-center gap-3">
              <m.icon className="w-4 h-4 shrink-0" style={{ color: m.color }} />
              <span className="text-xs w-14 text-foreground">{m.label}</span>
              <div className="flex-1 h-2 rounded-full" style={{ background: "var(--muted)" }}>
                <div className="h-2 rounded-full transition-all" style={{ width: `${m.value}%`, background: m.color }} />
              </div>
              <span className="text-xs w-8 text-right font-medium" style={{ color: m.color }}>{m.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 카테고리 관리
// ─────────────────────────────────────────────────────
const CUSTOM_COLORS = ["#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#ec4899","#f97316","#14b8a6","#6366f1","#84cc16"];

const FIXED_PLATFORMS = [
  { key: "wordpress", label: "워드프레스", color: "#21759B" },
  { key: "blogger",   label: "블로거",     color: "#FF5722" },
  { key: "medium",    label: "미디엄",     color: "#333333" },
];

function loadPlatformCategories(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem("platform_categories") || "{}"); } catch { return {}; }
}

function savePlatformCategories(data: Record<string, string[]>) {
  localStorage.setItem("platform_categories", JSON.stringify(data));
  saveSettingsToServer({ platform_categories: JSON.stringify(data) });
}

function PlatformCategoryCard({ platformKey, label, color, allData, onUpdate }: {
  platformKey: string; label: string; color: string;
  allData: Record<string, string[]>; onUpdate: (data: Record<string, string[]>) => void;
}) {
  const cats = allData[platformKey] || [];
  const [newCat, setNewCat] = useState("");

  const add = () => {
    const trimmed = newCat.trim();
    if (!trimmed) { toast.error("카테고리명을 입력해주세요"); return; }
    if (cats.includes(trimmed)) { toast.error("이미 있는 카테고리예요"); return; }
    const updated = { ...allData, [platformKey]: [...cats, trimmed] };
    onUpdate(updated);
    setNewCat("");
    toast.success(`"${trimmed}" 추가됐어요`);
  };

  const remove = (idx: number) => {
    const updated = { ...allData, [platformKey]: cats.filter((_: string, i: number) => i !== idx) };
    onUpdate(updated);
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const list = [...cats];
    [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
    onUpdate({ ...allData, [platformKey]: list });
  };

  const moveDown = (idx: number) => {
    if (idx === cats.length - 1) return;
    const list = [...cats];
    [list[idx], list[idx + 1]] = [list[idx + 1], list[idx]];
    onUpdate({ ...allData, [platformKey]: list });
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: `2px solid ${color}30` }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="font-semibold text-sm text-foreground">{label}</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${color}20`, color }}>
          {cats.length}개
        </span>
      </div>
      <div className="space-y-1.5 mb-3">
        {cats.length === 0 && (
          <p className="text-xs text-center py-3" style={{ color: "var(--muted-foreground)" }}>카테고리가 없어요</p>
        )}
        {cats.map((cat: string, idx: number) => (
          <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
            <span className="text-xs font-bold w-5 text-center" style={{ color }}>{idx + 1}</span>
            <span className="flex-1 text-sm text-foreground">{cat}</span>
            <div className="flex items-center gap-0.5">
              <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent/20" style={{ color: "var(--muted-foreground)" }} onClick={() => moveUp(idx)}>
                <ChevronDown className="w-3 h-3 rotate-180" />
              </button>
              <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent/20" style={{ color: "var(--muted-foreground)" }} onClick={() => moveDown(idx)}>
                <ChevronDown className="w-3 h-3" />
              </button>
              <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/20" style={{ color: "#ef4444" }} onClick={() => remove(idx)}>
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={newCat} onChange={e => setNewCat(e.target.value)}
          placeholder="카테고리 입력 후 Enter"
          className="h-9 text-sm flex-1"
          onKeyDown={e => e.key === "Enter" && add()} />
        <button className="h-9 px-3 rounded-xl font-semibold text-white text-xs transition-all active:scale-95"
          style={{ background: color }} onClick={add}>추가</button>
      </div>
    </div>
  );
}

function CategoryManager() {
  const [allData, setAllData] = useState<Record<string, string[]>>(loadPlatformCategories);
  const [customList, setCustomList] = useState<any[]>(() => {
    try {
      const admin = JSON.parse(localStorage.getItem("admin_custom_list") || "[]");
      const platform = JSON.parse(localStorage.getItem("platform_custom_list") || "[]");
      // 둘 다 합쳐서 중복 제거 (webhook_url 기준)
      const merged = [...admin, ...platform].filter((e, i, arr) =>
        arr.findIndex(x => x.webhook_url === e.webhook_url) === i
      );
      return merged;
    } catch { return []; }
  });

  // 커스텀 사이트 목록 새로고침
  const refreshCustomList = () => {
    try {
      const admin = JSON.parse(localStorage.getItem("admin_custom_list") || "[]");
      const platform = JSON.parse(localStorage.getItem("platform_custom_list") || "[]");
      const merged = [...admin, ...platform].filter((e, i, arr) =>
        arr.findIndex(x => x.webhook_url === e.webhook_url) === i
      );
      setCustomList(merged);
    } catch {}
  };

  // 고정 플랫폼 (번호 없이 그대로)
  const numberedFixed = FIXED_PLATFORMS;

  // 커스텀 사이트 번호 붙이기
  const customPlatforms = customList.map((e: any, idx: number) => ({
    key: `custom_${idx}`,
    label: `커스텀 ${idx + 1}${e._name ? ` · ${e._name}` : ""}`,
    color: CUSTOM_COLORS[idx % CUSTOM_COLORS.length],
  }));

  const allPlatforms = [...numberedFixed, ...customPlatforms];

  const handleUpdate = (updated: Record<string, string[]>) => {
    setAllData(updated);
    savePlatformCategories(updated);
  };

  return (
    <div className="space-y-4 py-2">
      {/* 안내 + 계정 추가 버튼 */}
      <div className="rounded-2xl p-4 flex items-center justify-between gap-3" style={{ background: "oklch(0.6 0.15 220/10%)", border: "1px solid oklch(0.6 0.15 220/30%)" }}>
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          플랫폼별로 카테고리를 따로 관리해요. 배포 시 선택한 플랫폼의 카테고리만 표시돼요.
        </p>
        <button onClick={refreshCustomList}
          className="h-8 px-3 rounded-xl text-xs font-semibold transition-all active:scale-95 shrink-0"
          style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
          새로고침
        </button>
      </div>
      {/* 플랫폼별 카테고리 카드 */}
      <div className="grid gap-4 sm:grid-cols-2">
        {allPlatforms.map(p => (
          <PlatformCategoryCard key={p.key} platformKey={p.key} label={p.label} color={p.color} allData={allData} onUpdate={handleUpdate} />
        ))}
      </div>
      {customPlatforms.length === 0 && (
        <div className="text-center py-4 text-xs" style={{ color: "var(--muted-foreground)" }}>
          커스텀 사이트가 없어요. API 키 탭 → 커스텀 Webhook에서 추가 후 새로고침 해주세요.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// OG 이미지 관리
// ─────────────────────────────────────────────────────
function OGManager() {
  const [og, setOg] = useState<OGSettings>(loadOG);
  const [newPost, setNewPost] = useState({ title: "", url: "", image: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const siteRef = useRef<HTMLInputElement>(null);
  const postRef = useRef<HTMLInputElement>(null);

  // ✅ 마운트 시 서버에서 최신 OG 설정 불러오기
  useEffect(() => {
    loadOGFromServer().then(serverOg => {
      if (serverOg) setOg(serverOg);
    });
  }, []);

  const uploadSite = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("이미지 파일만 가능합니다"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("5MB 이하만 가능합니다"); return; }
    setUploading(true);
    try {
      const url = await uploadImageToImgbb(file);
      const u = { ...og, siteImage: url };
      setOg(u);
      await saveOGToServer(u);
      toast.success("✅ OG 이미지 업로드 완료! 모든 기기에서 공유됩니다.");
    } catch (e: any) {
      toast.error(e.message || "이미지 업로드 실패");
    }
    setUploading(false);
  };

  const save = async () => {
    await saveOGToServer(og);
    const setMeta = (prop: string, val: string) => {
      let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement;
      if (!el) { el = document.createElement("meta"); el.setAttribute("property", prop); document.head.appendChild(el); }
      el.setAttribute("content", val);
    };
    setMeta("og:title", og.siteTitle); setMeta("og:description", og.siteDesc); setMeta("og:site_name", og.siteName);
    document.title = og.siteTitle;
    toast.success("✅ OG 설정 저장 완료! 모든 기기에서 적용됩니다.");
  };

  const code = `<meta property="og:title" content="${og.siteTitle}" />\n<meta property="og:description" content="${og.siteDesc}" />\n<meta property="og:site_name" content="${og.siteName}" />\n<meta property="og:image" content="https://YOUR_DOMAIN/og-image.jpg" />\n<meta name="twitter:card" content="${og.twitterCard}" />`;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-4 border-b flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}>
            <Globe className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <div className="font-semibold text-sm text-foreground">앱 전체 OG 이미지</div>
            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>카카오톡/SNS 링크 공유 시 표시</div>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {og.siteImage ? (
            <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: "1200/630", maxHeight: 180 }}>
              <img src={og.siteImage} alt="OG" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 hover:bg-black/50 transition-all flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                <button className="px-3 py-2 rounded-lg text-xs text-white font-medium" style={{ background: "rgba(255,255,255,0.2)" }} onClick={() => siteRef.current?.click()}><Upload className="w-3.5 h-3.5 inline mr-1" />변경</button>
                <button className="px-3 py-2 rounded-lg text-xs text-white font-medium" style={{ background: "rgba(239,68,68,0.7)" }} onClick={async () => { const u = { ...og, siteImage: "" }; setOg(u); await saveOGToServer(u); }}><X className="w-3.5 h-3.5 inline mr-1" />삭제</button>
              </div>
            </div>
          ) : (
            <button className="w-full rounded-xl flex flex-col items-center justify-center gap-2 py-8 transition-all"
              style={{ border: `2px dashed ${drag ? "#6366f1" : "var(--border)"}`, background: drag ? "#6366f108" : "var(--background)", maxHeight: 160 }}
              onClick={() => siteRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={async e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) await uploadSite(f); }}>
              <Upload className="w-8 h-8 opacity-30" style={{ color: "var(--muted-foreground)" }} />
              <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>{uploading ? "업로드 중..." : "1200×630 권장 · 최대 5MB"}</span>
            </button>
          )}
          <input ref={siteRef} type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) await uploadSite(f); e.target.value = ""; }} />
          <div className="space-y-3">
            <div><label className="text-xs font-medium mb-1 block" style={{ color: "var(--muted-foreground)" }}>사이트 제목</label><Input value={og.siteTitle} onChange={e => setOg(p => ({ ...p, siteTitle: e.target.value }))} className="h-11 text-sm" /></div>
            <div><label className="text-xs font-medium mb-1 block" style={{ color: "var(--muted-foreground)" }}>사이트명</label><Input value={og.siteName} onChange={e => setOg(p => ({ ...p, siteName: e.target.value }))} className="h-11 text-sm" /></div>
            <div><label className="text-xs font-medium mb-1 block" style={{ color: "var(--muted-foreground)" }}>설명</label><Textarea value={og.siteDesc} onChange={e => setOg(p => ({ ...p, siteDesc: e.target.value }))} className="text-sm resize-none min-h-[80px]" /></div>
          </div>
          <button className="w-full h-11 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }} onClick={save}>
            <CheckCircle2 className="w-4 h-4" /> OG 설정 저장
          </button>
          <div className="rounded-xl p-3" style={{ background: "oklch(0.12 0.005 285)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold" style={{ color: "#10b981" }}>index.html 코드</span>
              <button className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
                onClick={() => { navigator.clipboard.writeText(code); toast.success("복사됐어요!"); }}>
                <Copy className="w-3 h-3" /> 복사
              </button>
            </div>
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap" style={{ color: "#6ee7b7", lineHeight: 1.7 }}>{code}</pre>
          </div>
        </div>
      </div>

      {/* 글별 OG */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }}>
              <Link className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className="font-semibold text-sm text-foreground">글별 OG 이미지</div>
              <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{og.postImages.length}개 등록</div>
            </div>
          </div>
          <button className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }} onClick={() => setShowAdd(v => !v)}>
            + 추가
          </button>
        </div>
        {showAdd && (
          <div className="p-4 border-b space-y-3" style={{ borderColor: "var(--border)", background: "var(--background)" }}>
            <Input value={newPost.title} onChange={e => setNewPost(p => ({ ...p, title: e.target.value }))} placeholder="글 제목" className="h-11 text-sm" />
            <Input value={newPost.url} onChange={e => setNewPost(p => ({ ...p, url: e.target.value }))} placeholder="글 URL (선택)" className="h-11 text-sm" />
            {newPost.image ? (
              <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: "1200/630", maxHeight: 140 }}>
                <img src={newPost.image} alt="미리보기" className="w-full h-full object-cover" />
                <button className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setNewPost(p => ({ ...p, image: "" }))}><X className="w-3.5 h-3.5 text-white" /></button>
              </div>
            ) : (
              <button className="w-full rounded-xl flex items-center justify-center gap-2 py-5 transition-all" style={{ border: "2px dashed var(--border)", background: "var(--card)" }} onClick={() => postRef.current?.click()}>
                <Upload className="w-5 h-5 opacity-30" style={{ color: "var(--muted-foreground)" }} />
                <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>이미지 업로드</span>
              </button>
            )}
            <input ref={postRef} type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { const b64 = await toBase64(f); setNewPost(p => ({ ...p, image: b64 })); } e.target.value = ""; }} />
            <div className="flex gap-2">
              <button className="flex-1 h-11 rounded-xl font-semibold text-white text-sm transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }}
                onClick={() => {
                  if (!newPost.title.trim()) { toast.error("글 제목을 입력해주세요"); return; }
                  if (!newPost.image) { toast.error("OG 이미지를 업로드해주세요"); return; }
                  const u = { ...og, postImages: [...og.postImages, { id: Date.now().toString(), ...newPost }] };
                  setOg(u); saveOG(u); setNewPost({ title: "", url: "", image: "" }); setShowAdd(false);
                  toast.success("추가됐어요!");
                }}>추가</button>
              <button className="px-4 h-11 rounded-xl text-sm font-medium" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }} onClick={() => { setShowAdd(false); setNewPost({ title: "", url: "", image: "" }); }}>취소</button>
            </div>
          </div>
        )}
        {og.postImages.length === 0 && !showAdd ? (
          <div className="py-10 text-center"><p className="text-sm" style={{ color: "var(--muted-foreground)" }}>글별 OG 이미지를 추가해주세요</p></div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {og.postImages.map(post => (
              <div key={post.id} className="flex items-center gap-3 p-3">
                <div className="w-16 h-10 rounded-lg overflow-hidden shrink-0" style={{ border: "1px solid var(--border)" }}><img src={post.image} alt={post.title} className="w-full h-full object-cover" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{post.title}</p>
                  {post.url && <p className="text-xs truncate" style={{ color: "var(--muted-foreground)" }}>{post.url}</p>}
                </div>
                <button className="w-8 h-8 flex items-center justify-center rounded-lg" style={{ color: "#ef4444" }}
                  onClick={() => { const u = { ...og, postImages: og.postImages.filter(p => p.id !== post.id) }; setOg(u); saveOG(u); toast.success("삭제됐어요"); }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 공지 팝업 관리
// ─────────────────────────────────────────────────────
function PopupManager() {
  const [popups, setPopups] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newStartAt, setNewStartAt] = useState("");
  const [newEndAt, setNewEndAt] = useState("");
  const [newEmoji, setNewEmoji] = useState("📢");
  const [newColor, setNewColor] = useState("#10b981");
  const [newFileUrl, setNewFileUrl] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState<"title"|"content"|null>(null);
  const [editingId, setEditingId] = useState<string|null>(null);

  const EMOJI_LIST = ["😀","😊","🎉","🔥","💡","⭐","✅","❌","📢","📣","🎁","💰","🚀","💎","🏆","❤️","👍","🙌","😍","🤩","📌","🔔","💬","📝","📱","💻","🌟","✨","🎯","🎊","🎈","🎀","🛒","💳","📦","🔗","📧","📞","🌈","🌙","☀️","⚡","🌺","🍀","🦋","🐝","💐","🍎","☕","🎵"];

  const insertEmoji = (emoji: string, target: "title" | "content") => {
    if (target === "title") setNewTitle(prev => prev + emoji);
    if (target === "content") setNewContent(prev => prev + emoji);
    setShowEmojiPicker(null);
  };

  useEffect(() => {
    const token = localStorage.getItem("ba_token") || "";
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "loadPopups" }),
    }).then(r => r.json()).then(d => {
      if (d.ok && Array.isArray(d.popups)) setPopups(d.popups);
    }).catch(() => {});
  }, []);

  const save = async (list: any[]) => {
    setSaving(true);
    const token = localStorage.getItem("ba_token") || "";
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "savePopups", popups: list }),
    });
    setSaving(false);
    toast.success("✅ 팝업 저장됨");
  };

  const addPopup = async () => {
    if (!newTitle.trim()) { toast.error("제목을 입력해주세요"); return; }
    if (!newContent.trim()) { toast.error("내용을 입력해주세요"); return; }
    const popup = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      content: newContent.trim(),
      enabled: true,
      startAt: newStartAt || "",
      endAt: newEndAt || "",
      emoji: newEmoji || "📢",
      color: newColor || "#10b981",
      fileUrl: newFileUrl.trim() || "",
    };
    const updated = [...popups, popup];
    setPopups(updated);
    await save(updated);
    setNewTitle(""); setNewContent(""); setNewStartAt(""); setNewEndAt("");
    setNewEmoji("📢"); setNewColor("#10b981"); setNewFileUrl("");
    setShowAdd(false);
  };

  const toggleEnabled = async (id: string) => {
    const updated = popups.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p);
    setPopups(updated);
    await save(updated);
  };

  const deletePopup = async (id: string) => {
    const updated = popups.filter(p => p.id !== id);
    setPopups(updated);
    await save(updated);
    toast.success("삭제됐어요");
  };

  const startEdit = (popup: any) => {
    setEditingId(popup.id);
    setNewTitle(popup.title || "");
    setNewContent(popup.content || "");
    setNewStartAt(popup.startAt || "");
    setNewEndAt(popup.endAt || "");
    setNewEmoji(popup.emoji || "📢");
    setNewColor(popup.color || "#10b981");
    setNewFileUrl(popup.fileUrl || "");
    setShowAdd(true);
  };

  const saveEdit = async () => {
    if (!newTitle.trim()) { toast.error("제목을 입력해주세요"); return; }
    if (!newContent.trim()) { toast.error("내용을 입력해주세요"); return; }
    const updated = popups.map(p => p.id === editingId ? {
      ...p,
      title: newTitle.trim(),
      content: newContent.trim(),
      startAt: newStartAt || "",
      endAt: newEndAt || "",
      emoji: newEmoji || "📢",
      color: newColor || "#10b981",
      fileUrl: newFileUrl.trim() || "",
    } : p);
    setPopups(updated);
    await save(updated);
    setEditingId(null);
    setNewTitle(""); setNewContent(""); setNewStartAt(""); setNewEndAt("");
    setNewEmoji("📢"); setNewColor("#10b981"); setNewFileUrl("");
    setShowAdd(false);
  };

  return (
    <div className="space-y-4 py-4">
      {/* 안내 */}
      <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "oklch(0.65 0.22 350/10%)", border: "1px solid oklch(0.65 0.22 350/30%)" }}>
        <Bell className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#ec4899" }} />
        <div>
          <p className="text-sm font-semibold text-foreground">회원 공지 팝업 관리</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            활성화된 팝업이 대시보드에 표시돼요. 회원이 닫기 또는 일주일 보지 않기를 선택할 수 있어요.
          </p>
        </div>
      </div>

      {/* 팝업 목록 */}
      {popups.map((popup, idx) => (
        <div key={popup.id} className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: popup.enabled ? "oklch(0.696 0.17 162.48/20%)" : "var(--muted)", color: popup.enabled ? "#10b981" : "var(--muted-foreground)" }}>
                {popup.enabled ? "활성" : "비활성"}
              </span>
              <span className="font-semibold text-sm text-foreground">{popup.title}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* 활성 토글 */}
              <div className="relative w-11 h-6 rounded-full cursor-pointer transition-colors"
                style={{ background: popup.enabled ? "#10b981" : "var(--muted)" }}
                onClick={() => toggleEnabled(popup.id)}>
                <div className="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow"
                  style={{ left: popup.enabled ? "22px" : "2px" }} />
              </div>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-500/10"
                onClick={() => startEdit(popup)}>
                <span style={{ fontSize: 14 }}>✏️</span>
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/10"
                onClick={() => deletePopup(popup.id)}>
                <Trash2 className="w-4 h-4" style={{ color: "#ef4444" }} />
              </button>
            </div>
          </div>
          <p className="text-xs whitespace-pre-line" style={{ color: "var(--muted-foreground)" }}>{popup.content}</p>
          {(popup.startAt || popup.endAt) && (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {popup.startAt && `시작: ${popup.startAt}`}{popup.startAt && popup.endAt && " ~ "}{popup.endAt && `종료: ${popup.endAt}`}
            </p>
          )}
        </div>
      ))}

      {popups.length === 0 && !showAdd && (
        <div className="py-8 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>등록된 팝업이 없어요</div>
      )}

      {/* 추가 폼 */}
      {showAdd && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid #ec489940" }}>
          <p className="font-semibold text-sm text-foreground">{editingId ? "팝업 수정" : "새 팝업 추가"}</p>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>제목</label>
              <button type="button" onClick={() => setShowEmojiPicker(v => v === "title" ? null : "title")}
                className="text-xs px-2 py-0.5 rounded-lg" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                😊 이모티콘
              </button>
            </div>
            {showEmojiPicker === "title" && (
              <div className="flex flex-wrap gap-1 p-2 mb-2 rounded-xl" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
                {EMOJI_LIST.map(e => (
                  <button key={e} type="button" onClick={() => insertEmoji(e, "title")}
                    className="text-lg hover:scale-125 transition-transform p-0.5">{e}</button>
                ))}
              </div>
            )}
            <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="팝업 제목" className="text-sm" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>내용</label>
              <button type="button" onClick={() => setShowEmojiPicker(v => v === "content" ? null : "content")}
                className="text-xs px-2 py-0.5 rounded-lg" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                😊 이모티콘
              </button>
            </div>
            {showEmojiPicker === "content" && (
              <div className="flex flex-wrap gap-1 p-2 mb-2 rounded-xl" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
                {EMOJI_LIST.map(e => (
                  <button key={e} type="button" onClick={() => insertEmoji(e, "content")}
                    className="text-lg hover:scale-125 transition-transform p-0.5">{e}</button>
                ))}
              </div>
            )}
            <Textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="팝업 내용" className="text-sm min-h-[120px] font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--muted-foreground)" }}>노출 시작일 (선택)</label>
              <Input type="date" value={newStartAt} onChange={e => setNewStartAt(e.target.value)} className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--muted-foreground)" }}>노출 종료일 (선택)</label>
              <Input type="date" value={newEndAt} onChange={e => setNewEndAt(e.target.value)} className="text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--muted-foreground)" }}>이모지 아이콘</label>
              <Input value={newEmoji} onChange={e => setNewEmoji(e.target.value)} placeholder="📢" className="text-sm" maxLength={4} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--muted-foreground)" }}>헤더 색상</label>
              <div className="flex items-center gap-2">
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="w-10 h-9 rounded cursor-pointer border-0" style={{ background: "transparent" }} />
                <Input value={newColor} onChange={e => setNewColor(e.target.value)} placeholder="#10b981" className="text-sm flex-1" maxLength={7} />
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--muted-foreground)" }}>파일 다운로드 URL (선택)</label>
            <Input value={newFileUrl} onChange={e => setNewFileUrl(e.target.value)} placeholder="https://... 또는 /파일경로.pdf" className="text-sm" />
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" style={{ background: "#ec4899", color: "white" }} onClick={editingId ? saveEdit : addPopup} disabled={saving}>
              {saving ? "저장 중..." : editingId ? "✅ 수정 저장" : "✅ 추가"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => { setShowAdd(false); setEditingId(null); setNewTitle(""); setNewContent(""); setNewStartAt(""); setNewEndAt(""); setNewEmoji("📢"); setNewColor("#10b981"); setNewFileUrl(""); }}>
              취소
            </Button>
          </div>
        </div>
      )}

      {/* 추가 버튼 */}
      {!showAdd && (
        <button className="w-full h-11 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg,#ec4899,#db2777)" }}
          onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> 팝업 추가
        </button>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────
// 관리자 대시보드
// ─────────────────────────────────────────────────────
const TABS = [
  { id: "apikeys", label: "API 키", icon: Key, color: "#10b981", grad: "linear-gradient(135deg,#10b981,#059669)" },
  { id: "users",   label: "회원",   icon: Users, color: "#6366f1", grad: "linear-gradient(135deg,#6366f1,#4f46e5)" },
  { id: "security",label: "보안",   icon: Shield, color: "#f59e0b", grad: "linear-gradient(135deg,#f59e0b,#d97706)" },
  { id: "category",label: "카테고리", icon: FileText, color: "#06b6d4", grad: "linear-gradient(135deg,#06b6d4,#0284c7)" },
  { id: "og",      label: "OG",    icon: Image, color: "#a78bfa", grad: "linear-gradient(135deg,#a78bfa,#7c3aed)" },
  { id: "popup",   label: "공지",  icon: Bell, color: "#ec4899", grad: "linear-gradient(135deg,#ec4899,#db2777)" },
  { id: "autopublish", label: "자동발행", icon: Send, color: "#03C75A", grad: "linear-gradient(135deg,#03C75A,#059669)" },
  { id: "publy", label: "Publy", icon: Smartphone, color: "#00ff88", grad: "linear-gradient(135deg,#00ff88,#00cc66)" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── Publy 회원 현황 위젯 ──────────────────────────────────────
const PUBLY_URL = "https://qhhoyxexxlimbjrbwrgq.supabase.co";
const PUBLY_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoaG95eGV4eGxpbWJqcmJ3cmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU4MzA5NzcsImV4cCI6MjA2MTQwNjk3N30.bHtF5g_cJjlcLLFH5JaTzqOeD03j6fNXQYhYkVvTKM";

function PublyWidget() {
  const [stats, setStats] = React.useState<any>(null);
  const [users, setUsers] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const PUBLY_DOMAIN = "https://publy-bap.vercel.app";

  React.useEffect(() => {
    async function load() {
      try {
        const headers = {
          "apikey": PUBLY_KEY,
          "Authorization": `Bearer ${PUBLY_KEY}`,
          "Content-Type": "application/json",
        };
        const [uRes, qRes, hRes] = await Promise.all([
          fetch(`${PUBLY_URL}/rest/v1/publy_users?select=*&order=created_at.desc`, { headers }),
          fetch(`${PUBLY_URL}/rest/v1/publy_quotas?select=*`, { headers }),
          fetch(`${PUBLY_URL}/rest/v1/publy_history?select=*`, { headers }),
        ]);
        const [uData, qData, hData] = await Promise.all([uRes.json(), qRes.json(), hRes.json()]);
        const usersWithQuota = (uData || []).map((u: any) => ({
          ...u,
          quota: (qData || []).find((q: any) => q.user_id === u.id),
          pub_count: (hData || []).filter((h: any) => h.user_id === u.id).length,
        }));
        setUsers(usersWithQuota);
        setStats({
          total: usersWithQuota.length,
          active: usersWithQuota.filter((u: any) => u.is_active).length,
          pro: usersWithQuota.filter((u: any) => u.plan === "pro").length,
          basic: usersWithQuota.filter((u: any) => u.plan === "basic").length,
          free: usersWithQuota.filter((u: any) => u.plan === "free").length,
          totalPub: (hData || []).length,
          today: (hData || []).filter((h: any) => new Date(h.published_at).toDateString() === new Date().toDateString()).length,
        });
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) return (
    <div style={{textAlign:"center",padding:"64px",color:"var(--muted-foreground)"}}>
      <div style={{width:32,height:32,borderRadius:"50%",border:"3px solid rgba(0,255,136,.2)",borderTopColor:"#00ff88",animation:"spin 1s linear infinite",margin:"0 auto 12px"}}/>
      Publy 데이터 로딩 중...
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* 헤더 */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:44,height:44,borderRadius:14,background:"linear-gradient(135deg,#00ff88,#00cc66)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:900,color:"#000",boxShadow:"0 4px 16px rgba(0,255,136,.3)"}}>P</div>
          <div>
            <div style={{fontSize:"1.1rem",fontWeight:800,color:"var(--foreground)"}}>Publy 회원 현황</div>
            <div style={{fontSize:"0.75rem",color:"var(--muted-foreground)"}}>자동발행 앱 실시간 데이터</div>
          </div>
        </div>
        <a href={PUBLY_DOMAIN} target="_blank" rel="noopener noreferrer"
          style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:10,background:"linear-gradient(135deg,#00ff88,#00cc66)",color:"#000",fontWeight:700,fontSize:"0.8rem",textDecoration:"none"}}>
          🚀 Publy 관리자 열기
        </a>
      </div>

      {/* 통계 카드 */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        {[
          {label:"전체 회원",value:stats?.total||0,color:"#00ff88",icon:"👥"},
          {label:"활성 회원",value:stats?.active||0,color:"#00c875",icon:"✅"},
          {label:"PRO",value:stats?.pro||0,color:"#4285F4",icon:"⭐"},
          {label:"BASIC",value:stats?.basic||0,color:"#f59e0b",icon:"🔵"},
          {label:"오늘 발행",value:stats?.today||0,color:"#00ff88",icon:"🚀"},
          {label:"총 발행",value:stats?.totalPub||0,color:"#a78bfa",icon:"📊"},
        ].map((s,i)=>(
          <div key={i} style={{padding:"16px",borderRadius:14,border:`1px solid ${s.color}25`,background:`${s.color}08`,textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:6}}>{s.icon}</div>
            <div style={{fontSize:"1.6rem",fontWeight:900,color:s.color,fontFamily:"'Space Grotesk',sans-serif"}}>{s.value}</div>
            <div style={{fontSize:"0.72rem",color:"var(--muted-foreground)",fontWeight:600,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 플랜 분포 바 */}
      <div style={{padding:"18px 20px",borderRadius:16,background:"var(--card)",border:"1px solid var(--border)"}}>
        <div style={{fontSize:"0.8rem",fontWeight:700,color:"var(--muted-foreground)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:14}}>플랜 분포</div>
        {[
          {label:"PRO",count:stats?.pro||0,color:"#00c875"},
          {label:"BASIC",count:stats?.basic||0,color:"#4285F4"},
          {label:"FREE",count:stats?.free||0,color:"#888"},
        ].map(p=>{
          const pct = stats?.total ? Math.round(p.count/stats.total*100) : 0;
          return (
            <div key={p.label} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:"0.8rem",fontWeight:700,color:p.color}}>{p.label}</span>
                <span style={{fontSize:"0.8rem",color:"var(--muted-foreground)",fontFamily:"'JetBrains Mono',monospace"}}>{p.count}명 ({pct}%)</span>
              </div>
              <div style={{height:8,borderRadius:99,background:"var(--border)",overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:99,background:p.color,width:`${pct}%`,transition:"width .6s ease"}}/>
              </div>
            </div>
          );
        })}
      </div>

      {/* 최근 가입 회원 */}
      <div style={{padding:"18px 20px",borderRadius:16,background:"var(--card)",border:"1px solid var(--border)"}}>
        <div style={{fontSize:"0.8rem",fontWeight:700,color:"var(--muted-foreground)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:14}}>최근 가입 회원</div>
        {users.slice(0,8).map((u,i)=>(
          <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{width:32,height:32,borderRadius:9,background:"linear-gradient(135deg,rgba(0,255,136,.2),rgba(0,255,136,.1))",border:"1px solid rgba(0,255,136,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#00ff88",flexShrink:0}}>
              {(u.name||u.email)[0].toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:"0.82rem",fontWeight:600,color:"var(--foreground)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||"이름없음"}</div>
              <div style={{fontSize:"0.72rem",color:"var(--muted-foreground)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <span style={{fontSize:"0.7rem",fontWeight:800,padding:"2px 8px",borderRadius:99,background:u.plan==="pro"?"rgba(0,200,117,.15)":u.plan==="basic"?"rgba(66,133,244,.15)":"rgba(120,120,120,.15)",color:u.plan==="pro"?"#00c875":u.plan==="basic"?"#4285F4":"#999"}}>
                {u.plan?.toUpperCase()}
              </span>
              <span style={{fontSize:"0.72rem",color:"var(--muted-foreground)",fontFamily:"'JetBrains Mono',monospace"}}>{u.pub_count}건</span>
            </div>
          </div>
        ))}
      </div>

      {/* Publy 앱 다운로드 배너 */}
      <div style={{padding:"20px 22px",borderRadius:16,background:"linear-gradient(135deg,rgba(0,255,136,.08),rgba(0,200,117,.04))",border:"1px solid rgba(0,255,136,.2)",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{fontSize:40}}>📱</div>
        <div style={{flex:1,minWidth:160}}>
          <div style={{fontSize:"0.95rem",fontWeight:800,color:"var(--foreground)",marginBottom:4}}>Publy 앱 설치</div>
          <div style={{fontSize:"0.78rem",color:"var(--muted-foreground)",lineHeight:1.6}}>PC/모바일 브라우저에서 접속 후 설치 버튼을 누르면 앱처럼 사용 가능합니다.</div>
        </div>
        <a href={PUBLY_DOMAIN} target="_blank" rel="noopener noreferrer"
          style={{padding:"10px 20px",borderRadius:12,background:"linear-gradient(135deg,#00ff88,#00cc66)",color:"#000",fontWeight:800,fontSize:"0.82rem",textDecoration:"none",boxShadow:"0 4px 16px rgba(0,255,136,.3)"}}>
          ⬇️ Publy 열기
        </a>
      </div>
    </div>
  );
}


function AdminDashboard() {
  const [tab, setTab] = useState<TabId>("apikeys");
  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("ba_token");
    localStorage.removeItem("ba_user");
    window.location.reload();
  };
  const activeTab = TABS.find(t => t.id === tab)!;

  return (
    <Layout>
      <div className="pb-24">
        {/* 헤더 */}
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: activeTab.grad }}>
                <activeTab.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-black text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>운영자 패널</h1>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{activeTab.label} 관리</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="ap-guide-btn" onClick={()=>setShowGuide(v=>!v)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{position:"relative",zIndex:1}}>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="#000"/>
                </svg>
                <span style={{position:"relative",zIndex:1}}>사용 설명서</span>
              </button>
              <button className="text-xs px-3 py-2 rounded-xl font-bold transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", boxShadow: "0 0 12px rgba(239,68,68,0.4)" }}
                onClick={() => window.location.href = "/monetization"}>
                💰 수익화
              </button>
              <button className="text-xs px-3 py-2 rounded-xl font-medium transition-all active:scale-95"
                style={{ background: "var(--muted)", color: "var(--muted-foreground)" }} onClick={handleLogout}>
                잠금
              </button>
            </div>
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        <div className="px-4">
          {tab === "apikeys"  && <ApiKeyManager />}
          {tab === "users"    && <UserManager />}
          {tab === "security" && <SecurityPanel />}
          {tab === "category" && <CategoryManager />}
          {tab === "og"       && <OGManager />}
          {tab === "popup"    && <PopupManager />}
          {tab === "autopublish" && <AutoPublishManager />}
          {tab === "publy"       && <PublyWidget />}
        </div>
      </div>

      {/* 하단 탭바 */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ background: "var(--background)", borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center px-2 py-2 gap-1">
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-2xl transition-all active:scale-95"
                style={{ background: active ? `${t.color}18` : "transparent" }}
                onClick={() => setTab(t.id)}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: active ? t.grad : "transparent" }}>
                  <t.icon className="w-4 h-4" style={{ color: active ? "white" : "var(--muted-foreground)" }} />
                </div>
                <span className="text-[10px] font-semibold" style={{ color: active ? t.color : "var(--muted-foreground)" }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}

// ─────────────────────────────────────────────────────
// 비밀번호 게이트
// ─────────────────────────────────────────────────────
function AdminGate({ onAuth }: { onAuth: () => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!pw.trim()) return;
    setLoading(true);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", userId: "admin", password: pw }),
      });
      const d = await r.json();
      if (d.ok) {
        localStorage.setItem("ba_token", d.token);
        localStorage.setItem("ba_user", JSON.stringify(d.user));
        sessionStorage.setItem(SESSION_KEY, d.token);
        // 서버 설정 로드
        const sr = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${d.token}` },
          body: JSON.stringify({ action: "loadSettings" }),
        });
        const sd = await sr.json();
        if (sd.ok && sd.settings) {
          Object.entries(sd.settings).forEach(([k, v]) => {
            if (typeof v === "string") localStorage.setItem(`u:admin:${k}`, v);
          });
        }
        // 글로벌 설정 복원
        try {
          const gr = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${d.token}` },
            body: JSON.stringify({ action: "loadAdminGlobalSettings" }),
          });
          const gd = await gr.json();
          if (gd.ok && gd.settings?.admin_custom_list) {
            localStorage.setItem("admin_custom_list", gd.settings.admin_custom_list);
          }
          if (gd.ok && gd.settings?.platform_categories) {
            localStorage.setItem("platform_categories", gd.settings.platform_categories);
          }
        } catch {}
        onAuth();
      } else {
        toast.error("비밀번호가 올바르지 않아요");
        setPw("");
      }
    } catch { toast.error("네트워크 오류"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#080b14", position:"relative", overflow:"hidden" }}>

      {/* ── 화려한 배경 ── */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0 }}>
        {/* 메시 그라데이션 */}
        <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at 15% 15%, rgba(16,185,129,0.3) 0%, transparent 45%), radial-gradient(ellipse at 85% 10%, rgba(99,102,241,0.35) 0%, transparent 45%), radial-gradient(ellipse at 70% 85%, rgba(236,72,153,0.25) 0%, transparent 45%), radial-gradient(ellipse at 10% 80%, rgba(245,158,11,0.2) 0%, transparent 45%), radial-gradient(ellipse at 50% 50%, rgba(6,182,212,0.15) 0%, transparent 55%)" }} />

        {/* 움직이는 오브 */}
        <div style={{ position:"absolute", top:"5%", left:"10%", width:350, height:350, borderRadius:"50%", background:"radial-gradient(circle,rgba(16,185,129,0.4) 0%,transparent 70%)", animation:"sadmin_orb1 9s ease-in-out infinite" }} />
        <div style={{ position:"absolute", top:"15%", right:"5%", width:280, height:280, borderRadius:"50%", background:"radial-gradient(circle,rgba(99,102,241,0.45) 0%,transparent 70%)", animation:"sadmin_orb2 11s ease-in-out infinite" }} />
        <div style={{ position:"absolute", bottom:"10%", left:"15%", width:240, height:240, borderRadius:"50%", background:"radial-gradient(circle,rgba(236,72,153,0.35) 0%,transparent 70%)", animation:"sadmin_orb3 8s ease-in-out infinite" }} />
        <div style={{ position:"absolute", bottom:"20%", right:"15%", width:200, height:200, borderRadius:"50%", background:"radial-gradient(circle,rgba(245,158,11,0.3) 0%,transparent 70%)", animation:"sadmin_orb4 10s ease-in-out infinite" }} />
        <div style={{ position:"absolute", top:"45%", left:"45%", width:180, height:180, borderRadius:"50%", background:"radial-gradient(circle,rgba(6,182,212,0.3) 0%,transparent 70%)", animation:"sadmin_orb5 7s ease-in-out infinite", transform:"translate(-50%,-50%)" }} />

        {/* 격자 패턴 */}
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(16,185,129,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.04) 1px,transparent 1px)", backgroundSize:"50px 50px" }} />

        {/* 빛 기둥 */}
        <div style={{ position:"absolute", top:0, left:"40%", width:2, height:"45%", background:"linear-gradient(180deg,rgba(16,185,129,0.7),transparent)", filter:"blur(1px)", animation:"sadmin_beam1 5s ease-in-out infinite" }} />
        <div style={{ position:"absolute", top:0, left:"60%", width:1, height:"35%", background:"linear-gradient(180deg,rgba(99,102,241,0.6),transparent)", animation:"sadmin_beam2 7s ease-in-out infinite 1s" }} />
        <div style={{ position:"absolute", top:0, left:"25%", width:1, height:"30%", background:"linear-gradient(180deg,rgba(245,158,11,0.5),transparent)", animation:"sadmin_beam2 6s ease-in-out infinite 2s" }} />

        {/* 별 파티클 */}
        {[
          {x:8,y:12,s:3,d:6,dl:0,c:"#6ee7b7"},{x:88,y:8,s:2,d:8,dl:1,c:"#a5b4fc"},
          {x:20,y:82,s:4,d:5,dl:2,c:"#f9a8d4"},{x:78,y:78,s:3,d:9,dl:0.5,c:"#fcd34d"},
          {x:45,y:6,s:2,d:7,dl:1.5,c:"#10b981"},{x:30,y:40,s:3,d:6,dl:3,c:"#6366f1"},
          {x:72,y:45,s:2,d:8,dl:2,c:"#ec4899"},{x:55,y:88,s:4,d:5,dl:1,c:"#f59e0b"},
          {x:15,y:55,s:2,d:9,dl:0.8,c:"#67e8f9"},{x:85,y:55,s:3,d:6,dl:2.5,c:"#6ee7b7"},
          {x:60,y:20,s:2,d:7,dl:1.8,c:"#a5b4fc"},{x:38,y:70,s:3,d:8,dl:0.3,c:"#fcd34d"},
        ].map((p,i)=>(
          <div key={i} style={{ position:"absolute", left:`${p.x}%`, top:`${p.y}%`, width:p.s, height:p.s, borderRadius:"50%", background:p.c, boxShadow:`0 0 ${p.s*4}px ${p.c}`, animation:`sadmin_star ${p.d}s ease-in-out infinite ${p.dl}s` }} />
        ))}

        {/* 수평 글리치 라인 */}
        <div style={{ position:"absolute", top:"38%", left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(16,185,129,0.4),transparent)", animation:"sadmin_line 7s ease-in-out infinite" }} />
        <div style={{ position:"absolute", top:"62%", left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(99,102,241,0.3),transparent)", animation:"sadmin_line 9s ease-in-out infinite 3s" }} />
      </div>

      <style>{`
        @keyframes sadmin_orb1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(50px,-40px) scale(1.15)} 66%{transform:translate(-30px,40px) scale(0.9)} }
        @keyframes sadmin_orb2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-60px,50px) scale(1.2)} 66%{transform:translate(40px,-30px) scale(0.85)} }
        @keyframes sadmin_orb3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(70px,-50px) scale(1.1)} }
        @keyframes sadmin_orb4 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-60px,30px) scale(1.15)} }
        @keyframes sadmin_orb5 { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.4)} }
        @keyframes sadmin_star { 0%,100%{transform:translateY(0) scale(1);opacity:0.7} 50%{transform:translateY(-18px) scale(1.4);opacity:1} }
        @keyframes sadmin_beam1 { 0%,100%{opacity:0.4;transform:translateX(-50%) scaleY(1)} 50%{opacity:0.9;transform:translateX(-50%) scaleY(1.15)} }
        @keyframes sadmin_beam2 { 0%,100%{opacity:0.3} 50%{opacity:0.8} }
        @keyframes sadmin_line { 0%,100%{opacity:0;transform:scaleX(0)} 30%,70%{opacity:1;transform:scaleX(1)} }
        @keyframes sadmin_card { 0%,100%{box-shadow:0 0 30px rgba(16,185,129,0.2),0 0 60px rgba(99,102,241,0.1)} 50%{box-shadow:0 0 50px rgba(16,185,129,0.4),0 0 100px rgba(99,102,241,0.2)} }
        @keyframes sadmin_icon { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-8px) rotate(5deg)} }
        @keyframes sadmin_ring { 0%,100%{transform:scale(1);opacity:0.4} 50%{transform:scale(1.15);opacity:0.8} }
        @keyframes sadmin_border { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
        @keyframes sadmin_in { from{opacity:0;transform:translateY(20px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
      `}</style>

      {/* 탑바 - 유리 효과 */}
      <div style={{ position:"relative", zIndex:10, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 20px", borderBottom:"1px solid rgba(255,255,255,0.08)", background:"rgba(8,11,20,0.6)", backdropFilter:"blur(16px)" }}>
        <button className="flex items-center gap-2 text-sm font-medium opacity-70 hover:opacity-100" style={{ color: "#fff" }} onClick={() => window.location.href = "/"}>
          <Home className="w-4 h-4" /> 홈으로
        </button>
        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981", border:"1px solid rgba(16,185,129,0.3)" }}>운영자 전용</span>
      </div>

      {/* 중앙 카드 */}
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:20, position:"relative", zIndex:1 }}>
        <div style={{ width:"100%", maxWidth:380, animation:"sadmin_in 0.6s cubic-bezier(0.34,1.56,0.64,1) both" }}>

          {/* 카드 글로우 테두리 */}
          <div style={{ position:"relative" }}>
            <div style={{ position:"absolute", inset:-2, borderRadius:26, background:"linear-gradient(135deg,#10b981,#6366f1,#ec4899,#10b981)", backgroundSize:"300% 300%", animation:"sadmin_border 4s linear infinite", zIndex:-1, opacity:0.8 }} />

            <div style={{ background:"rgba(8,11,20,0.85)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:24, padding:"44px 40px", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)", animation:"sadmin_card 4s ease-in-out infinite" }}>

              {/* 아이콘 */}
              <div style={{ textAlign:"center", marginBottom:32 }}>
                <div style={{ position:"relative", display:"inline-block", marginBottom:18 }}>
                  <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto relative"
                    style={{ background:"linear-gradient(135deg, #10b981, #6366f1)", animation:"sadmin_icon 4s ease-in-out infinite", boxShadow:"0 12px 40px rgba(16,185,129,0.5)" }}>
                    <Shield className="w-10 h-10 text-white" />
                    <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: "#f59e0b", boxShadow:"0 4px 12px rgba(245,158,11,0.5)" }}>
                      <Lock className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                  {/* 링 애니메이션 */}
                  <div style={{ position:"absolute", inset:-8, borderRadius:"50%", border:"2px solid rgba(16,185,129,0.4)", animation:"sadmin_ring 2s ease-in-out infinite" }} />
                  <div style={{ position:"absolute", inset:-16, borderRadius:"50%", border:"1px solid rgba(99,102,241,0.25)", animation:"sadmin_ring 2s ease-in-out infinite 0.5s" }} />
                </div>
                <h1 className="text-2xl font-black" style={{ fontFamily:"'Space Grotesk', sans-serif", color:"#fff", letterSpacing:"-0.04em" }}>관리자 인증</h1>
                <p className="text-sm mt-1" style={{ color:"rgba(255,255,255,0.45)" }}>운영자 전용 관리 패널</p>
              </div>

              {/* 입력 + 버튼 — 원본 그대로 */}
              <div className="space-y-4">
                <div className="relative">
                  <Input
                    type={show ? "text" : "password"}
                    placeholder="관리자 비밀번호"
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    className="h-12 pr-12 text-base"
                    name="blogauto-admin-passcode"
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="text"
                    style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", color:"#fff" }}
                  />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 p-1" style={{ color: "rgba(255,255,255,0.4)" }} onClick={() => setShow(v => !v)}>
                    {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <button
                  className="w-full h-12 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95"
                  style={{ background: loading ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #10b981, #6366f1)", boxShadow: loading ? "none" : "0 8px 32px rgba(16,185,129,0.4)" }}
                  onClick={handleSubmit} disabled={loading}>
                  {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                  {loading ? "인증 중..." : "접속하기"}
                </button>
              </div>

              <button className="w-full mt-4 text-sm text-center hover:underline" style={{ color: "rgba(255,255,255,0.35)" }} onClick={() => window.location.href = "/dashboard"}>
                대시보드로 이동
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────
export default function SuperAdminPage() {
  const [authed, setAuthed] = useState(() => {
    const s = sessionStorage.getItem(SESSION_KEY);
    return !!s && !!localStorage.getItem("ba_token");
  });
  if (!authed) return <AdminGate onAuth={() => setAuthed(true)} />;
  return <AdminDashboard />;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 자동발행 관리 — 관리자 전용
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function AutoPublishManager() {
  const [botStatus, setBotStatus] = useState<"online"|"offline"|"checking">("checking");
  const [flowEmail, setFlowEmail] = useState(() => localStorage.getItem("admin_flow_email") || "");
  const [flowPw,    setFlowPw]    = useState(() => localStorage.getItem("admin_flow_pw") || "");
  const [showFlowPw, setShowFlowPw] = useState(false);
  const [history,   setHistory]   = useState<any[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const [activeSection, setActiveSection] = useState<"status"|"flow"|"history">("status");

  useEffect(() => {
    fetch("http://localhost:3333/health", { signal: AbortSignal.timeout(3000) })
      .then(r => setBotStatus(r.ok ? "online" : "offline"))
      .catch(() => setBotStatus("offline"));
    try {
      const h = JSON.parse(localStorage.getItem("blogauto_autopublish_history") || "[]");
      setHistory(Array.isArray(h) ? h : []);
    } catch { setHistory([]); }
  }, []);

  function saveFlow() {
    localStorage.setItem("admin_flow_email", flowEmail);
    localStorage.setItem("admin_flow_pw", flowPw);
    toast.success("Google Flow 계정 저장됨");
  }

  const dotC = botStatus==="online" ? "#03C75A" : botStatus==="offline" ? "#ef4444" : "#f59e0b";
  const dotL = botStatus==="online" ? "온라인" : botStatus==="offline" ? "오프라인" : "확인 중";

  const SECTIONS = [
    { key:"status",  label:"서버 상태",    emoji:"🖥️" },
    { key:"flow",    label:"Flow 계정",    emoji:"🎨" },
    { key:"history", label:"발행 히스토리", emoji:"📋" },
  ] as const;

  const CSS = `
    @keyframes ap-fade  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes ap-spin  { to{transform:rotate(360deg)} }
    @keyframes ap-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(3,199,90,.4)} 50%{box-shadow:0 0 0 6px transparent} }
    @keyframes ap-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
    @keyframes ap-shine { 0%{transform:translateX(-100%) skewX(-15deg)} 100%{transform:translateX(260%) skewX(-15deg)} }
    @keyframes ap-ring  { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2);opacity:0} }
    @keyframes guide-in { from{opacity:0;transform:translateX(100%)} to{opacity:1;transform:translateX(0)} }

    .ap-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      transition: all .2s;
      position: relative;
      overflow: hidden;
    }
    .ap-card::before {
      content:'';
      position:absolute;top:0;left:0;right:0;height:1px;
      background:linear-gradient(90deg,transparent,rgba(3,199,90,.5),transparent);
    }
    .ap-card:hover { border-color:rgba(3,199,90,.25); box-shadow:0 4px 20px rgba(3,199,90,.07); }

    .ap-section-btn {
      flex:1; padding:10px 8px; border-radius:12px; border:none;
      cursor:pointer; transition:all .18s; font-family:'Noto Sans KR',sans-serif;
      font-size:12px; font-weight:600; display:flex; flex-direction:column;
      align-items:center; gap:4px;
    }
    .ap-section-btn.active {
      background:linear-gradient(135deg,rgba(3,199,90,.15),rgba(5,150,105,.1));
      border:1px solid rgba(3,199,90,.4); color:#03C75A;
    }
    .ap-section-btn.inactive {
      background:var(--muted); color:var(--muted-foreground); border:1px solid transparent;
    }
    .ap-section-btn.inactive:hover { background:var(--accent); }

    .ap-primary-btn {
      background:linear-gradient(135deg,#03C75A,#059669);
      color:#000; font-weight:800; border:none; border-radius:12px;
      cursor:pointer; transition:all .18s; position:relative; overflow:hidden;
      display:flex; align-items:center; gap:7px; font-family:'Noto Sans KR',sans-serif;
    }
    .ap-primary-btn::after {
      content:''; position:absolute; inset:0;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);
      animation:ap-shine 2.5s ease-in-out infinite;
    }
    .ap-primary-btn:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(3,199,90,.4); }

    .ap-guide-btn {
      padding:7px 14px; border-radius:11px; border:none; cursor:pointer;
      background:linear-gradient(135deg,#f59e0b,#d97706);
      color:#000; font-weight:800; font-size:12px;
      font-family:'Noto Sans KR',sans-serif;
      display:flex; align-items:center; gap:6px;
      box-shadow:0 4px 12px rgba(245,158,11,.35);
      overflow:hidden; position:relative; transition:all .2s;
    }
    .ap-guide-btn::after {
      content:''; position:absolute; inset:0;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);
      animation:ap-shine 2s ease-in-out infinite;
    }
    .ap-guide-btn:hover { transform:translateY(-1px); box-shadow:0 8px 20px rgba(245,158,11,.5); }

    .ap-guide-panel {
      position:fixed; top:0; right:0; bottom:0; width:min(420px,100vw);
      background:var(--background); border-left:1px solid var(--border);
      z-index:10000; overflow-y:auto; padding:24px;
      animation:guide-in .3s ease both;
      box-shadow:-8px 0 40px rgba(0,0,0,.15);
    }

    @media(max-width:768px) {
      .ap-grid { grid-template-columns:1fr !important; }
      .ap-guide-panel { width:100vw; }
    }
  `;

  return (
    <>
      <style>{CSS}</style>

      {/* 사용설명서 패널 */}
      {showGuide && (
        <div className="ap-guide-panel">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{
                width:36,height:36,borderRadius:10,
                background:"linear-gradient(135deg,#f59e0b,#d97706)",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="white"/>
                </svg>
              </div>
              <h2 style={{fontSize:16,fontWeight:800,color:"var(--foreground)",margin:0}}>사용 설명서</h2>
            </div>
            <button onClick={()=>setShowGuide(false)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--muted-foreground)",padding:4}}>
              <X className="w-5 h-5"/>
            </button>
          </div>

          {[
            {
              step:"STEP 1", title:"봇 서버 실행 (관리자 PC)", color:"#03C75A",
              items:[
                { text:"터미널 열기 → 프로젝트 루트에서 cd naver-bot 입력", highlight:true },
                { text:"최초 1회: npm install 실행", highlight:false },
                { text:"최초 1회: npx playwright install chromium 실행", highlight:false },
                { text:".env 파일에 구글 계정 입력 후 저장", highlight:true },
                { text:"npm run dev 실행 → 서버 종료하면 안됨", highlight:true },
                { text:"이 페이지 상단 봇 서버 온라인 상태 확인", highlight:false },
              ]
            },
            {
              step:"STEP 2", title:"네이버/티스토리 계정 연결", color:"#03C75A",
              items:[
                { text:"일반 자동발행 페이지(/naver) → 계정 관리 탭 이동", highlight:true },
                { text:"관리자 본인 네이버 아이디/비번 입력 후 계정 추가", highlight:false },
                { text:"연결 버튼 클릭 → 브라우저 자동 로그인 진행", highlight:true },
                { text:"2단계 인증 있으면 직접 처리 후 자동 진행", highlight:false },
                { text:"티스토리도 동일하게 진행", highlight:false },
              ]
            },
            {
              step:"STEP 3", title:"Google Flow 계정 설정 (이미지 생성)", color:"#4285F4",
              items:[
                { text:"이 페이지 자동발행 탭 → Flow 계정 탭 클릭", highlight:true },
                { text:"관리자 구글 이메일/비밀번호 입력 후 저장", highlight:true },
                { text:"최초 발행 시 브라우저가 열리며 구글 로그인 진행", highlight:false },
                { text:"2단계 인증 있으면 직접 처리 후 자동 저장", highlight:false },
              ]
            },
            {
              step:"STEP 4", title:"글 작성 및 자동 발행", color:"#f59e0b",
              items:[
                { text:"일반 자동발행 페이지(/naver) → 글 생성 탭 이동", highlight:true },
                { text:"키워드 입력 → 플랫폼 선택 → 글 생성 클릭", highlight:true },
                { text:"생성된 글 확인/수정 후 발행하기로 넘기기 클릭", highlight:false },
                { text:"발행하기 탭 → 계정 선택 → 자동 발행 클릭", highlight:true },
                { text:"브라우저가 자동으로 열려서 글 발행 완료", highlight:false },
              ]
            },
            {
              step:"STEP 5", title:"발행 현황 모니터링", color:"#a78bfa",
              items:[
                { text:"히스토리 탭에서 전체 발행 내역 확인", highlight:false },
                { text:"실패 건은 빨간색 표시 → 원인 확인 후 재발행", highlight:true },
                { text:"봇 서버 오프라인 시 npm run dev 재실행", highlight:true },
                { text:"발행된 글 URL 클릭해서 직접 확인 가능", highlight:false },
              ]
            },
          ].map((section, i) => (
            <div key={i} style={{
              marginBottom:16, padding:"16px 18px", borderRadius:14,
              background:"var(--card)", border:`1px solid ${section.color}30`,
              animation:`ap-fade .3s ease ${i*.08}s both`,
            }}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={{
                  fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:99,
                  background:`${section.color}20`,color:section.color,letterSpacing:".05em",
                }}>{section.step}</span>
                <span style={{fontSize:13,fontWeight:700,color:"var(--foreground)"}}>{section.title}</span>
              </div>
              {section.items.map((item: any, j: number) => (
                <div key={j} style={{
                  display:"flex",alignItems:"flex-start",gap:8,marginBottom:6,
                  padding:item.highlight?"7px 10px":"3px 0",
                  borderRadius:item.highlight?8:0,
                  background:item.highlight?`${section.color}12`:"transparent",
                }}>
                  <div style={{
                    width:16,height:16,borderRadius:"50%",flexShrink:0,marginTop:2,
                    background:`${section.color}20`,border:`1px solid ${section.color}40`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:8,fontWeight:800,color:section.color,
                  }}>{j+1}</div>
                  <span style={{fontSize:12,lineHeight:1.5,
                    color:item.highlight?"var(--foreground)":"var(--muted-foreground)",
                    fontWeight:item.highlight?600:400,
                  }}>{item.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}



      {/* 메인 콘텐츠 */}
      <div style={{paddingBottom:120,animation:"ap-fade .35s ease both"}}>

        {/* 상단 타이틀 */}
        <div style={{
          display:"flex",alignItems:"center",gap:14,
          marginBottom:20,
          padding:"18px 20px",borderRadius:20,
          background:"linear-gradient(135deg,rgba(3,199,90,.08),rgba(5,150,105,.04))",
          border:"1px solid rgba(3,199,90,.2)",
          position:"relative",overflow:"hidden",
        }}>
          {/* 배경 SVG 데코 */}
          <svg style={{position:"absolute",right:-20,top:-20,opacity:.06,pointerEvents:"none"}} width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#03C75A" strokeWidth="2"/>
            <circle cx="60" cy="60" r="35" fill="none" stroke="#03C75A" strokeWidth="1.5"/>
            <circle cx="60" cy="60" r="20" fill="none" stroke="#03C75A" strokeWidth="1"/>
            <line x1="10" y1="60" x2="110" y2="60" stroke="#03C75A" strokeWidth="1"/>
            <line x1="60" y1="10" x2="60" y2="110" stroke="#03C75A" strokeWidth="1"/>
          </svg>

          <div style={{
            width:46,height:46,borderRadius:14,flexShrink:0,
            background:"linear-gradient(135deg,#03C75A,#059669)",
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:"0 0 20px rgba(3,199,90,.4)",
            animation:"ap-float 3s ease-in-out infinite",
          }}>
            <Zap className="w-5 h-5" style={{color:"#000"}}/>
          </div>
          <div>
            <h2 style={{
              fontSize:18,fontWeight:800,margin:0,
              color:"var(--foreground)",
              fontFamily:"'Space Grotesk',sans-serif",
            }}>자동 발행 관리</h2>
            <p style={{fontSize:11,color:"var(--muted-foreground)",margin:"3px 0 0"}}>
              네이버 블로그 · 티스토리 매크로 자동발행 관리자 패널
            </p>
          </div>

          {/* 봇 상태 표시 */}
          <div style={{
            marginLeft:"auto",display:"flex",alignItems:"center",gap:7,
            padding:"8px 14px",borderRadius:12,
            background:botStatus==="online"?"rgba(3,199,90,.1)":"rgba(255,255,255,.05)",
            border:`1px solid ${dotC}40`,
          }}>
            <div style={{
              width:8,height:8,borderRadius:"50%",background:dotC,
              animation:botStatus==="online"?"ap-pulse 2s infinite":"none",
            }}/>
            <span style={{fontSize:12,fontWeight:700,color:dotC}}>{dotL}</span>
          </div>
        </div>

        {/* 섹션 탭 */}
        <div style={{display:"flex",gap:8,marginBottom:18}}>
          {SECTIONS.map(s=>(
            <button key={s.key}
              className={`ap-section-btn ${activeSection===s.key?"active":"inactive"}`}
              onClick={()=>setActiveSection(s.key as any)}>
              <span style={{fontSize:18}}>{s.emoji}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        {/* ── 서버 상태 ── */}
        {activeSection==="status" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,animation:"ap-fade .3s ease both"}}
            className="ap-grid">
            {[
              {label:"봇 서버",       ok:botStatus==="online", sub:"localhost:3333", icon:"🖥️"},
              {label:"네이버 세션",   ok:!!localStorage.getItem("blogauto_autopublish_accounts"), sub:"계정 연결 상태", icon:"🟢"},
              {label:"티스토리",      ok:!!localStorage.getItem("blogauto_autopublish_accounts"), sub:"계정 연결 상태", icon:"🟠"},
              {label:"Google Flow",  ok:!!localStorage.getItem("admin_flow_email"), sub:"이미지 생성", icon:"🎨"},
            ].map((item,i)=>(
              <div key={i} className="ap-card" style={{padding:"18px 20px",animation:`ap-fade .3s ease ${i*.07}s both`}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                  <span style={{fontSize:22}}>{item.icon}</span>
                  <div style={{
                    display:"flex",alignItems:"center",gap:5,
                    padding:"4px 10px",borderRadius:99,
                    background:item.ok?"rgba(3,199,90,.12)":"rgba(239,68,68,.12)",
                  }}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:item.ok?"#03C75A":"#ef4444",
                      animation:item.ok?"ap-pulse 2s infinite":"none"}}/>
                    <span style={{fontSize:10,fontWeight:700,color:item.ok?"#03C75A":"#ef4444"}}>
                      {item.ok?"정상":"미연결"}
                    </span>
                  </div>
                </div>
                <p style={{fontSize:14,fontWeight:700,color:"var(--foreground)",margin:"0 0 3px"}}>{item.label}</p>
                <p style={{fontSize:11,color:"var(--muted-foreground)",margin:0}}>{item.sub}</p>
              </div>
            ))}

            {/* 전체 상태 요약 */}
            <div className="ap-card" style={{
              padding:"18px 20px",gridColumn:"1/-1",
              background:"linear-gradient(135deg,rgba(3,199,90,.06),rgba(5,150,105,.03))",
              animation:"ap-fade .3s ease .28s both",
            }}>
              <p style={{fontSize:13,fontWeight:700,color:"var(--foreground)",margin:"0 0 10px",display:"flex",alignItems:"center",gap:6}}>
                <Activity className="w-4 h-4" style={{color:"#03C75A"}}/> 봇 서버 실행 방법
              </p>
              <div style={{
                background:"rgba(0,0,0,.4)",borderRadius:10,padding:"12px 14px",
                fontFamily:"monospace",fontSize:12,color:"#03C75A",lineHeight:2,
              }}>
                <div><span style={{color:"rgba(255,255,255,.4)"}}>$</span> cd naver-bot</div>
                <div><span style={{color:"rgba(255,255,255,.4)"}}>$</span> npm install</div>
                <div><span style={{color:"rgba(255,255,255,.4)"}}>$</span> npx playwright install chromium</div>
                <div><span style={{color:"rgba(255,255,255,.4)"}}>$</span> npm run dev</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Flow 계정 ── */}
        {activeSection==="flow" && (
          <div style={{animation:"ap-fade .3s ease both"}}>
            <div className="ap-card" style={{padding:"22px"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
                <div style={{
                  width:36,height:36,borderRadius:10,
                  background:"linear-gradient(135deg,#4285F4,#34A853)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:16,fontWeight:900,color:"white",
                }}>G</div>
                <div>
                  <p style={{fontSize:14,fontWeight:700,color:"var(--foreground)",margin:0}}>Google Flow 공용 계정</p>
                  <p style={{fontSize:11,color:"var(--muted-foreground)",margin:0}}>이미지 자동 생성에 사용되는 관리자 계정</p>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}} className="ap-grid">
                <div>
                  <label style={{fontSize:11,fontWeight:700,color:"var(--muted-foreground)",display:"block",marginBottom:6}}>구글 이메일</label>
                  <Input value={flowEmail} onChange={e=>setFlowEmail(e.target.value)}
                    placeholder="admin@gmail.com" className="text-sm h-10"/>
                </div>
                <div>
                  <label style={{fontSize:11,fontWeight:700,color:"var(--muted-foreground)",display:"block",marginBottom:6}}>구글 비밀번호</label>
                  <div style={{position:"relative"}}>
                    <Input type={showFlowPw?"text":"password"} value={flowPw}
                      onChange={e=>setFlowPw(e.target.value)}
                      placeholder="••••••••" className="text-sm h-10 pr-10"/>
                    <button onClick={()=>setShowFlowPw(v=>!v)}
                      style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",
                        background:"none",border:"none",cursor:"pointer",color:"var(--muted-foreground)"}}>
                      {showFlowPw?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
                    </button>
                  </div>
                </div>
              </div>

              <button className="ap-primary-btn" style={{padding:"11px 22px",fontSize:13}} onClick={saveFlow}>
                <Save className="w-4 h-4" style={{position:"relative",zIndex:1}}/>
                <span style={{position:"relative",zIndex:1}}>저장</span>
              </button>

              <div style={{
                marginTop:14,padding:"12px 14px",borderRadius:12,
                background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",
                fontSize:11,color:"var(--muted-foreground)",lineHeight:1.7,
              }}>
                ⚠️ naver-bot/.env 파일의 GOOGLE_FLOW_EMAIL / GOOGLE_FLOW_PASSWORD 와 동일하게 설정하세요.<br/>
                최초 로그인 시 브라우저가 열리며 2단계 인증이 있으면 수동으로 처리해주세요.
              </div>
            </div>
          </div>
        )}

        {/* ── 발행 히스토리 ── */}
        {activeSection==="history" && (
          <div style={{animation:"ap-fade .3s ease both"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <span style={{fontSize:13,color:"var(--muted-foreground)"}}>총 {history.length}건</span>
              {history.length>0 && (
                <button
                  style={{
                    fontSize:11,padding:"6px 12px",borderRadius:10,cursor:"pointer",fontWeight:600,
                    background:"rgba(239,68,68,.1)",color:"#ef4444",
                    border:"1px solid rgba(239,68,68,.2)",display:"flex",alignItems:"center",gap:5,
                  }}
                  onClick={()=>{
                    if(!confirm("히스토리를 초기화할까요?"))return;
                    localStorage.removeItem("blogauto_autopublish_history");
                    setHistory([]);
                    toast.success("초기화됨");
                  }}>
                  <Trash2 className="w-3 h-3"/>초기화
                </button>
              )}
            </div>

            {history.length===0 ? (
              <div className="ap-card" style={{padding:"60px",textAlign:"center"}}>
                <Activity className="w-8 h-8" style={{color:"var(--muted-foreground)",margin:"0 auto 10px"}}/>
                <p style={{fontSize:13,color:"var(--muted-foreground)"}}>발행 기록 없음</p>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {history.slice(0,50).map((h:any,i:number)=>(
                  <div key={i} className="ap-card" style={{
                    padding:"14px 18px",
                    animation:`ap-fade .3s ease ${i*.04}s both`,
                    borderColor:h.status==="success"?"rgba(3,199,90,.2)":h.status==="fail"?"rgba(239,68,68,.2)":"var(--border)",
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                      <span style={{fontSize:18}}>{h.platform==="naver"?"🟢":"🟠"}</span>
                      <div style={{flex:1,minWidth:120}}>
                        <p style={{fontSize:13,fontWeight:600,color:"var(--foreground)",margin:"0 0 3px",
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</p>
                        <p style={{fontSize:11,color:"var(--muted-foreground)",margin:0,display:"flex",alignItems:"center",gap:6}}>
                          <span>{h.account}</span>
                          <span>·</span>
                          <span>{new Date(h.publishedAt).toLocaleString("ko-KR")}</span>
                        </p>
                        {h.error && <p style={{fontSize:11,color:"#ef4444",margin:"3px 0 0"}}>❌ {h.error}</p>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <span style={{
                          fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,
                          background:h.status==="success"?"rgba(3,199,90,.12)":h.status==="fail"?"rgba(239,68,68,.12)":"rgba(245,158,11,.12)",
                          color:h.status==="success"?"#03C75A":h.status==="fail"?"#ef4444":"#f59e0b",
                        }}>
                          {h.status==="success"?"✅ 완료":h.status==="fail"?"❌ 실패":"⏳ 진행"}
                        </span>
                        {h.url && (
                          <a href={h.url} target="_blank" rel="noopener noreferrer"
                            style={{fontSize:10,color:"var(--muted-foreground)",textDecoration:"none",
                              display:"flex",alignItems:"center",gap:3,
                              padding:"3px 9px",borderRadius:99,
                              background:"var(--muted)",border:"1px solid var(--border)"}}>
                            <Globe className="w-3 h-3"/>보기
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      {/* Publy 탭 */}
      {tab === "publy" && (
        <div style={{padding:"6px 0"}}>
          <PublyWidget />
        </div>
      )}
      </div>
    </>
  );
}
