'use strict';

const DB_NAME='ees-workers';
const DB_VERSION=1;
const STORE='workers';
let workers=[];
let deferredInstall=null;

const $=s=>document.querySelector(s);
const els={list:$('#workerList'),empty:$('#emptyState'),total:$('#totalCount'),inside:$('#insideCount'),urgent:$('#urgentCount'),search:$('#searchInput'),workerDialog:$('#workerDialog'),workerForm:$('#workerForm'),exitDialog:$('#exitDialog'),exitForm:$('#exitForm'),historyDialog:$('#historyDialog'),toast:$('#toast')};

const DAY=86400000;
function parseDate(value){const [y,m,d]=value.split('-').map(Number);return new Date(Date.UTC(y,m-1,d))}
function iso(date){return date.toISOString().slice(0,10)}
function addDays(value,n){const d=typeof value==='string'?parseDate(value):new Date(value);return iso(new Date(d.getTime()+n*DAY))}
function diffDays(a,b){return Math.round((parseDate(b)-parseDate(a))/DAY)}
function today(){return iso(new Date())}
function formatDate(value){if(!value)return '—';return new Intl.DateTimeFormat('ka-GE',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(parseDate(value))}
function esc(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function uid(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}

function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function getAll(){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function put(worker){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).put(worker);req.onsuccess=resolve;req.onerror=()=>reject(req.error)})}
async function remove(id){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);req.onsuccess=resolve;req.onerror=()=>reject(req.error)})}
async function clearDB(){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).clear();req.onsuccess=resolve;req.onerror=()=>reject(req.error)})}

function normalizedStays(worker,excludeStayId=null){return worker.stays.filter(s=>s.id!==excludeStayId).map(s=>({entry:s.entry,exit:s.exit||today()}))}
function isPresent(date,stays){return stays.some(s=>date>=s.entry&&date<=s.exit)}
function usedInWindow(endDate,stays){let used=0;for(let i=0;i<180;i++)if(isPresent(addDays(endDate,-i),stays))used++;return used}
function maxDeparture(worker,stay){
  const historical=normalizedStays(worker,stay.id);
  let lastAllowed=addDays(stay.entry,-1);
  for(let i=0;i<370;i++){
    const candidate=addDays(stay.entry,i);
    const proposed=[...historical,{entry:stay.entry,exit:candidate}];
    if(i>=90||usedInWindow(candidate,proposed)>90)break;
    lastAllowed=candidate;
  }
  return lastAllowed;
}
function earliestReturn(worker,exitDate){
  const stays=normalizedStays(worker).map(s=>s.exit>exitDate?{...s,exit:exitDate}:s);
  let candidate=addDays(exitDate,91);
  for(let i=0;i<370;i++){
    const day=addDays(candidate,i);
    if(usedInWindow(day,[...stays,{entry:day,exit:day}])<=90)return day;
  }
  return candidate;
}
function activeStay(worker){return worker.stays.find(s=>!s.exit)}
function currentInfo(worker){
  const active=activeStay(worker);
  if(active){const max=maxDeparture(worker,active);const elapsed=Math.max(0,diffDays(active.entry,today())+1);const unused=Math.max(0,diffDays(today(),max));return{inside:true,active,max,back:earliestReturn(worker,max),elapsed,remaining:unused,unused}}
  const last=[...worker.stays].filter(s=>s.exit).sort((a,b)=>b.exit.localeCompare(a.exit))[0];
  const lastMax=last?maxDeparture(worker,last):null;
  const unused=last&&last.exit<=lastMax?Math.max(0,diffDays(last.exit,lastMax)):0;
  return{inside:false,last,back:last?earliestReturn(worker,last.exit):null,elapsed:0,remaining:null,unused};
}

function toast(message){els.toast.textContent=message;els.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>els.toast.classList.remove('show'),2600)}
function initials(name){return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}

function render(){
  const query=els.search.value.trim().toLocaleLowerCase('ka');
  const ordered=[...workers].sort((a,b)=>{const ai=!!activeStay(a),bi=!!activeStay(b);return bi-ai||a.name.localeCompare(b.name,'ka')});
  const visible=ordered.filter(w=>w.name.toLocaleLowerCase('ka').includes(query));
  els.total.textContent=workers.length;
  els.inside.textContent=workers.filter(w=>activeStay(w)).length;
  els.urgent.textContent=workers.filter(w=>{const i=currentInfo(w);return i.inside&&i.remaining<=14}).length;
  els.empty.classList.toggle('hidden',workers.length>0||query.length>0);
  els.list.innerHTML=visible.map(w=>{
    const info=currentInfo(w);
    const action=info.inside?`<button class="primary" data-action="exit" data-id="${w.id}">გასვლა</button>`:`<button class="primary" data-action="entry" data-id="${w.id}">შესვლა</button>`;
    const first=info.inside?info.active.entry:(info.last?.entry||null);
    const exit=info.inside?info.max:(info.last?.exit||null);
    const used=Math.min(90,info.elapsed);
    return `<article class="worker-card"><div class="worker-main">
      <div class="person"><div class="avatar">${esc(initials(w.name))}</div><div><h3>${esc(w.name)}</h3><span class="status ${info.inside?'':'out'}">${info.inside?'● ქვეყანაშია':'○ გასულია'}</span></div></div>
      <div class="datum"><span>${info.inside?'შემოვიდა':'ბოლო შემოსვლა'}</span><strong>${formatDate(first)}</strong></div>
      <div class="datum depart"><span>${info.inside?'მაქს. გასვლა':'გავიდა'}</span><strong>${formatDate(exit)}</strong></div>
      <div class="datum return"><span>დაბრუნება შეუძლია</span><strong>${formatDate(info.back)}</strong></div>
      <div class="actions">${action}<button class="icon-btn" title="მენიუ" data-action="delete" data-id="${w.id}">⋮</button></div>
    </div><div class="card-footer"><button class="text-btn" data-action="history" data-id="${w.id}">ისტორია · ${w.stays.length} პერიოდი</button>${info.inside?`<div class="progress"><i class="${used>=76?'warn':''}" style="width:${used/90*100}%"></i></div><span>${used} დღე გამოყენებულია · <b>${info.unused} დღე დარჩა</b></span>`:`<span>ქვეყნის გარეთ · <b>${info.unused} დღე დარჩა გამოუყენებელი</b></span>`}</div></article>`
  }).join('');
}

