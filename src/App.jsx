import { useState, useMemo, useRef, useEffect } from "react";
import Papa from "papaparse";
import Chart from "chart.js/auto";

/* ---------- Local persistence (minimal addition for standalone runtime) ---------- */
const STORAGE_KEY = "humanitarian_dataflow_state_v1";
function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
function persistState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore quota/availability errors — demo still works without persistence */
  }
}

/* ---------- Domain data ---------- */
const PROJECTS = {
  "Talvora Nutrition Response": ["Kestrel District","Amber Valley","Riverbend"],
  "Winter Shelter Program": ["Kestrel District","Northgate","Stonebridge"],
  "Water & Sanitation Initiative": ["Riverbend","Stonebridge","Marrow Hills"],
  "Mobile Health Outreach": ["Amber Valley","Northgate","Marrow Hills"],
};
const PROJECT_NAMES = Object.keys(PROJECTS);
const SECTORS = ["Nutrition","Shelter","WASH","Health"];
const SERVICE_TYPES = ["Food Basket","Blanket Kit","Water Filter Kit","Medical Consultation","Hygiene Kit"];
const STATUSES = ["completed","planned","cancelled"];
const REQUIRED = ["record_id","project","location","sector","activity_date","reported_date","service_type","quantity","status"];

function pad(n){return String(n).padStart(2,"0");}
function fmtDate(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function daysBetween(a,b){return Math.round((b-a)/86400000);}
function rnd(arr){return arr[Math.floor(Math.random()*arr.length)];}
function todayUTC(){const t=new Date(); return new Date(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()));}

/* ---------- Synthetic dataset generator ---------- */
function genDataset(n=52){
  const today = todayUTC();
  const rows=[];
  for(let i=1;i<=n;i++){
    const project = rnd(PROJECT_NAMES);
    const validLocs = PROJECTS[project];
    let location = rnd(validLocs);
    const sector = SECTORS[PROJECT_NAMES.indexOf(project)];
    const service_type = rnd(SERVICE_TYPES);
    let status = Math.random()<0.82 ? "completed" : rnd(["planned","cancelled"]);
    let quantity = Math.floor(Math.random()*40)+1;
    const actOffset = Math.floor(Math.random()*90)+1;
    const activityDateObj = new Date(today.getTime()-actOffset*86400000);
    let activity_date = fmtDate(activityDateObj);
    let reportedOffset = Math.floor(Math.random()*10);
    let reported_date = fmtDate(new Date(activityDateObj.getTime()+reportedOffset*86400000));

    const row = {record_id:`TLV-${1000+i}`,project,location,sector,activity_date,reported_date,service_type,quantity:String(quantity),status};

    // inject deliberate issues into ~40% of rows
    const roll = Math.random();
    if(roll<0.06){ row.quantity = "0"; } // qty error
    else if(roll<0.11){ row.activity_date = fmtDate(new Date(today.getTime()+7*86400000)); } // future date error
    else if(roll<0.16){ row.activity_date = "13/45/2026"; } // invalid date error
    else if(roll<0.24){ // timeliness warning
      const late = 32+Math.floor(Math.random()*20);
      row.reported_date = fmtDate(new Date(activityDateObj.getTime()+late*86400000));
    } else if(roll<0.30){ // location mismatch warning
      const others = PROJECT_NAMES.filter(p=>p!==project).flatMap(p=>PROJECTS[p]).filter(l=>!validLocs.includes(l));
      row.location = rnd(others);
    } else if(roll<0.34){ // status consistency error
      row.status="cancelled"; row.quantity=String(Math.floor(Math.random()*20)+5);
    } else if(roll<0.37){ row.project=""; } // missing required
    rows.push(row);
  }
  // inject a couple of duplicate record_ids
  if(rows.length>10){ rows[7]={...rows[7], record_id: rows[3].record_id}; }
  if(rows.length>20){ rows[15]={...rows[15], record_id: rows[9].record_id}; }
  return rows;
}

