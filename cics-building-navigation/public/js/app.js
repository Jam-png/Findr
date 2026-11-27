const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let currentUser = null, selectedRole = 'student', floors = [], rooms = [], buildings = [], selectedFloor = null, selectedRoom = null;
let supabaseClient = null, passwordRecoveryActive = false;
let directoryMode = 'all', directoryCategory = 'All', directoryCache = [], adminReportCache = [], adminReportStatusFilter = 'All';

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});

  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();

    if (data.session?.access_token) {
      headers.set(
        'Authorization',
        `Bearer ${data.session.access_token}`
      );
    }
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers
  });

  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json')
    ? await response.json()
    : {};

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }

  return data;
}
async function initSupabaseClient() {
  if (!window.supabase?.createClient) throw new Error('Supabase Auth library did not load. Refresh the page and try again.');
  const config = await api('/api/config');
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Supabase Auth is not configured.');
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      passwordRecoveryActive = true;
      $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden');
      $('#loginPanel').classList.add('hidden'); $('#registerPanel').classList.add('hidden'); $('#forgotPanel').classList.add('hidden');
      $('#resetPanel').classList.remove('hidden');
      history.replaceState({}, document.title, `${location.pathname}?reset-password=1`);
    }
  });
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (new URLSearchParams(location.search).has('reset-password') && sessionData.session) {
    passwordRecoveryActive = true;
    $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden');
    $('#loginPanel').classList.add('hidden'); $('#registerPanel').classList.add('hidden'); $('#forgotPanel').classList.add('hidden');
    $('#resetPanel').classList.remove('hidden');
  }
}
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800); }
function message(el, text, success=false) { el.textContent=text; el.classList.toggle('success',success); }
function showAuth(register=false) {
  $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden');
  if (passwordRecoveryActive) {
    $('#loginPanel').classList.add('hidden'); $('#registerPanel').classList.add('hidden'); $('#forgotPanel').classList.add('hidden');
    $('#resetPanel').classList.remove('hidden');
    return;
  }
  $('#loginPanel').classList.toggle('hidden',register); $('#registerPanel').classList.toggle('hidden',!register);
  $('#forgotPanel').classList.add('hidden'); $('#resetPanel').classList.add('hidden');
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
document.addEventListener('click',e=>{
  const toggle=e.target.closest('.show-password');
  if(!toggle) return;
  const input=toggle.parentElement.querySelector('input');
  const visible=input.type==='password';
  input.type=visible?'text':'password';
  toggle.setAttribute('aria-label',visible?'Hide password':'Show password');
  toggle.setAttribute('aria-pressed',String(visible));
  toggle.innerHTML=visible
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3-.5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
});
$('#showRegister').addEventListener('click',e=>{e.preventDefault();showAuth(true)});
$('#showLogin').addEventListener('click',e=>{e.preventDefault();showAuth(false)});
$('#registerRole').addEventListener('change',e=>$('#adminCodeWrap').classList.toggle('hidden',e.target.value!=='admin'));
$('#forgotLink').addEventListener('click',e=>{
  e.preventDefault();
  $('#loginPanel').classList.add('hidden'); $('#registerPanel').classList.add('hidden'); $('#resetPanel').classList.add('hidden');
  $('#forgotPanel').classList.remove('hidden'); $('#forgotMessage').textContent='';
});
$('#backToLogin').addEventListener('click',e=>{e.preventDefault();showAuth(false)});

$('#forgotForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = String(new FormData(e.target).get('email') || '').trim().toLowerCase();
  const submit = e.target.querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    const data = await api('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    message($('#forgotMessage'), data.message, true);
  } catch (error) {
    message($('#forgotMessage'), error.message);
  } finally {
    submit.disabled = false;
  }
});

