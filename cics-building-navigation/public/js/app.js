const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let currentUser = null, selectedRole = 'student', floors = [], rooms = [], buildings = [], selectedFloor = null, selectedRoom = null;
let directoryMode = 'all', directoryCategory = 'All', directoryCache = [], adminReportCache = [], adminReportStatusFilter = 'All';

async function api(url, options={}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800); }
function message(el, text, success=false) { el.textContent=text; el.classList.toggle('success',success); }
function showAuth(register=false) {
  $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden');
  $('#loginPanel').classList.toggle('hidden',register); $('#registerPanel').classList.toggle('hidden',!register);
}
function showApp() {
  $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#userBadge').textContent=`${currentUser.full_name} · ${currentUser.role}`;
  const panel = $('#adminIntegrationPanel');
  panel.classList.toggle('hidden', currentUser.role !== 'admin');
  $('#adminDashboardNav').classList.toggle('hidden', currentUser.role !== 'admin');
  $('#adminReportsPanel').classList.toggle('hidden', currentUser.role !== 'admin');
  if (currentUser.role === 'admin') { loadIntegrationStatus(); loadAdminReports(); }
}
async function loadIntegrationStatus() {
  const target = $('#integrationStatus');
  if (!target || currentUser?.role !== 'admin') return;
  try {
    const status = await api('/api/integrations/status');
    const items = [
      ['Supabase PostgreSQL', status.database === 'connected' ? 'Connected' : 'Unavailable', status.database === 'connected'],
      ['Supabase Storage', status.imageStorage || 'Not configured', Boolean(status.imageStorage)],
      ['Resend email service', status.emailNotifications === 'configured' ? 'Configured' : 'Optional · Not configured', status.emailNotifications === 'configured']
    ];
    target.innerHTML = items.map(([name, value, ready]) => `<article class="integration-card"><b>${escapeHtml(name)}</b><p>${escapeHtml(value)}</p><span class="integration-state ${ready ? '' : 'pending'}">${ready ? '● Ready' : '● Setup needed'}</span></article>`).join('');
  } catch (error) {
    target.innerHTML = `<article class="integration-card"><b>Integration status unavailable</b><p>${escapeHtml(error.message)}</p></article>`;
  }
}
function go(page) {
  $$('.page').forEach(p=>p.classList.add('hidden'));
  $(`#${page}Page`).classList.remove('hidden');
  $$('.nav-link[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('#mainNav').classList.remove('open');
  if(page==='map') loadMap();
  if(page==='report') loadReports();
  if(page==='directory') renderDirectoryPage();
  if(page==='home' && currentUser?.role==='admin') loadAdminReports();
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
$$('.tab').forEach(b=>b.addEventListener('click',()=>{
  selectedRole=b.dataset.role; $$('.tab').forEach(x=>x.classList.toggle('active',x===b));
  $('#loginHeading').textContent=selectedRole==='admin'?'Admin Login':'Student Login';
  $('#loginForm button[type=submit]').textContent=selectedRole==='admin'?'Login as Administrator':'Login as Student';
}));
$('.show-password').addEventListener('click',e=>{
  const input=$('#loginForm [name=password]'); input.type=input.type==='password'?'text':'password';
  e.target.textContent=input.type==='password'?'SHOW':'HIDE';
});
$('#showRegister').addEventListener('click',e=>{e.preventDefault();showAuth(true)});
$('#showLogin').addEventListener('click',e=>{e.preventDefault();showAuth(false)});
$('#registerRole').addEventListener('change',e=>$('#adminCodeWrap').classList.toggle('hidden',e.target.value!=='admin'));
$('#forgotLink').addEventListener('click',e=>{e.preventDefault();toast('Please contact your CICS administrator to reset your password.');});
$('#menuToggle').addEventListener('click',()=>$('#mainNav').classList.toggle('open'));

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  try {
    const data=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:f.get('identifier'),password:f.get('password'),role:selectedRole})});
    currentUser=data.user; showApp(); go('home'); await loadReferenceData(); toast('Welcome to Findr!');
  } catch(err){message($('#loginMessage'),err.message);}
});
$('#registerForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  if(f.get('password')!==f.get('confirm_password')) return message($('#registerMessage'),'Passwords do not match.');
  const body=Object.fromEntries(f.entries()); delete body.confirm_password;
  try {
    const data=await api('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    message($('#registerMessage'),data.message,true); e.target.reset(); $('#adminCodeWrap').classList.add('hidden');
  } catch(err){message($('#registerMessage'),err.message);}
});
$('#logoutBtn').addEventListener('click',async()=>{
  try{await api('/api/auth/logout',{method:'POST'});}catch(_){}
  currentUser=null; showAuth(false); $('#loginForm').reset(); toast('You have logged out.');
});