/* ---------- Validation engine ---------- */
function validateRow(row, allRows){
  const issues=[];
  const add=(severity,field,message)=>issues.push({severity,field,message});

  REQUIRED.forEach(f=>{ if(!row[f] || String(row[f]).trim()==="") add("ERROR",f,`Missing required field "${f}".`); });

  const qty = Number(row.quantity);
  if(row.quantity!==undefined && row.quantity!=="" && (isNaN(qty)||qty<=0)) add("ERROR","quantity","Quantity must be greater than zero.");

  const actD = new Date(row.activity_date);
  const validAct = row.activity_date && !isNaN(actD.getTime());
  if(row.activity_date && !validAct) add("ERROR","activity_date","Activity date is not a valid date.");
  if(validAct && daysBetween(actD, todayUTC())<0) add("ERROR","activity_date","Activity date is in the future.");

  const repD = new Date(row.reported_date);
  const validRep = row.reported_date && !isNaN(repD.getTime());
  if(row.reported_date && !validRep) add("ERROR","reported_date","Reported date is not a valid date.");
  if(validAct && validRep){
    const gap = daysBetween(actD, repD);
    if(gap>30) add("WARNING","reported_date",`Reported ${gap} days after activity (>30 day threshold).`);
  }

  if(row.record_id){
    const dupes = allRows.filter(r=>r.record_id===row.record_id);
    if(dupes.length>1) add("ERROR","record_id","Duplicate record_id found in dataset.");
  }

  if(row.project && row.location && PROJECTS[row.project] && !PROJECTS[row.project].includes(row.location)){
    add("WARNING","location",`"${row.location}" is not an associated location for project "${row.project}".`);
  }

  if((row.status==="cancelled"||row.status==="planned") && qty>0 && row.status!=="" ){
    if(row.status==="cancelled") add("ERROR","status","A cancelled activity has a positive completed service quantity.");
  }

  const severity = issues.some(i=>i.severity==="ERROR") ? "ERROR" : issues.some(i=>i.severity==="WARNING") ? "WARNING" : "VALID";
  return {severity, issues};
}

function validateAll(rows){
  return rows.map(row=>({...row, _v: validateRow(row, rows)}));
}