$('#resetForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  const password=String(f.get('password')||'');
  if(password!==String(f.get('confirm_password')||'')) return message($('#resetMessage'),'Passwords do not match.');
  if(password.length<8) return message($('#resetMessage'),'Password must contain at least 8 characters.');
  const submit=e.target.querySelector('button[type="submit"]'); submit.disabled=true;
  try {
    if(!supabaseClient) throw new Error('Authentication is not ready. Refresh the reset link and try again.');
    const {error}=await supabaseClient.auth.updateUser({password});
    if(error) throw error;
    await supabaseClient.auth.signOut();
    passwordRecoveryActive = false;
    history.replaceState({},document.title,location.pathname);
    e.target.reset(); showAuth(false);
    message($('#loginMessage'),'Your password has been updated. You can now log in.',true);
  } catch(err) { message($('#resetMessage'),err.message); }
  finally { submit.disabled=false; }
});

$('#menuToggle').addEventListener('click',()=>$('#mainNav').classList.toggle('open'));

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  const f = new FormData(e.target);
  const submit = e.target.querySelector('button[type="submit"]');

  submit.disabled = true;

  try {
    if (!supabaseClient) {
      throw new Error('Supabase Auth is not ready. Please refresh the page.');
    }

    const data = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: f.get('identifier'),
        password: f.get('password'),
        role: selectedRole
      })
    });

    const { error: sessionError } = await supabaseClient.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token
    });

    if (sessionError) throw sessionError;

    const profile = await api('/api/auth/me');

    if (!profile.user) {
      throw new Error('Unable to load your Findr account profile.');
    }

    currentUser = profile.user;

    showApp();
    go('home');

    await loadReferenceData();

    toast('Welcome to Findr!');
  } catch (err) {
    message($('#loginMessage'), err.message);
  } finally {
    submit.disabled = false;
  }
});
$('#registerForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  if(f.get('password')!==f.get('confirm_password')) return message($('#registerMessage'),'Passwords do not match.');
  const body=Object.fromEntries(f.entries()); delete body.confirm_password;
  try {
    const data=await api('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    message($('#registerMessage'),data.message,true);
    e.target.reset(); $('#adminCodeWrap').classList.add('hidden');
  } catch(err){message($('#registerMessage'),err.message);}
});
$('#logoutBtn').addEventListener('click', async () => {
  try {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }

    currentUser = null;
    passwordRecoveryActive = false;

    showAuth(false);
    $('#loginForm').reset();

    toast('You have logged out.');
  } catch (error) {
    toast(error.message);
  }
});

async function loadReferenceData(){
  [buildings,floors,rooms]=await Promise.all([api('/api/buildings'),api('/api/floors'),api('/api/rooms')]);
  $('#reportBuilding').innerHTML='<option value="">Select building</option>'+buildings.map(b=>`<option value="${b.id}">${escapeHtml(b.building_name)}</option>`).join('');
  $('#reportRoom').innerHTML='<option value="">Select a room</option>'+getVisibleDestinationRooms().map(r =>
  `<option value="${r.id}">${escapeHtml(getDisplayRoomName(r))} · ${escapeHtml(r.floor_name)}</option>`
).join('');
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
    left: [
      {
        key: 'WOMENS-TOILET',
        label: "Women's Toilet",
        kind: 'facility',
        short: "Women's Toilet"
      }
    ],
    main: [
      { key: 'ORGS-OFFICE', label: 'CICS Orgs Office', kind: 'office' },
      ...['101', '102', '103', '104', '105', '106'].map(n => ({
        key: n,
        label: `Room ${n}`,
        kind: 'classroom'
      })),
      {
        key: 'UTILITY',
        label: 'Utility Room',
        kind: 'facility',
        short: 'Utility Room'
      }
    ],
    right: []
  },

  2: {
    left: [],
    main: [
      { key: '201', label: 'Room 201', kind: 'classroom' },
      { key: '202', label: 'Room 202', kind: 'classroom' },
      { key: 'A', label: 'CPE Faculty', kind: 'office' },
      { key: 'C', label: 'Consultation Office', kind: 'office' },
      { key: 'D', label: 'CICS Faculty', kind: 'office' },
      { key: 'E', label: "Dean's Office", kind: 'office' }
    ],
    right: []
  },

  3: {
    left: [
      {
        key: 'WOMENS-TOILET',
        label: "Women's Toilet",
        kind: 'facility',
        short: "Women's Toilet"
      }
    ],
    main: ['1', '2', '3', '4', '5', '6'].map(n => ({
      key: `LAB${n}`,
      label: `Lab ${n}`,
      kind: 'lab'
    })),
    right: [
      {
        key: 'MENS-TOILET',
        label: "Men's Toilet",
        kind: 'facility',
        short: "Men's Toilet"
      }
    ]
  },

  4: {
    left: [
      {
        key: 'WOMENS-TOILET-4F',
        label: "Women's Toilet",
        kind: 'facility',
        short: "Women's Toilet"
      }
    ],
    main: [
      { key: '401', label: 'Room 401', kind: 'classroom' },
      {
        key: 'PHYSICS-LAB',
        label: 'Physics Lab / RM 402',
        kind: 'lab'
      },
      {
        key: 'SMART-CLASSROOM',
        label: 'SMART Classroom',
        kind: 'classroom'
      },
      { key: 'EDL', label: 'EDL', kind: 'lab' },
      { key: 'TECH-LAB', label: 'Tech Lab', kind: 'lab' },
      { key: 'ITL', label: 'ITL', kind: 'lab' }
    ],
    right: [
      {
        key: 'MENS-TOILET-4F',
        label: "Men's Toilet",
        kind: 'facility',
        short: "Men's Toilet"
      }
    ]
  },

  5: {
    left: [],
    main: ['501', '502', '503', '504', '505', '506'].map(n => ({
      key: n,
      label: `Room ${n}`,
      kind: 'classroom'
    })),
    right: []
  }
};