async function loadReferenceData(){
  [buildings,floors,rooms]=await Promise.all([api('/api/buildings'),api('/api/floors'),api('/api/rooms')]);
  $('#reportBuilding').innerHTML='<option value="">Select building</option>'+buildings.map(b=>`<option value="${b.id}">${escapeHtml(b.building_name)}</option>`).join('');
  $('#reportRoom').innerHTML='<option value="">Select a room</option>'+rooms.map(r=>`<option value="${r.id}">${escapeHtml(r.room_name)} · ${escapeHtml(r.floor_name)}</option>`).join('');
}
function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function loadMap(){
  if(!floors.length) await loadReferenceData();
  const orderedFloors=[...floors].sort((a,b)=>Number(b.floor_number)-Number(a.floor_number));
  if(!selectedFloor) selectedFloor=orderedFloors.find(f=>Number(f.floor_number)===1)?.id || orderedFloors[0]?.id;
  renderFloorSelector(orderedFloors);
  renderRooms();
}

// Each floor has its own room sequence and side facilities based on the supplied
// official CICS Building Map. Keys match room_number values in the Supabase directory.
const FLOOR_PLANS = {
  1: {
    left: [{key:'WOMENS-TOILET',label:"Women's Toilet",kind:'facility',short:"Women's Toilet"}],
    main: [
      {key:'ORGS-OFFICE',label:'CICS Orgs Office',kind:'office',short:'Orgs Office'},
      ...['101','102','103','104','105','106'].map(n=>({key:n,label:`Room ${n}`,kind:'classroom'}))
    ],
    right: [
      {key:'UTILITY',label:'Utility Room',kind:'facility',short:'Utility Room'},
      {key:'FACULTY-TOILET',label:'Faculty Toilet',kind:'facility',short:'Faculty Toilet'}
    ]
  },
  2: {
    // The source map shows a faculty-toilet marker at both ends, while its directory
    // lists one Faculty Toilet destination. Both visual markers resolve to that record.
    left: [{key:'FACULTY-TOILET',label:'Faculty Toilet',kind:'facility',short:'Faculty Toilet'}],
    main: [
      {key:'201',label:'Room 201',kind:'classroom'}, {key:'202',label:'Room 202',kind:'classroom'},
      {key:'A',label:'CPE Faculty',kind:'office'}, {key:'B',label:'CICS Student Services',kind:'office'},
      {key:'C',label:'Consultation Office',kind:'office'}, {key:'D',label:'CICS Faculty',kind:'office'},
      {key:'E',label:"Dean's Office",kind:'office'}
    ],
    right: [{key:'FACULTY-TOILET',label:'Faculty Toilet',kind:'facility',short:'Faculty Toilet',visualOnly:true}]
  },
  3: {
    left: [{key:'WOMENS-TOILET',label:"Women's Toilet",kind:'facility',short:"Women's Toilet"}],
    main: ['1','2','3','4','5','6'].map(n=>({key:`LAB${n}`,label:`Lab ${n}`,kind:'lab'})),
    right: [{key:'MENS-TOILET',label:"Men's Toilet",kind:'facility',short:"Men's Toilet"}]
  },
  4: {
    left: [],
    // Room 402 is retained from the written room directory. The source illustration
    // has an unclear "EDL" label in this position, so it is not treated as a separate room.
    main: [
      {key:'401',label:'Room 401',kind:'classroom'},
      {key:'PHYSICS-LAB',label:'Physics Lab',kind:'lab'},
      {key:'SMART-CLASSROOM',label:'Smart Classroom',kind:'classroom'},
      {key:'402',label:'Room 402',kind:'classroom'},
      {key:'TECH-LAB',label:'Tech Lab',kind:'lab'},
      {key:'ITL',label:'ITL',kind:'lab'}
    ],
    right: []
  },
  5: {
    left: [],
    main: ['501','502','503','504','505','506'].map(n=>({key:n,label:`Room ${n}`,kind:'classroom'})),
    right: []
  }
};

