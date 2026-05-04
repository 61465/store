// ══════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════
let orders={branch:0,talabat:0,insta:0};
let cancels={branch:0,talabat:0,insta:0};
let customers=[], branchList=[], selCanTags=[];
let branchCancelReasons=[]; // [{reason, time}] for branch team only
let prodDB=[];
let checks=[];
let archive=[], editIdx=-1, prodFilter='all', currentTeam=null;
const SHIFT_SCHEMA_VERSION='20.2';
let appSettings=JSON.parse(localStorage.getItem('opsAppSettings')||'{}');
let activityLog=[];
let enterpriseUsers=JSON.parse(localStorage.getItem('opsEnterpriseUsers')||'[]');
let currentUser=JSON.parse(sessionStorage.getItem('opsCurrentUser')||'null');
let scContinuous=false;

// Dexie DB Setup
const db = new Dexie('AurumOpsDB');
db.version(1).stores({
  products: 'id, name, barcode, status',
  checklist: 'id',
  activityLog: 'id, time',
  archive: 'id, team, date'
});

async function loadDatabase() {
  try {
    const prodsCount = await db.products.count();
    if (prodsCount === 0) {
      let lsProds = JSON.parse(localStorage.getItem('productsDB'));
      if (!lsProds || !lsProds.length) lsProds = defProds();
      await db.products.bulkPut(lsProds);
      localStorage.removeItem('productsDB');
    }
    
    const checksCount = await db.checklist.count();
    if (checksCount === 0) {
      let lsChecks = JSON.parse(localStorage.getItem('checklistItems'));
      if (!lsChecks || !lsChecks.length) lsChecks = defChecks();
      await db.checklist.bulkPut(lsChecks);
      localStorage.removeItem('checklistItems');
    }

    const logCount = await db.activityLog.count();
    if (logCount === 0) {
      let lsLog = JSON.parse(localStorage.getItem('opsActivityLog'));
      if (lsLog && lsLog.length) {
        lsLog = lsLog.map((l, i) => ({...l, id: Date.now() + Math.random()}));
        await db.activityLog.bulkPut(lsLog);
        localStorage.removeItem('opsActivityLog');
      }
    }

    prodDB = await db.products.toArray();
    prodDB = normalizeProducts(prodDB);
    checks = await db.checklist.toArray();
    activityLog = await db.activityLog.orderBy('id').reverse().toArray();
    activityLog = activityLog.slice(0, 80);

  } catch (err) {
    console.error("Dexie Initialization Error:", err);
    prodDB = normalizeProducts(defProds());
    checks = defChecks();
    activityLog = [];
  }
}


function defProds(){return[
  {id:1,name:'أريل بور جيل 3.3 كيلو',company:'P&G',barcode:'6281006120086',status:'available',blockedDate:null},
  {id:2,name:'تايد بودر 3 كيلو',company:'P&G',barcode:'6281006121038',status:'available',blockedDate:null},
  {id:3,name:'فيري سائل 600 مل',company:'Unilever',barcode:'6285010141075',status:'available',blockedDate:null},
  {id:4,name:'دومينو سكر أبيض 2 كيلو',company:'Domino',barcode:'',status:'available',blockedDate:null},
  {id:5,name:'بسكويت لوتس 250 جرام',company:'Lotus',barcode:'5410522004865',status:'available',blockedDate:null},
  {id:6,name:'أرز بسمتي 2 كيلو',company:'محلي',barcode:'',status:'available',blockedDate:null},
  {id:7,name:'زيت دوار الشمس 1.8 لتر',company:'Afia',barcode:'6281001030025',status:'available',blockedDate:null},
  {id:8,name:'معجون أسنان كولجيت 120 مل',company:'Colgate',barcode:'8714789990484',status:'available',blockedDate:null},
  {id:9,name:'شامبو H&S 400 مل',company:'P&G',barcode:'8001090248374',status:'available',blockedDate:null},
  {id:10,name:'مياه نستله 1.5 لتر',company:'Nestlé',barcode:'6281020001047',status:'available',blockedDate:null},
];}

function defChecks(){return[
  {id:1,label:'مراجعة ثلاجة البحريات',note:'درجة الحرارة والنظافة',done:false,doneTime:null},
  {id:2,label:'جندولة قسم الحلويات',note:'ترتيب وتنظيم العروض',done:false,doneTime:null},
  {id:3,label:'مراجعة صلاحيات المنتجات',note:'فحص تواريخ الانتهاء',done:false,doneTime:null},
  {id:4,label:'التحقق من إدراج المنتجات',note:'مقارنة المخزون مع الإدراج',done:false,doneTime:null},
  {id:5,label:'تقرير نهاية الشيفت',note:'',done:false,doneTime:null},
];}


function normalizeProducts(list){
  return (list||[]).map(p=>({
    section:'',expiryDate:'',
    ...p,
    company:p.company||'-',
    status:p.status||'available',
    blockedDate:p.blockedDate||null
  }));
}

function productMeta(name,company){
  const n=(name||'').trim().toLowerCase(),c=(company||'').trim().toLowerCase();
  return prodDB.find(p=>p.barcode&&p.barcode===name)
    || prodDB.find(p=>p.name.trim().toLowerCase()===n&&(c==='-'||!c||p.company.trim().toLowerCase()===c))
    || prodDB.find(p=>n&&p.name.trim().toLowerCase().includes(n));
}

function enrichShortageProduct(p){
  const meta=productMeta(p.name,p.company)||{};
  return {...p ,section:p.section||meta.section||'',expiryDate:p.expiryDate||meta.expiryDate||''};
}

async function logActivity(action,details=''){
  activityLog.unshift({id: Date.now() + Math.random(), time:new Date().toLocaleString('ar-EG'),team:currentTeam||'-',branch:currentBranchName?currentBranchName():'-',user:activeUserName?activeUserName():'-',role:activeUserRole?activeUserRole():'-',action,details});
  activityLog=activityLog.slice(0,80);
  await db.activityLog.clear();
  await db.activityLog.bulkPut(activityLog);
  renderActivityLog();
}

prodDB=normalizeProducts(prodDB);


// ══════════════════════════════════════════════
// V20.1 SHIFT SAFETY + DAILY AUTO ARCHIVE
// ══════════════════════════════════════════════
function localDayKey(d=new Date()){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function getSavedShiftDay(sd){
  if(!sd)return localDayKey();
  if(sd.shiftDate)return sd.shiftDate;
  if(sd.lastUpdate)return localDayKey(new Date(sd.lastUpdate));
  return localDayKey();
}

function hasShiftActivity(sd){
  if(!sd)return false;
  const o=sd.orders||{},c=sd.cancels||{};
  const counts=(o.branch||0)+(o.talabat||0)+(o.insta||0)+(c.branch||0)+(c.talabat||0)+(c.insta||0);
  return counts>0
    || (sd.customers||[]).length>0
    || (sd.branchShortages||[]).length>0
    || (sd.cancelEntries||[]).length>0
    || (sd.cancelEntriesApp||[]).length>0
    || (sd.branchCancelReasons||[]).length>0
    || String(sd.notes||sd.followup||sd.generalNotes||'').trim().length>0;
}

function clearShiftState({touchStorage=true}={}){
  orders={branch:0,talabat:0,insta:0};
  cancels={branch:0,talabat:0,insta:0};
  customers=[];branchList=[];selCanTags=[];branchCancelReasons=[];
  window.cancelEntries=[];window.cancelEntriesApp=[];
  ['canReason','canReasonApp','followup','generalNotes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.querySelectorAll('#canTags .stag').forEach(b=>b.classList.remove('on'));
  checks.forEach(c=>{c.done=false;c.doneTime=null;});
  if(touchStorage&&currentTeam)localStorage.removeItem(teamKey('activeShiftData'));
}

function makeArchiveEntry({auto=false, sourceDate=null}={}){
  const isApp=currentTeam==='app';
  const tot=orders.branch+orders.talabat+orders.insta;
  const canTot=cancels.branch+cancels.talabat+cancels.insta;
  return {
    id:Date.now(),date:sourceDate||new Date().toLocaleDateString('ar-EG'),shift:getShift(),autoArchived:!!auto,
    branch:isApp?0:orders.branch,talabat:isApp?orders.talabat:0,insta:isApp?orders.insta:0,total:tot,
    canBranch:isApp?0:cancels.branch,canTalabat:isApp?cancels.talabat:0,canInsta:isApp?cancels.insta:0,cancelTotal:canTot,
    cancelReason:document.getElementById('canReason')?.value||'-',
    cancelTags:selCanTags.join('، '),
    branchCancelReasons:branchCancelReasons,
    generalNotes:document.getElementById('generalNotes')?.value||'-',
    branchShortage:branchList.length?branchList[branchList.length-1]?.items:'-',
    followup:document.getElementById('followup')?.value||'-',
    customersCount:currentTeam==='branch'?customers.length:0,
    productsCount:currentTeam==='branch'?customers.reduce((s,c)=>s+c.products.length,0):0,
    checklistDone:checks.filter(c=>c.done).length,checklistTotal:checks.length,
    timestamp:new Date().toISOString()
  };
}

async function archiveCurrentShift({auto=false, askReset=true, sourceDate=null}={}){
  const entry=makeArchiveEntry({auto,sourceDate});
  entry.team = currentTeam;
  entry.id = entry.id || Date.now() + Math.random();
  await db.archive.add(entry);
  
  const ar=archive;
  ar.push(entry);
  archive=ar;
  
  if(!askReset||confirm('✅ تم الأرشفة. هل تريد تصفير بيانات اليوم؟')){
    clearShiftState();
    await db.checklist.bulkPut(checks);
    renderCustomers();renderBranchRecs();renderShort();renderChecks();updateUI();
  }
  renderArchive();updateArchStats();
  return entry;
}

function checkAndStartNewDay(savedData){
  if(!currentTeam||!savedData)return;
  const savedDay=getSavedShiftDay(savedData),today=localDayKey();
  if(savedDay===today)return;
  if(hasShiftActivity(savedData)){
    archiveCurrentShift({auto:true,askReset:false,sourceDate:new Date(savedDay+'T12:00:00').toLocaleDateString('ar-EG')});
    toast('🌅 بدأ يوم جديد: تمت أرشفة بيانات أمس وتصفير العدادات تلقائياً');
  }else{
    clearShiftState();
  }
}


// ══════════════════════════════════════════════
// BARCODE SCANNER — ZXing (Works on Windows/Brave)
// ══════════════════════════════════════════════
let scStream=null, scReader=null, scActive=false;
let scCB=null;
let scCtx=null;
let scLastCode='', scLastTime=0;

function openScanner(ctx, cb){
  scCtx=ctx; scCB=cb||null;
  scLastCode=''; scLastTime=0;
  document.getElementById('scManInp').value='';
  hideScCards();
  setScStatus('idle','جاهز للمسح');
  document.getElementById('scModal').classList.add('on');
  if(!scStream) scStartCam();
}

function closeScanner(){
  scContinuous=false;updateContinuousScanUI();
  scStopCam();
  document.getElementById('scModal').classList.remove('on');
  scCB=null; scCtx=null;
}

async function scStartCam(){
  setScStatus('scanning','🔍 جاري فتح الكاميرا...');
  try{
    // Stop any previous reader cleanly
    if(scReader){
      try{ scReader.reset(); }catch(e){}
      scReader=null;
      await new Promise(r=>setTimeout(r,150)); // let camera release
    }
    scReader = new ZXing.BrowserMultiFormatReader();

    // decodeFromVideoDevice(undefined) → ZXing uses facingMode:'environment' automatically
    // This works on ALL browsers/devices without needing listVideoInputDevices
    const _so1=document.getElementById('scOff');if(_so1)_so1.style.display='none';
    const _sl1=document.getElementById('scLaser');if(_sl1)_sl1.style.display='block';
    scSetCamBtn(true);
    setScStatus('scanning','🔍 وجّه الكاميرا للباركود');
    scActive=true;

    await scReader.decodeFromVideoDevice(undefined, 'scVideo', (result, err)=>{
      const v=document.getElementById('scVideo');
      if(v&&v.srcObject&&!scStream)scStream=v.srcObject;
      if(!scActive) return;
      if(result){
        const code=result.getText(), now=Date.now();
        if(code!==scLastCode||(now-scLastTime)>2500){
          scLastCode=code; scLastTime=now;
          scOnDetected(code);
        }
      }
      // NotFoundException is normal (no barcode in frame) — safely ignore
    });
  }catch(e){
    console.error('ZXing error:',e);
    // If camera permission denied or no camera
    const msg = (e&&e.name==='NotAllowedError')
      ? '❌ رُفض إذن الكاميرا — افتح الإعدادات وأعطِ الإذن'
      : (e&&e.name==='NotFoundError')
      ? '❌ لا توجد كاميرا على هذا الجهاز'
      : '❌ خطأ في الكاميرا — استخدم الإدخال اليدوي';
    setScStatus('err', msg);
    const _sl2=document.getElementById('scLaser');if(_sl2)_sl2.style.display='none';
    scSetCamBtn(false);
    scActive=false;
  }
}

function scStopCam(){
  scActive=false;
  if(scReader){ try{scReader.reset();}catch(e){} scReader=null; }
  const v=document.getElementById('scVideo');
  const stream=scStream||(v&&v.srcObject);
  if(stream&&stream.getTracks){
    stream.getTracks().forEach(track=>{try{track.stop();}catch(e){}});
  }
  if(v){v.pause();v.srcObject=null;v.removeAttribute('src');try{v.load();}catch(e){}}
  scStream=null;
  const _so2=document.getElementById('scOff');if(_so2)_so2.style.display='flex';
  const _sl3=document.getElementById('scLaser');if(_sl3)_sl3.style.display='none';
  scSetCamBtn(false);
}

function scSetCamBtn(on){
  const b=document.getElementById('scCamBtn');
  if(on){b.classList.add('off');b.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34"/></svg> إيقاف الكاميرا';}
  else{b.classList.remove('off');b.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> تشغيل الكاميرا';}
}

function scToggleCam(){if(scActive)scStopCam();else scStartCam();}



function toggleContinuousScan(){
  scContinuous=!scContinuous;
  updateContinuousScanUI();
  if(scContinuous&&!scActive)scStartCam();
}

function updateContinuousScanUI(){
  const b=document.getElementById('scContBtn');
  if(b)b.textContent='🔁 المسح المستمر: '+(scContinuous?'يعمل':'متوقف');
}
function scOnDetected(code){
  scBeep(); scFlash();
  scLookup(code);
}

function scManualLookup(){
  const code=document.getElementById('scManInp').value.trim();
  if(!code){setScStatus('err','أدخل رقم الباركود');return;}
  scLookup(code);
}

function scLookup(code){
  code=code.trim();
  document.getElementById('scManInp').value=code;
  const prod=prodDB.find(p=>p.barcode&&p.barcode.trim()===code);
  hideScCards();
  const done=()=>{
    if(scCB)scCB(prod||null,code);
    else handleScResult(prod||null,code);
    if(scContinuous){
      setScStatus('scanning','🔁 تم التسجيل، وجّه الكاميرا للباركود التالي');
      setTimeout(hideScCards,650);
    }else{
      scStopCam();
      document.getElementById('scModal').classList.remove('on');
    }
  };
  if(prod){
    showScResult(prod,code);
    setScStatus('found','✅ تم العثور على المنتج');
    setTimeout(done,scContinuous?350:700);
  }else{
    document.getElementById('scNF').classList.add('on');
    const _nfc=document.getElementById('scNFCode');if(_nfc)_nfc.textContent=code;
    setScStatus('nf','⚠️ باركود غير موجود في القاعدة');
    setTimeout(done,scContinuous?450:900);
  }
}

// Route result based on context
function handleScResult(prod,code){
  switch(scCtx){
    case 'db-add':    fillDBForm(prod,code); break;
    case 'db-search': fillBCSearch(code); break;
    case 'cust-global': addProdInputFilled(prod?prod.name:'', prod?prod.company:'', prod&&prod.status!=='available'?prod.status:'out-of-stock', !prod?code:''); break;
    case 'branch-global': addBranchInputFilled(prod?prod.name:'', prod?prod.company:'', !prod?code:''); break;
  }
}

function fillDBForm(prod,code){
  document.getElementById('npBarcode').value=code;
  if(prod){
    document.getElementById('npName').value=prod.name;
    document.getElementById('npCompany').value=prod.company;
    const sec=document.getElementById('npSection');if(sec)sec.value=prod.section||'';
    const exp=document.getElementById('npExpiry');if(exp)exp.value=prod.expiryDate||'';
    document.getElementById('npStatus').value=prod.status;
    const _nbr=document.getElementById('npBlockedRow');if(_nbr)_nbr.style.display=prod.status==='blocked'?'block':'none';
    if(prod.blockedDate)document.getElementById('npBlockedDate').value=prod.blockedDate;
    toast('✅ تم ملء بيانات المنتج تلقائياً');
  }else{
    toast('📷 باركود جديد: '+code+' — أدخل بيانات المنتج');
  }
}

function fillBCSearch(code){
  document.getElementById('bcSearch').value=code;
  searchByBC(code);
}

function showScResult(p,code){
  const sm={available:{cls:'',label:'✅ متاح',bg:'rgba(56,217,169,.15)',c:'#38d9a9'},'out-of-stock':{cls:'',label:'⚠️ ناقص',bg:'rgba(246,166,35,.15)',c:'#f6a623'},blocked:{cls:'',label:'🚫 مغلق',bg:'rgba(255,79,106,.15)',c:'#ff4f6a'},'not-listed':{cls:'',label:'❌ غير مدرج',bg:'rgba(78,106,138,.15)',c:'#4e6a8a'}};
  const s=sm[p.status]||sm['not-listed'];
  const _spn=document.getElementById('scPName');if(_spn)_spn.textContent=p.name;
  const _spm=document.getElementById('scPMeta');if(_spm)_spm.textContent='🏢 '+p.company;
  const _spb=document.getElementById('scPBC');if(_spb)_spb.textContent=code;
  const badge=document.getElementById('scPBadge');
  badge.textContent=s.label;
  badge.style.cssText=`background:${s.bg};color:${s.c};border:1px solid ${s.c}40`;
  document.getElementById('scResult').classList.add('on');
}

function hideScCards(){
  document.getElementById('scResult').classList.remove('on');
  document.getElementById('scNF').classList.remove('on');
}

function setScStatus(type,text){
  const el=document.getElementById('scStatus');
  const dots={idle:'sd-b',scanning:'sd-b',found:'sd-g',err:'sd-r',nf:'sd-w'};
  el.className='sc-status '+type;
  el.innerHTML=`<div class="sdot ${dots[type]||'sd-b'}"></div><span>${text}</span>`;
}

function scBeep(){
  try{const a=new(window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator(),g=a.createGain();o.connect(g);g.connect(a.destination);o.type='sine';o.frequency.value=1450;g.gain.setValueAtTime(.22,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.11);o.start();o.stop(a.currentTime+.11);}catch(e){}
}

function scFlash(){
  const f=document.getElementById('scFlash');
  f.classList.remove('on');void f.offsetWidth;f.classList.add('on');
}


// ══════════════════════════════════════════════
// TEAM
// ══════════════════════════════════════════════
const TEAMS={
  branch:{name:'فريق الفرع',icon:'🏪',badge:'tbadge-b',pfx:'branch_',show:['branch'],hide:['talabat','insta'],showC:['branch'],hideC:['talabat','insta']},
  app:{name:'تطبيقات التوصيل',icon:'📸',badge:'tbadge-a',pfx:'app_',show:['insta','talabat'],hide:['branch'],showC:['insta','talabat'],hideC:['branch']},
};

async function selectTeam(t){
  currentTeam=t; sessionStorage.setItem('ct',t);
  document.getElementById('toverlay').classList.add('h');
  const _tb=document.getElementById('teamBar');if(_tb)_tb.style.display='flex';
  const cfg=TEAMS[t];
  const b=document.getElementById('tBadge');
  b.className='tbadge '+cfg.badge; b.textContent=cfg.icon+' '+cfg.name;
  applyTeamUI(t); await loadTeamData(t);
}

function switchTeam(){
  if(confirm('تغيير الفريق؟')){autoSave();currentTeam=null;sessionStorage.removeItem('ct');const _to=document.getElementById('toverlay');if(_to)_to.classList.remove('h');
    const _tb2=document.getElementById('teamBar');if(_tb2)_tb2.style.display='none';}
}

function applyTeamUI(t){
  const cfg=TEAMS[t];
  const ids=['branch','talabat','insta'];

  // Order counters
  const cCards=document.querySelectorAll('.cg .cc');
  cCards.forEach((c,i)=>c.style.display=cfg.hide.includes(ids[i])?'none':'');
  document.querySelector('.cg').style.gridTemplateColumns='repeat('+cfg.show.length+',1fr)';

  // Cancel counters — handled by separate branch/app sections above

  const isApp = t==='app';

  // Sections only for branch team
  const branchOnlySecs=['sec-addcust','sec-custrecords','sec-followup','sec-cancel-branch'];
  branchOnlySecs.forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=isApp?'none':'';
  });
  // App-only sections
  const appOnlySecs=['sec-cancel-app'];
  appOnlySecs.forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=isApp?'':'none';
  });
  // Tabs: hide المنتجات & المراجعات for branch, show for app
  const tabProds=document.getElementById('tab-prods');
  const tabChecks=document.getElementById('tab-checks');
  if(tabProds)  tabProds.style.display=isApp?'':'none';
  if(tabChecks) tabChecks.style.display=isApp?'':'none';

  // Stats row — app: hide entire branch stats row; branch: show 3 cols
  const statsEl=document.getElementById('entry-stats');
  if(statsEl){
    statsEl.style.display=isApp?'none':'';
    statsEl.style.gridTemplateColumns=isApp?'':'repeat(3,1fr)';
  }

  // App stats (products + checklist)
  const appStats=document.getElementById('app-quick-links');
  if(appStats) appStats.style.display=isApp?'':'none';

  // Branch shortages rename for app team
  const bsTitle=document.getElementById('sec-branchshort-title');
  const brTitle=document.getElementById('sec-branchrecs-title');
  if(bsTitle) bsTitle.textContent=isApp?'📦 نواقص':'🏢 نواقص الفرع';
  if(brTitle) brTitle.textContent=isApp?'📋 سجل النواقص':'📋 سجل نواقص الفرع';

  // App team: show products+checklist quick links in dashboard
  const appLinks=document.getElementById('app-quick-links');
  if(appLinks) appLinks.style.display=isApp?'':'none';

  // Cancel section title for app
  const cancelTitle=document.querySelector('.sec-t');
  // branch cancel with reason only for branch
  // addCancelWithReason is already conditional on currentTeam==='branch'
}

function teamKey(k){return currentTeam?TEAMS[currentTeam].pfx+k:k;}

async function loadTeamData(t){
  const pfx=TEAMS[t].pfx;
  orders={branch:0,talabat:0,insta:0}; cancels={branch:0,talabat:0,insta:0};
  customers=[]; branchList=[]; selCanTags=[];
  document.getElementById('canReason').value='';
  document.getElementById('followup').value='';
  document.querySelectorAll('#canTags .stag').forEach(b=>b.classList.remove('on'));
  const sd=JSON.parse(localStorage.getItem(pfx+'activeShiftData'));
  if(sd){
    orders=sd.orders||{branch:0,talabat:0,insta:0};
    cancels=sd.cancels||{branch:0,talabat:0,insta:0};
    customers=sd.customers||[]; branchList=sd.branchShortages||[];
    selCanTags=sd.cancelTags||[];
    branchCancelReasons=sd.branchCancelReasons||[];
    window.cancelEntries=sd.cancelEntries||[];
    window.cancelEntriesApp=sd.cancelEntriesApp||[];
    document.getElementById('canReason').value=sd.notes||'';
    const cra=document.getElementById('canReasonApp');
    if(cra) cra.value=sd.notes||'';
    document.getElementById('followup').value=sd.followup||'';
    if(document.getElementById('generalNotes')) document.getElementById('generalNotes').value=sd.generalNotes||'';
    restoreCanTags();
    checkAndStartNewDay(sd);
  }
  
  const archCount = await db.archive.where('team').equals(t).count();
  if (archCount === 0) {
    const lsArch = JSON.parse(localStorage.getItem(pfx+'monthlyArchive'));
    if (lsArch && lsArch.length > 0) {
      const itemsToPut = lsArch.map(a => ({...a, team: t, id: a.id || Date.now() + Math.random()}));
      await db.archive.bulkPut(itemsToPut);
      localStorage.removeItem(pfx+'monthlyArchive');
    }
  }
  archive = await db.archive.where('team').equals(t).toArray();
  
  updateUI(); renderCustomers(); renderBranchRecs(); renderShort();
  renderArchive(); updateArchStats(); checkBlockedAlerts();
  renderCancelRecords(); renderCancelRecordsApp(); renderPastShortages(); updateAppStats();
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
window.onload=async ()=>{
  await loadDatabase();
  const st=sessionStorage.getItem('ct');
  if(st) await selectTeam(st);
  updateShiftDisplay();setInterval(updateShiftDisplay,60000);
  setInterval(autoSave,30000);
  renderCustomers(); renderBranchRecs(); renderShort();
  loadAdminSettings();updateEnterpriseBadges();registerPWA();renderAssistantMessages();

  renderArchive(); updateArchStats(); renderProds(); renderChecks(); checkBlockedAlerts();renderAdmin();
  addProdInput(); addBranchInput();
  setInterval(()=>{if(document.getElementById('reportModal').classList.contains('on'))buildReport();},3000);
};


function syncCanReasonApp(){
  // Mirror app cancel reason to the shared canReason field
  const appReason=document.getElementById('canReasonApp');
  const mainReason=document.getElementById('canReason');
  if(appReason&&mainReason) mainReason.value=appReason.value;
  autoSave();
}
async function autoSave(){
  if(!currentTeam)return;
  localStorage.setItem(teamKey('activeShiftData'),JSON.stringify({
    orders,cancels,customers,branchShortages:branchList,
    notes:document.getElementById('canReason')?.value||'',
    followup:document.getElementById('followup')?.value||'',
    generalNotes:document.getElementById('generalNotes')?.value||'',
    cancelTags:selCanTags,branchCancelReasons,
    cancelEntries:window.cancelEntries||[],
    cancelEntriesApp:window.cancelEntriesApp||[],
    shiftDate:localDayKey(),
    schemaVersion:SHIFT_SCHEMA_VERSION,
    lastUpdate:Date.now()
  }));
  await db.products.bulkPut(prodDB);
  await db.checklist.bulkPut(checks);
}

async function syncData(){await autoSave();renderCustomers();renderBranchRecs();renderShort();checkBlockedAlerts();renderPastShortages();renderBranchCancelList();renderAdmin();logActivity('مزامنة محلية','حفظ بيانات الشيفت في المتصفح');toast('✅ تمت المزامنة');}

// ══════════════════════════════════════════════
// UI
// ══════════════════════════════════════════════
function updateUI(){
  // Orders counters — only update visible ones per team
  ['branch','talabat','insta'].forEach(k=>{
    const el=document.getElementById(k);
    if(el) el.value=orders[k];
  });
  // Cancel counters — null-guarded (some don't exist for certain teams)
  const _cb=document.getElementById('cBranch');   if(_cb) _cb.textContent=cancels.branch;
  const _ct=document.getElementById('cTalabat'); if(_ct) _ct.textContent=cancels.talabat;
  const _cta=document.getElementById('cTalabatApp'); if(_cta) _cta.textContent=cancels.talabat;
  const _ci=document.getElementById('cInsta');   if(_ci) _ci.textContent=cancels.insta;
  const _ca=document.getElementById('cInstaApp');if(_ca) _ca.textContent=cancels.insta;
  updateStats();
}

function updateStats(){
  const _cLen=customers.length;
  const _rLen=customers.reduce((s,c)=>s+c.products.filter(p=>p.status==='reported').length,0);
  ['sCustomers','sCustomers2'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=_cLen;});
  ['sReported','sReported2'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=_rLen;});
  updateAppStats();
  const totalCancels=currentTeam==='app'?(cancels.insta+cancels.talabat):(cancels.branch+cancels.talabat);
  ['sCancels','sCancels2'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=totalCancels;});
  const _bct=document.getElementById('branchCanTotal');if(_bct)_bct.textContent=cancels.branch+cancels.talabat;
  const _act=document.getElementById('appCanTotal');if(_act)_act.textContent=cancels.insta+cancels.talabat;
  const _ot=document.getElementById('ordersTotal');if(_ot)_ot.textContent=currentTeam==='app'?(orders.insta+orders.talabat):(orders.branch+orders.talabat);
}