function normaliseRoomValue(value=''){
  return String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
}


function isExcludedDestination(room) {
  const floor = Number(room.floor_number);
  const name = normaliseRoomValue(room.room_name);
  const number = normaliseRoomValue(room.room_number);

  // First floor: no Faculty Toilet
  if (floor === 1 && name.includes('facultytoilet')) {
    return true;
  }

  // Second floor: only the six requested destinations
  if (
    floor === 2 &&
    (
      name.includes('cicsstudentservices') ||
      name.includes('facultytoilet')
    )
  ) {
    return true;
  }

  // Third floor: Room 301 does not exist
  if (
    floor === 3 &&
    (number === '301' || name === 'room301')
  ) {
    return true;
  }

  // Fourth floor: hide the duplicate Room 402 record.
  // Physics Lab will represent RM 402.
  if (
    floor === 4 &&
    number === '402' &&
    !name.includes('physicslab')
  ) {
    return true;
  }

  return false;
}

function getVisibleDestinationRooms() {
  return rooms.filter(room => !isExcludedDestination(room));
}

function getDisplayRoomName(room) {
  if (
    Number(room.floor_number) === 4 &&
    normaliseRoomValue(room.room_number) === 'physicslab'
  ) {
    return 'Physics Lab / RM 402';
  }

  return room.room_name;
}

function getRoomSearchText(room) {
  return [
    getDisplayRoomName(room),
    room.room_name,
    room.room_number,
    room.room_type,
    room.floor_name
  ].join(' ').toLowerCase();
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
  const floorRooms = getVisibleDestinationRooms()
  .filter(r => Number(r.floor_id) === Number(floor.id));
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
    requestAnimationFrame(()=>$('#roomGrid [data-room].selected')?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'}));
  }));
  renderRoomDetails();
}