function normaliseRoomValue(value=''){
  return String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
}
function roomForPlanSlot(slot, floorRooms){
  const key=normaliseRoomValue(slot.key);
  const label=normaliseRoomValue(slot.label);
  const aliases={
    cicsorgsoffice:['orgsoffice','cicsorgsoffice'], utilityroom:['utility','utilityroom'],
    womenstoilet:['womenstoilet','womensrestroom'], facultytoilet:['facultytoilet'],
    menstoilet:['menstoilet','mensrestroom'], physicslab:['physicslab'],
    smartclassroom:['smartclassroom'], techlab:['techlab','technologylaboratory']
  };
  const candidates=[key,label,...(aliases[normaliseRoomValue(slot.label)]||[])];
  return floorRooms.find(r=>candidates.includes(normaliseRoomValue(r.room_number)) || candidates.includes(normaliseRoomValue(r.room_name)));
}
function ordinalFloor(n){return ({1:'1ST',2:'2ND',3:'3RD',4:'4TH',5:'5TH'})[Number(n)]||`${n}TH`;}
function renderFloorSelector(orderedFloors){
  $('#floorList').innerHTML=orderedFloors.map(f=>{
    const plan=FLOOR_PLANS[Number(f.floor_number)];
    const count=plan ? [...plan.left,...plan.main,...plan.right].filter((slot,index,array)=>!slot.visualOnly && array.findIndex(x=>x.key===slot.key)===index).length : rooms.filter(r=>Number(r.floor_id)===Number(f.id)).length;
    return `<button type="button" class="floor-button ${Number(selectedFloor)===Number(f.id)?'active':''}" data-floor="${f.id}"><span class="floor-number-small">${f.floor_number}</span><span class="floor-button-copy"><b>${ordinalFloor(f.floor_number)} Floor</b><small>${count} destinations</small></span><span class="floor-chevron">›</span></button>`;
  }).join('');
  $$('.floor-button').forEach(b=>b.addEventListener('click',()=>{
    selectedFloor=Number(b.dataset.floor); selectedRoom=null;
    renderFloorSelector(orderedFloors); renderRooms();
  }));
}
function roomCategory(slot, room){
  return slot.kind || (/toilet|utility|facility/i.test(`${slot.label} ${room?.room_type||''}`)?'facility':/office|faculty|service|consultation/i.test(`${slot.label} ${room?.room_type||''}`)?'office':/lab/i.test(`${slot.label} ${room?.room_type||''}`)?'lab':'classroom');
}
function renderRooms(){
  const floor=floors.find(f=>Number(f.id)===Number(selectedFloor));
  if(!floor){$('#roomGrid').innerHTML='<div class="empty-floor">No floor information is available.</div>';return;}
  const floorRooms=rooms.filter(r=>Number(r.floor_id)===Number(floor.id));
  const query=$('#mapSearch').value.trim().toLowerCase();
  const plan=FLOOR_PLANS[Number(floor.floor_number)]||{left:[],main:floorRooms.map(r=>({key:String(r.room_number),label:r.room_name,kind:r.room_type?.toLowerCase()==='office'?'office':r.room_type?.toLowerCase()==='laboratory'?'lab':'classroom'})),right:[]};
  const allSlots=[...plan.left,...plan.main,...plan.right];
  const matches=(slot)=>{const room=roomForPlanSlot(slot,floorRooms);return !query||`${slot.label} ${slot.key} ${room?.room_type||''} ${room?.description||''}`.toLowerCase().includes(query);};
  const visibleSlots=allSlots.filter(matches);
  $('#floorHeading').textContent=floor.floor_name||`${ordinalFloor(floor.floor_number)} Floor`;
  $('#floorEyebrow').textContent=`${ordinalFloor(floor.floor_number)} FLOOR PLAN`;
  if(query && !visibleSlots.length){
    const otherRoom=rooms.find(r=>`${r.room_name} ${r.room_number} ${r.room_type}`.toLowerCase().includes(query));
    if(otherRoom && Number(otherRoom.floor_id)!==Number(floor.id)){
      selectedFloor=Number(otherRoom.floor_id);
      renderFloorSelector([...floors].sort((a,b)=>Number(b.floor_number)-Number(a.floor_number)));
      renderRooms();return;
    }
  }
  const renderSlotButton=(slot,side=false)=>{
    const room=roomForPlanSlot(slot,floorRooms);
    const kind=roomCategory(slot,room);
    const selected=room && selectedRoom?.id===room.id;
    const label=slot.short||slot.label;
    const symbol=kind==='office'?'▦':kind==='lab'?'♧':kind==='facility'?'◉':'▤';
    const classes=`${side?'plan-side-marker':'plan-room'} ${kind} ${selected?'selected':''} ${room?'':'not-registered'}`;
    return `<button type="button" class="${classes}" ${room?`data-room="${room.id}"`:'disabled'} title="${escapeHtml(slot.label)}${room?'':' (not registered yet)'}"><span class="plan-room-icon">${symbol}</span><b>${escapeHtml(label)}</b>${side?'':`<small>${escapeHtml(room?.room_number||slot.key)}</small>`}</button>`;
  };
  const sideMarkup=(sideSlots,position)=>{
    const slots=sideSlots.filter(matches);
    const markers=slots.map(slot=>renderSlotButton(slot,true)).join('');
    const stairMarkup=`<div class="plan-side-stairs" aria-label="Stairwell"><span>STAIRS</span><i></i><i></i><i></i><i></i></div>`;
    return `<aside class="plan-side-zone ${position}">${markers}${stairMarkup}</aside>`;
  };
  const mainSlots=plan.main.filter(matches);
  const mainHtml=mainSlots.map(slot=>renderSlotButton(slot,false)).join('');
  const emptyMessage=query?'No matching destinations on this floor.':'No rooms registered on this floor.';
  $('#roomGrid').innerHTML=`
    <div class="plan-compass">N</div>
    <div class="floor-diagram">
      <div class="plan-architecture">
        ${sideMarkup(plan.left,'left')}
        <div class="plan-core">
          <div class="plan-rooms-row">${mainHtml||`<div class="empty-floor">${emptyMessage}</div>`}</div>
          <div class="plan-hallway"><span>MAIN HALLWAY</span></div>
          <div class="plan-direction">➜ &nbsp; FROM STAIRS</div>
        </div>
        ${sideMarkup(plan.right,'right')}
      </div>
    </div>
    <div class="plan-map-caption">Select a room, office, laboratory, or facility to view its location and navigation guide.</div>`;
  $$('#roomGrid [data-room]').forEach(button=>button.addEventListener('click',()=>{
    selectedRoom=rooms.find(r=>Number(r.id)===Number(button.dataset.room));
    renderRooms();renderRoomDetails();
  }));
  renderRoomDetails();
}