function updateAppStats(){
  if(currentTeam!=='app') return;
  // Products: blocked + out-of-stock + not-listed count
  const unavail=prodDB.filter(p=>p.status!=='available').length;
  const total=prodDB.length;
  const sdpb=document.getElementById('sProdsBlocked');
  const sdpt=document.getElementById('sProdsTotal');
  if(sdpb) sdpb.textContent=unavail;
  if(sdpt) sdpt.textContent=total;
  // Checklist
  const done=checks.filter(c=>c.done).length;
  const tot=checks.length;
  const sdcd=document.getElementById('sChecksDone');
  const sdct=document.getElementById('sChecksTotal');
  if(sdcd) sdcd.textContent=done;
  if(sdct) sdct.textContent=tot;
}

function manUpd(t,v){
  let n=Math.max(0,parseInt(v)||0);orders[t]=n;
  const el=document.getElementById(t);if(el)el.value=n;
  updateStats();autoSave();
}
function updCount(t,d){
  orders[t]=Math.max(0,orders[t]+d);
  const el=document.getElementById(t);if(el)el.value=orders[t];
  updateStats();autoSave();
}
function updCan(t,d){
  cancels[t]=Math.max(0,cancels[t]+d);
  updateUI();autoSave();
  if(t==='branch') renderBranchCancelList();
}

function togCanTag(btn,tag){
  const i=selCanTags.indexOf(tag);
  if(i===-1){selCanTags.push(tag);btn.classList.add('on');}
  else{selCanTags.splice(i,1);btn.classList.remove('on');}
  autoSave();
}

// ── BRANCH CANCEL NEW SYSTEM ─────────────────────────
// cancelEntries: [{custName, source, reason, time}]
// branchCancelReasons kept for backward compat with autoSave

function setCancelSource(btn,src){
  document.querySelectorAll('#cancelSourceBtns .stag').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const el=document.getElementById('cancelSource');if(el)el.value=src;
}

function setCancelQuickReason(btn,text){
  document.querySelectorAll('#cancelQuickBtns .stag').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const el=document.getElementById('cancelReasonFree');if(el)el.value=text;
}

function submitCancelEntry(){
  const orderNum=(document.getElementById('cancelOrderNum')?.value||'').trim();
  const source=document.getElementById('cancelSource')?.value||'فرع';
  const quickReason=document.querySelector('#cancelQuickBtns .stag.on')?.textContent.trim()||'';
  const freeReason=(document.getElementById('cancelReasonFree')?.value||'').trim();
  const reason=freeReason||quickReason||'غير محدد';

  // increment correct counter
  if(source==='فرع') cancels.branch=Math.max(0,cancels.branch+1);
  else cancels.talabat=Math.max(0,cancels.talabat+1);

  const entry={orderNum,source,reason,shift:getShift()};
  branchCancelReasons.push({reason:`${source}${orderNum?' #'+orderNum:''}: ${reason}`,shift:getShift()});
  if(!window.cancelEntries) window.cancelEntries=[];
  window.cancelEntries.push(entry);

  // reset form
  const onum=document.getElementById('cancelOrderNum');if(onum)onum.value='';
  const cfree=document.getElementById('cancelReasonFree');if(cfree)cfree.value='';
  document.querySelectorAll('#cancelQuickBtns .stag').forEach(b=>b.classList.remove('on'));

  updateUI(); autoSave(); renderCancelRecords();
}