function renderRoomDetails(){
  const r=selectedRoom;
  if(r){
    const floor=floors.find(f=>Number(f.id)===Number(r.floor_id));
    const roomType=(r.room_type||'Destination').toUpperCase();
    $('#roomDetails').innerHTML=`<div class="location-banner"><span class="destination-pin">⌖</span><b>DESTINATION SELECTED</b></div><div class="room-details-content"><div class="selected-destination"><small class="detail-type">${escapeHtml(roomType)}</small><h3>${escapeHtml(getDisplayRoomName(r))}</h3><p class="muted">⌁ &nbsp; ${escapeHtml(floor?.floor_name||r.floor_name||'CICS Building')}, CICS Building</p></div><div class="navigation-guide"><b>⌖ &nbsp; Navigation guide</b><p>Go to the ${escapeHtml(ordinalFloor(floor?.floor_number||''))} floor. Use the floor plan to identify the highlighted destination, then follow the building's hallway from the stairs. Confirm the exact route with on-site signs or staff.</p></div><button class="btn outline report-room-action" id="reportRoomBtn">⚠ &nbsp; Report a problem here</button></div>`;
  }else{
    $('#roomDetails').innerHTML=`<div class="location-banner"><span class="destination-pin">⌖</span><b>SELECT A DESTINATION</b></div><div class="room-details-content"><div><small class="detail-type">CICS BUILDING</small><h3>Choose a room or facility</h3><p class="muted">Select any room on the floor plan to view its location and navigation guide.</p></div><div class="navigation-guide"><b>⌖ &nbsp; Navigation guide</b><p>Your selected destination and directions will appear here.</p></div></div>`;
  }
  $('#reportRoomBtn')?.addEventListener('click',()=>{go('report');$('#reportRoom').value=String(r.id);});
}
$('#mapSearch').addEventListener('input',()=>{
  const q=$('#mapSearch').value.trim().toLowerCase();
  if(q){const match = getVisibleDestinationRooms().find(r => getRoomSearchText(r).includes(q));if(match){selectedFloor=Number(match.floor_id);selectedRoom=null;}}
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
  let list = getVisibleDestinationRooms();
  if(directoryMode==='laboratories') list=list.filter(r=>destinationCategory(r)==='Laboratories');
  if(directoryMode==='offices') list=list.filter(r=>destinationCategory(r)==='Offices' && ([1,2].includes(Number(r.floor_number))) && (Number(r.floor_number)!==1 || /orgs/i.test(r.room_name||'')));
  if(directoryCategory!=='All') list=list.filter(r=>destinationCategory(r)===directoryCategory);
  const q=$('#directorySearch').value.trim().toLowerCase();
  if (q) {
  list = list.filter(r => getRoomSearchText(r).includes(q));
}
  return list.sort((a,b)=>Number(a.floor_number)-Number(b.floor_number)||String(a.room_number).localeCompare(String(b.room_number),undefined,{numeric:true}));
}
function renderDirectoryPage(){
  if(!rooms.length)return;
  const heading=directoryMode==='laboratories'?'Where are the laboratories?':directoryMode==='offices'?'Where are the offices?':'Where do you need to go?';
  const subtitle=directoryMode==='laboratories'?'Browse registered laboratory destinations across the CICS Building.':directoryMode==='offices'?'Browse offices and student services by floor.':'Browse destinations grouped by floor. Offices and facilities appear at the end of each floor row.';
  $('#directoryHeading').textContent=heading; $('#directorySubtitle').textContent=subtitle;
  const list=getDirectoryRooms();
  $('#directoryResultsLabel').textContent=directoryCategory==='All'?(directoryMode==='laboratories'?'Laboratories':directoryMode==='offices'?'Offices':'All destinations'):directoryCategory;
  $('#directoryCount').textContent=`${list.length} result${list.length===1?'':'s'}`;
  const floorNumbers=[...new Set(list.map(r=>Number(r.floor_number)).filter(Number.isFinite))].sort((a,b)=>a-b);
  const floorMarkup=floorNumbers.map(number=>{
    const floorRooms=list.filter(r=>Number(r.floor_number)===number).sort((a,b)=>{
      const rank=r=>['Classrooms','Laboratories'].includes(destinationCategory(r))?0:destinationCategory(r)==='Offices'?1:2;
      return rank(a)-rank(b)||String(a.room_number).localeCompare(String(b.room_number),undefined,{numeric:true});
    });
    const floorName=floorRooms[0]?.floor_name||`${ordinalFloor(number)} Floor`;
    return `<section class="directory-floor-row"><div class="directory-floor-heading"><span class="directory-floor-number">${number}</span><div><b>${escapeHtml(floorName)}</b><small>${floorRooms.length} destination${floorRooms.length===1?'':'s'}</small></div></div><div class="directory-tile-grid">${floorRooms.map(r=>{
      const category=destinationCategory(r); const kind=category.toLowerCase();
      return `<button type="button" class="directory-tile ${kind}" data-directory-room="${r.id}" aria-label="View ${escapeHtml(r.room_name)} on map"><span class="directory-tile-icon">${destinationIcon(category)}</span><b>${escapeHtml(getDisplayRoomName(r))}</b><small>${escapeHtml(r.room_number||category)}</small><span class="directory-tile-floor">${category}</span></button>`;
    }).join('')}</div></section>`;
  }).join('');
  $('#directoryResults').innerHTML=list.length?floorMarkup:'<div class="directory-empty"><b>No matching destinations found.</b><p>Try another search or choose a different category.</p></div>';
  $$('[data-directory-room]').forEach(button=>button.addEventListener('click',()=>{
    const room=rooms.find(r=>String(r.id)===button.dataset.directoryRoom); if(!room)return;
    selectedFloor=room.floor_id; selectedRoom=room; $('#mapSearch').value=''; go('map');
    renderFloorSelector([...floors].sort((a,b)=>Number(b.floor_number)-Number(a.floor_number))); renderRooms(); renderRoomDetails();
    requestAnimationFrame(()=>$('#roomGrid [data-room].selected')?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'}));
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
    renderAdminCalendar();
    renderCalendarDayReports();
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


/* =========================================
   ADMIN REPORT CALENDAR
   Uses actual report created_at timestamps.
   Calendar dates use Asia/Manila timezone.
========================================= */

function getManilaDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));

  const date = {};
  parts.forEach(part => {
    if (part.type !== 'literal') {
      date[part.type] = part.value;
    }
  });

  return `${date.year}-${date.month}-${date.day}`;
}

function formatCalendarDate(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);

  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'full'
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function getReportsForDate(dateKey) {
  return adminReportCache.filter(report =>
    report.created_at &&
    getManilaDateKey(report.created_at) === dateKey
  );
}

function renderAdminCalendar() {
  const grid = $('#adminCalendarGrid');
  const monthLabel = $('#adminCalendarMonth');

  if (!grid || !monthLabel) return;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  monthLabel.textContent = new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    year: 'numeric'
  }).format(calendarDate);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayKey = getManilaDateKey(new Date());

  let html = weekdays.map(day =>
    `<div class="calendar-weekday">${day}</div>`
  ).join('');

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = [
      year,
      String(month + 1).padStart(2, '0'),
      String(day).padStart(2, '0')
    ].join('-');

    const reports = getReportsForDate(dateKey);
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === selectedCalendarDate;

    html += `
      <button
        type="button"
        class="calendar-day
          ${reports.length ? 'has-reports' : ''}
          ${isToday ? 'today' : ''}
          ${isSelected ? 'selected' : ''}"
        data-calendar-date="${dateKey}"
        aria-label="${dateKey}, ${reports.length} reports"
      >
        <span class="calendar-day-number">${day}</span>

        ${reports.length ? `
          <span class="calendar-report-count">
            ${reports.length} report${reports.length === 1 ? '' : 's'}
          </span>
        ` : ''}
      </button>
    `;
  }

  grid.innerHTML = html;

  const monthReports = adminReportCache.filter(report => {
    if (!report.created_at) return false;

    const reportDate = getManilaDateKey(report.created_at);
    const [reportYear, reportMonth] = reportDate.split('-').map(Number);

    return reportYear === year && reportMonth === month + 1;
  });

  const countElement = $('#adminCalendarMonthCount');

  if (countElement) {
    countElement.textContent =
      `${monthReports.length} report${monthReports.length === 1 ? '' : 's'} this month`;
  }

  grid.querySelectorAll('[data-calendar-date]').forEach(button => {
    button.addEventListener('click', () => {
      selectedCalendarDate = button.dataset.calendarDate;

      renderAdminCalendar();
      renderCalendarDayReports();
    });
  });
}