function openWorker(workerId=''){
  const worker=workers.find(w=>w.id===workerId);
  $('#workerId').value=workerId;
  $('#workerName').value=worker?.name||'';
  $('#workerName').readOnly=!!worker;
  $('#entryDate').value=today();
  $('#workerDialogTitle').textContent=worker?`${worker.name} — შესვლა`:'პიროვნების დამატება';
  els.workerDialog.showModal();
}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close())}

els.workerForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=$('#workerId').value,entry=$('#entryDate').value,name=$('#workerName').value.trim();
  if(!name||!entry)return;
  let worker=workers.find(w=>w.id===id);
  if(worker){
    const last=worker.stays.filter(s=>s.exit).sort((a,b)=>b.exit.localeCompare(a.exit))[0];
    if(last&&entry<earliestReturn(worker,last.exit)){toast(`დაბრუნება შესაძლებელია ${formatDate(earliestReturn(worker,last.exit))}-დან`);return}
    worker.stays.push({id:uid(),entry,exit:null});
  }else{worker={id:uid(),name,createdAt:new Date().toISOString(),stays:[{id:uid(),entry,exit:null}]};workers.push(worker)}
  await put(worker);closeDialogs();render();toast('ჩანაწერი შენახულია');
});
els.exitForm.addEventListener('submit',async e=>{
  e.preventDefault();const worker=workers.find(w=>w.id===$('#exitWorkerId').value),stay=worker?.stays.find(s=>s.id===$('#exitStayId').value),date=$('#exitDate').value;if(!stay)return;
  const max=maxDeparture(worker,stay);if(date<stay.entry||date>max){toast(`გასვლა უნდა იყოს ${formatDate(stay.entry)}–${formatDate(max)}`);return}
  stay.exit=date;await put(worker);closeDialogs();render();toast('გასვლა დაფიქსირდა');
});

document.addEventListener('click',async e=>{
  const close=e.target.closest('[data-close]');if(close){close.closest('dialog').close();return}
  const button=e.target.closest('[data-action]');if(!button)return;
  const {action,id}=button.dataset;
  if(action==='add-worker')openWorker();
  if(action==='entry')openWorker(id);
  if(action==='exit'){
    const worker=workers.find(w=>w.id===id),stay=activeStay(worker),max=maxDeparture(worker,stay);
    $('#exitWorkerId').value=id;$('#exitStayId').value=stay.id;$('#exitWorkerName').textContent=worker.name;$('#exitDate').min=stay.entry;$('#exitDate').max=max;$('#exitDate').value=today()>max?max:today()<stay.entry?stay.entry:today();els.exitDialog.showModal();
  }
  if(action==='delete'){
    const worker=workers.find(w=>w.id===id);if(confirm(`წაიშალოს ${worker.name} და მისი სრული ისტორია?`)){await remove(id);workers=workers.filter(w=>w.id!==id);render();toast('პიროვნება წაიშალა')}
  }
  if(action==='history')showHistory(id);
});

function showHistory(id){
  const worker=workers.find(w=>w.id===id);$('#historyWorkerName').textContent=worker.name;
  $('#historyList').innerHTML=[...worker.stays].sort((a,b)=>b.entry.localeCompare(a.entry)).map((s,i)=>`<div class="history-row"><div><span>შემოსვლა</span><strong>${formatDate(s.entry)}</strong></div><div><span>გასვლა</span><strong>${s.exit?formatDate(s.exit):'ჯერ ქვეყანაშია'}</strong></div><strong>${s.exit?diffDays(s.entry,s.exit)+1:diffDays(s.entry,today())+1} დღე</strong></div>`).join('');els.historyDialog.showModal();
}

$('#addWorkerBtn').addEventListener('click',()=>openWorker());
els.search.addEventListener('input',render);
$('#backupBtn').addEventListener('click',()=>{
  const payload={app:'EES',version:1,exportedAt:new Date().toISOString(),workers};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`ees-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast('Backup ფაილი შეიქმნა');
});
$('#restoreBtn').addEventListener('click',()=>$('#restoreInput').click());
$('#restoreInput').addEventListener('change',async e=>{
  try{const data=JSON.parse(await e.target.files[0].text());if(data.app!=='EES'||!Array.isArray(data.workers))throw new Error();if(!confirm(`Restore ჩაანაცვლებს მიმდინარე ${workers.length} ჩანაწერს. გავაგრძელოთ?`))return;await clearDB();workers=data.workers;for(const w of workers)await put(w);render();toast('მონაცემები აღდგენილია')}catch{toast('JSON ფაილი არასწორია')}finally{e.target.value=''}
});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').classList.remove('hidden')});
$('#installBtn').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').classList.add('hidden')});

async function init(){try{workers=await getAll();render()}catch(err){console.error(err);toast('მონაცემთა ბაზა ვერ გაიხსნა')}if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(console.error)}
init();