function renderCancelRecords(){
  const wrap=document.getElementById('cancelRecordsList');
  const container=document.getElementById('cancelRecordsItems');
  if(!wrap||!container) return;
  const entries=window.cancelEntries||[];
  if(!entries.length){wrap.style.display='none';return;}
  wrap.style.display='block';
  const srcIcon={'فرع':'📍','طلبات':'📱'};
  container.innerHTML=entries.map((e,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;
      background:rgba(255,79,106,.06);border:1px solid rgba(255,79,106,.15);
      border-radius:var(--rs);margin-bottom:5px;font-size:12px">
      <span style="color:var(--red);font-weight:900;flex-shrink:0;min-width:22px">#${i+1}</span>
      <span style="flex-shrink:0;font-size:11px;color:var(--muted)">${srcIcon[e.source]||''}${e.source}</span>
      ${e.orderNum?`<span style="background:var(--raised);border:1px solid var(--border-s);border-radius:4px;padding:1px 6px;font-weight:700;font-size:11px;flex-shrink:0;direction:ltr">${esc(e.orderNum)}</span>`:''}
      <span style="flex:1;color:var(--text)">${esc(e.reason)}</span>
      <span style="color:var(--muted);font-size:10px;flex-shrink:0">${e.shift||getShift()}</span>
      <button onclick="removeCancelEntry(${i})"
        style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:0 2px;line-height:1;flex-shrink:0;touch-action:manipulation">×</button>
    </div>`).join('');
}

function removeCancelEntry(i){
  const entries=window.cancelEntries||[];
  const e=entries[i];
  if(e){
    if(e.source==='فرع') cancels.branch=Math.max(0,cancels.branch-1);
    else cancels.talabat=Math.max(0,cancels.talabat-1);
  }
  entries.splice(i,1);
  branchCancelReasons.splice(i,1);
  updateUI(); autoSave(); renderCancelRecords();
}


// ── APP TEAM CANCEL SYSTEM (انستا شوب) ──────────────
function setCancelQuickReasonApp(btn,text){
  document.querySelectorAll('#cancelQuickBtnsApp .stag').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const el=document.getElementById('cancelReasonFreeApp');if(el)el.value=text;
}

function submitCancelEntryApp(){
  const orderNum=(document.getElementById('cancelOrderNumApp')?.value||'').trim();
  const quickReason=document.querySelector('#cancelQuickBtnsApp .stag.on')?.textContent.trim()||'';
  const freeReason=(document.getElementById('cancelReasonFreeApp')?.value||'').trim();
  const reason=freeReason||quickReason||'غير محدد';

  const source=document.getElementById('cancelSourceApp')?.value||'انستا شوب';
  if(source==='طلبات') cancels.talabat=Math.max(0,cancels.talabat+1);
  else cancels.insta=Math.max(0,cancels.insta+1);

  const entry={orderNum,source,reason,shift:getShift()};
  if(!window.cancelEntriesApp) window.cancelEntriesApp=[];
  window.cancelEntriesApp.push(entry);

  // reset form
  const on=document.getElementById('cancelOrderNumApp');if(on)on.value='';
  const rf=document.getElementById('cancelReasonFreeApp');if(rf)rf.value='';
  document.querySelectorAll('#cancelQuickBtnsApp .stag').forEach(b=>b.classList.remove('on'));

  updateUI(); autoSave(); renderCancelRecordsApp();
}

function renderCancelRecordsApp(){
  const wrap=document.getElementById('cancelRecordsListApp');
  const container=document.getElementById('cancelRecordsItemsApp');
  if(!wrap||!container) return;
  const entries=window.cancelEntriesApp||[];
  if(!entries.length){wrap.style.display='none';return;}
  wrap.style.display='block';
  container.innerHTML=entries.map((e,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;
      background:rgba(255,79,106,.06);border:1px solid rgba(255,79,106,.15);
      border-radius:var(--rs);margin-bottom:5px;font-size:12px">
      <span style="color:var(--red);font-weight:900;flex-shrink:0;min-width:22px">#${i+1}</span>
      <span style="font-size:11px;color:var(--muted);flex-shrink:0">${e.source==='طلبات'?'📱 طلبات':'🌐 انستا'}</span>
      ${e.orderNum?`<span style="background:var(--raised);border:1px solid var(--border-s);border-radius:4px;padding:1px 6px;font-weight:700;font-size:11px;flex-shrink:0;direction:ltr">${esc(e.orderNum)}</span>`:''}
      <span style="flex:1;color:var(--text)">${esc(e.reason)}</span>
      <span style="color:var(--muted);font-size:10px;flex-shrink:0">${e.shift||getShift()}</span>
      <button onclick="removeCancelEntryApp(${i})"
        style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:0 2px;line-height:1;flex-shrink:0;touch-action:manipulation">×</button>
    </div>`).join('');
}

function removeCancelEntryApp(i){
  const entries=window.cancelEntriesApp||[];
  const e=entries[i];
  if(e){
    if(e.source==='طلبات') cancels.talabat=Math.max(0,cancels.talabat-1);
    else cancels.insta=Math.max(0,cancels.insta-1);
  }
  entries.splice(i,1);
  updateUI(); autoSave(); renderCancelRecordsApp();
}

// backward compat stubs
function addCancelWithReason(type){ updCan(type,1); }
function renderBranchCancelList(){ renderCancelRecords(); }
function closeCancelModal(){
  const m=document.getElementById('cancelReasonModal');if(m)m.classList.remove('on');
}

// ── FOLLOWUP AUTOCOMPLETE (past shortages) ────────────
function renderPastShortages(){
  const container=document.getElementById('pastShortagesSuggestions');
  if(!container) return;
  // collect all unique product names from current customers
  const allProds=[];
  customers.forEach(cu=>{
    cu.products.forEach(p=>{
      const key=p.name.trim().toLowerCase();
      if(key && !allProds.find(x=>x.key===key)){
        allProds.push({key,name:p.name,company:p.company!=='-'?p.company:'',customer:cu.name});
      }
    });
  });
  if(!allProds.length){
    container.innerHTML='<span style="font-size:11px;color:var(--muted)">لا توجد نواقص مسجلة بعد</span>';
    return;
  }
  container.innerHTML=allProds.map(p=>`
    <button onclick="appendToFollowup('${esc(p.name)}${p.company?' ('+esc(p.company)+')':''} — ${esc(p.customer)}')"
      style="padding:4px 9px;background:rgba(79,172,254,.1);border:1px solid rgba(79,172,254,.2);border-radius:16px;font-size:11px;color:var(--blue);cursor:pointer;white-space:nowrap">
      ${esc(p.name)}${p.company?' <span style=color:var(--muted)>('+esc(p.company)+')</span>':''}
    </button>`).join('');
}

function appendToFollowup(text){
  const ta=document.getElementById('followup');
  if(!ta) return;
  const cur=ta.value.trim();
  ta.value=(cur?cur+'\n':'')+text;
  ta.scrollTop=ta.scrollHeight;
  autoSave();
}

function followupAC(ta){
  const list=document.getElementById('followupACList');
  if(!list) return;
  const val=ta.value;
  const lastLine=val.split('\n').pop().trim().toLowerCase();
  if(!lastLine||lastLine.length<2){list.style.display='none';return;}
  // search all products in customers
  const allProds=[];
  customers.forEach(cu=>{
    cu.products.forEach(p=>{
      if(p.name.toLowerCase().includes(lastLine)){
        allProds.push({name:p.name,company:p.company,customer:cu.name});
      }
    });
  });
  if(!allProds.length){list.style.display='none';return;}
  list.innerHTML=allProds.slice(0,6).map(p=>`
    <div onclick="pickFollowupAC(this,'${esc(p.name)}${p.company&&p.company!=='-'?' ('+esc(p.company)+')':''} — ${esc(p.customer)}')"
      style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border-s)">
      📦 ${esc(p.name)}${p.company&&p.company!=='-'?` <span style='color:var(--muted)'>(${esc(p.company)})</span>`:''}
      <span style="color:var(--muted);font-size:10px"> — ${esc(p.customer)}</span>
    </div>`).join('');
  list.style.display='block';
}

function pickFollowupAC(el,text){
  const ta=document.getElementById('followup');
  const lines=ta.value.split('\n');
  lines[lines.length-1]=text;
  ta.value=lines.join('\n');
  const _fal=document.getElementById('followupACList');if(_fal)_fal.style.display='none';
  ta.focus(); autoSave();
}

function restoreCanTags(){
  document.querySelectorAll('#canTags .stag').forEach(b=>{if(selCanTags.includes(b.textContent.trim()))b.classList.add('on');});
}

// ══════════════════════════════════════════════
// PRODUCT INPUT ROWS (customer)
// ══════════════════════════════════════════════
function addProdInput(){addProdInputFilled('','','out-of-stock','');}

function addProdInputFilled(name,company,status,bcHint){
  const container=document.getElementById('newCustProds');
  const w=document.createElement('div');
  w.className='psw';
  const btns=[
    {s:'out-of-stock',c:'to',l:'⚠️ ناقص'},
    {s:'blocked',c:'tb',l:'🚫 مغلق'},
    {s:'not-listed',c:'tn',l:'❌ غير مدرج'},
  ].map(b=>`<button class="stag ${b.c}${b.s===status?' on':''}" onclick="setPIS(this,'${b.s}')">${b.l}</button>`).join('');
  const hint=bcHint&&!name?`<div style="font-size:10px;color:var(--muted);margin-bottom:3px">📷 باركود: ${esc(bcHint)}</div>`:'';
  w.innerHTML=`${hint}
    <div class="irow" style="margin-bottom:3px">
      <input type="text" class="pn" placeholder="اسم المنتج..." value="${esc(name)}" oninput="prodAC(this)" autocomplete="off" style="margin:0">
      <input type="text" class="pc" placeholder="الشركة" value="${esc(company)}" style="margin:0;flex:.55">
      <button class="scanbtn" onclick="openRowScanner(this)" title="📷 مسح">📷</button>
      <button class="rmbtn" onclick="this.closest('.psw').remove()">✖</button>
    </div>
    <div class="acl"></div>
    <div style="margin-top:3px">
      <div style="font-size:10px;color:var(--muted);margin-bottom:3px">حالة المنتج:</div>
      <div class="stags">${btns}</div>
      <input type="hidden" class="ps-val" value="${status}">
    </div>`;
  container.appendChild(w);
}

function openRowScanner(btn){
  const row=btn.closest('.psw');
  openScanner('row',function(prod,code){
    if(prod){
      row.querySelector('.pn').value=prod.name;
      row.querySelector('.pc').value=prod.company;
      const mapped=prod.status!=='available'?prod.status:'out-of-stock';
      row.querySelectorAll('.stags .stag').forEach((b,i)=>{b.classList.remove('on');if(['out-of-stock','blocked','not-listed'][i]===mapped)b.classList.add('on');});
      row.querySelector('.ps-val').value=mapped;
      toast('✅ '+prod.name);
    }else{
      row.querySelector('.pn').placeholder='باركود: '+code;
      toast('📷 '+code+' — غير موجود في القاعدة');
    }
  });
}

function setPIS(btn,s){
  const w=btn.closest('.psw');
  w.querySelectorAll('.stags .stag').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  w.querySelector('.ps-val').value=s;
}

// ══════════════════════════════════════════════
// AUTOCOMPLETE
// ══════════════════════════════════════════════
function prodAC(inp){
  const q=inp.value.trim().toLowerCase();
  const w=inp.closest('.psw');
  const l=w.querySelector('.acl');
  if(!q){l.classList.remove('on');return;}
  const m=prodDB.filter(p=>p.name.toLowerCase().includes(q)||p.company.toLowerCase().includes(q)).slice(0,7);
  if(!m.length){l.classList.remove('on');return;}
  const em={available:'✅','out-of-stock':'⚠️',blocked:'🚫','not-listed':'❌'};
  l.innerHTML=m.map(p=>`<div class="aci" onclick="selAC(this,'${esc(p.name)}','${esc(p.company)}','${p.status}')">${em[p.status]||''} ${esc(p.name)}<small>${esc(p.company)}</small></div>`).join('');
  l.classList.add('on');
}

function selAC(item,name,company,status){
  const w=item.closest('.psw');
  w.querySelector('.pn').value=name;
  w.querySelector('.pc').value=company;
  const mapped=status!=='available'?status:'out-of-stock';
  w.querySelectorAll('.stags .stag').forEach((b,i)=>{b.classList.remove('on');if(['out-of-stock','blocked','not-listed'][i]===mapped)b.classList.add('on');});
  w.querySelector('.ps-val').value=mapped;
  w.querySelector('.acl').classList.remove('on');
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function autoLearn(name,company){
  name=(name||'').trim();
  if(!name||name.length<2)return;
  if(!prodDB.some(p=>p.name.trim().toLowerCase()===name.toLowerCase())){
    prodDB.push({id:Date.now()+Math.random(),name,company:(company||'-').trim(),barcode:'',status:'available',blockedDate:null,section:'',expiryDate:''});
    
  }
}

// ══════════════════════════════════════════════
// ADD CUSTOMER
// ══════════════════════════════════════════════
function addCustomer(){
  const name=document.getElementById('newCustName').value.trim();
  const phone=document.getElementById('newCustPhone').value.trim();
  if(!name||!phone){alert('❌ أدخل الاسم والهاتف');return;}
  const prods=[];
  document.querySelectorAll('#newCustProds .psw').forEach(w=>{
    const n=w.querySelector('.pn').value.trim();
    const c=w.querySelector('.pc').value.trim();
    const s=w.querySelector('.ps-val').value||'out-of-stock';
    if(n){const meta=productMeta(n,c)||{};prods.push({id:Date.now()+Math.random(),name:n,company:c||'-',productStatus:s,status:'waiting',reported:'-',section:meta.section||''});autoLearn(n,c);}
  });
  if(!prods.length){alert('❌ أضف منتجاً واحداً على الأقل');return;}
  customers.push({id:Date.now(),name,phone,products:prods,date:new Date().toLocaleDateString('ar-EG'),shift:getShift()});
  document.getElementById('newCustName').value='';
  document.getElementById('newCustPhone').value='';
  document.getElementById('newCustProds').innerHTML='';
  addProdInput();
  autoSave();renderCustomers();renderShort();updateStats();renderPastShortages();
  toast('✅ تم حفظ نواقص العميل');
}

function renderCustomers(){
  const c=document.getElementById('custRecords');
  if(!customers.length){c.innerHTML='<div style="text-align:center;padding:18px;color:var(--muted)">📭 لا يوجد عملاء</div>';return;}
  c.innerHTML='';
  customers.forEach((cu,ci)=>{
    const b=document.createElement('div'); b.className='rb';
    const ph=cu.products.map((p,pi)=>{
      const sl={'out-of-stock':'⚠️ ناقص',blocked:'🚫 مغلق','not-listed':'❌ غير مدرج',available:'✅ متاح'}[p.productStatus]||'';
      return `<div class="rp">
        <div><span class="pn">${p.name}</span>${p.company!=='-'?`<span class="pc"> (${p.company})</span>`:''}${sl?`<span style="font-size:10px;color:var(--muted)"> • ${sl}</span>`:''}
        </div>
        <div class="ps"><span class="sbadge ${p.status==='reported'?'sr':'sw'}">${p.status==='reported'?'📢 تم التبليغ':'⏳ انتظار'}</span>
        ${p.status==='waiting'?`<button class="rpbtn" onclick="reportProd(${ci},${pi})">📩 تبليغ</button>`:`<small style="color:var(--muted)">${p.reported}</small>`}
        </div></div>`;
    }).join('');
    b.innerHTML=`<div class="rhdr"><div class="rinfo"><span>👤 ${cu.name}</span><span>📞 ${cu.phone}</span><span style="font-size:10px;opacity:.7">${cu.date}</span></div><button class="rmbtn" onclick="delCust(${ci})">🗑️</button></div><div>${ph}</div><button class="addpbtn" onclick="addProdToCust(${cu.id})">➕ إضافة منتج</button>`;
    c.appendChild(b);
  });
}

function reportProd(ci,pi){
  const to=prompt('📢 تم التبليغ إلى:');
  if(to){customers[ci].products[pi].status='reported';customers[ci].products[pi].reported=to;autoSave();renderCustomers();renderShort();updateStats();toast('✅ تم التبليغ');}
}

function delCust(i){
  if(confirm('حذف هذا العميل؟')){customers.splice(i,1);autoSave();renderCustomers();renderShort();updateStats();renderPastShortages();toast('✅ تم الحذف');}
}

function addProdToCust(id){
  const n=prompt('📦 اسم المنتج:');if(!n)return;
  const c=prompt('🏢 الشركة:')||'-';
  const cu=customers.find(c=>c.id===id);
  if(cu){const meta=productMeta(n,c)||{};cu.products.push({id:Date.now()+Math.random(),name:n,company:c,productStatus:'out-of-stock',status:'waiting',reported:'-',section:meta.section||''});autoLearn(n,c);autoSave();renderCustomers();renderShort();updateStats();toast('✅ تمت الإضافة');}
}

// ══════════════════════════════════════════════
// BRANCH SHORTAGES
// ══════════════════════════════════════════════
function addBranchInput(){addBranchInputFilled('','','');}

function addBranchInputFilled(name,company,bcHint){
  const c=document.getElementById('branchProds');
  const row=document.createElement('div'); row.className='irow';
  const meta=productMeta(name,company)||{};
  const hint=bcHint&&!name?`<span style="font-size:10px;color:var(--muted);flex-shrink:0">📷${esc(bcHint)}</span>`:'';
  row.innerHTML=`<input type="text" class="bn" placeholder="اسم المنتج" value="${esc(name)}" style="margin:0">
    <input type="text" class="bc" placeholder="الشركة" value="${esc(company)}" style="margin:0;flex:.55">
    ${hint}
    <button class="scanbtn" onclick="openBranchRowScanner(this)">📷</button>
    <button class="rmbtn" onclick="this.closest('.irow').remove()">✖</button>`;
  c.appendChild(row);
}

function openBranchRowScanner(btn){
  const row=btn.closest('.irow');
  openScanner('branch-row',function(prod,code){
    if(prod){row.querySelector('.bn').value=prod.name;row.querySelector('.bc').value=prod.company;toast('✅ '+prod.name);}
    else{row.querySelector('.bn').placeholder='باركود: '+code;toast('📷 '+code);}
  });
}

function saveBranch(){
  const items=[];
  document.querySelectorAll('#branchProds .irow').forEach(r=>{
    const n=r.querySelector('.bn').value.trim();
    const c=r.querySelector('.bc').value.trim();
    if(n){items.push({name:n,company:c});autoLearn(n,c);}
  });
  if(!items.length){alert('❌ أدخل منتجاً واحداً');return;}
  const sorted=items.slice().sort((a,b)=>String(a.company||'').localeCompare(String(b.company||''),'ar'));
  branchList.push({date:new Date().toLocaleDateString('ar-EG'),shift:getShift(),items:sorted.map(x=>x.company?`${x.name} (${x.company})`:x.name).join(' + '),itemsData:sorted});
  logActivity('حفظ نواقص',`${sorted.length} منتج`);
  document.getElementById('branchProds').innerHTML=''; addBranchInput();
  autoSave(); renderBranchRecs(); toast('✅ تم حفظ نواقص الفرع');
}

function renderBranchRecs(){
  const c=document.getElementById('branchRecs');
  if(!branchList.length){c.innerHTML='<div style="text-align:center;padding:16px;color:var(--muted)">📭 لا توجد نواقص</div>';return;}
  c.innerHTML=branchList.slice().reverse().map(r=>`<div class="brec"><div class="bd">📅 ${r.date} — ${r.shift||getShift()}</div><div class="bi">${esc(r.items)}</div></div>`).join('');
}

// ══════════════════════════════════════════════
// SHORTAGES TAB
// ══════════════════════════════════════════════
function renderShort(){
  const f=document.getElementById('shortFilter').value;
  const sort=document.getElementById('shortSort')?.value||'time';
  const c=document.getElementById('shortContainer');
  if(!customers.length){c.innerHTML='<div style="text-align:center;padding:36px;color:var(--muted)">📭 لا توجد نواقص</div>';return;}
  c.innerHTML='';
  customers.forEach((cu,ci)=>{
    let fp=(f==='all'?cu.products:cu.products.filter(p=>p.status===f)).map(enrichShortageProduct);
    if(sort==='section')fp.sort((a,b)=>String(a.section||'zzz').localeCompare(String(b.section||'zzz'),'ar'));
    if(!fp.length)return;
    const b=document.createElement('div'); b.className='rb';
    const ph=fp.map(p=>{
      const pi=cu.products.findIndex(x=>x.id===p.id);
      const meta=`${p.section?`<span class="route-pill">${esc(p.section)}</span>`:''}`;
      return `<div class="rp"><div><span class="pn">${esc(p.name)}</span>${p.company!=='-'?`<span class="pc"> (${esc(p.company)})</span>`:''}${meta}</div>
        <div class="ps"><span class="sbadge ${p.status==='reported'?'sr':'sw'}">${p.status==='reported'?'📢 تم التبليغ':'⏳ انتظار'}</span>
        ${p.status==='waiting'?`<button class="rpbtn" onclick="reportProd(${ci},${pi})">📩 تبليغ</button>`:`<small style="color:var(--muted)">${esc(p.reported)}</small>`}
        </div></div>`;
    }).join('');
    b.innerHTML=`<div class="rhdr"><div class="rinfo"><span>👤 ${esc(cu.name)}</span><span>📞 ${esc(cu.phone)}</span></div></div><div>${ph}</div>`;
    c.appendChild(b);
  });
  if(!c.children.length)c.innerHTML='<div style="text-align:center;padding:36px;color:var(--muted)">📭 لا توجد نتائج</div>';
}

// ══════════════════════════════════════════════
// PRODUCTS DB
// ══════════════════════════════════════════════
function addToDB(){
  const name=document.getElementById('npName').value.trim();
  if(!name){alert('❌ أدخل اسم المنتج');return;}
  const barcode=document.getElementById('npBarcode').value.trim();
  const section=document.getElementById('npSection')?.value.trim()||'';
  const expiryDate=document.getElementById('npExpiry')?.value||'';
  const status=document.getElementById('npStatus').value;
  const blockedDate=status==='blocked'?document.getElementById('npBlockedDate').value:null;
  if(barcode){
    const ex=prodDB.find(p=>p.barcode&&p.barcode.trim()===barcode);
    if(ex){ex.name=name;ex.company=document.getElementById('npCompany').value.trim()||'-';ex.section=section;ex.expiryDate=expiryDate;ex.status=status;ex.blockedDate=blockedDate;clearDBForm();autoSave();renderProds();checkBlockedAlerts();renderAdmin();logActivity('تحديث منتج',name);toast('✅ تم تحديث المنتج الموجود');return;}
  }
  prodDB.push({id:Date.now(),name,company:document.getElementById('npCompany').value.trim()||'-',barcode,section,expiryDate,status,blockedDate});
  clearDBForm(); autoSave(); renderProds(); checkBlockedAlerts(); renderAdmin();logActivity('إضافة منتج',name); toast('✅ تم الإضافة');
}

function clearDBForm(){
  ['npName','npCompany','npBarcode','npSection','npExpiry'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('npStatus').value='available';
  const _nbr2=document.getElementById('npBlockedRow');if(_nbr2)_nbr2.style.display='none';
}

function setProdFilter(f,btn){
  prodFilter=f;
  document.querySelectorAll('#prods .sec .stag').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('bcSearch').value='';
  renderProds();
}

function searchByBC(bc){
  if(!bc||!bc.trim()){renderProds();return;}
  const found=prodDB.filter(p=>p.barcode&&p.barcode.includes(bc.trim()));
  renderProdsList(found.length?found:null,bc);
}

function renderProds(){
  document.getElementById('bcSearch').value='';
  const q=(document.getElementById('prodSearch').value||'').toLowerCase();
  const filtered=prodDB.filter(p=>(prodFilter==='all'||p.status===prodFilter)&&(!q||p.name.toLowerCase().includes(q)||p.company.toLowerCase().includes(q)));
  renderProdsList(filtered,null);
}

function renderProdsList(list,bcHl){
  const c=document.getElementById('prodsContainer');
  if(!list||!list.length){
    c.innerHTML=`<div style="text-align:center;padding:18px;color:${bcHl?'var(--warn)':'var(--muted)'}">${bcHl?`❌ لا يوجد منتج بباركود: <strong>${esc(bcHl)}</strong><br><br><button class="addbtn" onclick="document.getElementById('npBarcode').value='${esc(bcHl)}';showTab('prods')">➕ إضافة هذا الباركود</button>`:'📭 لا توجد منتجات'}</div>`;
    return;
  }
  const sm={'available':{l:'✅ متاح',cls:'ta'},'out-of-stock':{l:'⚠️ ناقص',cls:'to'},'blocked':{l:'🚫 مغلق',cls:'tb'},'not-listed':{l:'❌ غير مدرج',cls:'tn'}};
  c.innerHTML=list.map(p=>{
    const s=sm[p.status]||{l:p.status,cls:'tn'};
    const days=p.blockedDate?Math.floor((Date.now()-new Date(p.blockedDate))/(86400000)):null;
    const warn=days!==null?`<div class="binfo">🕒 مغلق ${days} يوم${days>=7?' ⚠️ تجاوز 7 أيام!':''}</div>`:'';
    return `<div class="sec" style="padding:10px 14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:7px">
        <div>
          <div style="font-weight:700;font-size:14px">${esc(p.name)}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(p.company)}${p.barcode?` • <span style="color:var(--blue);font-size:10px;letter-spacing:.5px;direction:ltr">${esc(p.barcode)}</span>`:' • <span style="color:var(--muted);font-size:10px">بدون باركود</span>'}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:3px">${p.section?`قسم: ${esc(p.section)} `:''}${p.expiryDate?` <span class="route-pill">صلاحية ${esc(p.expiryDate)}</span>`:''}</div>
          ${warn}
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
          <span class="stag ${s.cls}" style="cursor:default">${s.l}</span>
          <select onchange="updProdStatus(${p.id},this.value)" style="font-size:11px;padding:4px 7px;margin:0;width:auto">
            <option value="available" ${p.status==='available'?'selected':''}>✅ متاح</option>
            <option value="out-of-stock" ${p.status==='out-of-stock'?'selected':''}>⚠️ ناقص</option>
            <option value="blocked" ${p.status==='blocked'?'selected':''}>🚫 مغلق</option>
            <option value="not-listed" ${p.status==='not-listed'?'selected':''}>❌ غير مدرج</option>
          </select>
          <button class="scanbtn" style="width:32px;height:32px;font-size:14px" onclick="editProdBC(${p.id})" title="تحديث الباركود">🔖</button>
          <button class="ab db2" onclick="delFromDB(${p.id})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function editProdBC(id){
  const p=prodDB.find(x=>x.id===id);if(!p)return;
  if(confirm(`تحديث باركود "${p.name}"\n\nموافق = فتح الكاميرا | إلغاء = إدخال يدوي`)){
    openScanner('edit-bc',function(prod,code){p.barcode=code;autoSave();renderProds();toast('✅ تم تحديث الباركود');});
  }else{
    const code=prompt(`باركود "${p.name}":`,p.barcode||'');
    if(code!==null){p.barcode=code.trim();autoSave();renderProds();toast('✅ تم التحديث');}
  }
}

function updProdStatus(id,s){
  const p=prodDB.find(x=>x.id===id);
  if(p){p.status=s;if(s==='blocked'&&!p.blockedDate)p.blockedDate=new Date().toISOString().split('T')[0];else if(s!=='blocked')p.blockedDate=null;autoSave();renderProds();checkBlockedAlerts();updateAppStats();toast('✅ تم تحديث الحالة');}
}

async function delFromDB(id){
  if(confirm('حذف هذا المنتج؟')){prodDB=prodDB.filter(p=>p.id!==id); await db.products.delete(id);autoSave();renderProds();toast('✅ تم الحذف');}
}

function checkBlockedAlerts(){
  const c=document.getElementById('blockedAlerts');
  const ov=prodDB.filter(p=>p.status==='blocked'&&p.blockedDate&&Math.floor((Date.now()-new Date(p.blockedDate))/86400000)>=7);
  if(!ov.length){c.innerHTML='';return;}
  c.innerHTML=`<div class="alert"><strong>⚠️ ${ov.length} منتج مغلق منذ 7 أيام أو أكثر!</strong>${ov.map(p=>`<div>🔴 ${esc(p.name)} — مغلق ${Math.floor((Date.now()-new Date(p.blockedDate))/86400000)} يوم</div>`).join('')}</div>`;
}

// ══════════════════════════════════════════════
// CHECKLIST
// ══════════════════════════════════════════════
function addCheck(){
  const l=document.getElementById('newCheckLbl').value.trim();
  if(!l){alert('❌ أدخل اسم المهمة');return;}
  checks.push({id:Date.now(),label:l,note:document.getElementById('newCheckNote').value.trim(),done:false,doneTime:null});
  document.getElementById('newCheckLbl').value=''; document.getElementById('newCheckNote').value='';
  autoSave(); renderChecks(); toast('✅ تمت الإضافة');
}

function togCheck(id){
  const item=checks.find(c=>c.id===id);
  if(item){item.done=!item.done;item.doneTime=null;autoSave();renderChecks();}
}

function delCheck(id){checks=checks.filter(c=>c.id!==id);autoSave();renderChecks();}

function resetChecks(){checks.forEach(c=>{c.done=false;c.doneTime=null;});autoSave();renderChecks();toast('✅ تمت إعادة التعيين');}

function renderChecks(){
  const c=document.getElementById('checkList');
  if(!checks.length){c.innerHTML='<div style="text-align:center;padding:16px;color:var(--muted)">📭 لا توجد مهام</div>';return;}
  const done=checks.filter(x=>x.done).length;
  const pct=Math.round((done/checks.length)*100);
  c.innerHTML=`<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:5px"><span>تم ${done} من ${checks.length}</span><span>${pct}%</span></div>
    <div class="prog"><div class="prog-fill" style="width:${pct}%;background:var(--green)"></div></div>
  </div>
  ${checks.map(item=>`<div class="cli ${item.done?'done':''}">
    <button class="cltog" onclick="togCheck(${item.id})">${item.done?'✓':''}</button>
    <div style="flex:1"><div class="cll">${esc(item.label)}</div>${item.note?`<div class="cln">${esc(item.note)}</div>`:''}${item.done?`<div class="cln" style="color:var(--green)">✅ منجز في شيفت ${getShift()}</div>`:''}</div>
    <button class="ab db2" onclick="delCheck(${item.id})" style="padding:4px 7px">🗑️</button>
  </div>`).join('')}`;
}

// ══════════════════════════════════════════════
// SHIFT
// ══════════════════════════════════════════════
function getShift(){const h=new Date().getHours();return h>=9&&h<16?'صباحي':h>=16?'ليلي':'أوفر نايت';}
function getShiftRange(){return getShift();}

function updateShiftDisplay(){
  const shift=getShift();
  const _pf=document.getElementById('pFill');if(_pf)_pf.style.width='100%';
  const _pf2=document.getElementById('pFill2');if(_pf2)_pf2.style.width='100%';
  const _lt2=document.getElementById('liveTime2');if(_lt2)_lt2.textContent=shift;
  const _hst=document.getElementById('hdrShiftTime');if(_hst)_hst.textContent='الشيفت الحالي: '+shift;
  const _lt=document.getElementById('liveTime');if(_lt)_lt.innerHTML=`<div style="font-size:10px;color:var(--muted)">الشيفت الحالي</div><div class="tc-ok" style="font-size:18px;font-weight:700">${shift}</div>`;
}

// ══════════════════════════════════════════════
// REPORT
// ══════════════════════════════════════════════
function openReport(){document.getElementById('reportModal').classList.add('on');buildReport();}
function closeReport(){document.getElementById('reportModal').classList.remove('on');}

function buildReport(){
  const shift=document.getElementById('rShift').value==='auto'?getShift():document.getElementById('rShift').value;
  const branchName=typeof currentBranchName==='function'?currentBranchName():'-';
  const branchCode=typeof currentBranchCode==='function'?currentBranchCode():'MAIN';
  const companyName=appSettings?.companyName||'-';
  const activeName=typeof activeUserName==='function'?activeUserName():'-';
  const totalOrders=currentTeam==='app'?(orders.insta+orders.talabat):orders.branch;
  const totalCancels=currentTeam==='app'?(cancels.insta+cancels.talabat):cancels.branch;
  const cancelRate=totalOrders?((totalCancels/totalOrders)*100).toFixed(1)+'%':'0%';
  const shortageProductsCount=customers.reduce((s,cu)=>s+cu.products.length,0);
  const reportedCount=customers.reduce((s,cu)=>s+cu.products.filter(p=>p.status==='reported').length,0);
  const waitingCount=Math.max(0,shortageProductsCount-reportedCount);
  const blockedProducts=prodDB.filter(p=>p.status==='blocked');
  const notListedProducts=prodDB.filter(p=>p.status==='not-listed');
  const outOfStockProducts=prodDB.filter(p=>p.status==='out-of-stock');
  const expiringProducts=typeof nearExpiryProducts==='function'?nearExpiryProducts(30):[];
  const doneChecks=checks.filter(c=>c.done);
  const pendingChecks=checks.filter(c=>!c.done);
  const branchShortageRecords=branchList||[];
  const branchEntries=window.cancelEntries||[];
  const appEntries=window.cancelEntriesApp||[];
  const allCancelEntries=currentTeam==='app'?appEntries:branchEntries;

  let r=`📊 *التقرير النهائي*\n`;
  r+=`🏢 ${companyName} — ${branchName} (${branchCode})\n`;
  r+=`📅 ${new Date().toLocaleDateString('ar-EG')}\n`;
  r+=`${'─'.repeat(28)}\n\n`;

  r+=`📌 *الملخص التنفيذي:*\n`;
  r+=`• الأوردرات: ${totalOrders}\n`;
  r+=`• الملغيات: ${totalCancels} (${cancelRate})\n`;
  r+=`• نواقص العملاء: ${shortageProductsCount}\n`;
  r+=`• تم التبليغ: ${reportedCount}\n`;
  r+=`• انتظار تبليغ: ${waitingCount}\n`;
  r+=`• نواقص الفرع المسجلة: ${branchShortageRecords.length}\n`;
  r+=`• منتجات مغلقة: ${blockedProducts.length}\n`;
  r+=`• غير مدرج: ${notListedProducts.length}\n`;
  r+=`• منتجات قاربت على الانتهاء: ${expiringProducts.length}\n\n`;

  if(document.getElementById('i1').checked){
    r+=`📦 *إحصائيات الأوردرات:*\n`;
    r+=`• فرع: ${orders.branch}\n`;
    r+=`• طلبات: ${orders.talabat}\n`;
    r+=`• انستا: ${orders.insta}\n`;
    r+=`• الإجمالي: ${orders.branch+orders.talabat+orders.insta}\n\n`;
  }

  if(document.getElementById('i2').checked){
    r+=`🚫 *الملغيات بالتفصيل:*\n`;
    r+=`• فرع: ${cancels.branch}\n`;
    r+=`• طلبات: ${cancels.talabat}\n`;
    r+=`• انستا: ${cancels.insta}\n`;
    r+=`• الإجمالي: ${cancels.branch+cancels.talabat+cancels.insta}\n`;
    if(allCancelEntries.length){
      r+=`\n📋 *سجل الملغيات:*\n`;
      allCancelEntries.forEach((e,i)=>{
        const src=e.source?`${e.source}`:'-';
        r+=`${i+1}. ${src}${e.orderNum?' #'+e.orderNum:''}: ${e.reason||'-'}\n`;
      });
    }
    r+='\n';
  }

  if(document.getElementById('i3').checked){
    r+=`🏢 *نواقص الفرع:*\n`;
    if(branchShortageRecords.length){
      branchShortageRecords.forEach((rec,idx)=>{
        r+=`• سجل ${idx+1}\n`;
        if(rec.itemsData&&rec.itemsData.length){
          rec.itemsData.forEach(item=>{
            r+=`  - ${item.name}${item.company?` (${item.company})`:''}\n`;
          });
        }else if(rec.items){
          rec.items.split(' + ').forEach(item=>r+=`  - ${item}\n`);
        }
      });
    }else{
      r+=`• لا توجد نواقص فرع مسجلة\n`;
    }
    r+='\n';
  }

  if(document.getElementById('i4').checked){
    r+=`⚠️ *نواقص العملاء (${customers.length} عميل):*\n`;
    if(customers.length){
      customers.forEach(cu=>{
        r+=`• ${cu.name} — ${cu.phone}\n`;
        cu.products.forEach(p=>{
          const sl={'out-of-stock':'ناقص','blocked':'مغلق','not-listed':'غير مدرج','available':'متاح'}[p.productStatus]||'-';
          const section=p.section?` / ${p.section}`:'';
          const status=p.status==='reported'?'تم التبليغ':'انتظار';
          r+=`  - ${p.name}${p.company!=='-'?` (${p.company})`:''}${section} — ${sl} — ${status}${p.reported&&p.reported!=='-'?` (${p.reported})`:''}\n`;
        });
      });
    }else{
      r+=`• لا توجد نواقص عملاء حالياً\n`;
    }
    r+='\n';
  }

  if(document.getElementById('i5').checked){
    r+=`📦 *حالة المنتجات المهمة:*\n`;
    r+=`• ناقص: ${outOfStockProducts.length}\n`;
    r+=`• مغلق: ${blockedProducts.length}\n`;
    r+=`• غير مدرج: ${notListedProducts.length}\n`;
    if(blockedProducts.length){
      r+=`\n🚫 *منتجات مغلقة:*\n`;
      blockedProducts.forEach(p=>{
        const d=p.blockedDate?Math.floor((Date.now()-new Date(p.blockedDate))/86400000):null;
        r+=`- ${p.name}${d!==null?` — ${d} يوم`:''}\n`;
      });
    }
    if(notListedProducts.length){
      r+=`\n❌ *منتجات غير مدرجة:*\n`;
      notListedProducts.forEach(p=>r+=`- ${p.name}\n`);
    }
    if(expiringProducts.length){
      r+=`\n⏳ *منتجات قاربت على الانتهاء:*\n`;
      expiringProducts.forEach(p=>r+=`- ${p.name} — ${p.daysLeft} يوم${p.section?` / ${p.section}`:''}\n`);
    }
    r+='\n';
  }

  if(document.getElementById('i6').checked){
    r+=`✅ *المراجعات:*\n`;
    r+=`• منجز: ${doneChecks.length}/${checks.length}\n`;
    if(doneChecks.length){
      r+=`• المهام المنجزة:\n`;
      doneChecks.forEach(c=>r+=`  - ${c.label}\n`);
    }
    if(pendingChecks.length){
      r+=`• المهام غير المنجزة:\n`;
      pendingChecks.forEach(c=>r+=`  - ${c.label}\n`);
    }
    r+='\n';
  }

  if(document.getElementById('i7').checked){
    const f=document.getElementById('followup').value.trim();
    const sn=document.getElementById('supportNotes').value.trim();
    const gn=document.getElementById('generalNotes')?document.getElementById('generalNotes').value.trim():'';
    r+=`📝 *ملاحظات الشيفت:*\n`;
    if(f)r+=`• متابعة العملاء:\n${f}\n`;
    if(sn)r+=`• تواصل مع الدعم:\n${sn}\n`;
    if(gn)r+=`• ملاحظات عامة:\n${gn}\n`;
    if(!f&&!sn&&!gn)r+=`• لا توجد ملاحظات إضافية\n`;
    r+='\n';
  }

  r+=`${'─'.repeat(28)}\n`;
  r+=`تم إنشاء التقرير النهائي`;
  const _rp=document.getElementById('rPrev');if(_rp)_rp.value=r;
}

function copyReport(){
  const t=document.getElementById('rPrev').value;
  navigator.clipboard.writeText(t).then(()=>toast('✅ تم نسخ التقرير')).catch(()=>{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('✅ تم النسخ');});
}

// ══════════════════════════════════════════════
// ARCHIVE
// ══════════════════════════════════════════════
function archiveShift(){
  const entry=makeArchiveEntry();
  entry.branchCode=currentBranchCode();entry.branchName=currentBranchName();entry.userName=activeUserName();entry.userRole=activeUserRole();
  logActivity('أرشفة شيفت',entry.date);
  let ar=JSON.parse(localStorage.getItem(teamKey('monthlyArchive')))||[];
  if(editIdx!==-1){
    ar[editIdx]=entry;editIdx=-1;
    document.getElementById('editNotice').classList.remove('on');
    localStorage.setItem(teamKey('monthlyArchive'),JSON.stringify(ar));
    archive=ar;renderArchive();updateArchStats();
    alert('✅ تم تحديث السجل');
    return;
  }
  archiveCurrentShift({askReset:true});
}

function renderArchive(){
  let ar=JSON.parse(localStorage.getItem(teamKey('monthlyArchive')))||[];
  const tb=document.getElementById('archBody');
  if(!ar.length){tb.innerHTML="<tr><td colspan='9' style='text-align:center;padding:24px;color:var(--muted)'>📭 لا توجد سجلات</td></tr>";return;}
  ar.sort((a,b)=>new Date(b.timestamp||b.date)-new Date(a.timestamp||a.date));
  tb.innerHTML=ar.map(e=>{
    const oi=archive.findIndex(x=>x.id===e.id);
    const r=e.cancelReason||'-';
    return `<tr><td>${e.date}</td><td>${e.shift}</td><td>${e.branch||0}</td><td>${e.talabat||0}</td><td>${e.insta||0}</td><td><strong>${e.total||0}</strong></td><td>${e.cancelTotal||0}</td><td><small title="${esc(r)}">${r.substring(0,13)}${r.length>13?'...':''}</small></td><td><button class="ab eb" onclick="editArch(${oi})">✏️</button><button class="ab db2" onclick="delArch(${oi})">🗑️</button></td></tr>`;
  }).join('');
}

function filterArch(){
  const f=document.getElementById('archSearch').value.toLowerCase();
  document.querySelectorAll('#archBody tr').forEach(r=>r.style.display=Array.from(r.querySelectorAll('td')).slice(0,-1).map(td=>td.textContent).join(' ').toLowerCase().includes(f)?'':'none');
}

function delArch(i){
  if(confirm('حذف هذا السجل؟')){archive.splice(i,1);localStorage.setItem(teamKey('monthlyArchive'),JSON.stringify(archive));renderArchive();updateArchStats();toast('✅ تم الحذف');}
}

function editArch(i){
  const e=archive[i];
  if(confirm('تحميل بيانات هذا السجل للتعديل؟')){
    orders={branch:e.branch||0,talabat:e.talabat||0,insta:e.insta||0};
    cancels={branch:e.canBranch||0,talabat:e.canTalabat||0,insta:e.canInsta||0};
    document.getElementById('canReason').value=e.cancelReason||'';
    document.getElementById('followup').value=e.followup||'';
    editIdx=i; document.getElementById('editNotice').classList.add('on');
    showTab('entry'); updateUI(); scrollTo({top:0,behavior:'smooth'});
  }
}

function updateArchStats(){
  let ar=JSON.parse(localStorage.getItem(teamKey('monthlyArchive')))||[];
  const c=document.getElementById('archStats');
  if(!ar.length){c.innerHTML='';return;}
  const tO=ar.reduce((s,i)=>s+(i.total||0),0);
  const tC=ar.reduce((s,i)=>s+(i.cancelTotal||0),0);
  c.innerHTML=`<div class="si"><div class="si-l">📊 أيام</div><div class="si-n">${ar.length}</div></div><div class="si"><div class="si-l">📦 إجمالي</div><div class="si-n">${tO}</div></div><div class="si"><div class="si-l">🚫 ملغيات</div><div class="si-n">${tC}</div></div><div class="si"><div class="si-l">📈 متوسط</div><div class="si-n">${Math.round(tO/ar.length)}</div></div>`;
}

// ══════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════
function xlDate(){return new Date().toLocaleDateString('ar-EG').replace(/\//g,'-');}
function xlFile(prefix){return `${prefix}_${currentBranchCode?currentBranchCode():'MAIN'}_${getShift()}_${xlDate()}.xlsx`;}
function xlStatus(v){return {'out-of-stock':'ناقص',blocked:'مغلق','not-listed':'غير مدرج',available:'متاح'}[v]||v||'-';}
function xlAOA(title, subtitle, headers, rows){
  const data=[[title],[subtitle],[],headers,...rows];
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:Math.max(0,headers.length-1)}},{s:{r:1,c:0},e:{r:1,c:Math.max(0,headers.length-1)}}];
  ws['!cols']=headers.map((h,i)=>({wch:Math.max(12,String(h).length+4,...rows.slice(0,80).map(r=>String(r[i]??'').length+2))}));
  ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:3,c:0},e:{r:Math.max(3,rows.length+3),c:headers.length-1}})};
  ws['!views']=[{rightToLeft:true}];
  return ws;
}
function xlBook(){
  const wb=XLSX.utils.book_new();
  wb.Props={Title:'Operations V23 Enterprise Report',Subject:'Shift Operations',Author:activeUserName?activeUserName():'Operations V23',Company:appSettings?.companyName||'',CreatedDate:new Date()};
  wb.Workbook={Views:[{RTL:true}]};
  return wb;
}
function xlAdd(wb,name,ws){XLSX.utils.book_append_sheet(wb,ws,name.substring(0,31));}
function archiveRows(){
  const ar=JSON.parse(localStorage.getItem(teamKey('monthlyArchive')))||[];
  return ar.sort((a,b)=>new Date(a.timestamp||a.date)-new Date(b.timestamp||b.date));
}
function professionalWorkbook(kind='full'){
  const wb=xlBook();
  const ar=archiveRows();
  const today=new Date().toLocaleDateString('ar-EG');
  const branch=currentBranchName?currentBranchName():'-';
  const shift=getShift();
  const totalOrders=ar.reduce((s,i)=>s+(i.total||0),0);
  const totalCancels=ar.reduce((s,i)=>s+(i.cancelTotal||0),0);
  const summaryRows=[
    ['الشركة',appSettings?.companyName||'-'],
    ['الفرع',branch],
    ['كود الفرع',currentBranchCode?currentBranchCode():'MAIN'],
    ['تاريخ التقرير',today],
    ['عدد سجلات الأرشيف',ar.length],
    ['إجمالي الأوردرات',totalOrders],
    ['إجمالي الملغيات',totalCancels],
    ['نسبة الإلغاء',totalOrders?((totalCancels/totalOrders)*100).toFixed(1)+'%':'0%'],
    ['نواقص حالية',customers.reduce((s,c)=>s+c.products.length,0)],
    ['منتجات مغلقة',prodDB.filter(p=>p.status==='blocked').length],
    ['منتجات قاربت على الانتهاء',nearExpiryProducts?nearExpiryProducts().length:0]
  ];
  xlAdd(wb,'ملخص تنفيذي',xlAOA('تقرير العمليات التنفيذي','ملخص جاهز للإدارة', ['البند','القيمة'], summaryRows));

  if(kind==='full'||kind==='orders'){
    xlAdd(wb,'الأوردرات',xlAOA('تقرير الأوردرات','حسب الشيفت فقط بدون عداد وقت', ['التاريخ','الشيفت','فرع','طلبات','انستا','الإجمالي'], ar.map(i=>[i.date,i.shift,i.branch||0,i.talabat||0,i.insta||0,i.total||0])));
  }
  if(kind==='full'||kind==='cancels'){
    xlAdd(wb,'الملغيات',xlAOA('تقرير الملغيات','أسباب وإجماليات الإلغاء', ['التاريخ','الشيفت','فرع','طلبات','انستا','الإجمالي','الأسباب'], ar.map(i=>[i.date,i.shift,i.canBranch||0,i.canTalabat||0,i.canInsta||0,i.cancelTotal||0,i.cancelReason||'-'])));
  }
  if(kind==='full'||kind==='shortages'){
    const custRows=[];
    customers.forEach(c=>c.products.forEach(p=>{
      const m=enrichShortageProduct?enrichShortageProduct(p):p;
      custRows.push([c.name,c.phone,m.name,m.company||'-',m.section||'-',xlStatus(m.productStatus),m.status==='reported'?'تم التبليغ':'انتظار',m.reported||'-']);
    }));
    if(custRows.length > 0 || kind==='shortages'){
      xlAdd(wb,'نواقص العملاء',xlAOA('تقرير نواقص العملاء','طلبات انستا وطلبات والعملاء', ['المصدر/العميل','الهاتف','المنتج','الشركة','القسم','نوع النقص','حالة التبليغ','تم التبليغ إلى'], custRows));
    }
    const branchRows=[];
    branchList.forEach(b=>(b.itemsData||[]).forEach(p=>branchRows.push([p.name,p.company||'-',p.section||'-','ناقص','انتظار','-'])));
    if(branchRows.length > 0 || kind==='shortages'){
      xlAdd(wb,'نواقص الفرع',xlAOA('تقرير نواقص الفرع','المنتجات المطلوبة للفرع', ['المنتج','الشركة','القسم','نوع النقص','حالة التبليغ','تم التبليغ إلى'], branchRows));
    }
  }
  if(kind==='full'){
    xlAdd(wb,'المنتجات',xlAOA('قاعدة المنتجات','الحالة الحالية للمنتجات', ['المنتج','الشركة','الباركود','القسم','الصلاحية','الحالة','تاريخ الغلق'], prodDB.map(p=>[p.name,p.company||'-',p.barcode||'-',p.section||'-',p.expiryDate||'-',xlStatus(p.status),p.blockedDate||'-'])));
    xlAdd(wb,'المراجعات',xlAOA('قائمة المراجعات','حالة مهام الشيفت', ['المهمة','ملاحظة','الحالة'], checks.map(c=>[c.label,c.note||'-',c.done?'منجز':'غير منجز'])));
  }
  return wb;
}

function exPro(){XLSX.writeFile(professionalWorkbook('full'),xlFile('تقرير_عمليات_احترافي'));}
function exOrders(){XLSX.writeFile(professionalWorkbook('orders'),xlFile('تقرير_الأوردرات'));}
function exShort(){XLSX.writeFile(professionalWorkbook('shortages'),xlFile('تقرير_النواقص'));}
function exCan(){XLSX.writeFile(professionalWorkbook('cancels'),xlFile('تقرير_الملغيات'));}
function exSum(){XLSX.writeFile(professionalWorkbook('full'),xlFile('ملخص_تنفيذي'));}

function exportBK(){const b=new Blob([JSON.stringify({date:new Date().toLocaleString('ar-EG'),archive,customers,branchShortages:branchList,productsDB:prodDB,checklistItems:checks},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`backup_${new Date().toLocaleDateString().replace(/\//g,'-')}.json`;a.click();}

function clearArch(){if(confirm('مسح الأرشيف بالكامل؟')){const c=prompt("اكتب 'نعم':");if(c==='نعم'){archive=[];localStorage.setItem(teamKey('monthlyArchive'),JSON.stringify(archive));renderArchive();updateArchStats();toast('✅ تم المسح');}}}

// ══════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════
function showTab(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  document.getElementById(id).classList.add('on');
  const map={entry:'لوحة',short:'النواقص',prods:'المنتجات',checks:'المراجعات',arch:'الأرشيف',admin:'إدارة'};
  document.querySelectorAll('.tab').forEach(b=>{if(b.textContent.includes(map[id]))b.classList.add('on');});
  if(id==='short')renderShort();
  if(id==='arch'){renderArchive();updateArchStats();}
  if(id==='prods'){renderProds();checkBlockedAlerts();}
  if(id==='checks')renderChecks();

  if(id==='admin')renderAdmin();
}

// ══════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════
function toast(msg){
  const t=document.createElement('div');t.className='toast';t.textContent=msg;
  document.body.appendChild(t);setTimeout(()=>t.remove(),2800);
}




// ══════════════════════════════════════════════
// V21 ENTERPRISE OPERATIONS
// ══════════════════════════════════════════════
function currentBranchName(){return appSettings.branchName||'فرع غير محدد';}
function currentBranchCode(){return appSettings.branchCode||'MAIN';}
function activeUserName(){return currentUser?.name||'مستخدم محلي';}
function activeUserRole(){return currentUser?.role||'staff';}

function updateEnterpriseBadges(){
  const bb=document.getElementById('branchBadge');if(bb)bb.textContent=currentBranchName();
  const ub=document.getElementById('userBadge');if(ub)ub.innerHTML=`${esc(activeUserName())}<span class="role-pill">${esc(activeUserRole())}</span>`;
}

function quickUserLogin(){
  if(!enterpriseUsers.length){
    const name=prompt('اسم الموظف الحالي:')||'مستخدم محلي';
    currentUser={id:Date.now(),name,role:'manager'};
  }else{
    const list=enterpriseUsers.map((u,i)=>`${i+1}. ${u.name} - ${u.role}`).join('\n');
    const idx=parseInt(prompt('اختر رقم المستخدم:\n'+list),10)-1;
    if(!enterpriseUsers[idx])return;
    currentUser=enterpriseUsers[idx];
  }
  sessionStorage.setItem('opsCurrentUser',JSON.stringify(currentUser));
  updateEnterpriseBadges();
  logActivity('تسجيل مستخدم',activeUserName());
}

function saveEnterpriseSettings(){
  appSettings.branchName=document.getElementById('branchNameSetting')?.value.trim()||appSettings.branchName||'';
  appSettings.branchCode=document.getElementById('branchCodeSetting')?.value.trim()||appSettings.branchCode||'MAIN';
  appSettings.managerWhatsApp=document.getElementById('managerWhatsAppSetting')?.value.trim()||'';
  appSettings.companyName=document.getElementById('companyNameSetting')?.value.trim()||'';
  localStorage.setItem('opsAppSettings',JSON.stringify(appSettings));
  updateEnterpriseBadges();renderAdmin();
  logActivity('حفظ إعدادات المؤسسة',currentBranchName());
  toast('✅ تم حفظ إعدادات المؤسسة');
}

function addEnterpriseUser(){
  const name=document.getElementById('newUserName')?.value.trim();
  const role=document.getElementById('newUserRole')?.value||'staff';
  if(!name){toast('أدخل اسم الموظف');return;}
  enterpriseUsers.push({id:Date.now(),name,role,branchCode:currentBranchCode(),active:true});
  localStorage.setItem('opsEnterpriseUsers',JSON.stringify(enterpriseUsers));
  document.getElementById('newUserName').value='';
  renderUsersList();logActivity('إضافة مستخدم',`${name} - ${role}`);
}

function removeEnterpriseUser(id){
  if(!confirm('حذف المستخدم من الجهاز؟'))return;
  const u=enterpriseUsers.find(x=>x.id===id);
  enterpriseUsers=enterpriseUsers.filter(x=>x.id!==id);
  localStorage.setItem('opsEnterpriseUsers',JSON.stringify(enterpriseUsers));
  renderUsersList();logActivity('حذف مستخدم',u?.name||id);
}

function renderUsersList(){
  const el=document.getElementById('usersList');if(!el)return;
  if(!enterpriseUsers.length){el.innerHTML='<div style="font-size:12px;color:var(--muted)">لا يوجد مستخدمون بعد.</div>';return;}
  el.innerHTML=enterpriseUsers.map(u=>`<div class="mini-kpi"><span>${esc(u.name)} <span class="role-pill">${esc(u.role)}</span></span><button class="ab db2" onclick="removeEnterpriseUser(${u.id})">حذف</button></div>`).join('');
}

function buildRiskAlerts(){
  const totalOrders=(orders.branch||0)+(orders.talabat||0)+(orders.insta||0);
  const totalCancels=(cancels.branch||0)+(cancels.talabat||0)+(cancels.insta||0);
  const cancelRate=totalOrders?totalCancels/totalOrders:0;
  const waiting=customers.reduce((s,c)=>s+c.products.filter(p=>p.status==='waiting').length,0);
  const blocked7=prodDB.filter(p=>p.status==='blocked'&&p.blockedDate&&Math.floor((Date.now()-new Date(p.blockedDate))/86400000)>=7).length;
  const expiry7=nearExpiryProducts(7).length;
  const risks=[];
  risks.push({level:cancelRate>.15?'high':cancelRate>.08?'med':'low',title:'نسبة الإلغاء',body:totalOrders?`${(cancelRate*100).toFixed(1)}% من إجمالي الأوردرات`:'لا توجد أوردرات كافية'});
  risks.push({level:waiting>10?'high':waiting>3?'med':'low',title:'نواقص لم تُبلغ',body:`${waiting} منتج في الانتظار`});
  risks.push({level:blocked7>0?'high':'low',title:'منتجات مغلقة أكثر من 7 أيام',body:`${blocked7} منتج يحتاج مراجعة`});
  risks.push({level:expiry7>0?'med':'low',title:'صلاحيات خلال 7 أيام',body:`${expiry7} منتج قريب جداً من الانتهاء`});
  return risks;
}

function renderRiskPanel(){
  const el=document.getElementById('riskPanel');if(!el)return;
  el.innerHTML=buildRiskAlerts().map(r=>`<div class="risk-row"><span class="risk-dot risk-${r.level}"></span><div><strong>${esc(r.title)}</strong><div style="color:var(--muted)">${esc(r.body)}</div></div></div>`).join('');
}

function enterpriseSnapshot(){
  return {
    schemaVersion:'21.0',
    exportedAt:new Date().toISOString(),
    branch:{name:currentBranchName(),code:currentBranchCode(),company:appSettings.companyName||''},
    user:{name:activeUserName(),role:activeUserRole()},
    state:{orders,cancels,customers,branchList,prodDB,checks,archive,activityLog,enterpriseUsers,appSettings}
  };
}

function downloadText(filename,textValue,type='text/plain'){
  const b=new Blob([textValue],{type});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b);a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function exportEnterpriseBackup(){
  downloadText(`enterprise_backup_${currentBranchCode()}_${localDayKey()}.json`,JSON.stringify(enterpriseSnapshot(),null,2),'application/json');
  logActivity('تصدير نسخة Enterprise',currentBranchCode());
}

function restoreEnterpriseBackup(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(!data.state)throw new Error('Invalid backup');
      if(!confirm('استعادة النسخة ستستبدل بيانات هذا الجهاز. هل أنت متأكد؟'))return;
      orders=data.state.orders||orders;cancels=data.state.cancels||cancels;customers=data.state.customers||[];
      branchList=data.state.branchList||[];prodDB=normalizeProducts(data.state.prodDB||prodDB);checks=data.state.checks||checks;
      archive=data.state.archive||archive;activityLog=data.state.activityLog||activityLog;enterpriseUsers=data.state.enterpriseUsers||enterpriseUsers;appSettings=data.state.appSettings||appSettings;
      
      
      
      localStorage.setItem('opsEnterpriseUsers',JSON.stringify(enterpriseUsers));
      localStorage.setItem('opsAppSettings',JSON.stringify(appSettings));
      if(currentTeam)localStorage.setItem(teamKey('monthlyArchive'),JSON.stringify(archive));
      autoSave();updateUI();renderCustomers();renderBranchRecs();renderShort();renderProds();renderChecks();renderAdmin();
      logActivity('استعادة نسخة Enterprise',file.name);
      toast('✅ تمت الاستعادة');
    }catch(e){alert('ملف النسخة غير صالح');}
  };
  reader.readAsText(file);
}

function exportAuditCSV(){
  const rows=[['time','team','branch','user','role','action','details'],...activityLog.map(x=>[x.time,x.team,currentBranchCode(),activeUserName(),activeUserRole(),x.action,x.details||''])];
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadText(`audit_${currentBranchCode()}_${localDayKey()}.csv`,csv,'text/csv;charset=utf-8');
}

function supabaseSchemaSQL(){
  return `-- Operations V21 Supabase schema
create table if not exists branches (
  id bigserial primary key,
  code text unique not null,
  name text not null,
  company text,
  created_at timestamptz default now()
);

create table if not exists shift_archives (
  id bigserial primary key,
  created_at timestamptz default now(),
  branch_code text not null,
  team text,
  shift_date date,
  user_name text,
  user_role text,
  data jsonb not null
);

create table if not exists audit_logs (
  id bigserial primary key,
  created_at timestamptz default now(),
  branch_code text,
  user_name text,
  user_role text,
  action text not null,
  details text,
  data jsonb
);



create table if not exists products (
  id bigserial primary key,
  branch_code text not null,
  name text not null,
  company text,
  barcode text,
  section text,
  expiry_date date,
  status text default 'available',
  updated_at timestamptz default now()
);`;
}

function renderSupabaseSQL(){
  const el=document.getElementById('supabaseSql');if(el)el.textContent=supabaseSchemaSQL();
}

function copySupabaseSQL(){
  navigator.clipboard?.writeText(supabaseSchemaSQL()).then(()=>toast('✅ تم نسخ SQL')).catch(()=>downloadText('supabase_schema.sql',supabaseSchemaSQL()));
}

// ══════════════════════════════════════════════
// V20.2 ADMIN, CLOUD, PWA, AI
// ══════════════════════════════════════════════
function requireAdminPin(){
  const ok=sessionStorage.getItem('adminOK')==='1';
  if(ok)return true;
  const pin=prompt('أدخل PIN الإدارة:');
  if(pin===(appSettings.adminPin||'2026')){sessionStorage.setItem('adminOK','1');return true;}
  toast('صلاحية الإدارة مطلوبة');
  return false;
}

function openAdminTab(){if(requireAdminPin())showTab('admin');}

function loadAdminSettings(){
  const map={supabaseUrl:appSettings.supabaseUrl||'',supabaseKey:appSettings.supabaseKey||'',openRouterKey:appSettings.openRouterKey||'',openRouterModel:appSettings.openRouterModel||'deepseek/deepseek-r1:free'};
  Object.entries(map).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val;});
  const ent={branchNameSetting:appSettings.branchName||'',branchCodeSetting:appSettings.branchCode||'MAIN',managerWhatsAppSetting:appSettings.managerWhatsApp||'',companyNameSetting:appSettings.companyName||''};
  Object.entries(ent).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val;});
  updateEnterpriseBadges();
}

function saveCloudSettings(){
  appSettings.supabaseUrl=document.getElementById('supabaseUrl')?.value.trim()||'';
  appSettings.supabaseKey=document.getElementById('supabaseKey')?.value.trim()||'';
  localStorage.setItem('opsAppSettings',JSON.stringify(appSettings));
  logActivity('حفظ إعدادات Supabase','');
  toast('✅ تم حفظ إعدادات السحابة');
}

function saveAISettings(){
  appSettings.openRouterKey=document.getElementById('openRouterKey')?.value.trim()||'';
  appSettings.openRouterModel=document.getElementById('openRouterModel')?.value.trim()||'deepseek/deepseek-r1:free';
  localStorage.setItem('opsAppSettings',JSON.stringify(appSettings));
  logActivity('حفظ إعدادات AI',appSettings.openRouterModel);
  toast('✅ تم حفظ OpenRouter');
}

function renderAdmin(){
  const k=document.getElementById('adminKpis');
  if(k){
    const totalOrders=currentTeam==='app'?orders.insta:(orders.branch+orders.talabat);
    const totalCancels=currentTeam==='app'?cancels.insta:(cancels.branch+cancels.talabat);
    const waiting=customers.reduce((s,c)=>s+c.products.filter(p=>p.status==='waiting').length,0);
    const exp=nearExpiryProducts().length;
    k.innerHTML=`<div class="mini-kpi"><span>الأوردرات</span><strong>${totalOrders}</strong></div><div class="mini-kpi"><span>الملغيات</span><strong>${totalCancels}</strong></div><div class="mini-kpi"><span>نواقص منتظرة</span><strong>${waiting}</strong></div><div class="mini-kpi"><span>صلاحيات قريبة</span><strong>${exp}</strong></div>`;
  }
  renderExpiryList();renderActivityLog();renderPWAStatus();loadAdminSettings();renderUsersList();renderRiskPanel();renderSupabaseSQL();updateEnterpriseBadges();
}

function nearExpiryProducts(days=30){
  const now=new Date();
  return prodDB.filter(p=>p.expiryDate).map(p=>({...p,daysLeft:Math.ceil((new Date(p.expiryDate)-now)/86400000)})).filter(p=>p.daysLeft>=0&&p.daysLeft<=days).sort((a,b)=>a.daysLeft-b.daysLeft);
}

function renderExpiryList(){
  const el=document.getElementById('expiryList');if(!el)return;
  const list=nearExpiryProducts();
  if(!list.length){el.innerHTML='<div style="color:var(--muted);font-size:12px">لا توجد صلاحيات قريبة خلال 30 يوم.</div>';return;}
  el.innerHTML=list.map(p=>`<div class="mini-kpi"><span>${esc(p.name)}</span><strong class="${p.daysLeft<=7?'danger-soft':'ok-soft'}">${p.daysLeft} يوم</strong></div>`).join('');
}

function renderActivityLog(){
  const el=document.getElementById('activityLogBox');if(!el)return;
  el.innerHTML=activityLog.length?activityLog.map(x=>`<div>• ${esc(x.time)} — <b>${esc(x.action)}</b> ${x.details?`<span>(${esc(x.details)})</span>`:''}</div>`).join(''):'لا يوجد نشاط بعد.';
}

function sanitizeShiftForAI(){
  const cancelEntries=[...(window.cancelEntries||[]),...(window.cancelEntriesApp||[])].map(e=>({source:e.source,reason:e.reason,shift:e.shift||getShift()}));
  const shortageProducts=[];
  customers.forEach(c=>c.products.forEach(p=>{const m=enrichShortageProduct(p);shortageProducts.push({product:m.name,company:m.company,type:m.productStatus,status:m.status,section:m.section});}));
  return {
    date:new Date().toLocaleDateString('ar-EG'),team:currentTeam,shift:getShift(),branchCode:currentBranchCode(),branchName:currentBranchName(),userName:activeUserName(),userRole:activeUserRole(),
    orders,cancels,cancelEntries,
    branchShortages:branchList.map(x=>({date:x.date,shift:x.shift||getShift(),items:x.itemsData||x.items})),
    shortageProducts,
    productsSummary:{
      total:prodDB.length,
      blocked:prodDB.filter(p=>p.status==='blocked').length,
      outOfStock:prodDB.filter(p=>p.status==='out-of-stock').length,
      notListed:prodDB.filter(p=>p.status==='not-listed').length,
      nearExpiry:nearExpiryProducts().map(p=>({name:p.name,section:p.section,daysLeft:p.daysLeft}))
    }
  };
}

function localShiftAnalysis(data=sanitizeShiftForAI()){
  const totalOrders=(data.orders.branch||0)+(data.orders.talabat||0)+(data.orders.insta||0);
  const totalCancels=(data.cancels.branch||0)+(data.cancels.talabat||0)+(data.cancels.insta||0);
  const reasons={};data.cancelEntries.forEach(e=>{reasons[e.reason]=(reasons[e.reason]||0)+1;});
  const topReason=Object.entries(reasons).sort((a,b)=>b[1]-a[1])[0];
  const sections={};data.shortageProducts.forEach(p=>{const s=p.section||'غير مصنف';sections[s]=(sections[s]||0)+1;});
  const topSection=Object.entries(sections).sort((a,b)=>b[1]-a[1])[0];
  return `ملخص إداري سريع:
- إجمالي الأوردرات: ${totalOrders}
- إجمالي الملغيات: ${totalCancels}${totalOrders?` بنسبة ${((totalCancels/totalOrders)*100).toFixed(1)}%`:''}
- أكثر سبب إلغاء تكراراً: ${topReason?`${topReason[0]} (${topReason[1]})`:'لا توجد بيانات كافية'}
- أكثر قسم فيه نواقص: ${topSection?`${topSection[0]} (${topSection[1]})`:'لا توجد بيانات كافية'}
- منتجات قريبة الصلاحية: ${data.productsSummary.nearExpiry.length}

توصية:
راجع القسم الأكثر تكراراً قبل الذروة، وجهّز بدائل للمنتجات الناقصة، وراجع سبب الإلغاء الأعلى مع مسؤول الشيفت قبل نهاية اليوم.`;
}

async function generateSmartAnalysis(){
  const box=document.getElementById('aiAnalysis');if(box)box.textContent='جاري التحليل...';
  const data=sanitizeShiftForAI();
  if(!appSettings.openRouterKey){
    if(box)box.textContent=localShiftAnalysis(data)+'\n\nملاحظة: هذا تحليل محلي. أضف OpenRouter API Key للحصول على صياغة أقوى.';
    return;
  }
  try{
    const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+appSettings.openRouterKey,'HTTP-Referer':location.href,'X-Title':'Operations V20'},body:JSON.stringify({model:appSettings.openRouterModel||'deepseek/deepseek-r1:free',messages:[{role:'system',content:'أنت محلل عمليات سوبر ماركت. اكتب ملخصاً عربياً عملياً مختصراً بدون ذكر أسماء أو هواتف.'},{role:'user',content:JSON.stringify(data)}],temperature:.3})});
    if(!res.ok)throw new Error(await res.text());
    const out=await res.json();
    box.textContent=out.choices?.[0]?.message?.content||localShiftAnalysis(data);
    logActivity('تحليل AI','OpenRouter');
  }catch(e){
    box.textContent=localShiftAnalysis(data)+'\n\nتعذر الاتصال بـ OpenRouter، فتم استخدام التحليل المحلي.';
  }
}