function renderRoomDetails(){
  const r=selectedRoom;
  if(r){
    const floor=floors.find(f=>Number(f.id)===Number(r.floor_id));
    const roomType=(r.room_type||'Destination').toUpperCase();
    $('#roomDetails').innerHTML=`<div class="location-banner"><span class="destination-pin">⌖</span><b>DESTINATION SELECTED</b></div><div class="room-details-content"><div class="selected-destination"><small class="detail-type">${escapeHtml(roomType)}</small><h3>${escapeHtml(r.room_name)}</h3><p class="muted">⌁ &nbsp; ${escapeHtml(floor?.floor_name||r.floor_name||'CICS Building')}, CICS Building</p></div><div class="navigation-guide"><b>⌖ &nbsp; Navigation guide</b><p>Go to the ${escapeHtml(ordinalFloor(floor?.floor_number||''))} floor and follow the main hallway. ${escapeHtml(r.room_name)} is highlighted on the floor plan.</p></div><button class="btn outline report-room-action" id="reportRoomBtn">⚠ &nbsp; Report a problem here</button></div>`;
  }else{
    $('#roomDetails').innerHTML=`<div class="location-banner"><span class="destination-pin">⌖</span><b>SELECT A DESTINATION</b></div><div class="room-details-content"><div><small class="detail-type">CICS BUILDING</small><h3>Choose a room or facility</h3><p class="muted">Select any room on the floor plan to view its location and navigation guide.</p></div><div class="navigation-guide"><b>⌖ &nbsp; Navigation guide</b><p>Your selected destination and directions will appear here.</p></div></div>`;
  }
  $('#reportRoomBtn')?.addEventListener('click',()=>{go('report');$('#reportRoom').value=String(r.id);});
}
$('#mapSearch').addEventListener('input',()=>{
  const q=$('#mapSearch').value.trim().toLowerCase();
  if(q){const match=rooms.find(r=>`${r.room_name} ${r.room_number} ${r.room_type}`.toLowerCase().includes(q));if(match){selectedFloor=Number(match.floor_id);selectedRoom=null;}}
  renderFloorSelector([...floors].sort((a,b)=>Number(b.floor_number)-Number(a.floor_number)));renderRooms();
});
$('#clearSearch').addEventListener('click',()=>{$('#mapSearch').value='';renderFloorSelector([...floors].sort((a,b)=>Number(b.floor_number)-Number(a.floor_number)));renderRooms();});
$('#homeSearchBtn').addEventListener('click',()=>{go('map');$('#mapSearch').value=$('#homeSearch').value;renderRooms();});
$('#homeSearch').addEventListener('keydown',e=>{if(e.key==='Enter')$('#homeSearchBtn').click();});
$$('.quick-card').forEach(b=>b.addEventListener('click',()=>{
  if(b.dataset.page){go(b.dataset.page);return;}
  directoryMode=b.dataset.quickMode||'all';directoryCategory='All';$('#directorySearch').value='';
  $$('.directory-filter').forEach(x=>x.classList.toggle('active',x.dataset.category==='All'));
  go('directory');
}));