function renderCalendarDayReports() {
  const target = $('#adminCalendarDayReports');

  if (!target) return;

  if (!selectedCalendarDate) {
    target.innerHTML = `
      <div class="directory-empty">
        <b>Select a date</b>
        <p>Choose a day on the calendar to view its submitted reports.</p>
      </div>
    `;
    return;
  }

  const reports = getReportsForDate(selectedCalendarDate);

  if (!reports.length) {
    target.innerHTML = `
      <div class="directory-empty">
        <b>No reports on this date</b>
        <p>${escapeHtml(formatCalendarDate(selectedCalendarDate))}</p>
      </div>
    `;
    return;
  }

  target.innerHTML = `
    <div class="calendar-selected-date">
      <h3>${escapeHtml(formatCalendarDate(selectedCalendarDate))}</h3>
      <p>${reports.length} submitted report${reports.length === 1 ? '' : 's'}</p>
    </div>

    <div class="calendar-report-list">
      ${reports.map(report => `
        <article class="calendar-report-item">
          <div class="calendar-report-heading">
            <b>${escapeHtml(report.title || 'Untitled report')}</b>
            <span class="status-pill">
              ${escapeHtml(report.status || 'Submitted')}
            </span>
          </div>

          <p>
            ${escapeHtml(report.full_name || report.contact_name || 'Unknown user')}
          </p>

          <p>
            ${escapeHtml(report.category || 'Uncategorized')}
            ·
            ${escapeHtml(report.room_name || 'Location not specified')}
          </p>

          <p class="muted">
            ${escapeHtml(report.building_name || 'CICS Building')}
          </p>

          ${report.description ? `
            <p>${escapeHtml(report.description)}</p>
          ` : ''}

          ${report.image_url ? `
            <a href="${escapeHtml(report.image_url)}"
               target="_blank"
               rel="noopener noreferrer">
              View attachment
            </a>
          ` : ''}
        </article>
      `).join('')}
    </div>
  `;
}