async function syncToSupabase(){
  saveCloudSettings();
  if(!appSettings.supabaseUrl||!appSettings.supabaseKey){toast('أضف رابط Supabase والـ anon key أولاً');return;}
  const payload={created_at:new Date().toISOString(),branch_code:currentBranchCode(),team:currentTeam,shift_date:localDayKey(),user_name:activeUserName(),user_role:activeUserRole(),data:sanitizeShiftForAI()};
  try{
    const url=appSettings.supabaseUrl.replace(/\/$/,'')+'/rest/v1/shift_archives';
    const res=await fetch(url,{method:'POST',headers:{apikey:appSettings.supabaseKey,Authorization:'Bearer '+appSettings.supabaseKey,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(payload)});
    if(!res.ok)throw new Error(await res.text());
    logActivity('مزامنة Supabase','shift_archives');
    toast('✅ تمت المزامنة مع Supabase');
  }catch(e){toast('تعذرت مزامنة Supabase: تحقق من الجدول والإعدادات');}
}

function registerPWA(){
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('sw.js').then(()=>renderPWAStatus()).catch(()=>renderPWAStatus());
  }
  renderPWAStatus();
}

function renderPWAStatus(){
  const el=document.getElementById('pwaStatus');if(!el)return;
  el.innerHTML=location.protocol.startsWith('http')
    ? 'جاهز للتثبيت عند النشر على HTTPS. Service Worker مفعل إن سمح المتصفح.'
    : 'افتح التطبيق عبر Netlify/GitHub Pages أو خادم محلي لتفعيل PWA بالكامل. وضع الملف المباشر لا يسمح بتسجيل Service Worker.';
}