function destinationCategory(room){
  const type=String(room.room_type||'').toLowerCase();
  if(type.includes('laboratory')||type==='lab')return 'Laboratories';
  if(type.includes('office')||type.includes('service'))return 'Offices';
  if(type.includes('restroom')||type.includes('toilet')||type.includes('facility'))return 'Facilities';
  return 'Classrooms';
}
function destinationIcon(category){return category==='Laboratories'?'♧':category==='Offices'?'▤':category==='Facilities'?'♙':'▣';}
function getDirectoryRooms(){
  let list=[...rooms];
  if(directoryMode==='laboratories') list=list.filter(r=>destinationCategory(r)==='Laboratories');
  if(directoryMode==='offices') list=list.filter(r=>destinationCategory(r)==='Offices' && ([1,2].includes(Number(r.floor_number))) && (Number(r.floor_number)!==1 || /orgs/i.test(r.room_name||'')));
  if(directoryCategory!=='All') list=list.filter(r=>destinationCategory(r)===directoryCategory);
  const q=$('#directorySearch').value.trim().toLowerCase();
  if(q)list=list.filter(r=>`${r.room_name} ${r.room_number} ${r.room_type} ${r.floor_name}`.toLowerCase().includes(q));
  return list.sort((a,b)=>Number(a.floor_number)-Number(b.floor_number)||String(a.room_number).localeCompare(String(b.room_number),undefined,{numeric:true}));
}
function renderDirectoryPage(){
  if(!rooms.length)return;
  const heading=directoryMode==='laboratories'?'Where are the laboratories?':directoryMode==='offices'?'Where are the offices?':'Where do you need to go?';
  const subtitle=directoryMode==='laboratories'?'Browse registered laboratory destinations across the CICS Building.':directoryMode==='offices'?'Offices on the 1st floor near the stairs and the 2nd floor.':'Search all destinations across the CICS Building.';
  $('#directoryHeading').textContent=heading;$('#directorySubtitle').textContent=subtitle;
  const list=getDirectoryRooms();
  $('#directoryResultsLabel').textContent=directoryCategory==='All'?(directoryMode==='laboratories'?'Laboratories':directoryMode==='offices'?'Offices':'All destinations'):directoryCategory;
  $('#directoryCount').textContent=`${list.length} result${list.length===1?'':'s'}`;
  $('#directoryResults').innerHTML=list.length?list.map(r=>{
    const category=destinationCategory(r);const floor=escapeHtml(r.floor_name||`${ordinalFloor(r.floor_number)} Floor`);
    return `<article class="directory-result"><span class="directory-result-icon ${category.toLowerCase()}">${destinationIcon(category)}</span><div class="directory-result-copy"><b>${escapeHtml(r.room_name)}</b><small>${floor} · ${category==='Laboratories'?'Laboratory':category==='Offices'?'Office':category==='Facilities'?'Facility':'Classroom'}</small></div><button type="button" class="directory-map-link" data-directory-room="${r.id}">View on map <span>→</span></button></article>`;
  }).join(''):'<div class="directory-empty"><b>No matching destinations found.</b><p>Try another search or choose a different category.</p></div>';
  $$('[data-directory-room]').forEach(button=>button.addEventListener('click',()=>{
    const room=rooms.find(r=>String(r.id)===button.dataset.directoryRoom);if(!room)return;
    selectedFloor=room.floor_id;selectedRoom=room;$('#mapSearch').value='';go('map');
    renderFloorSelector([...floors].sort((a,b)=>Number(b.floor_number)-Number(a.floor_number)));renderRooms();renderRoomDetails();
  }));
}
$('#directorySearch').addEventListener('input',renderDirectoryPage);
$$('.directory-filter').forEach(button=>button.addEventListener('click',()=>{directoryCategory=button.dataset.category;$$('.directory-filter').forEach(x=>x.classList.toggle('active',x===button));renderDirectoryPage();}));