function changeCalendarMonth(amount) {
  calendarDate = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth() + amount,
    1
  );

  selectedCalendarDate = null;

  renderAdminCalendar();
  renderCalendarDayReports();
}

$('#adminCalendarPrev')?.addEventListener('click', () => {
  changeCalendarMonth(-1);
});

$('#adminCalendarNext')?.addEventListener('click', () => {
  changeCalendarMonth(1);
});

$('#adminCalendarRefresh')?.addEventListener('click', async () => {
  await loadAdminReports();
});

(async function init(){
  try {
    await initSupabaseClient();
  } catch(error) {
    console.error('[Findr Auth]', error);
  }

  // Never redirect to the main interface during password recovery.
  if (passwordRecoveryActive) {
    showAuth(false);
    return;
  }

  try {
    const data = await api('/api/auth/me');

    // Check again in case password recovery started during the API request.
    if (passwordRecoveryActive) {
      showAuth(false);
      return;
    }

    if (data.user) {
      currentUser = data.user;
      showApp();
      await loadReferenceData();
      go('home');
    } else {
      showAuth(false);
    }
  } catch(error) {
    if (!passwordRecoveryActive) {
      showAuth(false);
    }
  }
})();


/* =========================================
   ADMIN REPORT CALENDAR
   Uses each report's actual created_at value.
   Displays dates in Asia/Manila.
========================================= */

let calendarDate = new Date();
let selectedCalendarDate = null;

function getManilaDateKey(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function getManilaDateParts(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(new Date(value));

  const result = {};
  parts.forEach(part => {
    if (part.type !== 'literal') {
      result[part.type] = Number(part.value);
    }
  });

  return result;
}

function formatCalendarDate(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);

  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'full'
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function getReportsForDate(dateKey) {
  return adminReportCache.filter(report =>
    report.created_at &&
    getManilaDateKey(report.created_at) === dateKey
  );
}

function renderAdminCalendar() {
  const grid = $('#adminCalendarGrid');
  const monthLabel = $('#adminCalendarMonth');

  if (!grid || !monthLabel) return;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  const monthName = new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    year: 'numeric'
  }).format(calendarDate);

  monthLabel.textContent = monthName;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const todayKey = getManilaDateKey(new Date());

  let html = weekdays.map(day =>
    `<div class="calendar-weekday">${day}</div>`
  ).join('');

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = [
      year,
      String(month + 1).padStart(2, '0'),
      String(day).padStart(2, '0')
    ].join('-');

    const reports = getReportsForDate(dateKey);
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === selectedCalendarDate;

    html += `
      <button
        type="button"
        class="calendar-day
          ${reports.length ? 'has-reports' : ''}
          ${isToday ? 'today' : ''}
          ${isSelected ? 'selected' : ''}"
        data-calendar-date="${dateKey}"
        aria-label="${dateKey}, ${reports.length} reports"
      >
        <span class="calendar-day-number">${day}</span>
        ${reports.length
          ? `<span class="calendar-report-count">
               ${reports.length} report${reports.length === 1 ? '' : 's'}
             </span>`
          : ''}
      </button>
    `;
  }

  grid.innerHTML = html;

  const monthReports = adminReportCache.filter(report => {
    if (!report.created_at) return false;

    const parts = getManilaDateParts(report.created_at);

    return parts.year === year && parts.month === month + 1;
  });

  const countElement = $('#adminCalendarMonthCount');

  if (countElement) {
    countElement.textContent =
      `${monthReports.length} report${monthReports.length === 1 ? '' : 's'} this month`;
  }

  grid.querySelectorAll('[data-calendar-date]').forEach(button => {
    button.addEventListener('click', () => {
      selectedCalendarDate = button.dataset.calendarDate;

      renderAdminCalendar();
      renderCalendarDayReports();
    });
  });

  if (selectedCalendarDate) {
    const [selectedYear, selectedMonth] =
      selectedCalendarDate.split('-').map(Number);

    if (selectedYear !== year || selectedMonth !== month + 1) {
      selectedCalendarDate = null;
      renderCalendarDayReports();
    }
  }
}