// ══════════════════════════════════════════════
// V21 ENTERPRISE VOICE DICTATION ENGINE
// ══════════════════════════════════════════════
const _voiceSessions={};

function toggleVoiceInput(targetId,btnId,interimId){
  // If already listening for this target → stop
  if(_voiceSessions[targetId]){
    try{_voiceSessions[targetId].stop();}catch(e){}
    _voiceSessions[targetId]=null;
    const btn=document.getElementById(btnId);
    if(btn){btn.classList.remove('listening');btn.innerHTML='🎙️ إملاء صوتي';}
    const interim=document.getElementById(interimId);
    if(interim)interim.textContent='';
    return;
  }

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const target=document.getElementById(targetId);
  const btn=document.getElementById(btnId);
  const interim=document.getElementById(interimId);

  if(!SR){
    toast('🎙️ الإدخال الصوتي يتطلب متصفح Chrome أو Edge');
    return;
  }
  if(!target){toast('خطأ: الحقل غير موجود');return;}

  const rec=new SR();
  rec.lang='ar-SA';
  rec.interimResults=true;
  rec.continuous=true;
  rec.maxAlternatives=1;

  _voiceSessions[targetId]=rec;
  if(btn){btn.classList.add('listening');btn.innerHTML='⏹️ إيقاف التسجيل';}
  toast('🎙️ يستمع الآن — تحدث بوضوح...');

  let finalBuffer='';

  rec.onresult=e=>{
    let interimText='';
    let newFinal='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t=e.results[i][0].transcript;
      if(e.results[i].isFinal){newFinal+=t+' ';}
      else{interimText+=t;}
    }
    if(newFinal){
      finalBuffer+=newFinal;
      target.value=(target.value?target.value.trimEnd()+' ':'')+finalBuffer.trimEnd();
      finalBuffer='';
      target.dispatchEvent(new Event('input',{bubbles:true}));
      autoSave();
    }
    if(interim)interim.textContent=interimText?('…'+interimText):'';
  };

  rec.onerror=ev=>{
    const msgs={network:'خطأ في الشبكة',"not-allowed":'يرجى السماح للمتصفح بالوصول للميكروفون',"no-speech":'لم يتم اكتشاف صوت — حاول مجدداً',aborted:'تم إلغاء الإدخال الصوتي'};
    toast(msgs[ev.error]||'تعذر التقاط الصوت: '+ev.error);
    _voiceSessions[targetId]=null;
    if(btn){btn.classList.remove('listening');btn.innerHTML='🎙️ إملاء صوتي';}
    if(interim)interim.textContent='';
  };

  rec.onend=()=>{
    // Auto-restart if still in listening state (browser ends session after silence)
    if(_voiceSessions[targetId]){
      try{rec.start();}catch(e){
        _voiceSessions[targetId]=null;
        if(btn){btn.classList.remove('listening');btn.innerHTML='🎙️ إملاء صوتي';}
        if(interim)interim.textContent='';
      }
    }
  };

  try{rec.start();}
  catch(e){
    toast('تعذر بدء الميكروفون: '+e.message);
    _voiceSessions[targetId]=null;
    if(btn){btn.classList.remove('listening');btn.innerHTML='🎙️ إملاء صوتي';}
  }
}