$('#reportForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=new FormData(e.target);
  try{
    const data=await api('/api/reports',{method:'POST',body:form});
    message($('#reportMessage'),data.message,true);e.target.reset();await loadReports();toast('Report submitted successfully.');
  }catch(err){message($('#reportMessage'),err.message);}
});
async function loadReports(){
  try{
    const reports=await api('/api/reports');
    $('#reportHistory').innerHTML=reports.length?reports.map(r=>`<div class="report-row"><div><b>${escapeHtml(r.title)}</b><div class="muted">${escapeHtml(r.category)} · ${new Date(r.created_at).toLocaleDateString()}</div>${r.image_url?`<a href="${r.image_url}" target="_blank" rel="noopener">View attachment</a>`:''}</div><span class="status-pill">${escapeHtml(r.status)}</span>${currentUser.role==='admin'?`<select data-status-id="${r.id}"><option ${r.status==='Submitted'?'selected':''}>Submitted</option><option ${r.status==='Under Review'?'selected':''}>Under Review</option><option ${r.status==='In Progress'?'selected':''}>In Progress</option><option ${r.status==='Resolved'?'selected':''}>Resolved</option><option ${r.status==='Rejected'?'selected':''}>Rejected</option></select>`:''}</div>`).join(''):'<p class="muted">No reports submitted yet.</p>';
    $$('[data-status-id]').forEach(s=>s.addEventListener('change',async()=>{try{await api(`/api/reports/${s.dataset.statusId}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s.value})});toast('Report status updated.');loadReports();if(currentUser?.role==='admin')loadAdminReports();}catch(err){toast(err.message);}}));
  }catch(err){$('#reportHistory').textContent=err.message;}
}

const REPORT_STATUSES=['Submitted','Under Review','In Progress','Resolved','Rejected'];
async function loadAdminReports(){
  if(currentUser?.role!=='admin')return;
  const target=$('#adminReportsList');if(!target)return;
  target.innerHTML='<p class="muted">Loading reports…</p>';
  try{
    adminReportCache=await api('/api/reports');
    const counts={Submitted:0,'Under Review':0,'In Progress':0,Resolved:0,Rejected:0};
    adminReportCache.forEach(r=>{if(counts[r.status]!==undefined)counts[r.status]++;});
    $('#adminReportSummary').innerHTML=`<div><b>${adminReportCache.length}</b><small>Total reports</small></div><div><b>${counts.Submitted}</b><small>New</small></div><div><b>${counts['Under Review']}</b><small>Under review</small></div><div><b>${counts['In Progress']}</b><small>In progress</small></div><div><b>${counts.Resolved}</b><small>Resolved</small></div>`;
    renderAdminReports();
  }catch(err){target.innerHTML=`<div class="directory-empty"><b>Unable to load reports</b><p>${escapeHtml(err.message)}</p></div>`;}
}
function renderAdminReports(){
  const list=adminReportStatusFilter==='All'?adminReportCache:adminReportCache.filter(r=>r.status===adminReportStatusFilter);
  $('#adminReportsList').innerHTML=list.length?`<div class="admin-report-table-wrap"><table class="admin-report-table"><thead><tr><th>Problem report</th><th>Submitted by</th><th>Location</th><th>Priority</th><th>Date</th><th>Attachment</th><th>Status</th></tr></thead><tbody>${list.map(r=>`<tr><td><b>${escapeHtml(r.title)}</b><small>${escapeHtml(r.category)} · ${escapeHtml(r.description||'')}</small></td><td>${escapeHtml(r.contact_name||r.full_name||'Not provided')}<small>${escapeHtml(r.contact_email||'No email provided')}</small></td><td>${escapeHtml(r.building_name||'CICS Building')}<small>${escapeHtml(r.room_name||'Room not specified')}</small></td><td><span class="priority-pill ${String(r.priority||'Medium').toLowerCase()}">${escapeHtml(r.priority||'Medium')}</span></td><td>${new Date(r.created_at).toLocaleDateString()}</td><td>${r.image_url?`<a href="${r.image_url}" target="_blank" rel="noopener">View image ↗</a>`:'<span class="muted">None</span>'}</td><td><select class="admin-status-select" data-admin-status-id="${r.id}">${REPORT_STATUSES.map(status=>`<option value="${status}" ${r.status===status?'selected':''}>${status}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`:'<div class="directory-empty"><b>No reports to display.</b><p>Submitted problem reports will appear here.</p></div>';
  $$('[data-admin-status-id]').forEach(select=>select.addEventListener('change',async()=>{
    const previous=adminReportCache.find(r=>String(r.id)===select.dataset.adminStatusId)?.status;
    select.disabled=true;
    try{
      await api(`/api/reports/${select.dataset.adminStatusId}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:select.value})});
      toast('Report status updated.');await loadAdminReports();
    }catch(err){toast(err.message);select.value=previous||'Submitted';select.disabled=false;}
  }));
}
$('#adminReportRefresh').addEventListener('click',loadAdminReports);
$('#adminReportFilter').addEventListener('change',e=>{adminReportStatusFilter=e.target.value;renderAdminReports();});

(async function init(){
  try{const data=await api('/api/auth/me');if(data.user){currentUser=data.user;showApp();await loadReferenceData();go('home');}else showAuth(false);}
  catch(_){showAuth(false);}
})();
