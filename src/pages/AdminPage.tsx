import { useState, useEffect, useCallback } from "react";
import { supabase, getAccounts, upsertAccount, PublyAccount } from "../lib/supabase";

interface Props {
  onBack: () => void;
  onDashboard: () => void;
  theme: "dark" | "light";
  onThemeToggle: () => void;
}

interface UserFull {
  id:string; email:string; name:string; plan:string; is_active:boolean; created_at:string; phone?:string; memo?:string;
  quota?: { total_quota:number; used_quota:number; remaining_quota:number; reset_date:string; };
  payments?: any[]; notes?: any[]; history_count?: number;
}


const ADM_GUIDE_STEPS = [
  {title:"봇 서버 실행", color:"#00c875", items:["터미널 → cd naver-bot","npm run dev 실행","이 페이지 상단 서버 온라인 확인"]},
  {title:"관리자 자동발행", color:"#f59e0b", items:["자동발행 탭 → 계정 관리에서 계정 추가","계정 연결 버튼 클릭","글 생성 탭에서 키워드로 글 생성","발행하기 탭에서 자동 발행"]},
  {title:"회원 관리", color:"#4285F4", items:["회원관리 탭에서 회원 클릭","등급/건수/만료일 수정 후 저장","결제 내역 및 메모 추가 가능"]},
  {title:"서버 점검", color:"#a78bfa", items:["봇 오프라인 시 npm run dev 재실행","실패 건은 히스토리에서 확인","API 키 오류 시 설정 탭에서 재입력"]},
];


const GEMINI_MODELS_ADM = ["gemini-2.0-flash","gemini-2.0-flash-lite","gemini-2.5-flash","gemini-2.5-flash-lite"];

const ADM_WRITE_AI = [
  {id:"gemini",label:"Gemini Flash",sub:"Google AI · 무료",placeholder:"AIza...",storageKey:"publy_gemini_key",link:"https://aistudio.google.com/app/apikey",color:"#4285F4",logo:"G",free:true},
  {id:"groq",label:"Groq (Llama 3)",sub:"초고속 · 무료",placeholder:"gsk_...",storageKey:"publy_groq_key",link:"https://console.groq.com/keys",color:"#F55036",logo:"L",free:true},
  {id:"openai",label:"OpenAI GPT-4",sub:"글쓰기 최강",placeholder:"sk-...",storageKey:"publy_openai_key",link:"https://platform.openai.com/api-keys",color:"#10A37F",logo:"O",free:false},
];

const ADM_IMAGE_AI = [
  {id:"openai_img",label:"OpenAI DALL-E",sub:"이미지 생성+분석",placeholder:"sk-...",storageKey:"publy_openai_key",link:"https://platform.openai.com/api-keys",color:"#10A37F",logo:"O",free:false},
  {id:"replicate",label:"Replicate (Flux)",sub:"고품질 이미지",placeholder:"r8_...",storageKey:"publy_replicate_key",link:"https://replicate.com/account/api-tokens",color:"#8B5CF6",logo:"R",free:false},
];

function AdmAICard({item,selected,onClick}:{item:any,selected:boolean,onClick:()=>void}){
  return(
    <button onClick={onClick} style={{
      flex:1,padding:"12px 10px",borderRadius:14,cursor:"pointer",
      fontFamily:"'Noto Sans KR',sans-serif",textAlign:"left",
      border:`2px solid ${selected?item.color:"var(--b)"}`,
      background:selected?`${item.color}15`:"var(--ib)",
      transform:selected?"translateY(-4px) scale(1.04)":"translateY(0) scale(1)",
      boxShadow:selected?`0 10px 24px ${item.color}35`:"none",
      transition:"all .25s cubic-bezier(.34,1.56,.64,1)",
      position:"relative",overflow:"hidden",
    }}>
      {selected&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${item.color},transparent)`}}/>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
        <div style={{width:28,height:28,borderRadius:8,background:selected?item.color:`${item.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:selected?"#000":item.color,transition:"all .2s"}}>{item.logo}</div>
        {selected
          ?<span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:item.color,color:"#000"}}>✓ 선택됨</span>
          :<span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:99,background:item.free?"rgba(0,200,117,.15)":"rgba(245,158,11,.15)",color:item.free?"#00c875":"#f59e0b"}}>{item.free?"무료":"유료"}</span>
        }
      </div>
      <div style={{fontSize:11,fontWeight:700,color:selected?item.color:"var(--t)"}}>{item.label}</div>
      <div style={{fontSize:9,color:"var(--m)",marginTop:2}}>{item.sub}</div>
    </button>
  );
}

function AdmKeyInput({k}:{k:any}){
  const [val,setVal]=useState(()=>localStorage.getItem(k.storageKey)||"");
  const [show,setShow]=useState(false);
  const [saved,setSaved]=useState(false);
  const [testing,setTesting]=useState(false);
  const [testMsg,setTestMsg]=useState("");

  function save(){
    if(!val.trim()){setTestMsg("❌ 키 입력 필요");return;}
    localStorage.setItem(k.storageKey,val.trim());
    setSaved(true);setTestMsg("✅ 저장됨");
    setTimeout(()=>{setSaved(false);setTestMsg("");},3000);
  }

  async function testKey(){
    if(!val.trim()){setTestMsg("❌ 키 입력 필요");return;}
    setTesting(true);setTestMsg("");
    try{
      if(k.id==="gemini"){
        for(const model of GEMINI_MODELS_ADM){
          const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+val.trim(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"hi"}]}],generationConfig:{maxOutputTokens:10}}),signal:AbortSignal.timeout(8000)});
          if(r.ok){setTestMsg("✅ 연결 성공 ("+model+")");break;}
          if(r.status===401||r.status===403){setTestMsg("❌ API 키 오류");break;}
        }
      } else if(k.id==="groq"){
        const r=await fetch("https://api.groq.com/openai/v1/models",{headers:{"Authorization":"Bearer "+val.trim()},signal:AbortSignal.timeout(8000)});
        setTestMsg(r.ok?"✅ Groq 연결 성공":"❌ 연결 실패");
      } else if(k.id==="openai"||k.id==="openai_img"){
        const r=await fetch("https://api.openai.com/v1/models",{headers:{"Authorization":"Bearer "+val.trim()},signal:AbortSignal.timeout(8000)});
        setTestMsg(r.ok?"✅ OpenAI 연결 성공":"❌ 연결 실패");
      } else {
        setTestMsg("저장 후 실제 생성으로 테스트");
      }
    }catch(e:any){setTestMsg("❌ "+e.message);}
    finally{setTesting(false);}
  }

  return(
    <div style={{padding:"12px 14px",borderRadius:12,border:`1px solid ${val?"rgba(245,158,11,.3)":"var(--b)"}`,background:"var(--bg)",marginBottom:8,transition:"border-color .2s"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{width:24,height:24,borderRadius:6,background:k.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#000"}}>{k.logo}</div>
          <div><div style={{fontSize:11,fontWeight:700,color:"var(--t)"}}>{k.label}</div><div style={{fontSize:9,color:"var(--m)"}}>{k.sub}</div></div>
          {val&&<span style={{fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:99,background:"var(--ad)",color:"var(--a)"}}>입력됨</span>}
        </div>
        <a href={k.link} target="_blank" rel="noopener noreferrer" style={{fontSize:9,fontWeight:700,color:k.color,textDecoration:"none",padding:"3px 8px",borderRadius:7,border:"1px solid "+k.color+"30",background:k.color+"10"}}>🔗 발급</a>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:6}}>
        <div style={{flex:1,position:"relative"}}>
          <input type={show?"text":"password"} placeholder={k.placeholder} value={val}
            onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}
            style={{width:"100%",padding:"8px 30px 8px 10px",borderRadius:8,border:"1px solid var(--ib2)",background:"var(--ib)",color:"var(--t)",fontSize:11,fontFamily:"'JetBrains Mono',monospace",outline:"none"}}/>
          <button onClick={()=>setShow(v=>!v)} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--m)",fontSize:11}}>{show?"🙈":"👁️"}</button>
        </div>
        <button onClick={save} style={{padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:800,fontSize:10,fontFamily:"'Noto Sans KR',sans-serif",background:saved?"var(--a)":"var(--ad)",color:saved?"#000":"var(--a)",flexShrink:0}}>{saved?"✅ 저장":"💾 저장"}</button>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <button onClick={testKey} disabled={testing} style={{padding:"4px 10px",borderRadius:7,border:"1px solid "+k.color+"30",background:k.color+"10",color:k.color,fontSize:9,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
          {testing&&<span style={{width:8,height:8,borderRadius:"50%",border:"2px solid "+k.color+"40",borderTopColor:k.color,animation:"as 1s linear infinite",display:"inline-block"}}/>}
          🔌 테스트
        </button>
        {testMsg&&<span style={{fontSize:9,color:testMsg.includes("✅")?"var(--s)":"var(--d)"}}>{testMsg}</span>}
      </div>
    </div>
  );
}

function AdminApiKeySettings(){
  const [writeAI,setWriteAI]=useState(()=>localStorage.getItem("publy_write_ai")||"gemini");
  const [imageAI,setImageAI]=useState(()=>localStorage.getItem("publy_image_ai")||"openai_img");

  return(
    <div style={{marginBottom:14}}>
      {/* 글쓰기 AI 선택 */}
      <div className="acd" style={{padding:"16px 18px",marginBottom:12}}>
        <div className="asl2">🤖 글쓰기 AI 선택</div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {ADM_WRITE_AI.map(item=>(
            <AdmAICard key={item.id} item={item} selected={writeAI===item.id} onClick={()=>{setWriteAI(item.id);localStorage.setItem("publy_write_ai",item.id);}}/>
          ))}
        </div>
        <div className="asl2">🖼️ 이미지 AI 선택</div>
        <div style={{display:"flex",gap:8}}>
          {ADM_IMAGE_AI.map(item=>(
            <AdmAICard key={item.id} item={item} selected={imageAI===item.id} onClick={()=>{setImageAI(item.id);localStorage.setItem("publy_image_ai",item.id);}}/>
          ))}
        </div>
      </div>

      {/* 글쓰기 키 */}
      <div className="acd" style={{padding:"16px 18px",marginBottom:12}}>
        <div className="asl2" style={{color:"var(--a)"}}>📝 글쓰기 API 키</div>
        {ADM_WRITE_AI.map(k=><AdmKeyInput key={k.id} k={k}/>)}
      </div>

      {/* 이미지 키 */}
      <div className="acd" style={{padding:"16px 18px",marginBottom:12}}>
        <div className="asl2" style={{color:"#8B5CF6"}}>🖼️ 이미지 API 키</div>
        <div style={{display:"flex",alignItems:"center",gap:7,padding:"8px 11px",borderRadius:9,background:"rgba(16,163,127,.1)",border:"1px solid rgba(16,163,127,.25)",marginBottom:10}}>
          <span style={{fontSize:13}}>💡</span>
          <span style={{fontSize:10,color:"#10A37F",fontWeight:600,lineHeight:1.5}}>
            <strong>OpenAI 키는 글쓰기 + 이미지 생성을 하나의 키로 사용 가능합니다.</strong><br/>
            <span style={{fontWeight:400,color:"var(--m)"}}>글쓰기에 입력한 OpenAI 키를 그대로 사용하세요. 따로 발급 불필요.</span>
          </span>
        </div>
        {ADM_IMAGE_AI.map(k=><AdmKeyInput key={k.id} k={k}/>)}
      </div>
    </div>
  );
}