// Legacy alias for any old references
function startVoiceInput(targetId){
  const btnId='voiceBtn-'+targetId;
  const interimId=targetId+'Interim';
  toggleVoiceInput(targetId,btnId,interimId);
}

function sendWhatsAppReport(){
  const txt=document.getElementById('rPrev')?.value||'';
  if(!txt.trim() || txt.includes('اضغط "معاينة"')){toast('التقرير فارغ');return;}
  const url='https://wa.me/?text='+encodeURIComponent(txt);
  window.open(url,'_blank','noopener');
}

async function improveReportWithAI() {
  const rp = document.getElementById('rPrev');
  if(!rp || !rp.value.trim() || rp.value.includes('اضغط "معاينة"')) { toast('قم بإنشاء التقرير أولاً'); return; }
  
  const originalText = rp.value;
  rp.value = "جاري التحليل والصياغة بالذكاء الاصطناعي... ⏳\nالرجاء الانتظار...";
  
  const prompt = `أنت مدير عمليات سوبر ماركت محترف. هذا تقرير وردية (شيفت). 
أريدك أن تعيد صياغته ليكون أكثر احترافية ووضوحاً للإدارة العليا.
حافظ على جميع الأرقام والبيانات بدقة تامة. يمكنك ترتيبها واستخدام إيموجي مناسب، وإبراز النقاط الحرجة (مثل النواقص أو المنتجات منتهية الصلاحية).

التقرير الأصلي:
${originalText}`;

  try {
    const key = document.getElementById('openRouterKey')?.value || localStorage.getItem('opsOpenRouterKey');
    const model = document.getElementById('openRouterModel')?.value || localStorage.getItem('opsOpenRouterModel') || 'deepseek/deepseek-r1:free';
    
    if (key) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model, messages: [{role: 'user', content: prompt}] })
      });
      const data = await response.json();
      if(data?.choices?.[0]?.message) {
        let content = data.choices[0].message.content;
        content = content.replace(/<think>[\s\S]*?<\/think>\n?/g, '');
        rp.value = content.trim();
        toast('✅ تم تنقيح التقرير بنجاح');
      } else {
        rp.value = originalText;
        toast('❌ خطأ في رد الذكاء الاصطناعي');
      }
    } else {
      if(typeof localExpertAnswer === 'function') {
        rp.value = localExpertAnswer(prompt) + '\n\n' + originalText;
        toast('⚠️ تم استخدام الذكاء المحلي. أضف مفتاح OpenRouter للحصول على صياغة ممتازة.');
      } else {
        rp.value = originalText;
        toast('❌ يرجى إضافة مفتاح API للذكاء الاصطناعي من الإعدادات');
      }
    }
  } catch (e) {
    console.error(e);
    rp.value = originalText;
    toast('❌ حدث خطأ في الاتصال');
  }
}