function renderCalendarDayReports() {
  const target = $('#adminCalendarDayReports');

  if (!target) return;

  if (!selectedCalendarDate) {
    target.innerHTML = `
      <div class="directory-empty">
        <b>Select a date</b>
        <p>Choose a day on the calendar to view its submitted reports.</p>
      </div>
    `;
    return;
  }

  const reports = getReportsForDate(selectedCalendarDate);

  if (!reports.length) {
    target.innerHTML = `
      <div class="directory-empty">
        <b>No reports on this date</b>
        <p>${escapeHtml(formatCalendarDate(selectedCalendarDate))}</p>
      </div>
    `;
    return;
  }

  target.innerHTML = `
    <div class="calendar-selected-date">
      <h3>${escapeHtml(formatCalendarDate(selectedCalendarDate))}</h3>
      <p>${reports.length} submitted report${reports.length === 1 ? '' : 's'}</p>
    </div>

    <div class="calendar-report-list">
      ${reports.map(report => `
        <article class="calendar-report-item">
          <div class="calendar-report-heading">
            <b>${escapeHtml(report.title || 'Untitled report')}</b>
            <span class="status-pill">
              ${escapeHtml(report.status || 'Submitted')}
            </span>
          </div>

          <p>
            ${escapeHtml(report.full_name || report.contact_name || 'Unknown user')}
          </p>

          <p>
            ${escapeHtml(report.category || 'Uncategorized')}
            ·
            ${escapeHtml(report.room_name || 'Location not specified')}
          </p>

          <p class="muted">
            ${escapeHtml(report.building_name || 'CICS Building')}
          </p>

          ${report.description
            ? `<p>${escapeHtml(report.description)}</p>`
            : ''}

          ${report.image_url
            ? `<a href="${escapeHtml(report.image_url)}"
                 target="_blank"
                 rel="noopener noreferrer">View attachment</a>`
            : ''}
        </article>
      `).join('')}
    </div>
  `;
}

function changeCalendarMonth(amount) {
  calendarDate = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth() + amount,
    1
  );

  selectedCalendarDate = null;

  renderAdminCalendar();
  renderCalendarDayReports();
}

$('#adminCalendarPrev')?.addEventListener('click', () => {
  changeCalendarMonth(-1);
});

$('#adminCalendarNext')?.addEventListener('click', () => {
  changeCalendarMonth(1);
});

$('#adminCalendarRefresh')?.addEventListener('click', async () => {
  await loadAdminReports();
  renderAdminCalendar();
  renderCalendarDayReports();
});

/*
 * Extend the existing admin report loader so the calendar
 * refreshes whenever the administrator refreshes the reports.
 */
const originalLoadAdminReports = loadAdminReports;

loadAdminReports = async function () {
  await originalLoadAdminReports();

  if (currentUser?.role === 'admin') {
    renderAdminCalendar();
    renderCalendarDayReports();
  }
};