const BOT = "http://localhost:3333";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;}
@keyframes af{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes as{to{transform:rotate(360deg)}}
@keyframes ag{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.35)}50%{box-shadow:0 0 0 8px rgba(245,158,11,0)}}
@keyframes ab{from{width:0}to{width:var(--w,100%)}}
@keyframes am{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
@keyframes asc{0%{top:-5%}100%{top:105%}}
@keyframes abl{0%,100%{opacity:1}50%{opacity:.3}}

.ar.dark{--bg:#060804;--bg2:#080b05;--c:rgba(245,158,11,.04);--c2:rgba(245,158,11,.07);--b:rgba(245,158,11,.12);--b2:rgba(245,158,11,.3);--t:#fffbf0;--m:rgba(255,251,240,.45);--a:#f59e0b;--a2:#d97706;--ad:rgba(245,158,11,.12);--hb:rgba(6,8,4,.92);--nb:rgba(8,11,5,.95);--ib:rgba(245,158,11,.06);--ib2:rgba(245,158,11,.15);--d:#ef4444;--s:#00c875;--i:#4285F4;--gd:rgba(0,255,136,.1);--g:rgba(0,255,136,1)}
.ar.light{--bg:#fffbf0;--bg2:#fef9e7;--c:rgba(255,255,255,.92);--c2:rgba(255,255,255,.98);--b:rgba(180,120,0,.1);--b2:rgba(180,120,0,.25);--t:#1a1200;--m:rgba(26,18,0,.5);--a:#b45309;--a2:#92400e;--ad:rgba(180,83,9,.1);--hb:rgba(255,251,240,.95);--nb:rgba(254,249,231,.97);--ib:rgba(180,83,9,.05);--ib2:rgba(180,83,9,.15);--d:#dc2626;--s:#059669;--i:#2563eb;--gd:rgba(0,150,80,.1);--g:#059669}
.ar{width:100vw;height:100vh;overflow:hidden;display:flex;flex-direction:column;font-family:'Noto Sans KR',sans-serif;color:var(--t);background:var(--bg);transition:background .3s;}
*::-webkit-scrollbar{width:4px;}*::-webkit-scrollbar-thumb{background:rgba(245,158,11,.2);border-radius:99px;}
.adm-guide-overlay{position:fixed;top:56px;right:0;bottom:0;width:min(400px,100vw);z-index:1000;overflow-y:auto;padding:22px;border-left:1px solid var(--b);animation:adm-slide-in .3s ease both;}
.ar.dark .adm-guide-overlay{background:#080b05;box-shadow:-16px 0 48px rgba(0,0,0,.6);}
.ar.light .adm-guide-overlay{background:#ffffff;box-shadow:-16px 0 32px rgba(0,0,0,.1);}
.adm-guide-float{position:fixed;bottom:88px;right:20px;z-index:99;padding:10px 16px;border-radius:99px;border:none;cursor:pointer;font-weight:800;font-size:12px;font-family:'Noto Sans KR',sans-serif;display:flex;align-items:center;gap:7px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;box-shadow:0 6px 20px rgba(245,158,11,.4);animation:ag 3s ease-in-out infinite;transition:all .2s;}
.adm-guide-float:hover{transform:translateY(-3px);box-shadow:0 10px 28px rgba(245,158,11,.55);}
@media(min-width:769px){.adm-guide-float{bottom:28px;}}
.asc{position:fixed;left:0;right:0;height:1px;pointer-events:none;z-index:0;background:linear-gradient(90deg,transparent,rgba(245,158,11,.15),transparent);animation:asc 12s linear infinite;}
.ah{height:56px;flex-shrink:0;display:flex;align-items:center;padding:0 20px;gap:12px;background:var(--hb);border-bottom:1px solid var(--b);backdrop-filter:blur(24px);position:relative;z-index:30;}
.al{font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:.22em;background:linear-gradient(135deg,var(--a),var(--a2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.ali{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--a),var(--a2));display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px var(--ad);flex-shrink:0;}
.arc{font-size:9px;font-weight:800;padding:3px 9px;border-radius:99px;letter-spacing:.12em;background:var(--ad);color:var(--a);border:1px solid var(--b2);animation:ag 2.5s infinite;}
.ahr{margin-left:auto;display:flex;align-items:center;gap:8px;}
.abh{display:flex;align-items:center;gap:7px;padding:7px 14px;border-radius:11px;border:1px solid;cursor:pointer;font-size:12px;font-weight:700;font-family:'Noto Sans KR',sans-serif;transition:all .2s;}
.abg{border-color:rgba(0,255,136,.3);background:var(--gd);color:var(--g);}
.abg:hover{transform:translateX(-2px);box-shadow:0 4px 14px rgba(0,200,100,.2);}
.abm{border-color:var(--b);background:var(--c);color:var(--m);}
.abm:hover{color:var(--t);border-color:var(--b2);}
.aib{width:36px;height:36px;border-radius:11px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;border:1px solid var(--b);background:var(--c);transition:all .2s;}
.aib:hover{border-color:var(--b2);transform:scale(1.08);}
.abdy{flex:1;display:flex;overflow:hidden;}
.asb{width:200px;flex-shrink:0;background:var(--nb);border-right:1px solid var(--b);display:flex;flex-direction:column;padding:12px 10px;gap:3px;overflow-y:auto;}
.an{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;border:none;cursor:pointer;width:100%;font-size:13px;font-weight:500;font-family:'Noto Sans KR',sans-serif;color:var(--m);background:transparent;transition:all .18s;text-align:left;position:relative;}
.an:hover{background:var(--c2);color:var(--t);}
.an.active{background:var(--ad);color:var(--a);font-weight:700;border:1px solid var(--b2);}
.an.active::before{content:'';position:absolute;left:0;top:20%;bottom:20%;width:3px;border-radius:99px;background:var(--a);box-shadow:0 0 8px var(--a);}
.ani{font-size:16px;flex-shrink:0;}
.anbg{margin-left:auto;font-size:9px;font-weight:800;padding:2px 6px;border-radius:99px;background:var(--ad);color:var(--a);}
.aco{flex:1;overflow-y:auto;padding:20px;}
.acd{background:var(--c);border:1px solid var(--b);border-radius:16px;position:relative;overflow:hidden;transition:all .2s;}
.acd::before{content:'';position:absolute;top:0;left:20%;right:20%;height:1px;background:linear-gradient(90deg,transparent,var(--b2),transparent);}
.acd:hover{border-color:var(--b2);}
.asg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;}
.ast{padding:16px 16px 14px;border-radius:14px;border:1px solid var(--b);background:var(--c);animation:af .3s ease both;transition:all .2s;}
.ast:hover{border-color:var(--b2);transform:translateY(-2px);}
.asv{font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:.05em;}
.asl{font-size:9px;color:var(--m);margin-top:2px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;}
.ainp{padding:9px 12px;border-radius:10px;font-size:12px;font-family:'Noto Sans KR',sans-serif;outline:none;transition:all .2s;background:var(--ib);border:1px solid var(--ib2);color:var(--t);}
.ainp:focus{border-color:var(--b2)!important;box-shadow:0 0 0 3px var(--ad)!important;}
.ainp::placeholder{color:var(--m);}
select.ainp{appearance:auto;}.dark select.ainp{color-scheme:dark;}.light select.ainp{color-scheme:light;}
.abp{padding:8px 15px;border:none;border-radius:10px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;font-weight:800;font-size:12px;background:linear-gradient(135deg,var(--a),var(--a2));color:#000;display:flex;align-items:center;gap:5px;transition:all .2s;}
.abp:hover{transform:translateY(-1px);box-shadow:0 5px 16px var(--ad);}
.abp:disabled{opacity:.4;cursor:not-allowed;transform:none;}
.abs{padding:5px 11px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:700;font-family:'Noto Sans KR',sans-serif;transition:all .15s;display:flex;align-items:center;gap:4px;}
.abd{background:rgba(239,68,68,.12);color:var(--d);border:1px solid rgba(239,68,68,.2);}
.abd:hover{background:rgba(239,68,68,.2);}
.abs2{background:rgba(0,200,117,.12);color:var(--s);border:1px solid rgba(0,200,117,.2);}
.abs2:hover{background:rgba(0,200,117,.2);}
.api{font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;letter-spacing:.08em;}
.pf{background:rgba(120,120,120,.12);color:#999;border:1px solid rgba(120,120,120,.2);}
.pb{background:rgba(66,133,244,.12);color:#4285F4;border:1px solid rgba(66,133,244,.2);}
.pp{background:rgba(0,200,117,.12);color:var(--s);border:1px solid rgba(0,200,117,.25);animation:ag 2.5s infinite;}
.aqb{height:4px;border-radius:99px;background:var(--b);overflow:hidden;}
.aqf{height:100%;border-radius:99px;animation:ab .7s ease both;}
.amo{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);}
.amd{background:var(--bg2);border:1px solid var(--b2);border-radius:20px;width:min(740px,100%);max-height:90vh;overflow-y:auto;animation:am .25s ease both;position:relative;}
.amh{padding:18px 22px 14px;border-bottom:1px solid var(--b);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg2);z-index:10;}
.ambd{padding:20px 22px;}
.ams{margin-bottom:20px;}
.amst{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid var(--b);display:flex;align-items:center;gap:6px;}
.asl2{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);margin-bottom:9px;display:flex;align-items:center;gap:5px;}
.aur{padding:13px 18px;border-bottom:1px solid var(--b);transition:background .15s;animation:af .3s ease both;cursor:pointer;}
.aur:hover{background:var(--c2);}
.aua{width:36px;height:36px;border-radius:10px;background:var(--ad);border:1px solid var(--b2);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--a);flex-shrink:0;}
.apb{flex:1;padding:12px 11px;border-radius:13px;border:1.5px solid var(--b);cursor:pointer;background:var(--c);display:flex;align-items:center;gap:10px;transition:all .22s;font-family:'Noto Sans KR',sans-serif;}
.apb.pn{border-color:#03C75A;background:rgba(3,199,90,.08);}
.apb.pt{border-color:#FF6B35;background:rgba(255,107,53,.08);}
.atb{flex:1;padding:9px;border:none;border-radius:10px;cursor:pointer;font-size:12px;font-weight:600;font-family:'Noto Sans KR',sans-serif;transition:all .18s;}
.atb.act{background:linear-gradient(135deg,var(--a),var(--a2));color:#000;}
.atb.ina{background:transparent;color:var(--m);}
.awrn{padding:10px 13px;border-radius:10px;font-size:12px;margin-bottom:12px;display:flex;align-items:center;gap:8px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);color:var(--a);}
.adn{width:8px;height:8px;border-radius:50%;background:var(--s);animation:abl 2s infinite;}
.ado{width:8px;height:8px;border-radius:50%;background:#555;}
.asp2{width:14px;height:14px;border-radius:50%;border:2px solid rgba(0,0,0,.2);border-top-color:#000;animation:as 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:5px;}
@media(max-width:768px){.asb{display:none;}.amb{display:flex!important;}.aco{padding:14px 12px 80px;}.asg{grid-template-columns:1fr 1fr;}.amd{width:100%;max-height:95vh;border-radius:16px 16px 0 0;}.amo{align-items:flex-end;padding:0;}}
.amb{display:none;position:fixed;bottom:0;left:0;right:0;z-index:100;padding:8px 10px 18px;gap:3px;background:var(--hb);border-top:1px solid var(--b);backdrop-filter:blur(24px);}
.ambb{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 3px;border-radius:10px;border:none;cursor:pointer;background:transparent;font-family:'Noto Sans KR',sans-serif;transition:all .18s;}
.ambb.active{background:var(--ad);}.ambi{font-size:20px;}.ambl{font-size:9px;font-weight:600;color:var(--m);}.ambb.active .ambl{color:var(--a);}
`;

const TABS = [{k:"publish",i:"🚀",l:"자동발행"},{k:"users",i:"👥",l:"회원관리"},{k:"stats",i:"📊",l:"통계"},{k:"settings",i:"🔐",l:"설정"}] as const;
const ADM_UID = "admin-publy";
const PLAN_LABELS:Record<string,string>={free:"FREE",basic:"BASIC",pro:"PRO"};

export default function AdminPage({onBack,onDashboard,theme,onThemeToggle}:Props){
  const [tab,setTab]=useState<"publish"|"users"|"stats"|"settings">("publish");
  const [botOnline,setBotOnline]=useState(false);
  const [platform,setPlatform]=useState<"naver"|"tistory">("naver");
  const [admAccs,setAdmAccs]=useState<PublyAccount[]>([]);
  const [pubTitle,setPubTitle]=useState("");const [pubContent,setPubContent]=useState("");const [pubTags,setPubTags]=useState("");const [pubImg,setPubImg]=useState("");const [pubAccId,setPubAccId]=useState("");const [publishing,setPublishing]=useState(false);const [pubMsg,setPubMsg]=useState("");
  const [adType,setAdType]=useState<"adpost"|"adsense">("adpost");
  const [targetChars,setTargetChars]=useState(1350);
  const [imgSource,setImgSource]=useState<"ai"|"upload"|"none">("ai"); // 이미지 소스
  const [imgCountManual,setImgCountManual]=useState<number|null>(null); // null=자동
  const [generatedImages,setGeneratedImages]=useState<string[]>([]); // AI 생성 이미지들
  const [uploadedImages,setUploadedImages]=useState<string[]>([]); // 업로드 이미지들
  const [showPreview,setShowPreview]=useState(false); // 미리보기 모달
  const [pubImageUrl,setPubImageUrl]=useState("");
  const [keyword,setKeyword]=useState("");const [generating,setGenerating]=useState(false);const [genTitle,setGenTitle]=useState("");const [genContent,setGenContent]=useState("");const [genTags,setGenTags]=useState("");
  const [titles,setTitles]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem("publy_adm_titles")||"[]");}catch{return[];}});
  const [selectedTitle,setSelectedTitle]=useState("");
  const [genImage,setGenImage]=useState("");
  const [genImgLoading,setGenImgLoading]=useState(false);
  const [loadingTitles,setLoadingTitles]=useState(false);
  const [pubImageUrl,setPubImageUrl]=useState("");
  const [pubSub,setPubSub]=useState<"publish"|"write"|"accounts">("publish");
  const [newPlat,setNewPlat]=useState<"naver"|"tistory">("naver");const [newUser,setNewUser]=useState("");const [newPw,setNewPw]=useState("");const [newBlog,setNewBlog]=useState("");const [addingAcc,setAddingAcc]=useState(false);const [showPw,setShowPw]=useState(false);const [connId,setConnId]=useState<string|null>(null);
  const [users,setUsers]=useState<UserFull[]>([]);const [loading,setLoading]=useState(true);const [search,setSearch]=useState("");const [selUser,setSelUser]=useState<UserFull|null>(null);
  const [editMap,setEditMap]=useState<Record<string,any>>({});const [saving,setSaving]=useState<string|null>(null);
  const [showAdmGuide,setShowAdmGuide]=useState(false);
  const [newNote,setNewNote]=useState("");const [newPayAmt,setNewPayAmt]=useState("");const [newPayNote,setNewPayNote]=useState("");const [addingPay,setAddingPay]=useState(false);
  const [newPw1,setNewPw1]=useState("");const [newPw2,setNewPw2]=useState("");const [pwMsg,setPwMsg]=useState("");
  const [flowEmail,setFlowEmail]=useState(()=>localStorage.getItem("admin_flow_email")||"");const [flowPw,setFlowPw]=useState(()=>localStorage.getItem("admin_flow_pw")||"");

  const checkBot=useCallback(async()=>{try{const r=await fetch(`${BOT}/health`,{signal:AbortSignal.timeout(3000)});setBotOnline(r.ok);}catch{setBotOnline(false);}},[]);

  useEffect(()=>{checkBot();getAccounts(ADM_UID).then(setAdmAccs);loadUsers();},[checkBot]);

  async function loadUsers(){
    setLoading(true);
    const{data}=await supabase.from("publy_users").select("*").order("created_at",{ascending:false});
    if(!data){setLoading(false);return;}
    const full=await Promise.all(data.map(async u=>{
      const[{data:q},{data:p},{data:n},{count}]=await Promise.all([
        supabase.from("publy_quotas").select("*").eq("user_id",u.id).single(),
        supabase.from("publy_payments").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(20),
        supabase.from("publy_notes").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(20),
        supabase.from("publy_history").select("*",{count:"exact",head:true}).eq("user_id",u.id),
      ]);
      return{...u,quota:q||undefined,payments:p||[],notes:n||[],history_count:count||0};
    }));
    setUsers(full as UserFull[]);setLoading(false);
  }

  async function handlePublish(){
    if(!pubTitle||!pubContent||!pubAccId)return;
    setPublishing(true);setPubMsg("발행 중...");
    try{const r=await fetch(`${BOT}/api/publish-full`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ADM_UID,platform,title:pubTitle,content:pubContent,tags:pubTags.split(",").map((t:string)=>t.trim()).filter(Boolean),imagePrompt:pubImg||undefined})});const d=await r.json();if(!r.ok)throw new Error(d.error);setPubMsg("✅ 발행 완료!");setPubTitle("");setPubContent("");setPubTags("");setPubImg("");}
    catch(e:any){setPubMsg("❌ "+e.message);}finally{setPublishing(false);}
  }

  // ── 200+ 카테고리 한국어→영어 이미지 프롬프트 ──────────
  const KO_EN_MAP:Record<string,string>={
    맛집:"delicious gourmet food beautiful plating restaurant warm lighting",음식:"delicious food dish beautiful presentation",요리:"cooking fresh ingredients cutting board kitchen herbs",카페:"cozy cafe coffee interior warm ambient pastry",커피:"coffee latte art ceramic cup morning steam",치킨:"crispy golden fried chicken korean food plate",피자:"pizza melted cheese fresh toppings italian",라면:"ramen noodle bowl hot steam broth toppings",삼겹살:"korean bbq pork belly grill sizzling smoke",회:"fresh sashimi seafood colorful plate ice",초밥:"sushi japanese fresh fish rice plate",파스타:"pasta italian tomato sauce herbs",브런치:"brunch cafe food table morning avocado eggs",스테이크:"steak beef grill plate fine dining",햄버거:"burger gourmet bun vegetables sauce",샐러드:"healthy salad fresh colorful vegetables bowl",케이크:"celebration cake dessert beautiful cream",빵:"fresh artisan bread bakery golden",디저트:"dessert sweet pastry cream fruit plate",마카롱:"macarons colorful french pastry",타르트:"tart pastry fruit cream elegant",아이스크림:"ice cream scoop colorful cone summer",도넛:"donuts glazed colorful sweet bakery",떡볶이:"tteokbokki korean street food red spicy rice cake",김밥:"kimbap seaweed rice roll colorful cross section",비빔밥:"bibimbap korean mixed rice bowl vegetables egg",냉면:"naengmyeon korean cold noodle bowl ice",갈비:"kalbi korean grilled ribs bbq",불고기:"bulgogi korean marinated beef grill sesame",된장찌개:"doenjang jjigae soybean paste stew clay pot",김치찌개:"kimchi jjigae stew pork red broth",해물:"seafood fresh shellfish shrimp crab",와인:"wine glass elegant bottle vineyard",맥주:"beer mug cold refreshing foam glass",막걸리:"korean rice wine makgeolli bottle cup",소주:"korean soju drink glass bottle",칵테일:"cocktail bar colorful garnish glass",초콜릿:"chocolate dark sweet confectionery",
    여행:"scenic travel destination beautiful landscape golden hour",관광:"tourism famous landmark architecture",해외여행:"international travel airplane passport suitcase",국내여행:"domestic korea scenic nature mountains",제주도:"jeju island volcanic landscape ocean cliffs",서울:"seoul city skyline namsan night view",부산:"busan haeundae beach ocean cliff bridge",강원도:"gangwon mountains forest nature snow",경주:"gyeongju historic temple bulguksa pagoda",전주:"jeonju hanok village traditional architecture",여수:"yeosu ocean night view bridge seafood",속초:"sokcho beach seoraksan mountains",춘천:"chuncheon lake mountain nature",강릉:"gangneung east sea beach coffee",통영:"tongyeong ocean cable car island",거제:"geoje island ocean cliff",남해:"namhae ocean blue village",담양:"damyang bamboo forest green",순천:"suncheon bay wetland sunset",일본:"tokyo japan shibuya neon cherry blossom",태국:"thailand bangkok temple tropical",베트남:"vietnam hoi an lanterns traditional street",발리:"bali indonesia temple rice terrace sunset",유럽:"europe historic architecture cobblestone",파리:"paris eiffel tower seine river sunset",호텔:"luxury hotel room interior elegant bed",숙소:"cozy accommodation room interior",펜션:"pension guesthouse countryside cozy",캠핑:"camping tent campfire stars nature",글램핑:"glamping luxury tent outdoor fairy lights",리조트:"resort pool tropical luxury",
    건강:"health wellness vitamins natural herbs",다이어트:"diet healthy food vegetables scale",운동:"exercise gym equipment weights fitness",헬스:"gym fitness dumbbells machines",요가:"yoga mat meditation calm nature",필라테스:"pilates reformer equipment studio",수영:"swimming pool water lane",달리기:"running shoes road park sunrise",등산:"hiking trail mountain forest backpack",뷰티:"beauty cosmetics makeup products palette",피부:"skincare serum cream bottle routine",헤어:"hair care shampoo salon tools",메이크업:"makeup brush palette foundation lipstick",스킨케어:"skincare products bottles cream serum",탈모:"hair treatment scalp care natural",영양제:"supplements vitamins capsules bottles",프로틴:"protein powder shaker gym",콜라겐:"collagen supplement beauty skin",비타민:"vitamin supplements colorful capsule",의료:"medical healthcare equipment sterile",병원:"hospital building professional clean",치과:"dental clinic teeth care",피부과:"dermatology clinic skincare treatment",
    재테크:"investment finance coins growth chart piggy bank",주식:"stock market chart trading graph trend",코인:"cryptocurrency bitcoin gold coin digital",비트코인:"bitcoin gold digital network circuit",ETF:"etf investment fund chart portfolio",부업:"side job laptop home office freelance",N잡:"multiple income laptop freelance gig",절약:"saving money coins jar budget planner",대출:"loan bank document contract pen",보험:"insurance document umbrella protection",청약:"apartment application document form",세금:"tax document calculator accounting",연말정산:"tax return document form calculator",
    부동산:"real estate property house document keys",아파트:"apartment building modern exterior",빌라:"villa house residential exterior garden",오피스텔:"officetel modern apartment interior",원룸:"studio apartment interior minimal",전세:"lease contract document keys",월세:"rental apartment document keys",분양:"new apartment construction modern",인테리어:"interior design modern minimalist furniture",리모델링:"home renovation interior before after",이사:"moving boxes cardboard tape packing",청소:"cleaning supplies spray bottle mop",정리:"organizing storage shelf neat minimal",
    IT:"technology digital computer code screen",AI:"artificial intelligence circuit board network",인공지능:"ai robot technology digital future",챗GPT:"chatgpt ai interface laptop",앱:"mobile app smartphone screen",스마트폰:"smartphone modern screen technology",노트북:"laptop computer desk workspace",코딩:"coding programming dark screen code",개발:"software development laptop code monitor",유튜브:"youtube studio camera ring light equipment",인스타그램:"instagram phone screen social media",블로그:"blog writing laptop cafe keyboard",게임:"gaming setup controller rgb monitor",드론:"drone aerial photography sky",스마트홈:"smart home device speaker automation",
    교육:"education books desk study knowledge",공부:"study books notebook pencil desk lamp",수능:"exam books pencil study desk",영어:"english learning books dictionary study",자격증:"certificate diploma achievement document",취업:"job resume briefcase professional laptop",이직:"career change resume laptop",면접:"interview professional suit document",독서:"reading book cozy armchair lamp",자기계발:"self development books journal planner",
    육아:"baby toys nursery soft colors stroller",아이:"children toys colorful playground",임신:"maternity baby items nursery soft",결혼:"wedding flowers venue decoration setup",웨딩:"wedding dress flowers bouquet ceremony",가족:"family gathering home table food",
    자동차:"car automobile road modern exterior",중고차:"used car dealership lot",전기차:"electric vehicle charging station modern",오토바이:"motorcycle bike road exterior",
    강아지:"cute puppy dog playing toy home",고양이:"cute cat kitten indoor cozy",반려동물:"pet companion home toys food bowl",토끼:"rabbit bunny cute fluffy indoor",
    패션:"fashion clothing outfit display stylish",쇼핑:"shopping retail store display bags",명품:"luxury brand handbag elegant display",신발:"shoes sneakers display clean",가방:"bag handbag leather elegant display",
    창업:"startup business office desk strategy",사업:"business meeting office professional",마케팅:"marketing strategy digital chart",프리랜서:"freelancer laptop home office coffee",유튜버:"youtube creator studio camera equipment",
    정부지원:"government document official stamp desk",지원금:"financial support money document",복지:"welfare care service document",
    자연:"nature landscape mountains forest scenic",꽃:"flowers colorful bloom garden spring",바다:"ocean sea waves sunset landscape",숲:"forest trees green peaceful path",산:"mountain peak scenic trail",봄:"spring cherry blossom bloom",여름:"summer beach ocean sunshine",가을:"autumn fall leaves colorful",겨울:"winter snow cold white landscape",
    골프:"golf course green club equipment",낚시:"fishing rod lake nature water",음악:"music instrument guitar piano",그림:"painting canvas brush art studio",사진:"photography camera lens equipment dslr",영화:"cinema popcorn screen ticket",
    명상:"meditation candle calm peaceful nature",힐링:"healing spa nature calm peaceful",스트레스:"stress relief tea candle calm",크리스마스:"christmas tree lights snow decoration",
    주방용품:"kitchen utensils cookware modern",가전제품:"home appliances refrigerator",생활용품:"household daily products containers",침구:"bedding pillow blanket cozy bedroom",가구:"furniture modern sofa desk chair",
    한우:"korean wagyu beef premium",굴비:"dried fish korean traditional",농산물:"farm produce vegetables harvest",수산물:"seafood fresh fish market",유기농:"organic farm natural produce",
    쿠팡:"ecommerce online shopping laptop",스마트스토어:"smart store ecommerce product",도매:"wholesale warehouse products boxes",
    법률:"law books gavel document professional",세무:"tax accounting calculator document",노무:"labor law document office",
    환경:"environment green nature eco",친환경:"eco friendly green natural organic",태양광:"solar panels rooftop renewable energy",
  };

  function buildImagePrompt(kw:string):string{
    const k=kw.trim();
    const NP="no people, no person, no face, no portrait, no human";
    const adB=adType==="adpost"
      ?"Korean lifestyle blog warm emotional photography, natural lighting, authentic"
      :"ultra realistic DSLR, editorial blog photo, 8K, magazine quality, natural lighting";
    const sorted=Object.keys(KO_EN_MAP).sort((a,b)=>b.length-a.length);
    for(const ko of sorted){if(k.includes(ko))return `${KO_EN_MAP[ko]}, ${NP}, ${adB}`;}
    if(/맛집|음식|카페|식당|요리|먹/.test(k))return `delicious korean food restaurant beautiful, ${NP}, ${adB}`;
    if(/여행|관광|호텔|숙소|비행기/.test(k))return `scenic travel destination golden hour, ${NP}, ${adB}`;
    if(/건강|운동|다이어트|헬스|요가/.test(k))return `health fitness wellness natural, ${NP}, ${adB}`;
    if(/주식|코인|재테크|투자|금융/.test(k))return `investment finance growth chart, ${NP}, ${adB}`;
    if(/부동산|아파트|전세|인테리어/.test(k))return `modern apartment real estate interior, ${NP}, ${adB}`;
    if(/뷰티|피부|메이크업|스킨케어/.test(k))return `skincare beauty cosmetics elegant, ${NP}, ${adB}`;
    if(/강아지|고양이|반려/.test(k))return `cute pet dog cat home cozy`;
    if(/육아|아기|임신|아이/.test(k))return `baby nursery toys soft pastel, ${NP}, ${adB}`;
    if(/취업|이직|직장|커리어/.test(k))return `career professional office laptop, ${NP}, ${adB}`;
    if(/창업|사업|마케팅/.test(k))return `startup business office strategy, ${NP}, ${adB}`;
    if(/IT|AI|코딩|기술/.test(k))return `technology digital AI circuit modern, ${NP}, ${adB}`;
    if(/정부|지원금|복지|혜택/.test(k))return `government document official professional, ${NP}, ${adB}`;
    if(/꽃|자연|바다|산|봄|여름|가을|겨울/.test(k))return `beautiful nature landscape seasonal, ${NP}, ${adB}`;
    if(/공부|교육|자격증/.test(k))return `study books desk lamp learning, ${NP}, ${adB}`;
    if(/패션|쇼핑|옷/.test(k))return `fashion clothing display stylish, ${NP}, ${adB}`;
    if(/명상|힐링|마음|스트레스/.test(k))return `meditation calm peaceful nature candle, ${NP}, ${adB}`;
    return `lifestyle blog concept natural editorial photo, ${NP}, ${adB}`;
  }

  function parseArr(text:string):string[]{
    const clean=text.replace(/```json|```/gi,"").trim();
    try{const m=clean.match(/\[[\s\S]*\]/);if(m){const p=JSON.parse(m[0]);if(Array.isArray(p))return p.map(String).filter((t:string)=>t.length>3);}}catch{}
    try{const p=JSON.parse(clean);if(Array.isArray(p))return p.map(String).filter((t:string)=>t.length>3);}catch{}
    return clean.split("\n").map((l:string)=>l.replace(/^[\d]+[).\s]+|^[-*•\s]+/,"").replace(/^[\s"']+|[\s"']+$/g,"").trim()).filter((l:string)=>l.length>4&&l.length<100);
  }

  async function callAI(prompt:string):Promise<string>{
    const ai=localStorage.getItem("publy_write_ai")||"gemini";
    if(ai==="gemini"){
      const key=localStorage.getItem("publy_gemini_key")||"";if(!key)throw new Error("Gemini API 키 없음");
      for(const model of GEMINI_MODELS_ADM){try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:4000}}),signal:AbortSignal.timeout(30000)});if(!r.ok)continue;const d=await r.json();const t=d.candidates?.[0]?.content?.parts?.[0]?.text||"";if(t)return t;}catch{continue;}}
      throw new Error("Gemini 실패");
    }
    if(ai==="groq"){
      const key=localStorage.getItem("publy_groq_key")||"";if(!key)throw new Error("Groq API 키 없음");
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"llama-3.1-70b-versatile",max_tokens:4000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(30000)});
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"Groq 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    if(ai==="openai"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI API 키 없음");
      const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"gpt-4o-mini",max_tokens:4000,messages:[{role:"user",content:prompt}]}),signal:AbortSignal.timeout(30000)});
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||"OpenAI 오류");}
      const d=await r.json();return d.choices?.[0]?.message?.content||"";
    }
    throw new Error("AI 미선택");
  }

  async function generateImage(kw:string):Promise<string>{
    const imgPrompt=buildImagePrompt(kw);
    const ai=localStorage.getItem("publy_image_ai")||"openai_img";
    if(ai==="openai_img"){
      const key=localStorage.getItem("publy_openai_key")||"";if(!key)throw new Error("OpenAI 키 없음");
      const r=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:"dall-e-3",prompt:imgPrompt,n:1,size:"1024x1024"}),signal:AbortSignal.timeout(60000)});
      if(!r.ok){const e=await r.json();throw new Error("DALL-E: "+(e.error?.message||r.status));}
      const d=await r.json();return d.data?.[0]?.url||"";
    }
    if(ai==="replicate"){
      const key=localStorage.getItem("publy_replicate_key")||"";if(!key)throw new Error("Replicate 키 없음");
      const pr=await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({input:{prompt:imgPrompt,num_outputs:1,aspect_ratio:"16:9"}}),signal:AbortSignal.timeout(30000)});
      if(!pr.ok){const e=await pr.json();throw new Error("Replicate: "+(e.detail||pr.status));}
      const pred=await pr.json();const pollUrl=pred.urls?.get;if(!pollUrl)throw new Error("Replicate 응답 오류");
      for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,2000));const res=await fetch(pollUrl,{headers:{"Authorization":`Bearer ${key}`}});const data=await res.json();if(data.status==="succeeded")return data.output?.[0]||"";if(data.status==="failed")throw new Error("Replicate 실패");}
      throw new Error("Replicate 타임아웃");
    }
    throw new Error("이미지 AI 미선택");
  }

  // 글자수 기반 이미지 추천 수량
  function recommendImageCount(content:string):number{
    return Math.max(1, Math.floor(content.length/200));
  }

  function getActiveImages():string[]{
    if(imgSource==="upload")return uploadedImages;
    return generatedImages;
  }

  // 본문을 이미지 수에 맞게 섹션으로 분할
  function splitContentWithImages(content:string, images:string[]):{text:string,img?:string}[]{
    if(!images.length||imgSource==="none")return [{text:content}];
    const charsPerSection=Math.floor(content.length/(images.length+1));
    const sections:{text:string,img?:string}[]=[];
    let pos=0;
    for(let i=0;i<images.length;i++){
      const end=Math.min(pos+charsPerSection, content.length);
      // 문단 경계 찾기
      const breakAt=content.lastIndexOf("\n",end)||end;
      sections.push({text:content.slice(pos,breakAt>pos?breakAt:end).trim()});
      sections.push({img:images[i]});
      pos=breakAt>pos?breakAt:end;
    }
    if(pos<content.length)sections.push({text:content.slice(pos).trim()});
    return sections;
  }

  async function handleGenerateImages(count:number){
    if(imgSource==="none"||imgSource==="upload")return;
    setGenImgLoading(true);
    const imgs:string[]=[];
    try{
      for(let i=0;i<count;i++){
        const url=await generateImage(keyword||selectedTitle);
        imgs.push(url);
        setGeneratedImages([...imgs]);
      }
    }catch(e:any){alert("이미지 생성 실패: "+e.message);}
    finally{setGenImgLoading(false);}
  }

  function handleImageUpload(e:React.ChangeEvent<HTMLInputElement>){
    const files=e.target.files;
    if(!files)return;
    Array.from(files).forEach(file=>{
      const reader=new FileReader();
      reader.onload=ev=>{
        if(ev.target?.result)setUploadedImages(prev=>[...prev,ev.target!.result as string]);
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleGenerateTitles(reset=false){
    if(!keyword.trim()){alert("키워드를 입력하세요");return;}
    if(reset)setTitles([]);
    setLoadingTitles(true);
    const isAdpost=adType==="adpost";
    const prompt=isAdpost
      ?`당신은 대한민국 최고의 네이버 블로그 SEO 제목 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 네이버 애드포스트 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 25~40자, 친근하고 감성적\n- 숫자 필수 (BEST 7, TOP 5 등)\n- "솔직히", "이것만", "나만 알던" 등 클릭 유발\n- 경험 공유형, 2026 트렌드\n\nJSON 배열만 반환.`
      :`당신은 구글 애드센스 최적화 SEO 전문가입니다.\n키워드: "${keyword.trim()}"\n목적: 구글 검색 상위노출 + 애드센스 클릭률 극대화\n\n반드시 제목 30개를 JSON 배열로만 반환하세요.\n- 키워드를 자연스럽게 포함\n- 30~50자, 정보성·전문적 톤\n- 검색의도 반영 (방법, 가이드, 총정리)\n- "완벽 가이드", "총정리", "이유 5가지" 등\n- 영어 혼용 자연스럽게 가능\n\nJSON 배열만 반환.`;
    try{
      const text=await callAI(prompt);
      const parsed=parseArr(text);
      if(!parsed.length)throw new Error("제목 파싱 실패");
      setTitles(prev=>{
        const combined=[...parsed,...prev];
        if(combined.length>=90){localStorage.setItem("publy_adm_titles",JSON.stringify(parsed));return parsed;}
        localStorage.setItem("publy_adm_titles",JSON.stringify(combined));
        return combined;
      });
    }catch(e:any){alert("제목 생성 실패: "+e.message);}
    finally{setLoadingTitles(false);}
  }

  async function handleGenerate(){
    if(!selectedTitle&&!keyword)return;
    const title=selectedTitle||keyword;
    setGenerating(true);setGenImage("");
    const isAdpost=adType==="adpost";
    const contentPrompt=isAdpost
      ?`당신은 대한민국 최고의 네이버 블로그 작가입니다.\n키워드: "${keyword}"\n제목: "${title}"\n목적: 네이버 애드포스트 클릭률 + 체류시간 극대화\n\n형식:\n태그: (태그1, 태그2, 태그3, 태그4, 태그5)\n본문: (정확히 ${targetChars}자 내외, 친근한 말투, 경험 공유형, 소제목 포함, 독자 공감 유도, 자연스러운 단락 구분)`
      :`당신은 구글 애드센스 최적화 전문 블로그 작가입니다.\n키워드: "${keyword}"\n제목: "${title}"\n목적: 구글 SEO 상위노출 + 애드센스 수익 극대화\n\n형식:\n태그: (태그1, 태그2, 태그3, 태그4, 태그5)\n본문: (정확히 ${targetChars}자 내외, 전문적 정보성 톤, H2/H3 소제목 다수 포함, 리스트 활용, 구체적 정보 중심, 자연스러운 단락 구분)`;
    try{
      const text=await callAI(contentPrompt);
      const tgm=text.match(/태그[:\s]*([^\n]+)/);const bm=text.match(/본문[:\s]*([\s\S]+)/);
      setGenTitle(title);
      if(tgm)setGenTags(tgm[1].trim());
      const body=bm?bm[1].trim():text;
      setGenContent(body);
      // 이미지 수량 계산
      const recCount=imgCountManual??recommendImageCount(body);
      if(imgSource==="ai"&&recCount>0){
        setGenImgLoading(true);setGeneratedImages([]);
        const imgs:string[]=[];
        try{
          for(let i=0;i<recCount;i++){
            const url=await generateImage(keyword||selectedTitle);
            imgs.push(url);setGeneratedImages([...imgs]);
          }
        }catch(e:any){alert("이미지 생성 실패: "+e.message);}
        finally{setGenImgLoading(false);}
      }
    }catch(e:any){alert("본문 생성 실패: "+e.message);}
    finally{setGenerating(false);}
  }

  async function handleAddAcc(){if(!newUser||!newPw)return;setAddingAcc(true);try{await upsertAccount({user_id:ADM_UID,platform:newPlat,username:newUser,password_encrypted:btoa(newPw),blog_name:newBlog||undefined,is_connected:false});getAccounts(ADM_UID).then(setAdmAccs);setNewUser("");setNewPw("");setNewBlog("");}catch(e:any){alert(e.message);}finally{setAddingAcc(false);}}

  async function handleConnect(acc:PublyAccount){if(!botOnline){alert("봇 서버 실행 필요");return;}setConnId(acc.id);try{const r=await fetch(`${BOT}/api/${acc.platform}/save-session`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:ADM_UID,id:acc.username,pw:atob((acc as any).password_encrypted||""),blogName:acc.blog_name})});if(!r.ok){const d=await r.json();throw new Error(d.error);}await supabase.from("publy_accounts").update({is_connected:true,connected_at:new Date().toISOString()}).eq("id",acc.id);getAccounts(ADM_UID).then(setAdmAccs);}catch(e:any){alert("연결 실패: "+e.message);}finally{setConnId(null);}}

  function edit(uid:string,key:string,val:any){setEditMap(p=>({...p,[uid]:{...p[uid],[key]:val}}))}

  async function saveUser(u:UserFull){
    const e=editMap[u.id]||{};setSaving(u.id);
    try{const upd:any={};if(e.plan&&e.plan!==u.plan)upd.plan=e.plan;if(e.memo!==undefined)upd.memo=e.memo;if(e.phone!==undefined)upd.phone=e.phone;if(Object.keys(upd).length>0)await supabase.from("publy_users").update(upd).eq("id",u.id);if(e.plan&&e.plan!==u.plan){const pq:Record<string,number>={free:10,basic:50,pro:999999};await supabase.from("publy_quotas").update({total_quota:pq[e.plan]||10}).eq("user_id",u.id);}if(e.quota!==undefined&&u.quota)await supabase.from("publy_quotas").update({total_quota:Number(e.quota),used_quota:Math.min(u.quota.used_quota,Number(e.quota))}).eq("user_id",u.id);if(e.days!==undefined&&u.quota){const d=new Date(u.quota.reset_date);d.setDate(d.getDate()+Number(e.days));await supabase.from("publy_quotas").update({reset_date:d.toISOString()}).eq("user_id",u.id);}await loadUsers();setEditMap(p=>{const n={...p};delete n[u.id];return n;});alert("저장됨");}
    catch(e:any){alert("오류: "+e.message);}finally{setSaving(null);}
  }

  async function resetQuota(uid:string){if(!confirm("건수 초기화?"))return;await supabase.from("publy_quotas").update({used_quota:0}).eq("user_id",uid);await loadUsers();}
  async function toggleActive(u:UserFull){if(!confirm(`${u.name||u.email} ${u.is_active?"비활성화":"활성화"}?`))return;await supabase.from("publy_users").update({is_active:!u.is_active}).eq("id",u.id);await loadUsers();}
  async function addNote(uid:string){if(!newNote.trim())return;await supabase.from("publy_notes").insert({user_id:uid,content:newNote.trim()});setNewNote("");await loadUsers();}
  async function addPayment(uid:string,plan:string){if(!newPayAmt)return;setAddingPay(true);try{await supabase.from("publy_payments").insert({user_id:uid,amount:Number(newPayAmt),plan,method:"manual",status:"completed",note:newPayNote||undefined});await supabase.from("publy_users").update({plan}).eq("id",uid);const pq:Record<string,number>={free:10,basic:50,pro:999999};await supabase.from("publy_quotas").update({total_quota:pq[plan]||10}).eq("user_id",uid);setNewPayAmt("");setNewPayNote("");await loadUsers();}finally{setAddingPay(false);}}
  function changeAdminPw(){if(!newPw1||newPw1!==newPw2){setPwMsg("비밀번호를 확인하세요");return;}if(newPw1.length<4){setPwMsg("4자 이상");return;}localStorage.setItem("publy_admin_pw",newPw1);setNewPw1("");setNewPw2("");setPwMsg("✅ 변경 완료");setTimeout(()=>setPwMsg(""),3000);}

  const filtered=users.filter(u=>!search||(u.name||"").includes(search)||u.email.includes(search));
  const tu=users.length,au=users.filter(u=>u.is_active).length,pu=users.filter(u=>u.plan==="pro").length,tp=users.reduce((s,u)=>s+(u.quota?.used_quota||0),0);
  const connAccs=admAccs.filter(a=>a.is_connected&&a.platform===platform);

  return(
    <>
      <style>{CSS}</style>
      {/* 사용설명서 패널 */}
      {showAdmGuide && (
        <div className="adm-guide-overlay">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:".15em",color:"var(--a)"}}>사용 설명서</div>
              <div style={{fontSize:10,color:"var(--m)"}}>관리자 운영 가이드</div>
            </div>
            <button onClick={()=>setShowAdmGuide(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--m)"}}>✕</button>
          </div>
          {ADM_GUIDE_STEPS.map((s,i)=>(
            <div key={i} style={{padding:"13px 15px",borderRadius:13,border:`1px solid ${s.color}30`,marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}>
                <div style={{width:20,height:20,borderRadius:6,background:`${s.color}20`,border:`1px solid ${s.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:s.color}}>{i+1}</div>
                <span style={{fontSize:13,fontWeight:700,color:"var(--t)"}}>{s.title}</span>
              </div>
              {s.items.map((item,j)=>(
                <div key={j} style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  <div style={{width:4,height:4,borderRadius:"50%",background:s.color,flexShrink:0}}/>
                  <span style={{fontSize:12,color:"var(--m)",lineHeight:1.5}}>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 사용설명서 플로팅 버튼 */}
      <button className="adm-guide-float" onClick={()=>setShowAdmGuide((v:boolean)=>!v)}>
        📖 사용 설명서
      </button>

      <div className="asc"/>

      {/* 회원 상세 모달 */}
      {selUser&&(
        <div className="amo" onClick={e=>{if(e.target===e.currentTarget)setSelUser(null);}}>
          <div className="amd">
            <div className="amh">
              <div className="aua" style={{width:44,height:44,fontSize:18}}>{(selUser.name||selUser.email)[0].toUpperCase()}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:800,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  {selUser.name||"이름없음"}
                  <span className={`api p${editMap[selUser.id]?.plan?.[0]||selUser.plan[0]}`}>{PLAN_LABELS[editMap[selUser.id]?.plan||selUser.plan]}</span>
                  {!selUser.is_active&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:99,background:"rgba(239,68,68,.12)",color:"var(--d)",border:"1px solid rgba(239,68,68,.2)",fontWeight:800}}>비활성</span>}
                </div>
                <div style={{fontSize:11,color:"var(--m)",fontFamily:"'JetBrains Mono',monospace"}}>{selUser.email}</div>
              </div>
              <div style={{display:"flex",gap:7}}>
                <button className="abs abs2" onClick={()=>toggleActive(selUser)}>{selUser.is_active?"🚫 비활성":"✅ 활성화"}</button>
                <button onClick={()=>setSelUser(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"var(--m)"}}>✕</button>
              </div>
            </div>
            <div className="ambd">
              {/* 기본 정보 */}
              <div className="ams">
                <div className="amst">👤 기본 정보</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:10}}>
                  {[{l:"이름",v:selUser.name||"-"},{l:"이메일",v:selUser.email},{l:"가입일",v:new Date(selUser.created_at).toLocaleDateString("ko-KR")},{l:"총 발행",v:`${selUser.history_count||0}건`}].map(item=>(
                    <div key={item.l} style={{padding:"9px 11px",borderRadius:9,background:"var(--ib)",border:"1px solid var(--b)"}}>
                      <div style={{fontSize:9,color:"var(--m)",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",marginBottom:3}}>{item.l}</div>
                      <div style={{fontSize:12,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{item.v}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:4}}>전화번호</label>
                  <input className="ainp" style={{width:"100%"}} placeholder="010-0000-0000" value={editMap[selUser.id]?.phone??selUser.phone??""} onChange={e=>edit(selUser.id,"phone",e.target.value)}/>
                </div>
              </div>
              {/* 등급/쿼터 */}
              <div className="ams">
                <div className="amst">⚙️ 등급 & 발행 관리</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:10}}>
                  <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:4}}>등급</label>
                    <select className="ainp" style={{width:"100%"}} value={editMap[selUser.id]?.plan||selUser.plan} onChange={e=>edit(selUser.id,"plan",e.target.value)}>
                      <option value="free">FREE</option><option value="basic">BASIC</option><option value="pro">PRO</option>
                    </select></div>
                  <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:4}}>총 건수</label>
                    <input className="ainp" type="number" style={{width:"100%"}} placeholder={String(selUser.quota?.total_quota||10)} value={editMap[selUser.id]?.quota??""} onChange={e=>edit(selUser.id,"quota",e.target.value)}/></div>
                  <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:4}}>연장 (일)</label>
                    <input className="ainp" type="number" style={{width:"100%"}} placeholder="0" value={editMap[selUser.id]?.days??""} onChange={e=>edit(selUser.id,"days",e.target.value)}/></div>
                </div>
                {selUser.quota&&(<div style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:10,color:"var(--m)"}}>사용 현황</span><span style={{fontSize:11,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{selUser.quota.used_quota}/{selUser.quota.total_quota}건 · {new Date(selUser.quota.reset_date).toLocaleDateString("ko-KR")} 만료</span></div>
                  <div className="aqb"><div className="aqf" style={{"--w":`${Math.min(100,selUser.quota.used_quota/selUser.quota.total_quota*100)}%`,width:`${Math.min(100,selUser.quota.used_quota/selUser.quota.total_quota*100)}%`,background:selUser.quota.used_quota/selUser.quota.total_quota>0.8?"var(--d)":"var(--s)"} as any}/></div>
                </div>)}
                <div style={{display:"flex",gap:8}}>
                  <button className="abp" style={{padding:"8px 16px",fontSize:12}} onClick={()=>saveUser(selUser)} disabled={saving===selUser.id}>{saving===selUser.id?<><span className="asp2"/>저장 중...</>:<>💾 저장</>}</button>
                  <button className="abs abd" onClick={()=>resetQuota(selUser.id)}>🔄 건수 초기화</button>
                </div>
              </div>
              {/* 결제 */}
              <div className="ams">
                <div className="amst">💳 결제 내역</div>
                <div style={{display:"grid",gridTemplateColumns:"80px 1fr 90px auto",gap:7,marginBottom:10,alignItems:"end"}}>
                  <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>금액(원)</label><input className="ainp" type="number" style={{width:"100%"}} placeholder="금액" value={newPayAmt} onChange={e=>setNewPayAmt(e.target.value)}/></div>
                  <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>메모</label><input className="ainp" style={{width:"100%"}} placeholder="결제 메모" value={newPayNote} onChange={e=>setNewPayNote(e.target.value)}/></div>
                  <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>등급 변경</label><select className="ainp" style={{width:"100%"}} id="pp"><option value="free">FREE</option><option value="basic">BASIC</option><option value="pro">PRO</option></select></div>
                  <button className="abp" style={{padding:"8px 11px",fontSize:11}} onClick={()=>{const s=document.getElementById("pp") as HTMLSelectElement;addPayment(selUser.id,s.value);}} disabled={addingPay}>{addingPay?<span className="asp2"/>:null}추가</button>
                </div>
                {(selUser.payments||[]).length===0?<div style={{padding:"14px",textAlign:"center",color:"var(--m)",fontSize:12}}>결제 내역 없음</div>:(selUser.payments||[]).map((p:any)=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:9,padding:"8px 11px",borderRadius:9,background:"var(--ib)",border:"1px solid var(--b)",marginBottom:5}}>
                    <span style={{fontSize:11,fontWeight:800,color:"var(--a)",fontFamily:"'JetBrains Mono',monospace"}}>₩{Number(p.amount).toLocaleString()}</span>
                    <span className={`api p${p.plan[0]}`}>{p.plan.toUpperCase()}</span>
                    <span style={{fontSize:11,color:"var(--m)",flex:1}}>{p.note||"-"}</span>
                    <span style={{fontSize:9,color:"var(--m)",fontFamily:"'JetBrains Mono',monospace"}}>{new Date(p.created_at).toLocaleDateString("ko-KR")}</span>
                  </div>
                ))}
              </div>
              {/* 메모 */}
              <div className="ams">
                <div className="amst">📝 관리자 메모</div>
                <div style={{display:"flex",gap:7,marginBottom:9}}>
                  <input className="ainp" style={{flex:1}} placeholder="메모 입력..." value={newNote} onChange={e=>setNewNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote(selUser.id)}/>
                  <button className="abp" style={{padding:"8px 13px",fontSize:12}} onClick={()=>addNote(selUser.id)}>추가</button>
                </div>
                {(selUser.notes||[]).map((n:any)=>(
                  <div key={n.id} style={{padding:"8px 11px",borderRadius:9,background:"var(--ib)",border:"1px solid var(--b)",marginBottom:5}}>
                    <div style={{fontSize:12,marginBottom:2}}>{n.content}</div>
                    <div style={{fontSize:9,color:"var(--m)",fontFamily:"'JetBrains Mono',monospace"}}>{new Date(n.created_at).toLocaleString("ko-KR")}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`ar ${theme}`}>
        {/* 헤더 */}
        <div className="ah">
          <div className="ali"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" fill="#000" opacity=".85"/><path d="M12 7L16 15H8L12 7Z" fill="#f59e0b"/></svg></div>
          <div className="al">PUBLY ADMIN</div>
          <span className="arc">ADMINISTRATOR</span>
          <span style={{fontSize:11,color:"var(--m)",fontFamily:"'JetBrains Mono',monospace",marginLeft:6}}>{tu}명</span>
          <div className="ahr">
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 11px",borderRadius:99,border:"1px solid var(--b)",background:"var(--c)",fontSize:11}}>
              <span className={botOnline?"adn":"ado"}/><span style={{color:botOnline?"var(--s)":"var(--m)"}}>{botOnline?"서버 온라인":"서버 오프라인"}</span>
            </div>
            <button className="aib" onClick={onThemeToggle} style={{cursor:"pointer"}}>{theme==="dark"?"☀️":"🌙"}</button>
            <button className="abh abg" onClick={onDashboard}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              대시보드
            </button>
            <button className="abh abm" onClick={onBack}>로그아웃</button>
          </div>
        </div>

        <div className="abdy">
          {/* 사이드바 */}
          <div className="asb">
            {TABS.map(t=>(
              <button key={t.k} className={`an ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as any)}>
                <span className="ani">{t.i}</span>{t.l}
                {t.k==="users"&&<span className="anbg">{tu}</span>}
              </button>
            ))}
            <div style={{marginTop:"auto",paddingTop:12,borderTop:"1px solid var(--b)"}}>
              <button onClick={()=>{checkBot();loadUsers();}} style={{width:"100%",padding:"8px 12px",borderRadius:10,border:"1px solid var(--b)",background:"var(--c)",color:"var(--m)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Noto Sans KR',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>🔄 새로고침</button>
            </div>
          </div>

          {/* 콘텐츠 */}
          <div className="aco">

            {/* 자동발행 */}
            {tab==="publish"&&(
              <div style={{animation:"af .3s ease both"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3,background:"var(--ib)",borderRadius:13,padding:4,marginBottom:14}}>
                  {[{k:"publish",l:"발행하기"},{k:"write",l:"글 생성"},{k:"accounts",l:"계정 관리"}].map(t=>(
                    <button key={t.k} className={`atb ${pubSub===t.k?"act":"ina"}`} onClick={()=>setPubSub(t.k as any)}>{t.l}</button>
                  ))}
                </div>
                {!botOnline&&<div className="awrn">⚠️ 봇 서버 오프라인. PC에서 naver-bot 실행 필요.</div>}

                {pubSub==="publish"&&(
                  <div>
                    <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                      <div className="asl2">🌐 플랫폼</div>
                      <div style={{display:"flex",gap:10}}>
                        {(["naver","tistory"] as const).map(p=>(
                          <button key={p} className={`apb ${platform===p?(p==="naver"?"pn":"pt"):""}`} onClick={()=>setPlatform(p)}>
                            <span style={{fontSize:20}}>{p==="naver"?"🟢":"🟠"}</span>
                            <div><div style={{fontSize:12,fontWeight:700,color:platform===p?(p==="naver"?"#03C75A":"#FF6B35"):"var(--m)"}}>{p==="naver"?"네이버":"티스토리"}</div><div style={{fontSize:10,color:"var(--m)"}}>Playwright</div></div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                      <div className="asl2">🔗 계정</div>
                      {connAccs.length===0?<div style={{padding:"14px",textAlign:"center",color:"var(--m)",fontSize:12}}>연결된 계정 없음 → <button style={{background:"none",border:"none",color:"var(--a)",cursor:"pointer",fontWeight:700}} onClick={()=>setPubSub("accounts")}>계정 관리</button></div>
                      :connAccs.map(a=>(
                        <div key={a.id} onClick={()=>setPubAccId(a.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 11px",borderRadius:9,cursor:"pointer",marginBottom:5,background:pubAccId===a.id?"var(--ad)":"var(--ib)",border:`1.5px solid ${pubAccId===a.id?"var(--b2)":"var(--b)"}`}}>
                          <div style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${pubAccId===a.id?"var(--a)":"var(--m)"}`,background:pubAccId===a.id?"var(--a)":"transparent",flexShrink:0}}/>
                          <span style={{fontSize:12,fontWeight:600}}>{a.username}</span>
                        </div>
                      ))}
                    </div>
                    <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                      <div className="asl2">📝 발행 내용</div>
                      {pubImageUrl&&(
                        <div style={{marginBottom:12}}>
                          <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:5,textTransform:"uppercase"}}>🖼️ 발행 이미지</label>
                          <div style={{position:"relative"}}>
                            <img src={pubImageUrl} alt="" style={{width:"100%",maxHeight:180,objectFit:"cover",borderRadius:10,border:"1px solid var(--b)"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                            <button onClick={()=>setPubImageUrl("")} style={{position:"absolute",top:6,right:6,background:"rgba(0,0,0,.6)",border:"none",color:"#fff",borderRadius:99,width:24,height:24,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                          </div>
                        </div>
                      )}
                      <div style={{display:"flex",flexDirection:"column",gap:9}}>
                        {[{l:"제목",v:pubTitle,s:setPubTitle,ph:"제목..."},{l:"태그",v:pubTags,s:setPubTags,ph:"태그1, 태그2"}].map(f=>(
                          <div key={f.l}><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3,textTransform:"uppercase"}}>{f.l}</label><input className="ainp" style={{width:"100%",padding:"10px 12px",fontSize:13}} placeholder={f.ph} value={f.v} onChange={e=>f.s(e.target.value)}/></div>
                        ))}
                        <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3,textTransform:"uppercase"}}>본문</label><textarea className="ainp" rows={7} style={{width:"100%",padding:"10px 12px",fontSize:13,resize:"vertical"}} value={pubContent} onChange={e=>setPubContent(e.target.value)}/></div>
                      </div>
                    </div>
                    <button className="abp" style={{width:"100%",justifyContent:"center",padding:"13px",fontSize:14}} onClick={handlePublish} disabled={publishing||!botOnline||!pubAccId||!pubTitle||!pubContent}>
                      {publishing?<><span className="asp2"/>발행 중...</>:<>🚀 자동 발행</>}
                    </button>
                    {pubMsg&&<div style={{marginTop:9,padding:"9px 12px",borderRadius:9,background:pubMsg.includes("✅")?"var(--ad)":"rgba(239,68,68,.08)",border:`1px solid ${pubMsg.includes("✅")?"var(--b2)":"rgba(239,68,68,.2)"}`,fontSize:13,color:pubMsg.includes("✅")?"var(--a)":"var(--d)"}}>{pubMsg}</div>}
                  </div>
                )}

                {pubSub==="write"&&(
                  <div>
                    {/* 애드타입 선택 */}
                    <div className="acd" style={{padding:"14px 18px",marginBottom:11}}>
                      <div className="asl2">🎯 수익화 목적 선택</div>
                      <div style={{display:"flex",gap:10}}>
                        {([
                          {id:"adpost",label:"📰 네이버 애드포스트",sub:"감성적·경험 공유형, 1200~1500자",color:"#03C75A"},
                          {id:"adsense",label:"🔍 구글 애드센스",sub:"정보성·SEO 최적화, 1500자+",color:"#4285F4"},
                        ] as const).map(t=>(
                          <button key={t.id} onClick={()=>setAdType(t.id)} style={{flex:1,padding:"12px 14px",borderRadius:13,border:`2px solid ${adType===t.id?t.color:"var(--b)"}`,background:adType===t.id?`${t.color}15`:"var(--ib)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .18s"}}>
                            <div style={{fontSize:13,fontWeight:700,color:adType===t.id?t.color:"var(--tx)",marginBottom:3}}>{t.label}</div>
                            <div style={{fontSize:10,color:"var(--m)"}}>{t.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 키워드 입력 */}
                    <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                      <div className="asl2">🔍 키워드 입력</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 100px",gap:9,marginBottom:10}}>
                        <div>
                          <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>키워드</label>
                          <input className="ainp" style={{width:"100%",padding:"11px 13px",fontSize:14}} placeholder="예: 강남 맛집, 다이어트 방법, 제주도 여행..." value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGenerateTitles(true)}/>
                        </div>
                        <div>
                          <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>플랫폼</label>
                          <select className="ainp" style={{width:"100%",padding:"11px 12px"}} value={platform} onChange={e=>setPlatform(e.target.value as any)}>
                            <option value="naver">네이버</option><option value="tistory">티스토리</option>
                          </select>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button className="abp" onClick={()=>handleGenerateTitles(true)} disabled={loadingTitles||!keyword}>
                          {loadingTitles?<><span className="asp2"/>생성 중...</>:<>⭐ 제목 30개 추천</>}
                        </button>
                        {titles.length>0&&<button className="abp" style={{background:"rgba(99,102,241,.15)",color:"#818cf8",border:"1px solid rgba(99,102,241,.3)"}} onClick={()=>handleGenerateTitles(false)} disabled={loadingTitles}>
                          {titles.length>=90?"🔄 초기화 후 재생성":"➕ 30개 추가"}
                        </button>}
                        {titles.length>0&&<button onClick={()=>{setTitles([]);setSelectedTitle("");localStorage.removeItem("publy_adm_titles");}} style={{padding:"8px 12px",borderRadius:9,border:"1px solid rgba(239,68,68,.3)",background:"rgba(239,68,68,.08)",color:"#ef4444",cursor:"pointer",fontSize:11,fontWeight:700}}>🗑 초기화</button>}
                      </div>
                      {titles.length>0&&(
                        <div style={{marginTop:9,display:"flex",alignItems:"center",gap:8}}>
                          <div style={{flex:1,height:5,background:"var(--b)",borderRadius:99,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${(titles.length/90)*100}%`,background:titles.length>=90?"#ef4444":"var(--a)",borderRadius:99,transition:"width .4s"}}/>
                          </div>
                          <span style={{fontSize:10,color:titles.length>=90?"#ef4444":"var(--m)",fontFamily:"monospace",flexShrink:0}}>{titles.length}/90{titles.length>=90?" — 초기화 후 재생성":""}</span>
                        </div>
                      )}
                    </div>

                    {/* 제목 목록 */}
                    {titles.length>0&&(
                      <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                        <div className="asl2">✨ 제목 선택 (클릭하세요)</div>
                        {selectedTitle&&(
                          <div style={{padding:"9px 13px",borderRadius:10,background:"var(--ad)",border:"1px solid var(--b2)",marginBottom:11,fontSize:13,fontWeight:700,color:"var(--a)"}}>
                            ✅ 선택됨: {selectedTitle}
                          </div>
                        )}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:8,maxHeight:380,overflowY:"auto"}}>
                          {titles.map((t,i)=>(
                            <button key={`${t}-${i}`} onClick={()=>setSelectedTitle(t)} style={{padding:"11px 13px",borderRadius:11,border:`1.5px solid ${selectedTitle===t?"var(--a)":"var(--b)"}`,background:selectedTitle===t?"var(--ad)":"var(--ib)",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s",position:"relative"}}>
                              <div style={{fontSize:9,color:selectedTitle===t?"var(--a)":"var(--m)",marginBottom:4,fontFamily:"monospace"}}>#{titles.length-i}</div>
                              <div style={{fontSize:12,fontWeight:600,color:selectedTitle===t?"var(--a)":"#e2e8f0",lineHeight:1.5}}>{t}</div>
                              {selectedTitle===t&&<div style={{position:"absolute",top:8,right:8,width:18,height:18,borderRadius:"50%",background:"var(--a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#000",fontWeight:900}}>✓</div>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 본문+이미지 생성 */}
                    {(selectedTitle||keyword)&&(
                      <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                        <div className="asl2">⚙️ 생성 설정</div>

                        {/* 목표 글자수 */}
                        <div style={{marginBottom:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                            <label style={{fontSize:9,color:"var(--m)",fontWeight:700,textTransform:"uppercase"}}>목표 글자수</label>
                            <span style={{fontSize:11,fontWeight:700,color:"var(--a)"}}>{targetChars.toLocaleString()}자</span>
                          </div>
                          <input type="range" min={1200} max={1500} step={50} value={targetChars} onChange={e=>setTargetChars(Number(e.target.value))} style={{width:"100%",accentColor:"var(--a)"}}/>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"var(--m)",marginTop:3}}>
                            <span>1200자</span><span>1350자</span><span>1500자</span>
                          </div>
                        </div>

                        {/* 이미지 소스 */}
                        <div style={{marginBottom:12}}>
                          <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:6,textTransform:"uppercase"}}>이미지 소스</label>
                          <div style={{display:"flex",gap:8}}>
                            {([{id:"ai",label:"🤖 AI 생성"},{id:"upload",label:"📁 내 이미지"},{id:"none",label:"🚫 없음"}] as const).map(s=>(
                              <button key={s.id} onClick={()=>setImgSource(s.id)} style={{flex:1,padding:"8px 10px",borderRadius:10,border:`1.5px solid ${imgSource===s.id?"var(--a)":"var(--b)"}`,background:imgSource===s.id?"var(--ad)":"var(--ib)",cursor:"pointer",fontSize:11,fontWeight:600,color:imgSource===s.id?"var(--a)":"var(--m)",fontFamily:"inherit",transition:"all .15s"}}>
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 업로드 */}
                        {imgSource==="upload"&&(
                          <div style={{marginBottom:12}}>
                            <label style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:10,border:"1.5px dashed var(--b2)",background:"var(--ad)",cursor:"pointer"}}>
                              <span style={{fontSize:18}}>📁</span>
                              <span style={{fontSize:12,color:"var(--a)",fontWeight:600}}>클릭해서 이미지 선택 (여러장 가능)</span>
                              <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{display:"none"}}/>
                            </label>
                            {uploadedImages.length>0&&(
                              <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                                {uploadedImages.map((img,i)=>(
                                  <div key={i} style={{position:"relative"}}>
                                    <img src={img} alt="" style={{width:60,height:60,objectFit:"cover",borderRadius:8,border:"1px solid var(--b)"}}/>
                                    <button onClick={()=>setUploadedImages(prev=>prev.filter((_,j)=>j!==i))} style={{position:"absolute",top:-4,right:-4,width:16,height:16,borderRadius:"50%",background:"#ef4444",border:"none",color:"#fff",cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {selectedTitle&&<div style={{padding:"9px 12px",borderRadius:9,background:"var(--ib)",marginBottom:10,fontSize:12}}>선택 제목: <strong style={{color:"var(--a)"}}>{selectedTitle}</strong></div>}
                        <button className="abp" onClick={handleGenerate} disabled={generating}>
                          {generating?<><span className="asp2"/>AI 작성 중...</>:<>✍️ 본문 + 이미지 생성</>}
                        </button>
                      </div>
                    )}

                    {/* 생성 결과 */}
                    {genContent&&(
                      <>
                        {/* 미리보기 모달 */}
                        {showPreview&&(
                          <div style={{position:"fixed",inset:0,zIndex:999,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowPreview(false)}>
                            <div style={{width:"100%",maxWidth:680,maxHeight:"90vh",overflowY:"auto",background:"#fff",borderRadius:16,padding:"32px 24px"}} onClick={e=>e.stopPropagation()}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                                <div style={{fontSize:12,color:"#888",fontWeight:600}}>📱 구독자 미리보기</div>
                                <button onClick={()=>setShowPreview(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#888"}}>✕</button>
                              </div>
                              <div style={{fontFamily:"'Apple SD Gothic Neo','Malgun Gothic',sans-serif"}}>
                                <h1 style={{fontSize:22,fontWeight:700,color:"#191919",lineHeight:1.4,marginBottom:16}}>{genTitle}</h1>
                                {genTags&&<div style={{marginBottom:16,display:"flex",flexWrap:"wrap",gap:6}}>
                                  {genTags.split(",").map((t,i)=><span key={i} style={{fontSize:12,padding:"3px 10px",borderRadius:99,background:"#f1f3f5",color:"#495057"}}>#{t.trim()}</span>)}
                                </div>}
                                {getActiveImages()[0]&&<img src={getActiveImages()[0]} alt="" style={{width:"100%",maxHeight:300,objectFit:"cover",borderRadius:8,marginBottom:20}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>}
                                {splitContentWithImages(genContent,getActiveImages().slice(1)).map((section,i)=>(
                                  <div key={i}>
                                    {section.img
                                      ?<img src={section.img} alt="" style={{width:"100%",maxHeight:260,objectFit:"cover",borderRadius:8,margin:"16px 0"}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                      :<div style={{fontSize:15,color:"#333",lineHeight:1.9,whiteSpace:"pre-wrap",marginBottom:8}}>{section.text}</div>
                                    }
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11,flexWrap:"wrap",gap:7}}>
                            <div className="asl2" style={{marginBottom:0}}>🎨 생성 결과</div>
                            <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                              <span style={{fontSize:10,padding:"3px 9px",borderRadius:99,background:"var(--ad)",color:"var(--a)",fontWeight:700}}>
                                {genContent.length.toLocaleString()}자 · 추천 {recommendImageCount(genContent)}장
                              </span>
                              <button onClick={()=>setShowPreview(true)} style={{padding:"5px 12px",borderRadius:9,border:"1px solid var(--b2)",background:"var(--ad)",color:"var(--a)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                                👁️ 미리보기
                              </button>
                            </div>
                          </div>

                          {/* 이미지 수량 조절 */}
                          {imgSource!=="none"&&(
                            <div style={{marginBottom:12,padding:"10px 14px",borderRadius:10,background:"var(--ib)",border:"1px solid var(--b)"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                                <label style={{fontSize:10,color:"var(--m)",fontWeight:700}}>🖼️ 이미지 수량 (200자당 1장 기준)</label>
                                <div style={{display:"flex",alignItems:"center",gap:7}}>
                                  <span style={{fontSize:11,fontWeight:700,color:"var(--a)"}}>{imgCountManual??recommendImageCount(genContent)}장</span>
                                  {imgCountManual!==null&&<button onClick={()=>setImgCountManual(null)} style={{fontSize:9,padding:"2px 7px",borderRadius:6,border:"1px solid var(--b)",background:"transparent",color:"var(--m)",cursor:"pointer",fontFamily:"inherit"}}>자동</button>}
                                </div>
                              </div>
                              <input type="range" min={0} max={20} step={1} value={imgCountManual??recommendImageCount(genContent)} onChange={e=>setImgCountManual(Number(e.target.value))} style={{width:"100%",accentColor:"var(--a)"}}/>
                              {imgSource==="ai"&&(
                                <button onClick={()=>handleGenerateImages(imgCountManual??recommendImageCount(genContent))} disabled={genImgLoading}
                                  style={{marginTop:8,padding:"6px 14px",borderRadius:9,border:"none",background:"var(--a)",color:"#000",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:5}}>
                                  {genImgLoading?<><span className="asp2" style={{borderTopColor:"#000",borderColor:"rgba(0,0,0,.2)"}}/>생성 중...</>:"🔄 이미지 재생성"}
                                </button>
                              )}
                            </div>
                          )}

                          {/* 이미지 갤러리 */}
                          {getActiveImages().length>0&&(
                            <div style={{marginBottom:12}}>
                              <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:6,textTransform:"uppercase"}}>
                                🖼️ 이미지 {getActiveImages().length}장 — 첫번째=썸네일
                              </label>
                              {genImgLoading&&<div style={{fontSize:11,color:"var(--a)",marginBottom:6,animation:"as 1s infinite"}}>⏳ 이미지 생성 중...</div>}
                              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                {getActiveImages().map((img,i)=>(
                                  <div key={i} style={{position:"relative"}}>
                                    <img src={img} alt="" style={{width:80,height:80,objectFit:"cover",borderRadius:8,border:`2px solid ${i===0?"var(--a)":"var(--b)"}`}} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                                    {i===0&&<span style={{position:"absolute",top:-7,left:-5,fontSize:8,fontWeight:800,padding:"2px 5px",borderRadius:99,background:"var(--a)",color:"#000"}}>썸네일</span>}
                                    <button onClick={()=>{if(imgSource==="ai")setGeneratedImages(prev=>prev.filter((_,j)=>j!==i));else setUploadedImages(prev=>prev.filter((_,j)=>j!==i));}}
                                      style={{position:"absolute",top:-5,right:-5,width:17,height:17,borderRadius:"50%",background:"#ef4444",border:"none",color:"#fff",cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div style={{display:"flex",flexDirection:"column",gap:9}}>
                            {[{l:"제목",v:genTitle,s:setGenTitle},{l:"태그",v:genTags,s:setGenTags}].map(f=>(
                              <div key={f.l}>
                                <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>{f.l}</label>
                                <input className="ainp" style={{width:"100%",padding:"10px 12px",fontSize:13}} value={f.v} onChange={e=>f.s(e.target.value)}/>
                              </div>
                            ))}
                            <div>
                              <label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>본문 ({genContent.length.toLocaleString()}자)</label>
                              <textarea className="ainp" rows={10} style={{width:"100%",padding:"10px 12px",fontSize:13,resize:"vertical"}} value={genContent} onChange={e=>setGenContent(e.target.value)}/>
                            </div>
                          </div>
                        </div>
                        <button className="abp" style={{width:"100%",justifyContent:"center",padding:"12px"}} onClick={()=>{setPubTitle(genTitle);setPubContent(genContent);setPubTags(genTags);setPubImageUrl(getActiveImages()[0]||"");setPubSub("publish");}}>
                          🚀 발행하기로 넘기기
                        </button>
                      </>
                    )}
                  </div>
                )}

                {pubSub==="accounts"&&(
                  <div>
                    <div className="acd" style={{padding:"16px 18px",marginBottom:11}}>
                      <div className="asl2">➕ 계정 추가</div>
                      <div style={{display:"grid",gridTemplateColumns:"90px 1fr 1fr",gap:9,marginBottom:9}}>
                        <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>플랫폼</label><select className="ainp" style={{width:"100%"}} value={newPlat} onChange={e=>setNewPlat(e.target.value as any)}><option value="naver">네이버</option><option value="tistory">티스토리</option></select></div>
                        <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>아이디</label><input className="ainp" style={{width:"100%"}} placeholder="아이디" value={newUser} onChange={e=>setNewUser(e.target.value)}/></div>
                        <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>비밀번호</label><div style={{position:"relative"}}><input className="ainp" type={showPw?"text":"password"} style={{width:"100%",paddingRight:32}} placeholder="비밀번호" value={newPw} onChange={e=>setNewPw(e.target.value)}/><button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"var(--m)"}}>{showPw?"🙈":"👁"}</button></div></div>
                      </div>
                      <button className="abp" style={{padding:"8px 15px",fontSize:12}} onClick={handleAddAcc} disabled={addingAcc}>{addingAcc?<><span className="asp2"/>추가 중...</>:<>➕ 추가</>}</button>
                    </div>
                    {admAccs.map((a,i)=>(
                      <div key={a.id} className="acd" style={{padding:"13px 16px",marginBottom:8,animation:`af .3s ease ${i*.06}s both`,borderColor:a.is_connected?(a.platform==="naver"?"rgba(3,199,90,.3)":"rgba(255,107,53,.3)"):"var(--b)"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                          <span style={{fontSize:20}}>{a.platform==="naver"?"🟢":"🟠"}</span>
                          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{a.username}</div><div style={{fontSize:10,color:"var(--m)"}}>{a.platform}</div></div>
                          <span style={{fontSize:9,padding:"3px 9px",borderRadius:99,fontWeight:800,background:a.is_connected?"rgba(0,200,117,.12)":"var(--ib)",color:a.is_connected?"var(--s)":"var(--m)"}}>{a.is_connected?"✅ 연결됨":"미연결"}</span>
                          <button className="abp" style={{padding:"6px 12px",fontSize:11}} onClick={()=>handleConnect(a)} disabled={!!connId||!botOnline}>{connId===a.id?<><span className="asp2"/>연결 중...</>:a.is_connected?"재연결":"연결"}</button><button onClick={async()=>{if(!confirm("삭제할까요?"))return;await supabase.from("publy_accounts").delete().eq("id",a.id);getAccounts(ADM_UID).then(setAdmAccs);}} style={{padding:"6px 10px",fontSize:11,background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:"#ef4444",cursor:"pointer",fontWeight:700}}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 회원관리 */}
            {tab==="users"&&(
              <div style={{animation:"af .3s ease both"}}>
                <div className="asg">
                  {[{l:"전체",v:tu,c:"var(--a)",i:"👥"},{l:"활성",v:au,c:"var(--s)",i:"✅"},{l:"PRO",v:pu,c:"#4285F4",i:"⭐"},{l:"총 발행",v:tp,c:"var(--a)",i:"🚀"}].map((s,i)=>(
                    <div key={i} className="ast" style={{animationDelay:`${i*.06}s`}}>
                      <div style={{fontSize:18,marginBottom:4}}>{s.i}</div>
                      <div className="asv" style={{color:s.c}}>{s.v}</div>
                      <div className="asl">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:11}}><input className="ainp" style={{width:"100%",padding:"11px 14px",fontSize:13}} placeholder="🔍 이름 또는 이메일 검색..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
                <div className="acd">
                  <div style={{padding:"12px 18px",borderBottom:"1px solid var(--b)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:13,fontWeight:700}}>회원 목록 <span style={{color:"var(--m)",fontWeight:400}}>({filtered.length}명)</span></span>
                    <span style={{fontSize:11,color:"var(--m)"}}>클릭 → 상세 관리</span>
                  </div>
                  {loading?(<div style={{padding:"48px",textAlign:"center",color:"var(--m)"}}><div style={{width:28,height:28,borderRadius:"50%",border:"3px solid var(--b)",borderTopColor:"var(--a)",animation:"as 1s linear infinite",margin:"0 auto 10px"}}/>불러오는 중...</div>)
                  :filtered.map((u,i)=>{
                    const pct=u.quota?Math.min(100,u.quota.used_quota/u.quota.total_quota*100):0;
                    return(
                      <div key={u.id} className="aur" style={{animationDelay:`${i*.04}s`}} onClick={()=>setSelUser(u)}>
                        <div style={{display:"flex",alignItems:"center",gap:11}}>
                          <div className="aua">{(u.name||u.email)[0].toUpperCase()}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2,flexWrap:"wrap"}}>
                              <span style={{fontSize:13,fontWeight:700}}>{u.name||"이름없음"}</span>
                              <span className={`api p${u.plan[0]}`}>{PLAN_LABELS[u.plan]}</span>
                              {!u.is_active&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:99,background:"rgba(239,68,68,.1)",color:"var(--d)",fontWeight:800}}>비활성</span>}
                            </div>
                            <div style={{fontSize:11,color:"var(--m)",fontFamily:"'JetBrains Mono',monospace"}}>{u.email}</div>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                            {u.quota&&<span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"var(--m)"}}>{u.quota.used_quota}/{u.quota.total_quota}건</span>}
                            <span style={{fontSize:10,color:"var(--m)"}}>발행 {u.history_count||0}</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M9 18L15 12L9 6" stroke="var(--m)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 통계 */}
            {tab==="stats"&&(
              <div style={{animation:"af .3s ease both"}}>
                <div className="asg" style={{gridTemplateColumns:"repeat(4,1fr)"}}>
                  {[{l:"전체 회원",v:tu,c:"var(--a)",i:"👥"},{l:"활성 회원",v:au,c:"var(--s)",i:"✅"},{l:"비활성",v:tu-au,c:"var(--d)",i:"🚫"},{l:"PRO",v:pu,c:"#4285F4",i:"⭐"},{l:"BASIC",v:users.filter(u=>u.plan==="basic").length,c:"#4285F4",i:"🔵"},{l:"FREE",v:users.filter(u=>u.plan==="free").length,c:"var(--m)",i:"⚪"},{l:"총 발행",v:tp,c:"var(--a)",i:"🚀"},{l:"평균 발행",v:tu?Math.round(tp/tu):0,c:"var(--a2)",i:"📊"}].map((s,i)=>(
                    <div key={i} className="ast" style={{animationDelay:`${i*.05}s`}}>
                      <div style={{fontSize:18,marginBottom:3}}>{s.i}</div>
                      <div className="asv" style={{color:s.c,fontSize:26}}>{s.v}</div>
                      <div className="asl">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div className="acd" style={{padding:"18px 20px"}}>
                  <div className="asl2">📊 플랜 분포</div>
                  {[{l:"PRO",c:"var(--s)"},{l:"BASIC",c:"#4285F4"},{l:"FREE",c:"var(--m)"}].map(p=>{const cnt=users.filter(u=>u.plan===p.l.toLowerCase()).length;return(
                    <div key={p.l} style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12,fontWeight:700,color:p.c}}>{p.l}</span><span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"var(--m)"}}>{cnt}명 ({tu?Math.round(cnt/tu*100):0}%)</span></div>
                      <div className="aqb" style={{height:8}}><div className="aqf" style={{"--w":`${tu?cnt/tu*100:0}%`,width:`${tu?cnt/tu*100:0}%`,background:p.c} as any}/></div>
                    </div>
                  );})}
                </div>
              </div>
            )}

            {/* 설정 */}
            {tab==="settings"&&(
              <div style={{animation:"af .3s ease both"}}>
                <AdminApiKeySettings />
                <div className="acd" style={{padding:"18px 20px",marginBottom:12}}>
                  <div className="asl2">🎨 Google Flow</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:10}}>
                    <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>이메일</label><input className="ainp" type="email" style={{width:"100%"}} placeholder="admin@gmail.com" value={flowEmail} onChange={e=>setFlowEmail(e.target.value)}/></div>
                    <div><label style={{fontSize:9,color:"var(--m)",fontWeight:700,display:"block",marginBottom:3}}>비밀번호</label><input className="ainp" type="password" style={{width:"100%"}} placeholder="••••••••" value={flowPw} onChange={e=>setFlowPw(e.target.value)}/></div>
                  </div>
                  <button className="abp" style={{padding:"9px 16px",fontSize:12}} onClick={()=>{localStorage.setItem("admin_flow_email",flowEmail);localStorage.setItem("admin_flow_pw",flowPw);alert("저장됨!");}}>💾 저장</button>
                </div>
                <div className="acd" style={{padding:"18px 20px",marginBottom:12}}>
                  <div className="asl2">🔐 관리자 비밀번호 변경</div>
                  <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:11}}>
                    <input className="ainp" type="password" style={{width:"100%",padding:"11px 13px",fontSize:13}} placeholder="새 비밀번호" value={newPw1} onChange={e=>setNewPw1(e.target.value)}/>
                    <input className="ainp" type="password" style={{width:"100%",padding:"11px 13px",fontSize:13}} placeholder="비밀번호 확인" value={newPw2} onChange={e=>setNewPw2(e.target.value)} onKeyDown={e=>e.key==="Enter"&&changeAdminPw()}/>
                  </div>
                  <button className="abp" style={{padding:"10px 20px",fontSize:13}} onClick={changeAdminPw}>🔐 변경</button>
                  {pwMsg&&<div style={{marginTop:9,padding:"8px 11px",borderRadius:8,background:pwMsg.includes("✅")?"var(--ad)":"rgba(239,68,68,.08)",fontSize:12,color:pwMsg.includes("✅")?"var(--a)":"var(--d)"}}>{pwMsg}</div>}
                </div>

                {/* BlogAuto Pro 연동 */}
                <div className="acd" style={{padding:"18px 20px",marginBottom:12,border:"1px solid rgba(99,102,241,.3)",background:"rgba(99,102,241,.05)"}}>
                  <div className="asl2" style={{color:"#6366f1"}}>🔗 BlogAuto Pro 연동</div>
                  <div style={{fontSize:11,color:"var(--m)",marginBottom:14,lineHeight:1.6}}>
                    BlogAuto Pro는 AI 블로그 자동화 플랫폼입니다.<br/>
                    회원 관리, API 키 설정, 발행 현황을 통합 관리할 수 있습니다.
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:9}}>
                    <a href="https://blogautopro.com/superadmin" target="_blank" rel="noopener noreferrer"
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",borderRadius:12,background:"linear-gradient(135deg,rgba(99,102,241,.15),rgba(139,92,246,.1))",border:"1px solid rgba(99,102,241,.3)",textDecoration:"none",transition:"all .2s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:34,height:34,borderRadius:9,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:900,color:"#fff",flexShrink:0}}>B</div>
                        <div>
                          <div style={{fontSize:13,fontWeight:800,color:"#6366f1",lineHeight:1.2}}>BlogAuto Pro 관리자</div>
                          <div style={{fontSize:10,color:"var(--m)",marginTop:2}}>회원 · API키 · 발행현황 통합 관리</div>
                        </div>
                      </div>
                      <span style={{fontSize:16,color:"#6366f1"}}>→</span>
                    </a>
                    <a href="https://blogautopro.com/naver" target="_blank" rel="noopener noreferrer"
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",borderRadius:12,background:"rgba(3,199,90,.06)",border:"1px solid rgba(3,199,90,.25)",textDecoration:"none",transition:"all .2s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:34,height:34,borderRadius:9,background:"linear-gradient(135deg,#03C75A,#059669)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"#fff",flexShrink:0}}>N</div>
                        <div>
                          <div style={{fontSize:13,fontWeight:800,color:"#03C75A",lineHeight:1.2}}>자동발행 허브</div>
                          <div style={{fontSize:10,color:"var(--m)",marginTop:2}}>네이버 · 티스토리 발행 현황 확인</div>
                        </div>
                      </div>
                      <span style={{fontSize:16,color:"#03C75A"}}>→</span>
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 모바일 탭바 */}
        <div className="amb">
          {TABS.map(t=>(
            <button key={t.k} className={`ambb ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k as any)}>
              <span className="ambi">{t.i}</span><span className="ambl">{t.l}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