// ══════════════════════════════════════════════
// V22 STORE VETERAN AI ASSISTANT
// ══════════════════════════════════════════════
let aiChatHistory=JSON.parse(localStorage.getItem('opsAiChatHistory')||'[]');

function toggleStoreAssistant(force){
  const dock=document.getElementById('aiDock');
  if(!dock)return;
  const on=force===undefined?!dock.classList.contains('on'):force;
  dock.classList.toggle('on',on);
  if(on){renderAssistantMessages();setTimeout(()=>document.getElementById('aiInput')?.focus(),80);}
}

function assistantWelcome(){
  return `أنا مساعد العمليات. اسألني عن النواقص، الملغيات، ترتيب التجميع، الصلاحيات، إغلاق الشيفت، أو قرارات المدير.
أقرأ مؤشرات الشيفت الحالية وأرد عليك كموظف خبرة تشغيل طويلة، بدون كشف بيانات العملاء.`;
}

function renderAssistantMessages(){
  const box=document.getElementById('aiMessages');if(!box)return;
  const messages=aiChatHistory.length?aiChatHistory:[{role:'bot',content:assistantWelcome()}];
  box.innerHTML=messages.slice(-30).map(m=>`<div class="ai-msg ${m.role==='user'?'user':'bot'}">${esc(m.content)}</div>`).join('');
  box.scrollTop=box.scrollHeight;
}

function pushAiMessage(role,content){
  aiChatHistory.push({role,content,time:Date.now()});
  aiChatHistory=aiChatHistory.slice(-60);
  localStorage.setItem('opsAiChatHistory',JSON.stringify(aiChatHistory));
  renderAssistantMessages();
}

function askAssistantQuick(q){
  const input=document.getElementById('aiInput');if(input)input.value=q;
  sendAssistantMessage();
}

function scrubAssistantText(text){
  return String(text||'')
    .replace(/\+?\d[\d\s\-]{7,}\d/g,'[رقم محذوف]')
    .replace(/(عميل|العميل)\s*[:：]?\s*[\u0600-\u06FFa-zA-Z ]{2,}/gi,'$1 [اسم محذوف]');
}

function storeExpertSystemPrompt(){
  return `أنت مساعد عمليات داخل نظام سوبر ماركت/انستا شوب.
تصرف كخبير تشغيل محلات بخبرة عشرات السنوات: عملي، مباشر، يعرف التجميع، النواقص، الصلاحيات، الطيارين، الإلغاءات، الذروة، وترتيب الأقسام.
لا تذكر أسماء عملاء أو أرقام هواتف. لا تطلب بيانات حساسة. أعط قرارات قابلة للتنفيذ الآن.
اكتب بالعربية المصرية/العربية الواضحة حسب سياق المستخدم.
اجعل الرد قصيراً ومنظماً:
- تشخيص سريع
- ماذا يفعل الموظف الآن
- ماذا يرفع للمشرف
- تنبيه إن كان هناك خطر`;
}

function assistantContext(){
  const data=sanitizeShiftForAI();
  const risks=buildRiskAlerts?buildRiskAlerts():[];
  const route=(branchList.at(-1)?.itemsData||[]).map(x=>({name:x.name,company:x.company})).filter(x=>x.name);
  return {
    ...data,
    risks,
    route,
    nearExpiry:nearExpiryProducts?nearExpiryProducts(14).map(p=>({name:p.name,section:p.section,daysLeft:p.daysLeft})):[]
  };
}

function localExpertAnswer(question){
  const q=question.toLowerCase();
  const data=assistantContext();
  const totalOrders=(data.orders.branch||0)+(data.orders.talabat||0)+(data.orders.insta||0);
  const totalCancels=(data.cancels.branch||0)+(data.cancels.talabat||0)+(data.cancels.insta||0);
  const waiting=data.shortageProducts.filter(p=>p.status==='waiting').length;
  const topRisk=(data.risks||[]).find(r=>r.level==='high')||(data.risks||[]).find(r=>r.level==='med');
  const sectionCounts={};data.shortageProducts.forEach(p=>{const a=p.section||'غير مصنف';sectionCounts[a]=(sectionCounts[a]||0)+1;});
  const topSections=Object.entries(sectionCounts).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([a,n])=>`${a}: ${n}`).join('، ');
  const reasons={};data.cancelEntries.forEach(e=>{reasons[e.reason||'غير محدد']=(reasons[e.reason||'غير محدد']||0)+1;});
  const topReason=Object.entries(reasons).sort((a,b)=>b[1]-a[1])[0];

  if(q.includes('تجميع')||q.includes('قسم')||q.includes('route')||q.includes('خط سير')){
    return `تشخيص سريع:
- عندك ${waiting} نقص/منتج في الانتظار.
- أكثر الأقسام ضغطاً: ${topSections||'لم يتم تسجيل أقسام كافية'}.

ماذا يفعل الموظف الآن:
- ابدأ بالقسم صاحب أكبر عدد نواقص، ثم انتقل للقسم التالي.
- اجمع كل منتجات القسم في نفس الجولة ولا تكرر الحركة بلا داع.
- أي منتج غير موجود: صوره/سجله فوراً كناقص ثم انتقل، لا تضيع وقتك على رف واحد.

يرفع للمشرف:
- الأقسام المتكررة في النواقص.
- المنتجات غير المدرجة أو المغلقة أكثر من يوم.`;
  }
  if(q.includes('ملغي')||q.includes('الغاء')||q.includes('إلغاء')||q.includes('cancel')){
    return `تشخيص سريع:
- إجمالي الملغيات: ${totalCancels}${totalOrders?` من ${totalOrders} أوردر (${((totalCancels/totalOrders)*100).toFixed(1)}%)`:''}.
- السبب الأعلى: ${topReason?`${topReason[0]} (${topReason[1]})`:'لا توجد أسباب كافية'}.

تصرف الآن:
- لو السبب نقص منتج: اعرض بديل بنفس السعر/القسم قبل الإلغاء.
- لو السبب طيارين أو تأخير: ارفع للمشرف فوراً قبل تراكم الطلبات.
- لو العميل لا يرد: طبق محاولة اتصال ثانية بعد 5 دقائق ثم وثق السبب.

تنبيه:
- لو نسبة الإلغاء فوق 15% اعتبر الشيفت في خطر وابدأ تدخل مشرف.`;
  }
  if(q.includes('صلاح')||q.includes('انتهاء')||q.includes('اكسباير')||q.includes('expiry')){
    const exp=data.nearExpiry||[];
    return `تشخيص سريع:
- منتجات قريبة الصلاحية خلال 14 يوم: ${exp.length}.

ماذا يفعل الموظف الآن:
${exp.length?exp.slice(0,8).map(p=>`- ${p.name}: ${p.daysLeft} يوم${p.section?`، قسم ${p.section}`:''}`).join('\n'):'- لا توجد عناصر مسجلة حالياً.'}

قرار تشغيلي:
- الأقل من 7 أيام: اعرضه للمشرف لعروض/مرتجع.
- من 8 إلى 14 يوم: قربه في الواجهة وتابع مبيعاته يومياً.`;
  }
  if(q.includes('اقفال')||q.includes('إغلاق')||q.includes('ارشفة')||q.includes('أرشفة')||q.includes('نهاية')){
    return `قائمة إغلاق الشيفت:
- راجع أن الأوردرات والملغيات مكتوبة صح.
- افتح النواقص وتأكد أن كل منتج مهم تم تبليغه أو له بديل.
- راجع المنتجات المغلقة أكثر من 7 أيام.
- راجع الصلاحيات القريبة.
- انسخ تقرير واتساب للمدير.
- بعدها اعمل أرشفة فقط.

لا تؤرشف قبل مراجعة سبب الإلغاء الأعلى: ${topReason?topReason[0]:'غير متوفر بعد'}.`;
  }
  return `تشخيص سريع:
- الأوردرات: ${totalOrders}
- الملغيات: ${totalCancels}${totalOrders?` (${((totalCancels/totalOrders)*100).toFixed(1)}%)`:''}
- نواقص في الانتظار: ${waiting}
- أهم خطر الآن: ${topRisk?`${topRisk.title} - ${topRisk.body}`:'لا يوجد خطر واضح'}

ماذا تفعل الآن:
- ابدأ بالنواقص المنتظرة ورتبها حسب القسم.
- عالج سبب الإلغاء الأعلى قبل أن يزيد.
- راجع الصلاحيات القريبة لو الشيفت هادئ.
- ارفع للمشرف أي منتج متكرر النقص أو مغلق أكثر من 7 أيام.`;
}

async function askOpenRouterAssistant(question){
  const cleanQuestion=scrubAssistantText(question);
  const context=assistantContext();
  const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+appSettings.openRouterKey,
      'HTTP-Referer':location.href,
      'X-Title':'Operations V22 Store Assistant'
    },
    body:JSON.stringify({
      model:appSettings.openRouterModel||'deepseek/deepseek-r1:free',
      messages:[
        {role:'system',content:storeExpertSystemPrompt()},
        {role:'user',content:'سياق الشيفت المنقح من البيانات الشخصية:\n'+JSON.stringify(context)+'\n\nسؤال الموظف:\n'+cleanQuestion}
      ],
      temperature:.25
    })
  });
  if(!res.ok)throw new Error(await res.text());
  const out=await res.json();
  return out.choices?.[0]?.message?.content||localExpertAnswer(question);
}

async function sendAssistantMessage(){
  const input=document.getElementById('aiInput');if(!input)return;
  const question=input.value.trim();if(!question)return;
  input.value='';
  pushAiMessage('user',question);
  pushAiMessage('bot','يفكر في وضع الشيفت الحالي...');
  try{
    const answer=appSettings.openRouterKey?await askOpenRouterAssistant(question):localExpertAnswer(question);
    aiChatHistory.pop();
    pushAiMessage('bot',answer);
    logActivity('سؤال مساعد AI',question.slice(0,80));
  }catch(e){
    aiChatHistory.pop();
    pushAiMessage('bot',localExpertAnswer(question)+'\n\nملاحظة: تعذر الاتصال بالـ API، فاستخدمت خبرة التشغيل المحلية.');
  }
}

// CLOSE MODALS ON OUTSIDE CLICK
document.getElementById('reportModal').addEventListener('click',function(e){if(e.target===this)closeReport();});
document.getElementById('scModal').addEventListener('click',function(e){if(e.target===this)closeScanner();});
document.getElementById('cancelReasonModal').addEventListener('click',function(e){if(e.target===this)closeCancelModal();});
document.addEventListener('click',function(e){
  const list=document.getElementById('followupACList');
  if(list&&!list.contains(e.target)&&e.target.id!=='followup') list.style.display='none';
  // Close global search on outside click
  const gsOv=document.getElementById('gsOverlay');
  if(gsOv&&e.target===gsOv) closeGlobalSearch();
});

// ══════════════════════════════════════════════
// V21 GLOBAL SEARCH (Spotlight)
// ══════════════════════════════════════════════
let _gsSelIdx=-1;
let _gsItems=[];

function openGlobalSearch(){
  const ov=document.getElementById('gsOverlay');if(!ov)return;
  ov.classList.add('on');
  const inp=document.getElementById('gsInp');if(inp){inp.value='';inp.focus();}
  _gsSelIdx=-1;
  renderGsResults('');
}

function closeGlobalSearch(){
  document.getElementById('gsOverlay')?.classList.remove('on');
}

function renderGsResults(q){
  const box=document.getElementById('gsResults');if(!box)return;
  const qL=q.toLowerCase().trim();
  _gsItems=[];

  // 1. Products
  const statusMap={available:{l:'متاح',bg:'rgba(45,212,119,.12)',c:'#2dd477'},'out-of-stock':{l:'ناقص',bg:'rgba(212,175,55,.12)',c:'#d4af37'},blocked:{l:'مغلق',bg:'rgba(239,68,68,.12)',c:'#ef4444'},'not-listed':{l:'غير مدرج',bg:'rgba(100,120,140,.12)',c:'#64788c'}};
  prodDB.filter(p=>!qL||(p.name+p.company+p.barcode).toLowerCase().includes(qL)).slice(0,6).forEach(p=>{
    const s=statusMap[p.status]||statusMap['not-listed'];
    _gsItems.push({icon:'📦',name:p.name,sub:p.company+(p.barcode?' · '+p.barcode:''),badge:s.l,bg:s.bg,c:s.c,action:()=>{showTab('prods');document.getElementById('prodSearch').value=p.name;renderProds();closeGlobalSearch();}});
  });

  // 2. Customers (shortages)
  customers.filter(c=>!qL||(c.name+c.phone+(c.products||[]).map(x=>x.name).join()).toLowerCase().includes(qL)).slice(0,4).forEach(c=>{
    _gsItems.push({icon:'👤',name:c.name,sub:(c.phone||'')+(c.products?.length?' · '+c.products.length+' نواقص':''),badge:'عميل',bg:'rgba(59,130,246,.1)',c:'#60a5fa',action:()=>{showTab('entry');closeGlobalSearch();}});
  });

  // 3. Cancel entries
  (window.cancelEntries||[]).filter(e=>!qL||(e.reason+e.source+(e.orderNum||'')).toLowerCase().includes(qL)).slice(0,4).forEach(e=>{
    _gsItems.push({icon:'✕',name:e.reason,sub:e.source+(e.orderNum?' · #'+e.orderNum:''),badge:'إلغاء',bg:'rgba(239,68,68,.1)',c:'#f87171',action:()=>{showTab('entry');closeGlobalSearch();}});
  });

  // 4. Archive
  archive.filter(a=>!qL||(a.branchName+a.date+a.user).toLowerCase().includes(qL)).slice(0,3).forEach(a=>{
    _gsItems.push({icon:'📊',name:a.branchName||'أرشيف',sub:a.date+' · '+a.user,badge:'أرشيف',bg:'rgba(212,175,55,.1)',c:'#d8bd69',action:()=>{showTab('arch');closeGlobalSearch();}});
  });

  if(!_gsItems.length){
    box.innerHTML=`<div class="gs-empty">${qL?'لا توجد نتائج لـ "'+esc(q)+'"':'ابدأ بالكتابة للبحث في المنتجات والعملاء والأرشيف'}</div>`;
    return;
  }

  box.innerHTML=_gsItems.map((it,i)=>`
    <div class="gs-item" data-i="${i}" onclick="_gsItems[${i}].action()">
      <div class="gs-icon">${it.icon}</div>
      <div class="gs-main">
        <div class="gs-name">${esc(it.name)}</div>
        <div class="gs-sub">${esc(it.sub)}</div>
      </div>
      <div class="gs-badge" style="background:${it.bg};color:${it.c}">${it.badge}</div>
    </div>`).join('');
}