/* ---------- Sample CSV (dirty, for upload demo) ---------- */
function sampleDirtyCsv(){
  const header = REQUIRED.join(",");
  const rows = [
    ["TLV-9001","Winter Shelter Program","Kestrel District","Shelter","2026-08-01","2026-08-02","Blanket Kit","12","completed"],
    ["TLV-9002","Water & Sanitation Initiative","Stonebridge","WASH","2026-08-05","2026-10-01","Water Filter Kit","8","completed"],
    ["TLV-9003","Mobile Health Outreach","Amber Valley","Health","2026-12-30","2026-08-06","Medical Consultation","5","completed"],
    ["TLV-9004","Talvora Nutrition Response","Northgate","Nutrition","2026-08-07","2026-08-08","Food Basket","0","completed"],
    ["TLV-9002","Water & Sanitation Initiative","Stonebridge","WASH","2026-08-05","2026-08-06","Water Filter Kit","8","completed"],
    ["TLV-9005","","Riverbend","Nutrition","2026-08-09","2026-08-09","Food Basket","15","completed"],
  ];
  return header+"\n"+rows.map(r=>r.join(",")).join("\n")+"\n";
}
function downloadCsv(){
  const blob = new Blob([sampleDirtyCsv()], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="talvora-sample-dirty.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Small UI atoms ---------- */
function Badge({sev}){
  const map={ERROR:["badge-err","Error"],WARNING:["badge-warn","Warning"],VALID:["badge-ok","Valid"]};
  const [cls,label]=map[sev]||map.VALID;
  return <span className={`badge ${cls}`}>{label}</span>;
}
function Banner(){
  return <div className="no-print bg-[#16241F] text-white text-center text-[12.5px] py-1.5 px-3">
    Demonstration system — fictional data only. Do not upload real data.
  </div>;
}
function StatCard({label,value,tone}){
  const toneCls = tone==="err"?"text-[var(--err)]":tone==="warn"?"text-[var(--warn)]":tone==="ok"?"text-[var(--ok)]":"text-[var(--ink)]";
  return <div className="card p-4">
    <div className="text-[12.5px] font-semibold text-[var(--sub)]">{label}</div>
    <div className={`text-3xl font-extrabold mt-1 ${toneCls}`}>{value}</div>
  </div>;
}

/* ---------- Chart ---------- */
function IssueChart({counts}){
  const ref = useRef(null); const chartRef = useRef(null);
  useEffect(()=>{
    if(chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(ref.current, {
      type:"bar",
      data:{ labels:["Valid","Warnings","Errors"],
        datasets:[{ data:[counts.valid,counts.warning,counts.error],
          backgroundColor:["#1F7A52","#9C6B12","#A6362C"], borderRadius:6, maxBarThickness:56 }]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ y:{beginAtZero:true, ticks:{precision:0}}, x:{grid:{display:false}} } }
    });
    return ()=>chartRef.current && chartRef.current.destroy();
  },[counts.valid,counts.warning,counts.error]);
  return <div className="h-56"><canvas ref={ref}></canvas></div>;
}

/* ---------- Pages ---------- */
function Dashboard({rows,setPage,setFocusId}){
  const counts = useMemo(()=>{
    let valid=0,warning=0,error=0;
    rows.forEach(r=>{ if(r._v.severity==="ERROR")error++; else if(r._v.severity==="WARNING")warning++; else valid++; });
    return {valid,warning,error};
  },[rows]);
  const review = rows.filter(r=>r._v.severity!=="VALID");
  const resolved = rows.filter(r=>r._resolved).length;
  return <div className="space-y-5">
    <div>
      <h1 className="text-2xl font-extrabold">Data Quality Dashboard</h1>
      <p className="text-[var(--sub)] text-sm mt-1">Republic of Talvora — service delivery activity data</p>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard label="Records processed" value={rows.length}/>
      <StatCard label="Valid" value={counts.valid} tone="ok"/>
      <StatCard label="Warnings" value={counts.warning} tone="warn"/>
      <StatCard label="Errors" value={counts.error} tone="err"/>
      <StatCard label="Needs review" value={review.length}/>
      <StatCard label="Resolved" value={resolved} tone="ok"/>
    </div>
    <div className="card p-4">
      <div className="font-semibold mb-2 text-sm">Issue counts</div>
      <IssueChart counts={counts}/>
    </div>
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">Records needing review</div>
        <button className="btn-ghost" onClick={()=>setPage("review")}>Open review queue →</button>
      </div>
      <table>
        <thead><tr><th>Record</th><th>Project</th><th>Severity</th><th>Top issue</th></tr></thead>
        <tbody>
          {review.slice(0,5).map(r=>(
            <tr key={r.record_id+Math.random()} className="cursor-pointer" onClick={()=>{setFocusId(r.record_id); setPage("records");}}>
              <td className="mono">{r.record_id||"—"}</td>
              <td>{r.project||"—"}</td>
              <td><Badge sev={r._v.severity}/></td>
              <td>{r._v.issues[0]?.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}

function Import({onImport}){
  const fileRef = useRef(null);
  const [summary,setSummary]=useState(null);
  const handleFile = (file)=>{
    Papa.parse(file, { header:true, skipEmptyLines:true, complete:(res)=>{
      const rows = res.data.map((r,i)=>({...r, record_id:r.record_id||`IMP-${i+1}`}));
      const validated = validateAll(rows);
      const c={valid:0,warning:0,error:0};
      validated.forEach(r=>{ if(r._v.severity==="ERROR")c.error++; else if(r._v.severity==="WARNING")c.warning++; else c.valid++; });
      setSummary({n:validated.length,...c});
      onImport(validated);
    }});
  };
  return <div className="space-y-5 max-w-2xl">
    <div>
      <h1 className="text-2xl font-extrabold">Data Import</h1>
      <p className="text-[var(--sub)] text-sm mt-1">Upload a CSV of service/activity records. Columns: {REQUIRED.join(", ")}.</p>
    </div>
    <div className="card p-8 text-center border-dashed"
      onDragOver={e=>e.preventDefault()}
      onDrop={e=>{e.preventDefault(); if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);}}>
      <p className="text-sm text-[var(--sub)] mb-3">Drag a CSV file here, or</p>
      <button type="button" className="btn" onClick={()=>fileRef.current.click()}>Choose CSV file</button>
      <input type="file" accept=".csv" ref={fileRef}
        style={{position:"absolute",width:"1px",height:"1px",padding:0,margin:"-1px",overflow:"hidden",clip:"rect(0,0,0,0)",whiteSpace:"nowrap",border:0}}
        onChange={e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); }}/>
      <div className="mt-4">
        <button type="button" className="btn-ghost text-[13px]" onClick={downloadCsv}>Download sample dirty CSV</button>
      </div>
    </div>
    {summary && <div className="card p-4 text-sm">
      <div className="font-semibold mb-1">Import summary</div>
      <div>{summary.n} records processed</div>
      <div className="text-[var(--ok)]">{summary.valid} valid</div>
      <div className="text-[var(--warn)]">{summary.warning} warnings</div>
      <div className="text-[var(--err)]">{summary.error} errors</div>
    </div>}
  </div>;
}

function Review({rows,issueStatus,setIssueStatus,setPage,setFocusId,setFocusIssue}){
  const key = (recordId,field)=>`${recordId}::${field}`;
  const issueRows = [];
  rows.forEach(r=>{
    r._v.issues.forEach((iss,i)=>{
      const status = issueStatus[key(r.record_id,iss.field)] || "Open";
      if(status==="Open" || status==="In Review") issueRows.push({r,iss,i,status});
    });
  });
  return <div className="space-y-5">
    <h1 className="text-2xl font-extrabold">Review Queue</h1>
    <div className="card overflow-x-auto">
      <table>
        <thead><tr><th>Record</th><th>Issue</th><th>Severity</th><th>Field</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {issueRows.map(({r,iss,i,status})=>(
            <tr key={r.record_id+iss.field+i}>
              <td className="mono">{r.record_id||"—"}</td>
              <td>{iss.message}</td>
              <td><Badge sev={iss.severity}/></td>
              <td className="mono text-[13px]">{iss.field}</td>
              <td>{status}</td>
              <td className="space-x-2 whitespace-nowrap">
                <button className="btn-ghost text-[13px]" onClick={()=>{setFocusId(r.record_id); setFocusIssue(iss.field); setPage("records-detail");}}>Open</button>
                {iss.severity==="WARNING" &&
                  <button className="btn-ghost text-[13px]" onClick={()=>setIssueStatus(s=>({...s,[key(r.record_id,iss.field)]:"Dismissed"}))}>Dismiss</button>}
              </td>
            </tr>
          ))}
          {issueRows.length===0 && <tr><td colSpan="6" className="text-center text-[var(--sub)] py-8">No outstanding issues — the review queue is clear.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

function RecordDetail({rows,setRows,focusId,setFocusId,focusIssue}){
  const idx = rows.findIndex(r=>r.record_id===focusId);
  const row = idx>=0?rows[idx]:null;
  const [draft,setDraft]=useState(row||{});
  useEffect(()=>{ setDraft(row||{}); },[focusId]);
  if(!row) return <div className="card p-6 text-sm text-[var(--sub)]">Select a record from the Review Queue or Records list.</div>;

  const save = ()=>{
    setRows(rs=>{ const next=[...rs]; next[idx]={...draft,_resolved:true,_reviewed:true}; return validateAll(next).map((r,i)=> i===idx? {...r,_resolved:next[idx]._resolved,_reviewed:true}:r); });
  };

  return <div className="grid md:grid-cols-2 gap-5">
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg mono">{row.record_id}</h2>
        <Badge sev={row._v.severity}/>
      </div>
      {REQUIRED.filter(f=>f!=="record_id").map(f=>(
        <div key={f}>
          <label className="text-[12px] font-semibold text-[var(--sub)] capitalize">{f.replace("_"," ")}</label>
          {f==="project" ? (
            <select className="w-full mt-1" value={draft[f]||""} onChange={e=>setDraft({...draft,[f]:e.target.value})}>
              <option value="">—</option>
              {PROJECT_NAMES.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          ) : f==="status" ? (
            <select className="w-full mt-1" value={draft[f]||""} onChange={e=>setDraft({...draft,[f]:e.target.value})}>
              {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input className="w-full mt-1" value={draft[f]||""} onChange={e=>setDraft({...draft,[f]:e.target.value})}/>
          )}
        </div>
      ))}
      <button className="btn mt-2" onClick={save}>Save & re-validate</button>
    </div>
    <div className="card p-5">
      <div className="font-semibold mb-3 text-sm">Data quality</div>
      {row._v.issues.length===0 && <div className="text-sm text-[var(--ok)]">No issues detected.</div>}
      <div className="space-y-3">
        {row._v.issues.map((iss,i)=>(
          <div key={i} className={`border rounded-lg p-3 ${iss.field===focusIssue?"border-[var(--brand)] bg-[#EEF3F1]":"border-[var(--line)]"}`}>
            <div className="flex items-center gap-2 mb-1"><Badge sev={iss.severity}/><span className="mono text-[12.5px] text-[var(--sub)]">{iss.field}</span>{iss.field===focusIssue && <span className="text-[11px] font-semibold text-[var(--brand)]">Selected from Review Queue</span>}</div>
            <div className="text-sm">{iss.message}</div>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-[var(--sub)] mt-4">The system detects issues and explains them. A human reviewer decides how each record is resolved.</p>
    </div>
  </div>;
}

function RecordsList({rows,setPage,setFocusId,setFocusIssue}){
  const [q,setQ]=useState("");
  const filtered = rows.filter(r=> !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-4">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-extrabold">Records</h1>
      <input placeholder="Search records…" value={q} onChange={e=>setQ(e.target.value)} className="w-56"/>
    </div>
    <div className="card overflow-x-auto">
      <table>
        <thead><tr><th>Record</th><th>Project</th><th>Location</th><th>Date</th><th>Status</th><th>Quality</th></tr></thead>
        <tbody>
          {filtered.map(r=>(
            <tr key={r.record_id+Math.random()} className="cursor-pointer" onClick={()=>{setFocusId(r.record_id); setFocusIssue(null); setPage("records-detail");}}>
              <td className="mono">{r.record_id||"—"}</td>
              <td>{r.project||"—"}</td>
              <td>{r.location||"—"}</td>
              <td className="mono text-[13px]">{r.activity_date}</td>
              <td className="capitalize">{r.status}</td>
              <td><Badge sev={r._v.severity}/></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}

function Report({rows}){
  const counts = useMemo(()=>{
    let valid=0,warning=0,error=0; rows.forEach(r=>{ if(r._v.severity==="ERROR")error++; else if(r._v.severity==="WARNING")warning++; else valid++; });
    return {valid,warning,error};
  },[rows]);
  const resolved = rows.filter(r=>r._resolved).length;
  const remaining = rows.filter(r=>r._v.severity!=="VALID" && !r._resolved && !r._dismissed).length;
  const ref = useRef(null); const chartRef=useRef(null);
  useEffect(()=>{
    if(chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(ref.current, {type:"bar", data:{labels:["Valid","Warnings","Errors"],
      datasets:[{data:[counts.valid,counts.warning,counts.error], backgroundColor:["#1F7A52","#9C6B12","#A6362C"], borderRadius:6}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});
    return ()=>chartRef.current && chartRef.current.destroy();
  },[counts]);
  const today = new Date(); const periodStart = new Date(today.getTime()-90*86400000);
  return <div className="space-y-5 max-w-3xl">
    <div className="no-print flex justify-end"><button type="button" className="btn" onClick={()=>window.print()}>Print report</button></div>
    <div className="card p-8">
      <div className="text-[12.5px] font-semibold text-[var(--sub)]">Open Relief Network (Demo)</div>
      <h1 className="text-2xl font-extrabold mt-1">Humanitarian DataFlow — Data Quality Report</h1>
      <p className="text-sm text-[var(--sub)] mt-1">Reporting period: {fmtDate(periodStart)} to {fmtDate(today)} · Republic of Talvora</p>
      <div className="grid grid-cols-3 gap-3 mt-6">
        <StatCard label="Records processed" value={rows.length}/>
        <StatCard label="Valid" value={counts.valid} tone="ok"/>
        <StatCard label="Warnings" value={counts.warning} tone="warn"/>
        <StatCard label="Errors" value={counts.error} tone="err"/>
        <StatCard label="Issues resolved" value={resolved} tone="ok"/>
        <StatCard label="Issues remaining" value={remaining} tone="warn"/>
      </div>
      <div className="mt-6 h-56"><canvas ref={ref}></canvas></div>
      <p className="text-[12px] text-[var(--sub)] mt-6 border-t border-[var(--line)] pt-3">
        Demonstration system — fictional data only. Do not upload real data.
      </p>
    </div>
  </div>;
}

/* ---------- App ---------- */
function App(){
  const persisted = loadPersistedState();
  const [rows,setRows]=useState(()=>{
    if(persisted && Array.isArray(persisted.rows) && persisted.rows.length){
      const raw = persisted.rows.map(({_v, ...r})=>r);
      return validateAll(raw);
    }
    return validateAll(genDataset());
  });
  const [page,setPage]=useState("dashboard");
  const [focusId,setFocusId]=useState(null);
  const [focusIssue,setFocusIssue]=useState(null);
  const [issueStatus,setIssueStatus]=useState(()=> (persisted && persisted.issueStatus) || {});
  const onImport = (validated)=> setRows(rs=>validateAll([...rs, ...validated]));

  // Minimal addition for standalone runtime: persist data/issue statuses/edits so a
  // page refresh or navigation doesn't unexpectedly reset the demo (no backend involved).
  useEffect(()=>{
    const plainRows = rows.map(({_v, ...r})=>r);
    persistState({rows: plainRows, issueStatus});
  },[rows, issueStatus]);

  const NAV = [["dashboard","Dashboard"],["import","Import"],["review","Review"],["records","Records"],["report","Report"]];

  return <div className="min-h-screen flex flex-col">
    <Banner/>
    <header className="no-print bg-[var(--panel)] border-b border-[var(--line)] px-5 py-3 flex items-center justify-between flex-wrap gap-3">
      <div>
        <div className="font-extrabold text-[15px]">Humanitarian DataFlow</div>
        <div className="text-[12px] text-[var(--sub)]">Open Relief Network (Demo)</div>
      </div>
      <nav className="flex gap-1 flex-wrap">
        {NAV.map(([k,label])=>(
          <div key={k} className={`navlink ${page===k||(k==="records"&&page==="records-detail")?"active":""}`} onClick={()=>setPage(k)}>{label}</div>
        ))}
      </nav>
    </header>
    <main className="flex-1 p-5 max-w-6xl w-full mx-auto">
      {page==="dashboard" && <Dashboard rows={rows} setPage={setPage} setFocusId={setFocusId}/>}
      {page==="import" && <Import onImport={onImport}/>}
      {page==="review" && <Review rows={rows} issueStatus={issueStatus} setIssueStatus={setIssueStatus} setPage={setPage} setFocusId={setFocusId} setFocusIssue={setFocusIssue}/>}
      {page==="records" && <RecordsList rows={rows} setPage={setPage} setFocusId={setFocusId} setFocusIssue={setFocusIssue}/>}
      {page==="records-detail" && <RecordDetail rows={rows} setRows={setRows} focusId={focusId} setFocusId={setFocusId} focusIssue={focusIssue}/>}
      {page==="report" && <Report rows={rows}/>}
    </main>
  </div>;
}

export default App;