// ══════════════════════════════════════════════
// V21 KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════
document.addEventListener('keydown',function(e){
  const tag=document.activeElement?.tagName;
  const inInput=tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT';

  // Global search: '/' key
  if(e.key==='/'&&!inInput){e.preventDefault();openGlobalSearch();return;}

  // Escape: close any open overlay
  if(e.key==='Escape'){
    closeGlobalSearch();
    if(document.getElementById('reportModal')?.classList.contains('on')) closeReport();
    toggleStoreAssistant(false);
    return;
  }

  // Inside global search
  const gsOn=document.getElementById('gsOverlay')?.classList.contains('on');
  if(gsOn){
    if(e.key==='ArrowDown'){e.preventDefault();_gsSelIdx=Math.min(_gsSelIdx+1,_gsItems.length-1);highlightGsItem();}
    else if(e.key==='ArrowUp'){e.preventDefault();_gsSelIdx=Math.max(_gsSelIdx-1,0);highlightGsItem();}
    else if(e.key==='Enter'&&_gsSelIdx>=0){e.preventDefault();_gsItems[_gsSelIdx]?.action();}
    return;
  }

  // Skip shortcuts if typing
  if(inInput) return;

  switch(e.key.toLowerCase()){
    case 'b': updCount('branch',1); toast('📍 +1 فرع'); break;
    case 't': updCount('talabat',1); toast('📱 +1 طلبات'); break;
    case 'i': updCount('insta',1); toast('🌐 +1 انستا'); break;
    case 'r': openReport(); break;
    case '?': toggleKbHint(); break;
  }
});

document.getElementById('gsInp')?.addEventListener('input',function(){renderGsResults(this.value);_gsSelIdx=-1;});

function highlightGsItem(){
  document.querySelectorAll('.gs-item').forEach((el,i)=>el.classList.toggle('sel',i===_gsSelIdx));
  document.querySelector('.gs-item.sel')?.scrollIntoView({block:'nearest'});
}

function toggleKbHint(){
  const h=document.getElementById('kbHint');
  if(h) h.style.display=h.style.display==='flex'?'none':'flex';
}

// ══════════════════════════════════════════════
// V21 EXPIRY NOTIFICATIONS
// ══════════════════════════════════════════════
function checkExpiryNotifications(){
  const urgent=prodDB.filter(p=>{
    if(!p.expiryDate) return false;
    const days=Math.ceil((new Date(p.expiryDate)-Date.now())/(864e5));
    return days>=0&&days<=3;
  });

  const badge=document.getElementById('expiryFloatBadge');
  if(badge){
    if(urgent.length){
      badge.style.display='block';
      badge.textContent='⚠️ '+urgent.length+' منتج ينتهي خلال 3 أيام — انقر لعرضها';
      badge.onclick=()=>{showTab('admin');badge.style.display='none';};
    } else {
      badge.style.display='none';
    }
  }

  // Browser push notification (only once per session per product)
  if('Notification' in window && Notification.permission==='granted' && urgent.length){
    urgent.slice(0,2).forEach(p=>{
      const days=Math.ceil((new Date(p.expiryDate)-Date.now())/(864e5));
      new Notification('⚠️ '+p.name, {
        body: 'ينتهي خلال '+days+' يوم'+' — '+( p.section||'بدون قسم'),
        icon: '📦',
        tag: 'expiry-'+p.barcode
      });
    });
  }
}

function requestNotifPermission(){
  if('Notification' in window && Notification.permission==='default'){
    Notification.requestPermission();
  }
}

// Run expiry check on load + every 30 min
setTimeout(()=>{ requestNotifPermission(); checkExpiryNotifications(); }, 2000);
setInterval(checkExpiryNotifications, 30*60*1000);

// ══════════════════════════════════════════════
// PHASE 2: LIVE ANALYTICS CHARTS
// ══════════════════════════════════════════════
let _charts={};

function renderAnalyticsCharts(){
  renderOrdersDonut();
  renderCancelReasonsBar();
  renderTrendLine();
  renderLiveKpis();
  renderStorageBar();
}

function destroyChart(id){
  if(_charts[id]){try{_charts[id].destroy();}catch(e){}delete _charts[id];}
}

const CHART_DEFAULTS={
  color:'#f6edd8',
  plugins:{legend:{labels:{color:'#d8bd69',font:{family:'Cairo',size:10},boxWidth:10}}},
};

function renderOrdersDonut(){
  destroyChart('ordersDonut');
  const ctx=document.getElementById('ordersDonutChart');if(!ctx)return;
  const vals=[orders.branch||0,orders.talabat||0,orders.insta||0];
  if(vals.every(v=>!v)){ctx.parentElement.innerHTML='<div style="height:140px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px">لا توجد أوردرات</div>';return;}
  _charts['ordersDonut']=new Chart(ctx,{
    type:'doughnut',
    data:{
      labels:['فرع','طلبات','انستا'],
      datasets:[{data:vals,backgroundColor:['#3b82f6','#f59e0b','#2dd477'],borderColor:'#0c0a07',borderWidth:2,hoverOffset:4}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{...CHART_DEFAULTS.plugins,tooltip:{callbacks:{label:c=>`${c.label}: ${c.raw}`}}},
      cutout:'68%',
    }
  });
}

function renderCancelReasonsBar(){
  destroyChart('cancelReasons');
  const ctx=document.getElementById('cancelReasonsChart');if(!ctx)return;
  const all=(window.cancelEntries||[]).concat(window.cancelEntriesApp||[]);
  const reasons={};
  all.forEach(e=>reasons[e.reason||'غير محدد']=(reasons[e.reason||'غير محدد']||0)+1);
  const sorted=Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if(!sorted.length){ctx.parentElement.innerHTML='<div style="height:140px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px">لا توجد إلغاءات</div>';return;}
  _charts['cancelReasons']=new Chart(ctx,{
    type:'bar',
    data:{
      labels:sorted.map(([k])=>k.length>10?k.slice(0,10)+'…':k),
      datasets:[{data:sorted.map(([,v])=>v),backgroundColor:'rgba(239,68,68,.7)',borderColor:'#ef4444',borderWidth:1,borderRadius:4}]
    },
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{...CHART_DEFAULTS.plugins,legend:{display:false},tooltip:{callbacks:{label:c=>`${c.raw} إلغاء`}}},
      scales:{x:{ticks:{color:'#a38b58',font:{size:9}},grid:{color:'rgba(255,255,255,.05)'}},y:{ticks:{color:'#d8bd69',font:{size:9,family:'Cairo'}},grid:{display:false}}}
    }
  });
}

function renderTrendLine(){
  destroyChart('trend');
  const ctx=document.getElementById('trendLineChart');if(!ctx)return;
  // Get last 7 archived days
  const days=[...archive].sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(-7);
  if(days.length<2){ctx.parentElement.innerHTML='<div style="height:180px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px">أرشف شيفتات للحصول على الرسم البياني</div>';return;}
  _charts['trend']=new Chart(ctx,{
    type:'line',
    data:{
      labels:days.map(d=>d.date),
      datasets:[
        {label:'الأوردرات',data:days.map(d=>(d.orders?.branch||0)+(d.orders?.talabat||0)+(d.orders?.insta||0)),borderColor:'#d4af37',backgroundColor:'rgba(212,175,55,.08)',tension:.35,fill:true,pointBackgroundColor:'#d4af37',pointRadius:4},
        {label:'الملغيات',data:days.map(d=>(d.cancels?.branch||0)+(d.cancels?.talabat||0)+(d.cancels?.insta||0)),borderColor:'#ef4444',backgroundColor:'rgba(239,68,68,.06)',tension:.35,fill:true,pointBackgroundColor:'#ef4444',pointRadius:4}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{...CHART_DEFAULTS.plugins},
      scales:{
        x:{ticks:{color:'#a38b58',font:{size:9,family:'Cairo'}},grid:{color:'rgba(255,255,255,.04)'}},
        y:{ticks:{color:'#a38b58',font:{size:9}},grid:{color:'rgba(255,255,255,.04)'},beginAtZero:true}
      }
    }
  });
}

function renderLiveKpis(){
  const box=document.getElementById('liveKpiGrid');if(!box)return;
  const totalOrders=(orders.branch||0)+(orders.talabat||0)+(orders.insta||0);
  const totalCancels=(cancels.branch||0)+(cancels.talabat||0)+(cancels.insta||0);
  const pct=totalOrders?(totalCancels/totalOrders*100).toFixed(1):0;
  const waiting=customers.reduce((s,c)=>s+c.products.filter(p=>p.status==='waiting').length,0);
  // Compare with last archived day
  const last=archive.length?archive[archive.length-1]:null;
  const lastTotal=last?((last.orders?.branch||0)+(last.orders?.talabat||0)+(last.orders?.insta||0)):null;
  const deltaOrders=lastTotal!==null?totalOrders-lastTotal:null;
  const kpis=[
    {val:totalOrders,lbl:'الأوردرات',color:'#d4af37',delta:deltaOrders},
    {val:totalCancels,lbl:'الملغيات',color:'#ef4444',delta:null},
    {val:pct+'%',lbl:'نسبة الإلغاء',color:pct>15?'#ef4444':pct>10?'#d4af37':'#2dd477',delta:null},
    {val:customers.length,lbl:'عملاء',color:'#60a5fa',delta:null},
    {val:waiting,lbl:'انتظار',color:'#f59e0b',delta:null},
    {val:customers.reduce((s,c)=>s+c.products.filter(p=>p.status==='reported').length,0),lbl:'تم التبليغ',color:'#2dd477',delta:null}
  ];
  box.innerHTML=kpis.map(k=>{
    let deltaHtml='';
    if(k.delta!==null){const cls=k.delta>0?'delta-up':k.delta<0?'delta-dn':'delta-eq';const sym=k.delta>0?'↑':k.delta<0?'↓':'=';deltaHtml=`<div class="kpi-delta ${cls}">${sym}${Math.abs(k.delta)}</div>`;}
    return `<div class="kpi-box"><div class="kpi-val" style="color:${k.color}">${k.val}</div><div class="kpi-lbl">${k.lbl}</div>${deltaHtml}</div>`;
  }).join('');
}

function renderStorageBar(){
  const info=document.getElementById('storageInfo');
  const bar=document.getElementById('storageBarFill');
  if(!info||!bar)return;
  let used=0;
  try{for(let k in localStorage){if(localStorage.hasOwnProperty(k))used+=localStorage[k].length*2;}}catch(e){}
  const maxBytes=5*1024*1024; // 5MB estimate
  const pct=Math.min(100,(used/maxBytes*100)).toFixed(1);
  const usedKB=(used/1024).toFixed(0);
  info.textContent=`مستخدم: ${usedKB} KB من أصل ~5 MB (${pct}%)`;
  bar.style.width=pct+'%';
  bar.className='storage-bar '+(pct>80?'storage-crit':pct>50?'storage-warn':'storage-ok');
  if(pct>85)toast('⚠️ التخزين ممتلئ! صدّر نسخة احتياطية وأرشف البيانات.');
}

function clearStorageCache(){
  if(!confirm('🧹 سيتم حذف سجل النشاط والكاش المؤقت فقط. بيانات الشيفت والمنتجات ستبقى. هل تريد المتابعة؟'))return;
  localStorage.removeItem('opsActivityLog');
  localStorage.removeItem('opsAiChatHistory');
  toast('✅ تم تنظيف الكاش');
  renderStorageBar();
}

// ══════════════════════════════════════════════
// PHASE 2: PRINT / PDF EXPORT
// ══════════════════════════════════════════════
function printShiftReport(){
  buildReport();
  setTimeout(()=>{
    const content=document.getElementById('rPrev')?.textContent||'';
    const win=window.open('','_blank','width=700,height=900');
    if(!win)return;
    const branchName=appSettings?.branchName||'';
    const date=new Date().toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
      <meta charset="UTF-8">
      <title>تقرير الشيفت — ${branchName}</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Cairo',sans-serif;background:#fff;color:#1a1a1a;padding:20mm 18mm;font-size:11pt;line-height:1.8}
        .report-header{border-bottom:3px solid #d4af37;padding-bottom:12px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end}
        .report-title{font-size:20pt;font-weight:900;color:#1a1209}
        .report-sub{font-size:10pt;color:#6b5a2a;margin-top:3px}
        .report-date{font-size:9pt;color:#888;text-align:left}
        .report-body{white-space:pre-wrap;font-size:10.5pt;line-height:2;color:#2a2010}
        .report-footer{margin-top:24px;border-top:1px solid #e0d0a0;padding-top:10px;font-size:9pt;color:#aaa;display:flex;justify-content:space-between}
        @media print{body{padding:15mm 12mm}@page{margin:0}}
      </style></head><body>
      <div class="report-header">
        <div><div class="report-title">📊 ${branchName||'نظام العمليات'}</div><div class="report-sub">تقرير الشيفت التشغيلي</div></div>
        <div class="report-date">${date}</div>
      </div>
      <div class="report-body">${content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      <div class="report-footer"><span>V24 Enterprise Operations</span><span>طُبع بواسطة نظام إدارة العمليات</span></div>
      <script>setTimeout(()=>window.print(),400);<\/script>
    </body></html>`);
    win.document.close();
  },300);
}

// ══════════════════════════════════════════════
// PHASE 2: PIN MANAGER SYSTEM
// ══════════════════════════════════════════════
let _pinBuffer='';
let _pinSessionUnlocked=false;
const PIN_LENGTH=4;

function isPinSet(){return !!localStorage.getItem('managerPIN');}
function isPinUnlocked(){return _pinSessionUnlocked;}

function openAdminTab(){
  showTab('admin');
  // Render charts when admin tab opens
  setTimeout(renderAnalyticsCharts,150);
  const pin=localStorage.getItem('managerPIN');
  if(pin && !_pinSessionUnlocked){
    showPinOverlay('unlock');
  }
}

function showPinOverlay(mode){
  _pinBuffer='';
  _pinMode=mode;
  const ov=document.getElementById('pinOverlay');if(!ov)return;
  ov.classList.add('on');
  updatePinDots();
}

let _pinMode='unlock';

function pinKey(k){
  if(_pinBuffer.length>=PIN_LENGTH)return;
  _pinBuffer+=k;
  updatePinDots();
  if(_pinBuffer.length===PIN_LENGTH) setTimeout(submitPin,160);
}

function pinDel(){
  _pinBuffer=_pinBuffer.slice(0,-1);
  updatePinDots();
}

function updatePinDots(){
  document.querySelectorAll('.pin-dot').forEach((d,i)=>{
    d.classList.toggle('filled',i<_pinBuffer.length);
    d.classList.remove('error');
  });
}

function submitPin(){
  const stored=localStorage.getItem('managerPIN');
  if(_pinMode==='unlock'){
    if(_pinBuffer===stored){
      _pinSessionUnlocked=true;
      document.getElementById('pinOverlay')?.classList.remove('on');
      toast('🔓 وصول المدير مفعّل لهذه الجلسة');
      setTimeout(renderAnalyticsCharts,200);
    }else{
      document.querySelectorAll('.pin-dot').forEach(d=>d.classList.add('error'));
      setTimeout(()=>{_pinBuffer='';updatePinDots();},700);
      toast('❌ رقم PIN خاطئ');
    }
  } else if(_pinMode==='set'){
    localStorage.setItem('managerPIN',_pinBuffer);
    _pinSessionUnlocked=true;
    document.getElementById('pinOverlay')?.classList.remove('on');
    toast('🔐 تم تعيين PIN المدير');
  }
}

function bypassPin(){
  if(confirm('تجاوز قفل المدير؟ هذا سيلغي حماية لوحة الإدارة.')){
    _pinSessionUnlocked=true;
    document.getElementById('pinOverlay')?.classList.remove('on');
  }
}

function setPinPrompt(){
  _pinBuffer='';_pinMode='set';
  const ov=document.getElementById('pinOverlay');if(!ov)return;
  document.querySelector('.pin-title').textContent='تعيين PIN المدير';
  document.querySelector('.pin-sub').textContent='أدخل 4 أرقام للحماية';
  ov.classList.add('on');
  updatePinDots();
}

function removePIN(){
  if(confirm('إزالة قفل PIN المدير؟')){
    localStorage.removeItem('managerPIN');
    _pinSessionUnlocked=false;
    toast('🔓 تم إزالة قفل المدير');
  }
}

// Hook renderAdmin to also update analytics
const _origRenderAdmin=typeof renderAdmin==='function'?renderAdmin:null;
function renderAdmin(){
  if(_origRenderAdmin)_origRenderAdmin();
  // refresh storage bar
  setTimeout(renderStorageBar,100);
}

