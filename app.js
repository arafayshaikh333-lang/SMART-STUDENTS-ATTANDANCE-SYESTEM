(() => {
  'use strict';
  const DB_NAME = 'SmartAttendDB';
  const DB_VERSION = 2;
  const STORE_STUDENTS = 'students';
  const STORE_ATTENDANCE = 'attendance';
  const STORE_LEAVE_REQUESTS = 'leaveRequests';
  // Publishable browser key only. Never place a Supabase secret key in this file.
  const SUPABASE_URL = 'https://xufnqpvgetkhgsymtrev.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5cbt53tYQSq_RDY-Ruu3kg_KN1tyf4n';
  const AUTH_EMAILS = { ADMIN: 'admin@attendance.example.com', 'CS-STUDENTS': 'cs-students@attendance.example.com' };
  const TOMBSTONE_KEY = 'smartAttendCloudTombstonesV1';
  const $ = (id) => document.getElementById(id);
  const state = { db: null, supabase: null, authUser: null, currentRole: null, cloudSyncing: false, cloudReady: false, lastCloudError: "", offlineMode: false, scanner: null, scannerRunning: false, nativeScanning: false, nativeStream: null, nativeVideo: null, nativeFrameId: null, toastTimer: null, pendingPhoto: null, photoPreviewUrl: null, rangeReportRows: [], dailyReportRows: [], studentPickerData: [], audioContext: null };
  const PAGE_TITLES = { dashboard: 'Dashboard', students: 'Students', scan: 'Scan attendance', records: 'Attendance records', leave: 'Leave management', generator: 'QR generator', 'daily-report': 'Daily Attendance Report', 'leave-approvals': 'Leave Approvals' };

  function isAdmin() { return state.currentRole === 'admin'; }
  function requireAdmin(message = 'This action is only available to the administrator.') {
    if (isAdmin()) return true;
    notify(message, 'error');
    return false;
  }
  function applyRoleUI() {
    const admin = isAdmin();
    if ($('leave-date')) { $('leave-date').min = admin ? '' : localDateKey(); if (!admin && $('leave-date').value < localDateKey()) $('leave-date').value = localDateKey(); }
    document.querySelectorAll('[data-role-admin]').forEach(node => { node.hidden = !admin; });
    $('current-role').textContent = admin ? 'ADMIN · Full access' : 'CS-STUDENTS · Add & view';
    $('student-directory-description').textContent = admin
      ? 'Add, update, and manage student profiles.'
      : 'Add new student profiles and view registered students. Editing and deletion are disabled for this account.';
  }
  function setPasswordVisibility(show) {
    const input = $('login-password');
    const button = $('toggle-password');
    if (!input || !button) return;
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    button.title = show ? 'Hide password' : 'Show password';
    button.innerHTML = show
      ? '<svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18"/><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a16.6 16.6 0 0 1-3.1 3.8"/><path d="M6.2 6.3C3.5 8.1 2 12 2 12s3.6 7 10 7a10.4 10.4 0 0 0 4.1-.8"/></svg>'
      : '<svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function bytesToBase64(bytes) { let binary=''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
  function base64ToBytes(value) { return Uint8Array.from(atob(value), ch => ch.charCodeAt(0)); }
  async function deriveOfflineHash(password, salt, iterations) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations, hash:'SHA-256'}, material, 256);
    return new Uint8Array(bits);
  }
  async function saveOfflineVerifier(username, password, role, uid) {
    if (!crypto?.subtle || !crypto?.getRandomValues || !isSecureContext) return;
    const salt=crypto.getRandomValues(new Uint8Array(16)), iterations=310000;
    const hash=await deriveOfflineHash(password,salt,iterations);
    localStorage.setItem(`smartAttendOfflineAuthV1:${username}`,JSON.stringify({salt:bytesToBase64(salt),hash:bytesToBase64(hash),iterations,role,uid}));
  }
  async function verifyOfflineLogin(username,password,role) {
    if (!crypto?.subtle || !isSecureContext) return null;
    let saved; try { saved=JSON.parse(localStorage.getItem(`smartAttendOfflineAuthV1:${username}`)||'null'); } catch (_) { return null; }
    if (!saved || saved.role!==role || !saved.salt || !saved.hash) return null;
    const actual=await deriveOfflineHash(password,base64ToBytes(saved.salt),Number(saved.iterations)||310000);
    const expected=base64ToBytes(saved.hash);
    if(actual.length!==expected.length) return null;
    let diff=0; for(let i=0;i<actual.length;i++) diff|=actual[i]^expected[i];
    return diff===0 ? saved : null;
  }
  async function handleLogin(event) {
    event.preventDefault();
    const username = $('login-username').value.trim().toUpperCase();
    const password = $('login-password').value;
    const expectedRole = username === 'ADMIN' ? 'admin' : username === 'CS-STUDENTS' ? 'student' : null;
    const email = AUTH_EMAILS[username];
    if (!email || !password) {
      $('login-error').textContent = 'Incorrect username or password. Please try again.';
      $('login-error').hidden = false;
      $('login-password').value = '';
      setPasswordVisibility(false);
      $('login-password').focus();
      return;
    }
    try {
      if (!state.supabase && window.supabase?.createClient) state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      if (!navigator.onLine) {
        const verifier=await verifyOfflineLogin(username,password,expectedRole);
        if(!verifier) throw new Error('This device has not completed an online sign-in for this account yet. Connect to the internet and sign in once first.');
        state.currentRole=expectedRole;
        state.offlineMode=true;
        state.authUser=null;
        if(state.supabase) {
          try { const {data:{session}}=await state.supabase.auth.getSession(); if(session?.user?.id===verifier.uid){state.authUser=session.user;state.offlineMode=false;} } catch (_) {}
        }
      } else {
        if (!state.supabase) throw new Error('Supabase client library did not load. Connect to the internet and reload this page.');
        const { data: authData, error: authError } = await state.supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        if (!authData?.user) throw new Error('Sign-in did not return a user. Please try again.');
        const { data: profile, error: profileError } = await state.supabase
          .from('profiles').select('role, student_id').eq('id', authData.user.id).single();
        if (profileError) throw new Error(`Could not verify account role: ${profileError.message}`);
        if (!profile || profile.role !== expectedRole) {
          await state.supabase.auth.signOut();
          throw new Error('This account does not have the correct portal role. Ask the administrator to check the profiles table.');
        }
        state.authUser = authData.user;
        state.currentRole = profile.role;
        state.offlineMode=false;
        try { await saveOfflineVerifier(username,password,profile.role,authData.user.id); } catch (_) {}
      }
      document.body.classList.add('authenticated');
      $('login-screen').hidden = true;
      applyRoleUI();
      if (!state.db) state.db = await openDatabase();
      await refreshAll();
      await navigate('dashboard');
      if (state.offlineMode) notify('Offline login successful. Changes will sync after you reconnect and sign in online.', 'success');
      else if (state.cloudReady) notify('Signed in and cloud data synced.', 'success');
      else notify(`Signed in, but cloud sync did not finish: ${state.lastCloudError || 'check your Supabase setup and internet connection'}`, 'error');
    } catch (err) {
      if (state.supabase && navigator.onLine) { try { await state.supabase.auth.signOut(); } catch (_) {} }
      document.body.classList.remove('authenticated');
      $('login-screen').hidden = false;
      state.currentRole = null;
      state.authUser = null;
      state.offlineMode = false;
      $('login-error').textContent = err.message || 'Could not sign in. Check your internet connection and account password.';
      $('login-error').hidden = false;
      $('login-password').value = '';
      setPasswordVisibility(false);
      $('login-password').focus();
    }
  }
  async function logout() {
    if (state.scannerRunning) await stopScanner(false);
    closeStudentModal();
    try { if (state.supabase) await state.supabase.auth.signOut(); } catch (_) {}
    state.authUser = null;
    state.currentRole = null;
    state.cloudReady = false;
    state.offlineMode = false;
    document.body.classList.remove('authenticated');
    $('login-screen').hidden = false;
    $('login-form').reset();
    setPasswordVisibility(false);
    $('login-error').textContent = 'Incorrect username or password. Please try again.';
    $('login-error').hidden = true;
    $('login-username').focus();
  }

  function localDateKey(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Karachi', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
    const part = type => parts.find(p => p.type === type)?.value || '00';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function readableDate(value = new Date()) { return new Intl.DateTimeFormat(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric', timeZone:'Asia/Karachi' }).format(value instanceof Date ? value : new Date(value)); }
  function readableTime(value) { return new Intl.DateTimeFormat(undefined, { hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Karachi' }).format(new Date(value)); }
  function pakistanMinutes(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Karachi', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(d);
    const part = type => Number(parts.find(p => p.type === type)?.value || 0);
    return part('hour') * 60 + part('minute') + part('second') / 60 + d.getMilliseconds() / 60000;
  }
  function attendanceTimeAllowed(value = new Date()) { return pakistanMinutes(value) >= (8 * 60 + 30); }
  // Attendance closes strictly after 10:00:00 AM Pakistan time.
  function attendanceCutoffPassed(value = new Date()) { return pakistanMinutes(value) > (10 * 60); }
  function punctualityLabel(timestamp, status='Present') {
    if (status !== 'Present' || !timestamp) return '—';
    const minutes = pakistanMinutes(new Date(Number(timestamp)));
    if (minutes < (8 * 60 + 30)) return 'Before allowed time';
    return minutes <= (9 * 60 + 15) ? 'On Time' : 'Late';
  }
  function displayDob(value) {
    if (!value) return '—';
    const d = new Date(`${value}T12:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { day:'2-digit', month:'short', year:'numeric' }).format(d);
  }
  // Student field accessors. Keep the legacy className field compatible:
  // older database records stored Department in className.
  function departmentOf(student) {
    return String(student?.department || student?.className || '').trim();
  }
  function yearClassOf(student) {
    return String(student?.yearClass || student?.studentClass || '').trim();
  }
  function fatherNameOf(student) {
    return String(student?.fatherName || student?.guardianName || '').trim();
  }
  function studentSearchText(student) {
    return [student?.name, student?.roll, departmentOf(student), yearClassOf(student), fatherNameOf(student), student?.email, student?.phone]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
  }
  function academicLabel(student) {
    return [departmentOf(student), yearClassOf(student)].filter(Boolean).join(' · ') || 'Department/Class not set';
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function initials(name='Student') { return name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0].toUpperCase()).join('') || 'S'; }
  function randomId() { const bytes = new Uint8Array(5); if (window.crypto?.getRandomValues) crypto.getRandomValues(bytes); else for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256); return 'SA-' + Array.from(bytes, b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(); }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('This browser does not support IndexedDB. Please use a recent version of Chrome, Edge, Firefox, or Safari.')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_STUDENTS)) {
          const students = db.createObjectStore(STORE_STUDENTS, { keyPath: 'id' });
          students.createIndex('rollLower', 'rollLower', { unique: true });
          students.createIndex('nameLower', 'nameLower', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_ATTENDANCE)) {
          const attendance = db.createObjectStore(STORE_ATTENDANCE, { keyPath: 'id', autoIncrement: true });
          attendance.createIndex('date', 'date', { unique: false });
          attendance.createIndex('studentDate', ['studentId','date'], { unique: true });
          attendance.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_LEAVE_REQUESTS)) {
          const leaveRequests = db.createObjectStore(STORE_LEAVE_REQUESTS, { keyPath: 'id' });
          leaveRequests.createIndex('status', 'status', { unique: false });
          leaveRequests.createIndex('date', 'date', { unique: false });
          leaveRequests.createIndex('studentDate', ['studentId','date'], { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the local database.'));
      request.onblocked = () => reject(new Error('The database is blocked by another open tab. Close other Smart Students Attendance System tabs and reload.'));
    });
  }
  function txStore(name, mode='readonly') { return state.db.transaction(name, mode).objectStore(name); }
  function requestPromise(request) { return new Promise((resolve,reject) => { request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error || new Error('Database request failed.')); }); }
  async function allStudents() { return requestPromise(txStore(STORE_STUDENTS).getAll()); }
  async function allAttendance() { return requestPromise(txStore(STORE_ATTENDANCE).getAll()); }
  async function allLeaveRequests() { return requestPromise(txStore(STORE_LEAVE_REQUESTS).getAll()); }
  async function getStudent(id) { return requestPromise(txStore(STORE_STUDENTS).get(id)); }
  async function saveStudent(student) { return requestPromise(txStore(STORE_STUDENTS,'readwrite').put(student)); }
  async function deleteStudent(id) { addCloudTombstone({ type: 'student', id: String(id) }); return requestPromise(txStore(STORE_STUDENTS,'readwrite').delete(id)); }
  function readCloudTombstones() { try { const value = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; } }
  function addCloudTombstone(item) { const items = readCloudTombstones(); if (!items.some(x => x.type === item.type && x.id === item.id && x.studentId === item.studentId && x.date === item.date)) { items.push(item); localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(items)); } }
  async function notify(message, kind='success') {
    const toast=$('toast'); toast.textContent=message; toast.className='toast show'+(kind==='error'?' error':kind==='success'?' success':'');
    clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>toast.classList.remove('show'),3600);
  }
  function personCell(studentOrRecord) {
    const name = studentOrRecord.name || 'Unknown student';
    const photo = studentOrRecord.photo ? `<img src="${studentOrRecord.photo}" alt="">` : escapeHtml(initials(name));
    const roll = studentOrRecord.roll || 'No roll number';
    return `<div class="table-person"><div class="avatar">${photo}</div><div><div class="person-name">${escapeHtml(name)}</div><div class="person-sub">${escapeHtml(roll)}</div></div></div>`;
  }
  function setEmpty(id, visible) { $(id).hidden = !visible; }
  async function navigate(page) {
    if (!state.currentRole || !PAGE_TITLES[page]) return;
    if (page === 'leave-approvals' && !isAdmin()) { notify('Leave approvals are available only in the SSC-TEACHER admin portal.', 'error'); return; }
    if (state.scannerRunning && page !== 'scan') await stopScanner(false);
    document.querySelectorAll('.page').forEach(node => node.classList.toggle('active', node.id === `page-${page}`));
    document.querySelectorAll('.nav-link').forEach(node => node.classList.toggle('active', node.dataset.page === page));
    $('page-title').textContent = PAGE_TITLES[page];
    $('sidebar').classList.remove('open');
    if (page === 'dashboard') await renderDashboard();
    if (page === 'students') await renderStudents();
    if (page === 'records') await renderRecords();
    if (page === 'leave') { await populateLeaveSelect(); await renderLeave(); }
    if (page === 'generator') await populateQrSelect();
    if (page === 'daily-report') await populateDailyStudentSelect();
    if (page === 'leave-approvals') await renderLeaveApprovals();
  }
  function avatarMarkup(student) { return student.photo ? `<img src="${student.photo}" alt="${escapeHtml(student.name)}">` : escapeHtml(initials(student.name)); }

  function statusMarkup(status='Present') {
    const normalized = status === 'Leave' ? 'Leave' : status === 'Absent' ? 'Absent' : 'Present';
    const extra = normalized === 'Leave' ? ' status-leave' : normalized === 'Absent' ? ' status-absent' : '';
    const label = normalized === 'Leave' ? 'On Leave' : normalized;
    return `<span class="status-pill${extra}">${label}</span>`;
  }
  async function renderDashboard() {
    const [students, attendance] = await Promise.all([allStudents(), allAttendance()]);
    const today = localDateKey();
    const todays = attendance.filter(row=>row.date===today).sort((a,b)=>b.timestamp-a.timestamp);
    const presentRows = todays.filter(row=>(row.status||'Present')==='Present');
    const leaveRows = todays.filter(row=>row.status==='Leave');
    $('stat-students').textContent = students.length;
    $('stat-present').textContent = presentRows.length;
    $('stat-leave').textContent = leaveRows.length;
    const presentIds = new Set(presentRows.map(row=>row.studentId));
    const leaveIds = new Set(leaveRows.map(row=>row.studentId));
    $('stat-absent').textContent = Math.max(0, students.length - presentIds.size - leaveIds.size);
    $('recent-body').innerHTML = todays.slice(0,8).map(row=>`<tr><td>${personCell(row)}</td><td>${escapeHtml(row.roll)}</td><td>${escapeHtml(readableTime(row.timestamp))}</td><td>${statusMarkup(row.status)}</td></tr>`).join('');
    setEmpty('recent-empty', todays.length===0);
  }
  async function renderStudents() {
    const [students, attendance] = await Promise.all([allStudents(),allAttendance()]);
    const query = $('student-search').value.trim().toLowerCase();
    const today = localDateKey();
    const todaysByStudent = new Map(attendance.filter(r=>r.date===today).map(r=>[r.studentId,r]));
    const filtered = students.filter(s=>[s.name,s.roll,departmentOf(s),yearClassOf(s),fatherNameOf(s),s.email,s.phone].some(v=>String(v||'').toLowerCase().includes(query))).sort((a,b)=>a.name.localeCompare(b.name));
    $('student-grid').innerHTML = filtered.map(s=>{const rec=todaysByStudent.get(s.id);const status=rec?statusMarkup(rec.status):'Not marked';const adminActions=isAdmin()?`<button class="btn btn-outline btn-small" data-action="edit-student" data-id="${escapeHtml(s.id)}">Edit</button><button class="btn btn-danger-outline btn-small" data-action="delete-student" data-id="${escapeHtml(s.id)}">Delete</button>`:'';return `<article class="student-card"><div class="student-card-top"><div class="avatar">${avatarMarkup(s)}</div><div><div class="person-name">${escapeHtml(s.name)}</div><div class="person-sub">${escapeHtml(s.roll)}</div></div></div><div class="student-card-body"><div class="detail-line"><span>Department</span><span>${escapeHtml(departmentOf(s)||'—')}</span></div><div class="detail-line"><span>Class</span><span>${escapeHtml(yearClassOf(s)||'—')}</span></div><div class="detail-line"><span>Father name</span><span>${escapeHtml(fatherNameOf(s)||'—')}</span></div><div class="detail-line"><span>Date of birth</span><span>${escapeHtml(displayDob(s.dateOfBirth))}</span></div><div class="detail-line"><span>Email</span><span>${escapeHtml(s.email||'—')}</span></div><div class="detail-line"><span>Phone</span><span>${escapeHtml(s.phone||'—')}</span></div><div class="detail-line"><span>Today's status</span><span>${status}</span></div></div><div class="student-card-actions">${adminActions}<button class="btn btn-outline btn-small" data-action="student-qr" data-id="${escapeHtml(s.id)}">Make QR</button></div></article>`;}).join('');
    setEmpty('students-empty', filtered.length===0);
    if (students.length && !filtered.length) { $('students-empty').querySelector('b').textContent='No matching students'; $('students-empty').querySelector('p').textContent='Try another search term.'; $('students-empty').querySelector('[data-action="add-student"]').hidden=true; }
    else { $('students-empty').querySelector('b').textContent='No students registered'; $('students-empty').querySelector('p').textContent='Add your first student to get started.'; $('students-empty').querySelector('[data-action="add-student"]').hidden=false; }
  }
  async function renderRecords() {
    const [attendance, students] = await Promise.all([allAttendance(), allStudents()]);
    const selectedDate = $('record-date').value || localDateKey();
    const q = $('record-student-search').value.trim().toLowerCase();
    const selectedStudent = $('record-student-filter').value || 'all';
    const byId = new Map(students.map(s=>[s.id,s]));
    const filtered = attendance.filter(r=>{ if(r.date!==selectedDate) return false; if(selectedStudent!=='all' && selectedStudent) return r.studentId===selectedStudent; if(!q || q==='all students') return true; const s=byId.get(r.studentId); return studentSearchText({...r,...(s||{})}).includes(q); }).sort((a,b)=>b.timestamp-a.timestamp);
    $('records-body').innerHTML = filtered.map(r=>{
      const current = byId.get(r.studentId);
      const dob = current?.dateOfBirth || r.dateOfBirth || '';
      const showRow = {...r, photo: current?.photo || ''};
      const time = r.timestamp ? readableTime(r.timestamp) : '—';
      const punctuality = punctualityLabel(r.timestamp, r.status || 'Present');
      return `<tr><td>${personCell(showRow)}</td><td>${escapeHtml(fatherNameOf(current)||r.fatherName||'—')}</td><td>${escapeHtml(displayDob(dob))}</td><td>${escapeHtml(r.roll)}</td><td>${escapeHtml(departmentOf(current)||r.department||r.className||'—')}</td><td>${escapeHtml(yearClassOf(current)||r.yearClass||'—')}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(time)}</td><td>${statusMarkup(r.status)}${r.reason?`<small class="record-reason">${escapeHtml(r.reason)}</small>`:''}</td><td>${escapeHtml(punctuality)}</td></tr>`;
    }).join('');
    setEmpty('records-empty', filtered.length===0);
  }

  const studentPickerConfigs = [
    { input:'range-report-student-search', menu:'range-report-student-options', hidden:'range-report-student', wrap:'range-student-picker', allowAll:true },
    { input:'daily-student-search', menu:'daily-student-options', hidden:'daily-report-student', wrap:'daily-student-picker', allowAll:true },
    { input:'record-student-search', menu:'record-student-options', hidden:'record-student-filter', wrap:'records-student-picker', allowAll:true },
    { input:'qr-student-search', menu:'qr-student-options', hidden:'qr-student', wrap:'qr-student-picker', allowAll:false }
  ];
  async function loadStudentPickerData() {
    state.studentPickerData = (await allStudents()).sort((a,b)=>a.name.localeCompare(b.name));
  }
  function closeStudentPicker(config) {
    const menu=$(config.menu), input=$(config.input);
    if(menu) menu.hidden=true;
    if(input) input.setAttribute('aria-expanded','false');
  }
  function renderStudentPickerOptions(config) {
    const input=$(config.input), menu=$(config.menu), hidden=$(config.hidden);
    if(!input||!menu||!hidden) return;
    const raw=input.value.trim();
    const selectedId=hidden.value;
    const selectedStudent=state.studentPickerData.find(s=>s.id===selectedId);
    const selectedLabel=selectedStudent?`${selectedStudent.name} — ${selectedStudent.roll}`:'';
    const query=(raw.toLowerCase()==='all students'||(selectedId&&raw===selectedLabel)) ? '' : raw.toLowerCase();
    const filtered=state.studentPickerData.filter(s=>studentSearchText(s).includes(query));
    const allOption=config.allowAll !== false && (!query || 'all students'.includes(query)) ? `<button type="button" class="student-picker-option" role="option" data-student-value="all"><span>All students</span><small>Show everyone</small></button>` : '';
    const students=filtered.slice(0,80).map(s=>`<button type="button" class="student-picker-option" role="option" data-student-value="${escapeHtml(s.id)}"><span>${escapeHtml(s.name)}</span><small>${escapeHtml(s.roll)} · ${escapeHtml(yearClassOf(s)||departmentOf(s)||'')}</small></button>`).join('');
    menu.innerHTML=allOption+students || '<div class="searchable-select-empty">No matching students found.</div>';
    menu.hidden=false; input.setAttribute('aria-expanded','true');
  }
  function chooseStudentPicker(config, value) {
    const student=state.studentPickerData.find(s=>s.id===value);
    if(value==='all' && config.allowAll !== false) { $(config.hidden).value='all'; $(config.input).value='All students'; }
    else if(student) { $(config.hidden).value=student.id; $(config.input).value=`${student.name} — ${student.roll}`; }
    else return;
    closeStudentPicker(config);
    if(config.hidden==='record-student-filter') renderRecords();
    if(config.hidden==='qr-student') $('qr-student').dispatchEvent(new Event('change', { bubbles:true }));
  }
  async function populateStudentPicker(config) {
    await loadStudentPickerData();
    if(config.hidden==='qr-student') {
      const select=$('qr-student');
      const previous=select.value;
      select.innerHTML='<option value="">Choose a student…</option>'+state.studentPickerData.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.roll)}</option>`).join('');
      if(state.studentPickerData.some(s=>s.id===previous)) select.value=previous;
    }
    const selected=$(config.hidden).value || (config.allowAll === false ? '' : 'all');
    if(document.activeElement!==$(config.input)) {
      if(selected==='all') $(config.input).value='All students';
      else {
        const selectedStudent=state.studentPickerData.find(s=>s.id===selected);
        if(selectedStudent) $(config.input).value=`${selectedStudent.name} — ${selectedStudent.roll}`;
        else { $(config.hidden).value=config.allowAll === false ? '' : 'all'; $(config.input).value=config.allowAll === false ? '' : 'All students'; }
      }
    }
  }
  async function populateReportStudentSelect() { await populateStudentPicker(studentPickerConfigs[0]); }
  async function populateDailyStudentSelect() { await populateStudentPicker(studentPickerConfigs[1]); }
  async function populateRecordsStudentPicker() { await populateStudentPicker(studentPickerConfigs[2]); }
  function dateKeysBetween(from, to) {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Please choose a valid date range (From date must not be after To date).');
    const keys = [];
    for (let day = start; day <= end; day += 86400000) {
      keys.push(new Date(day).toISOString().slice(0,10));
      if (keys.length > 1830) throw new Error('A report can cover a maximum of five years. Please choose a shorter range.');
    }
    return keys;
  }
  function buildRowsForDates(students, attendance, dates) {
    const map = new Map(attendance.map(r=>[`${r.studentId}::${r.date}`,r]));
    const rows = [];
    for (const date of dates) {
      for (const student of students) {
        const rec = map.get(`${student.id}::${date}`);
        const registeredFrom = student.createdAt ? localDateKey(new Date(student.createdAt)) : '';
        const status = rec ? (rec.status || 'Present') : (registeredFrom && date < registeredFrom ? 'Not Registered' : 'Absent');
        rows.push({
          studentId:student.id, name:student.name, dob:student.dateOfBirth || rec?.dateOfBirth || '',
          roll:student.roll || rec?.roll || '', fatherName:fatherNameOf(student)||rec?.fatherName||'', department:departmentOf(student)||rec?.department||rec?.className||'', className:yearClassOf(student)||rec?.yearClass||'',
          date, time:(status==='Present' || status==='Absent') && rec?.timestamp ? readableTime(rec.timestamp) : '—',
          status, punctuality:status==='Present' ? punctualityLabel(rec?.timestamp,status) : '—', reason:rec?.reason||''
        });
      }
    }
    return rows;
  }
  function renderReportTable(bodyId, rows) {
    $(bodyId).innerHTML = rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.fatherName||'—')}</td><td>${escapeHtml(displayDob(r.dob))}</td><td>${escapeHtml(r.roll)}</td><td>${escapeHtml(r.department||'—')}</td><td>${escapeHtml(r.className||'—')}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.time)}</td><td><span class="report-status report-${String(r.status).toLowerCase().replace(/\s+/g,'-')}">${escapeHtml(r.status)}</span></td><td>${escapeHtml(r.punctuality)}</td></tr>`).join('');
  }
  function updateReportSummary(prefix, rows) {
    $(`${prefix}-present`).textContent = rows.filter(r=>r.status==='Present').length;
    $(`${prefix}-absent`).textContent = rows.filter(r=>r.status==='Absent').length;
    $(`${prefix}-leave`).textContent = rows.filter(r=>r.status==='Leave').length;
    $(`${prefix}-late`).textContent = rows.filter(r=>r.punctuality==='Late').length;
  }
  async function generateRangeReport() {
    try {
      const from = $('range-report-from').value, to = $('range-report-to').value, selected = $('range-report-student').value;
      if (!selected) throw new Error('Search and select a student, or choose All students from the list.');
      if (!from || !to) throw new Error('Choose both From date and To date.');
      const dates = dateKeysBetween(from,to);
      const [allStudentsList, attendance] = await Promise.all([allStudents(),allAttendance()]);
      const students = selected === 'all' ? allStudentsList : allStudentsList.filter(s=>s.id===selected);
      if (!students.length) throw new Error('No student found. Please add a student first.');
      if (students.length * dates.length > 50000) throw new Error('This report is too large. Select one student or a shorter date range.');
      state.rangeReportRows = buildRowsForDates(students,attendance,dates);
      renderReportTable('range-report-body',state.rangeReportRows);
      updateReportSummary('range',state.rangeReportRows);
      $('range-report-caption').textContent = `${from} to ${to} · ${students.length===1?students[0].name:'All students'} · ${state.rangeReportRows.length} daily entries`;
      $('range-report-preview').hidden = false;
      notify('Date-range attendance report generated.','success');
    } catch (err) { notify(err.message || 'Could not generate attendance report.','error'); }
  }
  async function generateDailyReport() {
    try {
      const date = $('daily-report-date').value, selected = $('daily-report-student').value;
      if (!selected) throw new Error('Search and select a student, or choose All students from the list.');
      if (!date) throw new Error('Choose the report date.');
      const [allStudentsList,attendance] = await Promise.all([allStudents(),allAttendance()]);
      const students = selected === 'all' ? allStudentsList : allStudentsList.filter(s=>s.id===selected);
      if (!students.length) throw new Error('No student found. Add a student first.');
      state.dailyReportRows = buildRowsForDates(students,attendance,[date]);
      renderReportTable('daily-report-body',state.dailyReportRows);
      updateReportSummary('daily',state.dailyReportRows);
      $('daily-report-caption').textContent = `Daily attendance · ${date} · ${students.length===1?students[0].name:'All students'}`;
      $('daily-report-preview').hidden = false;
      notify('Daily attendance report generated.','success');
    } catch (err) { notify(err.message || 'Could not generate daily report.','error'); }
  }
  function reportCsv(rows, prefix) {
    if (!rows.length) { notify('Generate a report first.','error'); return; }
    const headers = ['Student Name','Father Name','Date of Birth','Roll Number','Department','Class','Date','Time','Status','Punctuality','Leave Reason'];
    const safeCell = value => { let v=String(value??''); if (/^[=+@-]/.test(v)) v="'"+v; return csvCell(v); };
    const lines = [headers,...rows.map(r=>[r.name,r.fatherName,r.dob,r.roll,r.department,r.className,r.date,r.time,r.status,r.punctuality,r.reason])].map(row=>row.map(safeCell).join(','));
    downloadText(`${prefix}-${localDateKey()}.csv`,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');
    notify('Excel-compatible CSV downloaded. Open it in Microsoft Excel.','success');
  }
  function pdfSafeText(value) {
    const text = String(value ?? '—')
      .replace(/[–—]/g, '-')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/•/g, '-')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return text.replace(/[^\x20-\x7E]/g, '?');
  }
  function pdfHex(value) {
    return Array.from(pdfSafeText(value), ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function pdfTextCommand(text, x, y, size = 8, font = 'F1', color = '172B4D') {
    const r = parseInt(color.slice(0,2),16)/255, g = parseInt(color.slice(2,4),16)/255, b = parseInt(color.slice(4,6),16)/255;
    return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(595-y).toFixed(2)} Tm <${pdfHex(text)}> Tj ET\n`;
  }
  function pdfRect(x, top, width, height, fill, stroke = null, lineWidth = 0.5) {
    const rgb = value => `${(parseInt(value.slice(0,2),16)/255).toFixed(3)} ${(parseInt(value.slice(2,4),16)/255).toFixed(3)} ${(parseInt(value.slice(4,6),16)/255).toFixed(3)}`;
    let out = 'q\n';
    if (fill) out += `${rgb(fill)} rg\n`;
    if (stroke) out += `${rgb(stroke)} RG ${lineWidth} w\n`;
    out += `${x.toFixed(2)} ${(595-top-height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ` + (fill && stroke ? 'B' : fill ? 'f' : 'S') + '\nQ\n';
    return out;
  }
  function pdfCellText(value, maxChars) {
    const text = pdfSafeText(value || '—');
    return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}?` : text;
  }
  function buildAttendancePdf(title, subtitle, rows) {
    const pageW = 842, pageH = 595, margin = 30;
    const headers = ['STUDENT NAME','FATHER NAME','DOB','ROLL NO.','DEPARTMENT','CLASS','DATE','TIME','STATUS','PUNCTUALITY'];
    const widths = [100, 83, 54, 52, 95, 78, 68, 62, 76, 94];
    const tableW = widths.reduce((a,b)=>a+b,0);
    const rowsPerPage = 17;
    const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
    const pages = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const pageRows = rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
      let c = '';
      c += pdfRect(0, 0, pageW, pageH, 'FFFFFF');
      c += pdfRect(0, 0, pageW, 12, '17345F');
      c += pdfTextCommand(title, margin, 43, 18, 'F2', '17345F');
      c += pdfTextCommand(subtitle, margin, 63, 9, 'F1', '66768C');
      c += pdfTextCommand(`Generated: ${readableDate()} ${readableTime(Date.now())} PKT | Entries: ${rows.length} | Page ${pageIndex+1} of ${pageCount}`, margin, 82, 8, 'F1', '66768C');
      let y = 97;
      let x = margin;
      c += pdfRect(margin, y, tableW, 25, '17345F');
      headers.forEach((head, idx) => {
        c += pdfTextCommand(head, x + 5, y + 16, 7, 'F2', 'FFFFFF');
        x += widths[idx];
      });
      y += 25;
      pageRows.forEach((row, rowIndex) => {
        const fill = rowIndex % 2 === 0 ? 'F4F7FC' : 'FFFFFF';
        c += pdfRect(margin, y, tableW, 23, fill, 'DCE4EF', 0.35);
        const values = [row.name, row.fatherName||'—', displayDob(row.dob), row.roll, row.department||'—', row.className||'—', row.date, row.time, row.status, row.punctuality];
        x = margin;
        values.forEach((value, idx) => {
          const max = Math.max(7, Math.floor((widths[idx] - 10) / 3.8));
          const color = idx === 6 && row.status === 'Present' ? '16845B' : idx === 6 && row.status === 'Leave' ? 'A96808' : idx === 7 && row.punctuality === 'Late' ? 'B42318' : idx === 7 && row.punctuality === 'On Time' ? '16845B' : '27364B';
          c += pdfTextCommand(pdfCellText(value, max), x + 5, y + 14.5, 7, 'F1', color);
          x += widths[idx];
        });
        y += 23;
      });
      c += pdfTextCommand('Smart Students Attendance System | Government Superior Science College Khairpur', margin, 574, 7, 'F1', '8A95A5');
      pages.push(c);
    }
    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const kids = pages.map((_,i)=>`${5+i*2} 0 R`).join(' ');
    objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach((content, i) => {
      const pageId = 5 + i*2, contentId = pageId + 1;
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
    });
    let pdf = '%PDF-1.4\n%AttendanceReport\n';
    const offsets = [0];
    for (let i=1; i<objects.length; i++) {
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i=1; i<objects.length; i++) pdf += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }
  function printReportAsPdf(title, subtitle, rows) {
    if (!rows.length) { notify('Generate a report first.','error'); return; }
    try {
      const blob = buildAttendancePdf(title, subtitle, rows);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeTitle = pdfSafeText(title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'attendance-report';
      link.href = url;
      link.download = `${safeTitle}-${localDateKey()}.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify('PDF downloaded directly. Check your Downloads folder.','success');
    } catch (err) {
      notify(`Could not create PDF: ${err.message || 'unknown error'}`,'error');
    }
  }

  function closeLeaveStudentOptions() {
    const menu = $('leave-student-options');
    if (menu) menu.hidden = true;
    const input = $('leave-student-search');
    if (input) input.setAttribute('aria-expanded', 'false');
  }
  function showLeaveStudentOptions() {
    const input = $('leave-student-search');
    const menu = $('leave-student-options');
    if (!input || !menu) return;
    const rawQuery = input.value.trim().toLowerCase();
    const selectedStudent = (state.leaveStudents || []).find(s => s.id === $('leave-student').value);
    const selectedLabel = selectedStudent ? `${selectedStudent.name} — ${selectedStudent.roll}`.toLowerCase() : '';
    const query = selectedStudent && rawQuery === selectedLabel ? '' : rawQuery;
    const students = state.leaveStudents || [];
    const filtered = students.filter(s => studentSearchText(s).includes(query));
    menu.innerHTML = filtered.length
      ? filtered.map(s => `<button type="button" class="searchable-select-option" role="option" aria-selected="${$('leave-student').value===s.id?'true':'false'}" data-student-id="${escapeHtml(s.id)}"><span>${escapeHtml(s.name)}</span><small>${escapeHtml(s.roll)} · ${escapeHtml(academicLabel(s))}</small></button>`).join('')
      : '<div class="searchable-select-empty">No matching students found.</div>';
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function chooseLeaveStudent(studentId) {
    const student = (state.leaveStudents || []).find(s => s.id === studentId);
    if (!student) return;
    $('leave-student').value = student.id;
    $('leave-student-search').value = `${student.name} — ${student.roll}`;
    closeLeaveStudentOptions();
  }
  async function populateLeaveSelect(preselect='') {
    const previous = preselect || $('leave-student').value;
    const students = (await allStudents()).sort((a,b)=>a.name.localeCompare(b.name));
    state.leaveStudents = students;
    $('leave-student').innerHTML = '<option value="">Choose a student…</option>' + students.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.roll)}</option>`).join('');
    if (previous && students.some(s=>s.id===previous)) {
      $('leave-student').value = previous;
      const selected = students.find(s=>s.id===previous);
      if (document.activeElement !== $('leave-student-search')) $('leave-student-search').value = `${selected.name} — ${selected.roll}`;
    } else {
      $('leave-student').value = '';
      if (document.activeElement !== $('leave-student-search')) $('leave-student-search').value = '';
    }
    $('leave-student-search').disabled = students.length === 0;
    $('leave-student-search').placeholder = students.length ? 'Search by student name or roll number…' : 'Add a student first';
  }
  async function renderLeave() {
    const [attendance, requests, students] = await Promise.all([allAttendance(), allLeaveRequests(), allStudents()]);
    const selectedDate=$('leave-date').value || localDateKey();
    const byId=new Map(students.map(s=>[s.id,s]));
    const approvedRows=attendance.filter(r=>r.date===selectedDate && r.status==='Leave').map(r=>({kind:'attendance',...r,requestStatus:'Approved'}));
    const requestRows=requests.filter(r=>r.date===selectedDate && r.status!=='Approved').map(r=>({kind:'request',...r}));
    const rows=[...requestRows,...approvedRows].sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
    $('leave-body').innerHTML=rows.map(r=>{
      const student=byId.get(r.studentId);
      const show={...r,photo:student?.photo||r.photo||''};
      const action=isAdmin()&&r.kind==='attendance'?`<td><button class="btn btn-danger-outline btn-small" data-action="cancel-leave" data-id="${escapeHtml(r.id)}">Cancel leave</button></td>`:isAdmin()?'<td>—</td>':'';
      const status=r.kind==='request'?(r.status==='Pending'?'<span class="pill pill-blue">Waiting for Approval</span>':'<span class="pill" style="background:#fff0f0;color:#b42318">Rejected</span>'):'<span class="pill" style="background:#e8f7ef;color:#16845b">Approved · On Leave</span>';
      return `<tr><td>${personCell(show)}</td><td>${escapeHtml([r.department||r.className||departmentOf(student)||'',r.yearClass||yearClassOf(student)||''].filter(Boolean).join(' · ')||'—')}</td><td>${escapeHtml(r.reason||'—')}</td><td>${escapeHtml(readableTime(r.timestamp))}</td><td>${status}</td>${action}</tr>`;
    }).join('');
    setEmpty('leave-empty', rows.length===0);
  }
  async function submitLeave(event) {
    event.preventDefault();
    const studentId=$('leave-student').value;
    const date=$('leave-date').value;
    const reason=$('leave-reason').value.trim();
    if(!studentId || !date || !reason){notify('Choose a student, leave date, and reason.','error');return;}
    const today=localDateKey();
    if(date===today && attendanceCutoffPassed(new Date())){notify('Leave for today closes after 10:00 AM Pakistan time. No leave can be submitted for today after the cutoff.','error');$('leave-date').focus();return;}
    if(!isAdmin() && date < today){notify('Student accounts can submit leave only for today or a future date. Only the administrator can enter leave for a past date.','error');$('leave-date').focus();return;}
    const student=await getStudent(studentId);
    if(!student){notify('Student not found. Refresh the page and try again.','error');return;}
    const [attendance, requests]=await Promise.all([allAttendance(),allLeaveRequests()]);
    const existing=attendance.find(r=>r.studentId===student.id && r.date===date);
    if(existing?.status==='Leave'){
      notify(`${student.name} already has leave recorded for ${date}.`,'error');
      return;
    }
    if(!isAdmin()) {
      const pending=requests.find(r=>r.studentId===student.id && r.date===date && r.status==='Pending');
      if(pending){notify(`${student.name} already has a leave request waiting for approval on ${date}.`,'error');return;}
      const request={id:randomId(),studentId:student.id,name:student.name,roll:student.roll,className:departmentOf(student),department:departmentOf(student),yearClass:yearClassOf(student),fatherName:fatherNameOf(student),photo:student.photo||'',date,dateOfBirth:student.dateOfBirth||'',timestamp:Date.now(),status:'Pending',reason};
      try {
        await requestPromise(txStore(STORE_LEAVE_REQUESTS,'readwrite').add(request));
        $('leave-reason').value=''; $('leave-student-search').value=''; $('leave-student').value='';
        await refreshAll(); $('leave-date').value=date;
        notify(`Leave request submitted for ${student.name}. Waiting for Approval.`, 'success');
      } catch(err) {
        notify(`Could not submit leave request: ${err.message||'database error'}`,'error');
      }
      return;
    }
    if(existing && !confirm(`${student.name} is currently marked Present on ${date}. Replace that status with On Leave?`)) return;
    const record={...(existing||{}),studentId:student.id,name:student.name,roll:student.roll,className:departmentOf(student),department:departmentOf(student),yearClass:yearClassOf(student),fatherName:fatherNameOf(student),date,dateOfBirth:student.dateOfBirth||'',timestamp:Date.now(),status:'Leave',reason,approvedBy:'ADMIN',approvedAt:Date.now()};
    try { await requestPromise(txStore(STORE_ATTENDANCE,'readwrite')[existing?'put':'add'](record)); $('leave-reason').value=''; $('leave-student-search').value=''; $('leave-student').value=''; await refreshAll(); $('leave-student-search').value=''; $('leave-student').value=''; $('leave-date').value=date; await renderLeave(); notify(`${student.name} marked on leave for ${date}.`,'success'); }
    catch(err){if(err.name==='ConstraintError')notify('Attendance or leave is already recorded for this student and date.','error');else notify(`Could not save leave: ${err.message||'database error'}`,'error');}
  }
  async function renderLeaveApprovals() {
    if (!requireAdmin('Leave approvals are available only to the administrator.')) return;
    const requests=await allLeaveRequests();
    const students=await allStudents();
    const byId=new Map(students.map(s=>[s.id,s]));
    requests.sort((a,b)=>((a.status==='Pending'?0:1)-(b.status==='Pending'?0:1)) || (b.timestamp||0)-(a.timestamp||0));
    const pendingCount=requests.filter(r=>r.status==='Pending').length;
    $('pending-leave-count').textContent=`${pendingCount} WAITING`;
    $('leave-approvals-body').innerHTML=requests.map(r=>{
      const student=byId.get(r.studentId);
      const show={...r,photo:student?.photo||r.photo||''};
      const status=r.status==='Pending'?'<span class="pill pill-blue">Waiting for Approval</span>':r.status==='Approved'?'<span class="pill" style="background:#e8f7ef;color:#16845b">Approved</span>':'<span class="pill" style="background:#fff0f0;color:#b42318">Rejected</span>';
      const actions=r.status==='Pending'?`<div class="action-group"><button class="btn btn-primary btn-small" data-action="approve-leave-request" data-id="${escapeHtml(r.id)}">Approve</button><button class="btn btn-danger-outline btn-small" data-action="reject-leave-request" data-id="${escapeHtml(r.id)}">Reject</button></div>`:'—';
      return `<tr><td>${personCell(show)}</td><td>${escapeHtml([r.department||r.className||departmentOf(student)||'',r.yearClass||yearClassOf(student)||''].filter(Boolean).join(' · ')||'—')}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.reason||'—')}</td><td>${escapeHtml(readableTime(r.timestamp))}</td><td>${status}</td><td>${actions}</td></tr>`;
    }).join('');
    setEmpty('leave-approvals-empty', requests.length===0);
  }
  async function approveLeaveRequest(requestId) {
    if(!requireAdmin('Only the SSC-TEACHER admin can approve leave requests.')) return;
    const request=(await allLeaveRequests()).find(r=>r.id===requestId && r.status==='Pending');
    if(!request){notify('This request is no longer waiting for approval.','error');await renderLeaveApprovals();return;}
    const attendance=(await allAttendance()).find(r=>r.studentId===request.studentId && r.date===request.date);
    if(attendance?.status==='Leave') {
      // An administrator may already have entered an approved leave for this date.
    } else if(attendance) {
      if(!confirm(`${request.name} already has a ${attendance.status||'Present'} attendance record on ${request.date}. Approving this request will replace it with On Leave. Continue?`)) return;
    }
    const updatedRequest={...request,status:'Approved',decidedAt:Date.now(),decidedBy:'ADMIN'};
    const leaveRecord={...(attendance||{}),studentId:request.studentId,name:request.name,roll:request.roll,className:request.className,department:request.department,yearClass:request.yearClass,fatherName:request.fatherName,date:request.date,dateOfBirth:request.dateOfBirth||'',timestamp:attendance?.status==='Leave'?(attendance.timestamp||request.timestamp):Date.now(),status:'Leave',reason:request.reason,leaveRequestId:request.id,approvedBy:'ADMIN',approvedAt:Date.now()};
    try {
      const tx=state.db.transaction([STORE_ATTENDANCE,STORE_LEAVE_REQUESTS],'readwrite');
      const as=tx.objectStore(STORE_ATTENDANCE), rs=tx.objectStore(STORE_LEAVE_REQUESTS);
      if(attendance) as.put(leaveRecord); else as.add(leaveRecord);
      rs.put(updatedRequest);
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Approval failed'));tx.onabort=()=>reject(tx.error||new Error('Approval was cancelled'));});
      await refreshAll();
      notify(`Leave approved for ${request.name} on ${request.date}. Attendance is now marked On Leave.`, 'success');
    } catch(err) { notify(`Could not approve leave: ${err.message||'database error'}`,'error'); }
  }
  async function rejectLeaveRequest(requestId) {
    if(!requireAdmin('Only the SSC-TEACHER admin can reject leave requests.')) return;
    const request=(await allLeaveRequests()).find(r=>r.id===requestId && r.status==='Pending');
    if(!request){notify('This request is no longer waiting for approval.','error');await renderLeaveApprovals();return;}
    if(!confirm(`Reject the leave request from ${request.name} for ${request.date}?`)) return;
    try {
      const updated={...request,status:'Rejected',decidedAt:Date.now(),decidedBy:'ADMIN'};
      await requestPromise(txStore(STORE_LEAVE_REQUESTS,'readwrite').put(updated));
      await refreshAll();
      notify(`Leave request rejected for ${request.name}.`, 'success');
    } catch(err) { notify(`Could not reject leave request: ${err.message||'database error'}`,'error'); }
  }
  async function cancelLeave(recordId) {
    if (!requireAdmin('Only the administrator can cancel a leave record.')) return;
    const id=Number(recordId);
    const record=(await allAttendance()).find(r=>r.id===id && r.status==='Leave');
    if(!record)return;
    if(!confirm(`Cancel leave for ${record.name} on ${record.date}?`))return;
    try { await requestPromise(txStore(STORE_ATTENDANCE,'readwrite').delete(id)); await refreshAll(); notify(`Leave cancelled for ${record.name}.`); }
    catch(err){notify(`Could not cancel leave: ${err.message||'database error'}`,'error');}
  }

  async function populateQrSelect(preselect='') {
    const config=studentPickerConfigs.find(item=>item.hidden==='qr-student');
    if(!config) return;
    await populateStudentPicker(config);
    if(preselect && state.studentPickerData.some(s=>s.id===preselect)) {
      $('qr-student').value=preselect;
      const student=state.studentPickerData.find(s=>s.id===preselect);
      $('qr-student-search').value=`${student.name} — ${student.roll}`;
    }
  }
  function openStudentModal(student=null) {
    if (!state.currentRole) return;
    if (student && !isAdmin()) { notify('Student account can add and view profiles, but cannot edit them.', 'error'); return; }
    $('student-form').reset(); $('edit-id').value=student?.id||''; state.pendingPhoto=null;
    $('modal-title').textContent=student?'Edit student':'Add student'; $('save-student').textContent=student?'Save changes':'Save student'; $('photo-preview').hidden=true; $('photo-preview').innerHTML='';
    $('student-name').value=student?.name||''; $('student-roll').value=student?.roll||''; $('student-dob').value=student?.dateOfBirth||''; $('student-dob').max=localDateKey(); $('student-class').value=departmentOf(student)||''; $('student-year-class').value=yearClassOf(student)||''; $('student-father-name').value=fatherNameOf(student); $('student-email').value=student?.email||''; $('student-phone').value=student?.phone||'';
    if(student?.photo) { $('photo-preview').innerHTML=`<img src="${student.photo}" alt="Current student photo"> <span class="person-sub">Current photo (choose a file to replace)</span>`; $('photo-preview').hidden=false; }
    $('student-modal').hidden=false; setTimeout(()=>$('student-name').focus(),20);
  }
  function closeStudentModal() { $('student-modal').hidden=true; state.pendingPhoto=null; }
  async function resizePhoto(file) {
    if(!file) return null;
    if(!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
    if(file.size > 12*1024*1024) throw new Error('Choose an image smaller than 12 MB.');
    const url=URL.createObjectURL(file);
    try {
      const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not read this image.'));img.src=url;});
      const max=420, scale=Math.min(1,max/Math.max(image.width,image.height)); const w=Math.max(1,Math.round(image.width*scale)),h=Math.max(1,Math.round(image.height*scale));
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(image,0,0,w,h);return canvas.toDataURL('image/jpeg',0.78);
    } finally { URL.revokeObjectURL(url); }
  }
  async function saveStudentFromForm(event) {
    event.preventDefault();
    const editing = Boolean($('edit-id').value);
    if (!state.currentRole) { notify('Please sign in first.', 'error'); return; }
    if (editing && !requireAdmin('Student account cannot edit existing student profiles.')) return;
    const id = $('edit-id').value || randomId();
    const name = $('student-name').value.trim();
    const roll = $('student-roll').value.trim();
    const dateOfBirth = $('student-dob').value;
    const department = $('student-class').value.trim();
    const yearClass = $('student-year-class').value.trim();
    const fatherName = $('student-father-name').value.trim();
    if (!name || !roll || !dateOfBirth || !department || !yearClass) { notify('Please complete all required fields, including Date of Birth, Department, and Class.', 'error'); return; }
    if (!/^\d{4}$/.test(roll)) { notify('Roll number must be exactly 4 digits (numbers only).', 'error'); $('student-roll').focus(); return; }
    if (dateOfBirth > localDateKey()) { notify('Date of birth cannot be in the future.', 'error'); $('student-dob').focus(); return; }
    if (!['Computer Science','Pre-Engineering','Pre-Medical'].includes(department)) { notify('Please select a valid department.', 'error'); $('student-class').focus(); return; }
    if (!['First-Year A','First-Year B','First-Year C','Second-Year A','Second-Year B','Second-Year C'].includes(yearClass)) { notify('Please select one of the six available classes.', 'error'); $('student-year-class').focus(); return; }
    const current = await getStudent(id);
    const rollLower = roll.toLocaleLowerCase();
    const students = await allStudents();
    if (students.some(s=>s.id!==id && s.rollLower===rollLower)) { notify('That roll number is already assigned to another student.', 'error'); $('student-roll').focus(); return; }
    let photo = current?.photo || null;
    const file = $('student-photo').files[0];
    try { if (file) photo = await resizePhoto(file); }
    catch (err) { notify(err.message || 'Could not process the photo.', 'error'); return; }
    const student = { id, name, roll, rollLower, dateOfBirth, fatherName, department, className:department, yearClass, email:$('student-email').value.trim(), phone:$('student-phone').value.trim(), photo, createdAt:current?.createdAt||Date.now(), updatedAt:Date.now() };
    try { await saveStudent(student); closeStudentModal(); await refreshAll(); notify(current ? 'Student profile updated.' : 'Student added successfully.'); }
    catch (err) { if (err.name==='QuotaExceededError') notify('Browser storage is full. Export a backup or remove large photos.', 'error'); else notify(`Could not save student: ${err.message||'database error'}`, 'error'); }
  }
  async function removeStudent(id) {
    if (!requireAdmin('Only the administrator can delete student profiles.')) return;
    const student=await getStudent(id); if(!student) return;
    if(!confirm(`Delete ${student.name} (${student.roll}) from the student directory? Existing attendance history will be retained.`)) return;
    try { await deleteStudent(id); await refreshAll(); notify('Student deleted. Historical attendance is retained.'); }
    catch(err){notify(`Could not delete student: ${err.message}`,'error');}
  }
  function normalizeQr(text) {
    let value=String(text||'').trim();
    if(value.startsWith('SMARTATTEND:')) value=value.slice('SMARTATTEND:'.length).trim();
    try { const u=new URL(value); const byParam=u.searchParams.get('student'); if(byParam) value=byParam; } catch(_) {}
    try { const obj=JSON.parse(value); if(obj && typeof obj==='object' && obj.studentId) value=String(obj.studentId); } catch(_) {}
    return value;
  }
  async function markAttendance(rawValue) {
    const studentId=normalizeQr(rawValue);
    if(!studentId){await showScanMessage('No QR value detected','Enter a student ID or scan a QR code.',true);return;}
    const student=await getStudent(studentId);
    if(!student){await showScanMessage('Student not found','This QR code does not match a registered student. Generate a code from the QR generator page.',true);notify('Unknown QR code — no attendance was saved.','error');return;}
    const now=Date.now(),date=localDateKey(new Date(now));
    if(!attendanceTimeAllowed(new Date(now))){const message='Attendance opens at 08:30 AM Pakistan time. No attendance was recorded before 08:30.';await showScanMessage('Attendance not open yet',message,true);notify(message,'error');return;}
    const baseRecord={studentId:student.id,name:student.name,roll:student.roll,className:departmentOf(student),department:departmentOf(student),yearClass:yearClassOf(student),fatherName:fatherNameOf(student),date,dateOfBirth:student.dateOfBirth||'',timestamp:now};
    if(attendanceCutoffPassed(new Date(now))) {
      const existing=(await allAttendance()).find(r=>r.studentId===student.id&&r.date===date);
      if(existing) {
        await showStudentResult(student,existing,true);
        notify(existing.status==='Leave'?`${student.name} is already marked On Leave today.`:existing.status==='Present'?`${student.name} was already marked Present before the 10:00 AM cutoff.`:`${student.name} is marked Absent today. The attendance cutoff was 10:00 AM.`,'error');
        return;
      }
      const absentRecord={...baseRecord,status:'Absent',reason:'Attempted attendance after the 10:00 AM cutoff.'};
      try {
        await requestPromise(txStore(STORE_ATTENDANCE,'readwrite').add(absentRecord));
        await showStudentResult(student,absentRecord,false);
        await refreshAll();
        notify(`${student.name} marked Absent. Attendance closed after 10:00 AM Pakistan time.`,'error');
      } catch(err) {
        if(err.name==='ConstraintError') {
          const all=await allAttendance(); const existingNow=all.find(r=>r.studentId===student.id&&r.date===date);
          await showStudentResult(student,existingNow||absentRecord,true);
          notify(`${student.name} already has a status recorded for today.`,'error');
        } else { await showScanMessage('Could not save absent status',err.message||'Database error. Please try again.',true); notify('Absent status could not be saved.','error'); }
      }
      return;
    }
    const record={...baseRecord,status:'Present',punctuality:punctualityLabel(now,'Present')};
    try {
      await requestPromise(txStore(STORE_ATTENDANCE,'readwrite').add(record));
      await showStudentResult(student,record,false); await refreshAll(); notify(`${student.name} marked present.`, 'success');
    } catch(err) {
      if(err.name==='ConstraintError') {
        const all=await allAttendance(); const existing=all.find(r=>r.studentId===student.id&&r.date===date);
        const found=existing||record; await showStudentResult(student,found,true); if(found.status==='Leave') notify(`${student.name} has leave recorded today; no present record was added.`, 'error'); else notify(`${student.name} is already marked present today.`, 'error');
      } else { await showScanMessage('Could not save attendance',err.message||'Database error. Please try again.',true); notify('Attendance could not be saved.','error'); }
    }
  }
  async function showScanMessage(title,message,isError=false) {
    $('scan-result').innerHTML=`<div class="scan-empty"><div class="result-icon">${isError?'!':'▣'}</div><b>${escapeHtml(title)}</b><p>${escapeHtml(message)}</p></div>`;
  }
  async function showStudentResult(student,record,duplicate) {
    const photo=student.photo?`<img src="${student.photo}" alt="Photo of ${escapeHtml(student.name)}">`:escapeHtml(initials(student.name));
    const status=record?.status||'Present';
    const bannerClass=status==='Leave'?'leave-banner':status==='Absent'?'absent-banner':duplicate?'duplicate-banner':'success-banner';
    const bannerText=status==='Leave'?`✓ ON LEAVE${record?.reason?' — '+escapeHtml(record.reason):''}`:status==='Absent'?`✕ ABSENT — Attendance closed after 10:00 AM${record?.reason?' · '+escapeHtml(record.reason):''}`:duplicate?'✓ Already marked PRESENT today':'✓ PRESENT — Attendance saved';
    $('scan-result').innerHTML=`<div class="scan-person"><div class="scan-person-photo">${photo}</div><h3>${escapeHtml(student.name)}</h3><div class="roll-line">Roll number: <b>${escapeHtml(student.roll)}</b></div><div class="result-details"><div class="result-detail"><span>DEPARTMENT</span><b>${escapeHtml(departmentOf(student)||'—')}</b></div><div class="result-detail"><span>CLASS</span><b>${escapeHtml(yearClassOf(student)||'—')}</b></div><div class="result-detail"><span>FATHER NAME</span><b>${escapeHtml(fatherNameOf(student)||'—')}</b></div><div class="result-detail"><span>DATE OF BIRTH</span><b>${escapeHtml(displayDob(student.dateOfBirth))}</b></div><div class="result-detail"><span>STUDENT QR ID</span><b>${escapeHtml(student.id)}</b></div><div class="result-detail"><span>DATE</span><b>${escapeHtml(record?.date||localDateKey())}</b></div><div class="result-detail"><span>${status==='Leave'?'RECORD TIME':status==='Absent'?'ATTEMPT TIME':'CHECK-IN TIME'}</span><b>${record?escapeHtml(readableTime(record.timestamp)):'—'}</b></div><div class="result-detail"><span>PUNCTUALITY</span><b>${escapeHtml(punctualityLabel(record?.timestamp,status))}</b></div>${student.email?`<div class="result-detail"><span>EMAIL</span><b>${escapeHtml(student.email)}</b></div>`:''}${student.phone?`<div class="result-detail"><span>PHONE</span><b>${escapeHtml(student.phone)}</b></div>`:''}</div><div class="${bannerClass}">${bannerText}</div></div>`;
  }
  async function prepareScanAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!state.audioContext) state.audioContext = new AudioCtx();
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
    } catch (_) { /* Audio is optional; QR scanning must continue if sound is unavailable. */ }
  }
  function playScanBeep() {
    try {
      const ctx=state.audioContext;
      if(!ctx || ctx.state!=='running') return;
      // Loud, crisp two-tone scanner confirmation. Output is still subject to
      // the device/browser volume setting; keep the gain below clipping level.
      const now=ctx.currentTime;
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type='square';
      osc.frequency.setValueAtTime(1450,now);
      osc.frequency.setValueAtTime(1850,now+0.115);
      gain.gain.setValueAtTime(0.0001,now);
      gain.gain.exponentialRampToValueAtTime(0.78,now+0.008);
      gain.gain.setValueAtTime(0.72,now+0.078);
      gain.gain.setValueAtTime(0.0001,now+0.09);
      gain.gain.setValueAtTime(0.0001,now+0.115);
      gain.gain.exponentialRampToValueAtTime(0.78,now+0.123);
      gain.gain.setValueAtTime(0.72,now+0.205);
      gain.gain.exponentialRampToValueAtTime(0.0001,now+0.255);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now+0.26);
    } catch (_) { /* Ignore audio playback restrictions. */ }
  }
  async function startScanner() {
    await prepareScanAudio();
    if(!window.isSecureContext && location.hostname!=='localhost' && location.hostname!=='127.0.0.1'){
      notify('Camera requires HTTPS or localhost. Open using the local server in README.','error');return;
    }
    if(state.scannerRunning) return;
    // Prefer the full scanner library when the CDN is reachable. If blocked, use
    // the native BarcodeDetector API on supported browsers (recent Chrome/Edge).
    if(!window.Html5Qrcode){ await startNativeScanner(); return; }
    $('reader').innerHTML='';
    state.scanner=new Html5Qrcode('reader',{verbose:false});
    $('start-scan').disabled=true; $('stop-scan').disabled=false;
    try {
      await state.scanner.start({facingMode:'environment'},{fps:10,qrbox:(viewWidth,viewHeight)=>{const size=Math.floor(Math.min(viewWidth,viewHeight)*0.72);return {width:Math.min(280,size),height:Math.min(280,size)};},aspectRatio:1.0,disableFlip:false}, async (decodedText)=>{ if(!state.scannerRunning) return; playScanBeep(); state.scannerRunning=false; try{await state.scanner.stop();}catch(_){} $('start-scan').disabled=false; $('stop-scan').disabled=true; await markAttendance(decodedText); }, ()=>{});
      state.scannerRunning=true;
    } catch(err) {
      state.scannerRunning=false; $('start-scan').disabled=false; $('stop-scan').disabled=true;
      $('reader').innerHTML='<div class="reader-fallback"><div class="qr-placeholder">▦</div><b>Camera could not start</b><span>Check browser camera permission, close other camera apps, and use localhost or HTTPS.</span></div>';
      notify(`Camera error: ${err?.message||err||'Permission denied'}`,'error');
    }
  }
  async function startNativeScanner() {
    if(!('BarcodeDetector' in window)) {
      await showScanMessage('QR scanner library unavailable','QR generation works offline. Camera scanning needs internet for the scanner library or a recent Chrome/Edge browser with native QR detection.',true);
      notify('Scanner library did not load and native QR detection is unavailable in this browser.','error'); return;
    }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notify('This browser cannot access a camera here. Use HTTPS or localhost and a recent browser.','error'); return;
    }
    $('start-scan').disabled=true; $('stop-scan').disabled=false; $('reader').innerHTML='';
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if(!formats.includes('qr_code')) throw new Error('This browser does not support native QR code detection.');
      const detector = new window.BarcodeDetector({formats:['qr_code']});
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      const video=document.createElement('video');
      video.autoplay=true; video.playsInline=true; video.muted=true;
      video.style.width='100%'; video.style.maxHeight='420px'; video.style.objectFit='cover'; video.style.borderRadius='10px';
      $('reader').appendChild(video); video.srcObject=stream;
      state.nativeStream=stream; state.nativeVideo=video; state.nativeScanning=true; state.scannerRunning=true;
      await video.play();
      const scanFrame=async()=>{
        if(!state.nativeScanning) return;
        try {
          if(video.readyState>=2) {
            const codes=await detector.detect(video);
            const value=codes.find(code=>code.rawValue)?.rawValue;
            if(value) {
              playScanBeep();
              state.nativeScanning=false; state.scannerRunning=false;
              if(state.nativeFrameId) cancelAnimationFrame(state.nativeFrameId);
              state.nativeStream?.getTracks().forEach(track=>track.stop()); state.nativeStream=null; state.nativeVideo=null; state.nativeFrameId=null;
              $('start-scan').disabled=false; $('stop-scan').disabled=true;
              await markAttendance(value); return;
            }
          }
        } catch(_) { /* Ignore individual frame decode errors and keep scanning. */ }
        if(state.nativeScanning) state.nativeFrameId=requestAnimationFrame(scanFrame);
      };
      state.nativeFrameId=requestAnimationFrame(scanFrame);
    } catch(err) {
      state.nativeScanning=false; state.scannerRunning=false;
      if(state.nativeStream) state.nativeStream.getTracks().forEach(track=>track.stop());
      state.nativeStream=null; state.nativeVideo=null; state.nativeFrameId=null;
      $('start-scan').disabled=false; $('stop-scan').disabled=true;
      $('reader').innerHTML='<div class="reader-fallback"><div class="qr-placeholder">▦</div><b>Camera could not start</b><span>Allow camera access and use HTTPS or localhost. For older browsers, connect to internet so the scanner library can load.</span></div>';
      notify(`Camera error: ${err?.message||err||'Permission denied'}`,'error');
    }
  }
  async function stopScanner(showMsg=true) {
    state.nativeScanning=false;
    if(state.nativeFrameId) cancelAnimationFrame(state.nativeFrameId);
    if(state.nativeStream) state.nativeStream.getTracks().forEach(track=>track.stop());
    if(state.nativeVideo) { try { state.nativeVideo.pause(); state.nativeVideo.srcObject=null; } catch(_) {} }
    state.nativeStream=null; state.nativeVideo=null; state.nativeFrameId=null;
    if(state.scanner) {
      try { if(state.scanner.isScanning) await state.scanner.stop(); } catch(_) {}
      try { state.scanner.clear(); } catch(_) {}
    }
    state.scanner=null; state.scannerRunning=false;
    if($('start-scan')) $('start-scan').disabled=false;
    if($('stop-scan')) $('stop-scan').disabled=true;
    if($('reader')) $('reader').innerHTML='<div class="reader-fallback"><div class="qr-placeholder">▦</div><b>Camera is stopped</b><span>Press Start camera to scan a student QR code.</span></div>';
    if(showMsg) notify('Camera stopped.');
  }
  async function generateQr(studentId) {
    if(!window.QRCode){notify('Local QR generator is missing. Re-extract the complete Smart Students Attendance System folder, including vendor/qrcode-lite.js, then reload.','error');return;}
    const student=await getStudent(studentId); if(!student){notify('Please select a registered student first.','error');return;}
    const output=$('qr-output'); output.innerHTML='<div class="qr-result-card"><div id="qr-canvas-wrap"></div><h3>'+escapeHtml(student.name)+'</h3><p>'+escapeHtml(student.roll)+' · '+escapeHtml(academicLabel(student))+'</p><div class="qr-id">'+escapeHtml(student.id)+'</div><div class="qr-actions"><button class="btn btn-primary" id="download-qr">Download PNG</button><button class="btn btn-outline" id="print-qr">Print QR</button></div></div>';
    try {
      const canvas=document.createElement('canvas');
      await QRCode.toCanvas(canvas,student.id,{width:230,margin:4,errorCorrectionLevel:'H',color:{dark:'#162d51',light:'#ffffff'}});
      $('qr-canvas-wrap').appendChild(canvas);
      $('download-qr').addEventListener('click',()=>{const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=`Smart-Students-Attendance-${student.roll.replace(/[^a-z0-9_-]/gi,'_')}.png`;document.body.appendChild(a);a.click();a.remove();});
      $('print-qr').addEventListener('click',()=>printQr(canvas,student));
    } catch(err){output.innerHTML='<div class="empty-state"><b>Could not generate QR code</b><p>'+escapeHtml(err.message||'Unknown error')+'</p></div>';}
  }
  function printQr(canvas, student) {
    const win=window.open('','_blank','width=520,height=650');
    if(!win){notify('Allow pop-ups to print the QR code.','error');return;}
    const src=canvas.toDataURL('image/png');
    win.document.write(`<!doctype html><html><head><title>QR — ${escapeHtml(student.name)}</title><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:95vh;text-align:center;color:#172b4d}.card{border:1px solid #ddd;border-radius:18px;padding:28px;width:300px}img{width:230px;height:230px}h2{font-size:20px;margin:15px 0 5px}p{font-size:13px;color:#555;margin:4px}.id{font-size:11px;margin-top:12px;color:#555}@media print{button{display:none}}</style></head><body><div class="card"><img src="${src}" alt="Student QR"><h2>${escapeHtml(student.name)}</h2><p>${escapeHtml(student.roll)}</p><p>${escapeHtml(academicLabel(student))}</p><div class="id">${escapeHtml(student.id)}</div><p><button onclick="window.print()">Print</button></p></div></body></html>`);
    win.document.close();
    win.addEventListener('load', () => setTimeout(() => win.print(), 300), { once: true });
  }
  function csvCell(value) { const s=String(value??''); return '"'+s.replace(/"/g,'""')+'"'; }
  function downloadText(filename,text,mime='text/plain;charset=utf-8') { const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function exportStudentsCsv() {
    const students=await allStudents(); const headers=['Student ID','Name','Father Name','Date of Birth','Roll Number','Department','Class','Email','Phone','Created At'];
    const lines=[headers,...students.map(s=>[s.id,s.name,fatherNameOf(s),s.dateOfBirth||'',s.roll,departmentOf(s),yearClassOf(s),s.email,s.phone,new Date(s.createdAt).toISOString()])].map(row=>row.map(csvCell).join(','));
    downloadText(`smart-students-attendance-students-${localDateKey()}.csv`,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8'); notify('Student CSV exported.');
  }
  async function exportAttendanceCsv() {
    const [records,students]=await Promise.all([allAttendance(),allStudents()]); const byId=new Map(students.map(s=>[s.id,s])); records.sort((a,b)=>a.timestamp-b.timestamp); const headers=['Student ID','Name','Father Name','Date of Birth','Roll Number','Department','Class','Date','Time','Status','Punctuality','Leave Reason'];
    const lines=[headers,...records.map(r=>{const s=byId.get(r.studentId);return [r.studentId,r.name,fatherNameOf(s)||r.fatherName||'',s?.dateOfBirth||r.dateOfBirth||'',r.roll,departmentOf(s)||r.department||r.className,yearClassOf(s)||r.yearClass||'',r.date,r.timestamp?readableTime(r.timestamp):'',r.status||'Present',punctualityLabel(r.timestamp,r.status||'Present'),r.reason||''];})].map(row=>row.map(csvCell).join(','));
    downloadText(`smart-students-attendance-records-${localDateKey()}.csv`,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8'); notify('Attendance CSV exported.');
  }
  async function backupJson() {
    const [students,attendance,leaveRequests]=await Promise.all([allStudents(),allAttendance(),allLeaveRequests()]);
    const backup={app:'SmartAttend',formatVersion:2,exportedAt:new Date().toISOString(),students,attendance,leaveRequests};
    downloadText(`smart-students-attendance-backup-${localDateKey()}.json`,JSON.stringify(backup,null,2),'application/json;charset=utf-8'); notify('Backup downloaded. Store it somewhere safe.');
  }
  async function restoreJson(file) {
    if (!requireAdmin('Only the administrator can restore a backup.')) { $('restore-json-file').value=''; return; }
    if(!file)return;
    if(file.size>30*1024*1024){notify('Backup is too large (maximum 30 MB).','error');return;}
    let data; try{data=JSON.parse(await file.text());}catch(_){notify('This file is not valid JSON.','error');return;}
    if(data?.app!=='SmartAttend'||!Array.isArray(data.students)||!Array.isArray(data.attendance)|| (data.leaveRequests!==undefined&&!Array.isArray(data.leaveRequests))){notify('This backup is not a valid Smart Students Attendance System backup.','error');return;}
    if(!confirm(`Restore ${data.students.length} students and ${data.attendance.length} attendance records? Existing student IDs may be overwritten; conflicting records are skipped. Export a backup of the current data first if needed.`))return;
    try{
      const currentStudents=await allStudents(); const currentAttendance=await allAttendance(); const currentRequests=await allLeaveRequests();
      const existingRolls=new Map(currentStudents.map(s=>[String(s.rollLower||s.roll||'').toLowerCase(),s.id]));
      const cleaned=data.students.map(s=>({...s,rollLower:String(s.rollLower||s.roll||'').toLowerCase()}));
      const backupRolls=new Map();
      for(const s of cleaned){
        const conflict=existingRolls.get(s.rollLower);
        if(conflict&&conflict!==s.id){notify(`Restore stopped: roll number ${s.roll} already belongs to a different student. Export/clear data first, or edit the backup.`,'error');return;}
        const insideBackup=backupRolls.get(s.rollLower);
        if(insideBackup&&insideBackup!==s.id){notify(`Restore stopped: the backup has duplicate roll number ${s.roll}.`,'error');return;}
        backupRolls.set(s.rollLower,s.id);
      }
      const knownPairs=new Set(currentAttendance.map(r=>`${r.studentId}::${r.date}`));
      const attendanceToAdd=[];
      for(const r of data.attendance){const k=`${r.studentId}::${r.date}`;if(knownPairs.has(k))continue;knownPairs.add(k);const clean={...r};delete clean.id;attendanceToAdd.push(clean);}
      const existingRequestIds=new Set(currentRequests.map(r=>r.id));
      const requestsToAdd=(data.leaveRequests||[]).filter(r=>r&&typeof r.id==='string'&&!existingRequestIds.has(r.id));
      const t=state.db.transaction([STORE_STUDENTS,STORE_ATTENDANCE,STORE_LEAVE_REQUESTS],'readwrite');const ss=t.objectStore(STORE_STUDENTS);const aa=t.objectStore(STORE_ATTENDANCE);const lr=t.objectStore(STORE_LEAVE_REQUESTS);
      for(const s of cleaned)ss.put(s);
      for(const r of attendanceToAdd)aa.add(r);
      for(const r of requestsToAdd)lr.put(r);
      await new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error||new Error('Restore failed'));t.onabort=()=>reject(t.error||new Error('Restore was cancelled'));});
      await refreshAll();notify(`Backup restore completed. Added ${cleaned.length} student profiles, ${attendanceToAdd.length} attendance records, and ${requestsToAdd.length} leave requests.`);
    }catch(err){notify(`Restore failed: ${err.message||'storage error'}`,'error');}
    finally{$('restore-json-file').value='';}
  }
  async function resetRestoreJson(file) {
    if (!requireAdmin('Only the administrator can reset and restore the database.')) {
      $('reset-restore-json-file').value = '';
      return;
    }
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Backup is too large (maximum 30 MB).');
      const data = JSON.parse(await file.text());
      if (data?.app !== 'SmartAttend' || !Array.isArray(data.students) || !Array.isArray(data.attendance) || (data.leaveRequests !== undefined && !Array.isArray(data.leaveRequests))) {
        throw new Error('This is not a valid Smart Students Attendance System JSON backup.');
      }
      if (!data.students.every(s => s && typeof s.id === 'string' && s.id && typeof s.name === 'string' && typeof s.roll === 'string')) {
        throw new Error('The backup contains an invalid student record.');
      }
      if (!data.attendance.every(r => r && r.studentId != null && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')))) {
        throw new Error('The backup contains an invalid attendance record.');
      }
      if (!(data.leaveRequests || []).every(r => r && typeof r.id === 'string' && r.id && r.studentId != null && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) && ['Pending','Approved','Rejected'].includes(r.status))) {
        throw new Error('The backup contains an invalid leave request.');
      }

      const studentIds = new Set();
      const rollNumbers = new Set();
      for (const student of data.students) {
        const id = String(student.id);
        const roll = String(student.roll).trim().toLowerCase();
        if (studentIds.has(id)) throw new Error(`Duplicate student ID found in backup: ${id}`);
        if (rollNumbers.has(roll)) throw new Error(`Duplicate roll number found in backup: ${student.roll}`);
        studentIds.add(id);
        rollNumbers.add(roll);
      }
      const attendanceKeys = new Set();
      for (const record of data.attendance) {
        const key = `${record.studentId}::${record.date}`;
        if (attendanceKeys.has(key)) throw new Error(`Duplicate attendance entry found for ${record.date}.`);
        attendanceKeys.add(key);
      }

      const exportedAt = data.exportedAt ? new Date(data.exportedAt) : null;
      const backupDateLabel = exportedAt && !Number.isNaN(exportedAt.getTime())
        ? exportedAt.toLocaleString()
        : 'date not recorded';
      const message = [
        'RESET & RESTORE: This will REPLACE ALL students and attendance records currently saved on this device.',
        '',
        `Incoming backup: ${backupDateLabel}`,
        `Students: ${data.students.length}`,
        `Attendance records: ${data.attendance.length}`,
        '',
        'A safety copy of the current device database will be downloaded automatically first.',
        'Continue only if this selected JSON is the complete backup you want to keep.'
      ].join('\n');
      if (!confirm(message)) return;
      const typedConfirmation = prompt('Final safety check: type REPLACE to replace all current records with this backup.');
      if (typedConfirmation !== 'REPLACE') {
        notify('Reset & restore cancelled. No data was changed.', 'error');
        return;
      }

      // Export the current device data first so an Admin can recover it if the wrong backup was selected.
      const [currentStudents, currentAttendance, currentLeaveRequests] = await Promise.all([allStudents(), allAttendance(), allLeaveRequests()]);
      const safetyBackup = {
        app: 'SmartAttend',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        backupPurpose: 'automatic-safety-copy-before-reset-restore',
        students: currentStudents,
        attendance: currentAttendance,
        leaveRequests: currentLeaveRequests
      };
      downloadText(
        `smart-students-attendance-safety-before-reset-${localDateKey()}.json`,
        JSON.stringify(safetyBackup, null, 2),
        'application/json;charset=utf-8'
      );

      const cleanedStudents = data.students.map(student => ({
        ...student,
        roll: String(student.roll).trim(),
        rollLower: String(student.roll).trim().toLowerCase(),
        nameLower: String(student.nameLower || student.name).trim().toLowerCase()
      }));
      const cleanedAttendance = data.attendance.map(record => {
        const clean = { ...record };
        delete clean.id; // attendance IDs are generated locally by IndexedDB
        return clean;
      });

      const cleanedLeaveRequests = data.leaveRequests || [];
      const incomingStudentIds = new Set(cleanedStudents.map(x => String(x.id)));
      const incomingAttendanceKeys = new Set(cleanedAttendance.map(x => `${x.studentId}::${x.date}`));
      const incomingLeaveIds = new Set(cleanedLeaveRequests.map(x => String(x.id)));
      for (const row of currentStudents) if (!incomingStudentIds.has(String(row.id))) addCloudTombstone({type:'student',id:String(row.id)});
      for (const row of currentAttendance) if (!incomingAttendanceKeys.has(`${row.studentId}::${row.date}`)) addCloudTombstone({type:'attendance',studentId:String(row.studentId),date:String(row.date)});
      for (const row of currentLeaveRequests) if (!incomingLeaveIds.has(String(row.id))) addCloudTombstone({type:'leave',id:String(row.id)});
      const tx = state.db.transaction([STORE_STUDENTS, STORE_ATTENDANCE, STORE_LEAVE_REQUESTS], 'readwrite');
      const studentStore = tx.objectStore(STORE_STUDENTS);
      const attendanceStore = tx.objectStore(STORE_ATTENDANCE);
      const leaveRequestStore = tx.objectStore(STORE_LEAVE_REQUESTS);
      studentStore.clear();
      attendanceStore.clear();
      leaveRequestStore.clear();
      for (const student of cleanedStudents) studentStore.put(student);
      for (const record of cleanedAttendance) attendanceStore.add(record);
      for (const request of cleanedLeaveRequests) leaveRequestStore.put(request);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Reset and restore failed.'));
        tx.onabort = () => reject(tx.error || new Error('Reset and restore was cancelled.'));
      });
      await refreshAll();
      notify(`Reset & restore complete: ${cleanedStudents.length} students, ${cleanedAttendance.length} attendance records, and ${cleanedLeaveRequests.length} leave requests loaded. A safety backup was downloaded.`, 'success');
    } catch (error) {
      notify(`Reset & restore failed: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      $('reset-restore-json-file').value = '';
    }
  }

  async function clearSelectedDay() {
    if (!requireAdmin('Only the administrator can clear attendance records.')) return;
    const date=$('record-date').value||localDateKey(); const matching=(await allAttendance()).filter(r=>r.date===date);
    if(!matching.length){notify('There are no attendance records for that date.','error');return;}
    if(!confirm(`Permanently delete all ${matching.length} attendance records for ${date}? This cannot be undone.`))return;
    try{for(const row of matching)addCloudTombstone({type:'attendance',studentId:String(row.studentId),date:String(row.date)});const store=txStore(STORE_ATTENDANCE,'readwrite');for(const row of matching)store.delete(row.id);await new Promise((resolve,reject)=>{const tx=store.transaction;tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});await refreshAll();notify(`Removed ${matching.length} attendance records for ${date}.`);}catch(err){notify(`Could not clear records: ${err.message}`,'error');}
  }
  function toStudentDb(s) {
    return { id:String(s.id), name:s.name||'', roll:String(s.roll||''), date_of_birth:s.dateOfBirth||null,
      father_name:s.fatherName||null, department:s.department||s.className||null, class_name:s.className||s.department||null,
      year_class:s.yearClass||null, email:s.email||null, phone:s.phone||null, photo:s.photo||null,
      created_at_ms:Number(s.createdAt||Date.now()), updated_at_ms:Number(s.updatedAt||s.createdAt||Date.now()) };
  }
  function fromStudentDb(r) {
    return { id:String(r.id), name:r.name||'', roll:String(r.roll||''), rollLower:String(r.roll||'').toLowerCase(),
      dateOfBirth:r.date_of_birth||'', fatherName:r.father_name||'', department:r.department||r.class_name||'',
      className:r.class_name||r.department||'', yearClass:r.year_class||'', email:r.email||'', phone:r.phone||'', photo:r.photo||null,
      createdAt:Number(r.created_at_ms||Date.parse(r.created_at)||Date.now()), updatedAt:Number(r.updated_at_ms||Date.parse(r.updated_at)||Date.now()) };
  }
  function toAttendanceDb(r) {
    return { student_id:String(r.studentId), name:r.name||null, roll:r.roll||null, class_name:r.className||r.department||null,
      department:r.department||r.className||null, year_class:r.yearClass||null, father_name:r.fatherName||null,
      date:String(r.date), date_of_birth:r.dateOfBirth||null, timestamp_ms:Number(r.timestamp||Date.now()),
      status:r.status||'Present', punctuality:r.punctuality||null, reason:r.reason||null,
      leave_request_id:r.leaveRequestId||null, approved_by:r.approvedBy||null, approved_at_ms:r.approvedAt||null };
  }
  function fromAttendanceDb(r, localMatch) {
    return { ...(localMatch||{}), studentId:String(r.student_id), name:r.name||'', roll:r.roll||'', className:r.class_name||r.department||'',
      department:r.department||r.class_name||'', yearClass:r.year_class||'', fatherName:r.father_name||'', date:String(r.date),
      dateOfBirth:r.date_of_birth||'', timestamp:Number(r.timestamp_ms||Date.now()), status:r.status||'Present',
      punctuality:r.punctuality||'', reason:r.reason||'', leaveRequestId:r.leave_request_id||'', approvedBy:r.approved_by||'', approvedAt:Number(r.approved_at_ms||0) };
  }
  function toLeaveDb(r) {
    return { id:String(r.id), student_id:String(r.studentId), name:r.name||null, roll:r.roll||null, class_name:r.className||r.department||null,
      department:r.department||r.className||null, year_class:r.yearClass||null, father_name:r.fatherName||null, photo:r.photo||null,
      date:String(r.date), date_of_birth:r.dateOfBirth||null, timestamp_ms:Number(r.timestamp||Date.now()), status:r.status||'Pending',
      reason:r.reason||null, decided_at_ms:Number(r.decidedAt||0)||null, decided_by:r.decidedBy||null };
  }
  function fromLeaveDb(r) {
    return { id:String(r.id), studentId:String(r.student_id), name:r.name||'', roll:r.roll||'', className:r.class_name||r.department||'',
      department:r.department||r.class_name||'', yearClass:r.year_class||'', fatherName:r.father_name||'', photo:r.photo||'',
      date:String(r.date), dateOfBirth:r.date_of_birth||'', timestamp:Number(r.timestamp_ms||Date.now()), status:r.status||'Pending',
      reason:r.reason||'', decidedAt:Number(r.decided_at_ms||0), decidedBy:r.decided_by||'' };
  }
  function newestStudent(a,b) { return Number(a?.updatedAt||a?.createdAt||0) >= Number(b?.updatedAt||b?.createdAt||0) ? a : b; }
  function newestAttendance(a,b) { const ta=Number(a?.approvedAt||a?.timestamp||0), tb=Number(b?.approvedAt||b?.timestamp||0); return ta>tb?a:tb>ta?b:b; }
  function newestLeave(a,b) {
    const terminal = x => x?.status === 'Approved' || x?.status === 'Rejected';
    if (terminal(a) && !terminal(b)) return a;
    if (terminal(b) && !terminal(a)) return b;
    return Number(a?.decidedAt||a?.timestamp||0) >= Number(b?.decidedAt||b?.timestamp||0) ? a : b;
  }
  async function putLocalRows(storeName, rows) {
    const tx=state.db.transaction(storeName,'readwrite'), store=tx.objectStore(storeName);
    for (const row of rows) {
      if (storeName===STORE_ATTENDANCE && (row.id===undefined || row.id===null)) store.add(row);
      else store.put(row);
    }
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Local sync write failed'));tx.onabort=()=>reject(tx.error||new Error('Local sync was cancelled'));});
  }
  async function applyCloudTombstones() {
    // Only Admin may propagate deletes to the shared cloud database.
    // The shared student portal is intentionally insert-only for existing records.
    if (!isAdmin()) return;
    const tombstones=readCloudTombstones(); if(!tombstones.length) return;
    const remaining=[];
    for(const item of tombstones) {
      let query;
      if(item.type==='student') query=state.supabase.from('students').delete().eq('id',item.id);
      else if(item.type==='attendance') query=state.supabase.from('attendance').delete().eq('student_id',item.studentId).eq('date',item.date);
      else if(item.type==='leave') query=state.supabase.from('leave_requests').delete().eq('id',item.id);
      else continue;
      const {error}=await query;
      if(error) remaining.push(item);
    }
    localStorage.setItem(TOMBSTONE_KEY,JSON.stringify(remaining));
  }
  async function syncCloudData() {
    if(!state.supabase || !state.authUser || !state.db || !navigator.onLine || state.cloudSyncing) return;
    state.cloudSyncing=true;
    try {
      await applyCloudTombstones();
      const [localStudents,localAttendance,localLeaves]=await Promise.all([allStudents(),allAttendance(),allLeaveRequests()]);
      const [studentsRes,attendanceRes,leavesRes]=await Promise.all([
        state.supabase.from('students').select('*'),
        state.supabase.from('attendance').select('*'),
        state.supabase.from('leave_requests').select('*')
      ]);
      if(studentsRes.error) throw studentsRes.error;
      if(attendanceRes.error) throw attendanceRes.error;
      if(leavesRes.error) throw leavesRes.error;
      const cloudStudents=(studentsRes.data||[]).map(fromStudentDb);
      const cloudAttendance=(attendanceRes.data||[]).map(r=>fromAttendanceDb(r,localAttendance.find(x=>String(x.studentId)===String(r.student_id)&&x.date===r.date)));
      const cloudLeaves=(leavesRes.data||[]).map(fromLeaveDb);
      const studentMap=new Map();
      for(const row of localStudents) studentMap.set(String(row.id),row);
      for(const row of cloudStudents) { const old=studentMap.get(String(row.id)); studentMap.set(String(row.id),old?newestStudent(old,row):row); }
      const attendanceMap=new Map();
      for(const row of localAttendance) attendanceMap.set(`${row.studentId}::${row.date}`,row);
      for(const row of cloudAttendance) { const k=`${row.studentId}::${row.date}`,old=attendanceMap.get(k); attendanceMap.set(k,old?newestAttendance(old,row):row); }
      const leaveMap=new Map();
      for(const row of localLeaves) leaveMap.set(String(row.id),row);
      for(const row of cloudLeaves) { const k=String(row.id),old=leaveMap.get(k); leaveMap.set(k,old?newestLeave(old,row):row); }
      const mergedStudents=[...studentMap.values()], mergedAttendance=[...attendanceMap.values()], mergedLeaves=[...leaveMap.values()];
      const studentsPayload=mergedStudents.map(toStudentDb);
      const attendancePayload=mergedAttendance.map(toAttendanceDb);
      const leavePayload=mergedLeaves.map(toLeaveDb);
      // Admin can insert/update existing cloud records. The shared CS-STUDENTS
      // account must not UPDATE rows (RLS intentionally reserves UPDATE for Admin).
      // For students, ON CONFLICT DO NOTHING safely skips records already in cloud.
      const studentWriteOptions = { onConflict: 'id', ignoreDuplicates: !isAdmin() };
      const attendanceWriteOptions = { onConflict: 'student_id,date', ignoreDuplicates: !isAdmin() };
      const leaveWriteOptions = { onConflict: 'id', ignoreDuplicates: !isAdmin() };
      if(studentsPayload.length){const {error}=await state.supabase.from('students').upsert(studentsPayload,studentWriteOptions);if(error)throw error;}
      if(attendancePayload.length){const {error}=await state.supabase.from('attendance').upsert(attendancePayload,attendanceWriteOptions);if(error)throw error;}
      if(leavePayload.length){const {error}=await state.supabase.from('leave_requests').upsert(leavePayload,leaveWriteOptions);if(error)throw error;}
      await Promise.all([putLocalRows(STORE_STUDENTS,mergedStudents),putLocalRows(STORE_ATTENDANCE,mergedAttendance),putLocalRows(STORE_LEAVE_REQUESTS,mergedLeaves)]);
      state.cloudReady=true;
      state.lastCloudError='';
    } catch(err) {
      console.warn('Cloud sync unavailable; local IndexedDB remains available:',err?.message||err);
      state.cloudReady=false;
      state.lastCloudError=err?.message||String(err);
    } finally { state.cloudSyncing=false; }
  }
  async function refreshAll() {
    await syncCloudData();
    const jobs=[renderDashboard(),renderStudents(),renderRecords(),renderLeave(),populateQrSelect(),populateLeaveSelect(),populateReportStudentSelect(),populateDailyStudentSelect(),populateRecordsStudentPicker()];
    if(isAdmin()) jobs.push(renderLeaveApprovals());
    await Promise.all(jobs);
  }
  function bindEvents() {
    $('login-form').addEventListener('submit', handleLogin);
    $('toggle-password').addEventListener('click', () => {
      const input = $('login-password');
      setPasswordVisibility(input.type === 'password');
      input.focus({ preventScroll: true });
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch (_) {}
    });
    $('logout-btn').addEventListener('click', logout);
    document.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.page)));
    document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
    $('mobile-menu').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
    $('add-student-btn').addEventListener('click',()=>openStudentModal());
    document.querySelectorAll('[data-action="add-student"]').forEach(btn=>btn.addEventListener('click',()=>openStudentModal()));
    $('close-modal').addEventListener('click',closeStudentModal); $('cancel-modal').addEventListener('click',closeStudentModal);
    $('student-modal').addEventListener('click',e=>{if(e.target===$('student-modal'))closeStudentModal();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeStudentModal();});
    $('student-form').addEventListener('submit',saveStudentFromForm);
    $('student-roll').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);});
    $('student-photo').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{state.pendingPhoto=await resizePhoto(file);$('photo-preview').innerHTML=`<img src="${state.pendingPhoto}" alt="Selected photo preview"><span class="person-sub">Selected photo</span>`;$('photo-preview').hidden=false;}catch(err){state.pendingPhoto=null;notify(err.message,'error');e.target.value='';}});
    $('student-search').addEventListener('input',renderStudents);
    $('student-grid').addEventListener('click',async e=>{const btn=e.target.closest('button[data-action]');if(!btn)return;const id=btn.dataset.id;if(btn.dataset.action==='edit-student'){if(!isAdmin()){notify('Student account cannot edit profiles.','error');return;}openStudentModal(await getStudent(id));}if(btn.dataset.action==='delete-student'){if(!isAdmin()){notify('Student account cannot delete profiles.','error');return;}removeStudent(id);}if(btn.dataset.action==='student-qr'){await populateQrSelect(id);await navigate('generator');await populateQrSelect(id);await generateQr(id);}});
    $('record-date').value=localDateKey(); $('record-date').addEventListener('change',renderRecords);
    // Searchable student selectors: type a name/roll, then click an exact result.
    for (const config of studentPickerConfigs) {
      const input=$(config.input), menu=$(config.menu), wrap=$(config.wrap);
      input.addEventListener('focus',()=>renderStudentPickerOptions(config));
      input.addEventListener('click',()=>renderStudentPickerOptions(config));
      input.addEventListener('input',()=>{ $(config.hidden).value=''; renderStudentPickerOptions(config); if(config.hidden==='record-student-filter') renderRecords(); if(config.hidden==='qr-student') $('qr-output').innerHTML='<div class="qr-empty-icon">⌗</div><b>Choose a student</b><p>Select a matching student before generating a QR code.</p>'; });
      input.addEventListener('keydown',e=>{const options=[...menu.querySelectorAll('[data-student-value]')];if(e.key==='Escape'){closeStudentPicker(config);return;}if(e.key==='ArrowDown'&&options.length){e.preventDefault();options[0].focus();}if(e.key==='Enter'&&!menu.hidden&&options.length){e.preventDefault();options[0].click();}});
      menu.addEventListener('click',e=>{const option=e.target.closest('[data-student-value]');if(option)chooseStudentPicker(config,option.dataset.studentValue);});
      menu.addEventListener('keydown',e=>{if(e.key==='Escape'){closeStudentPicker(config);input.focus();}});
    }
    document.addEventListener('click',e=>{for(const config of studentPickerConfigs){if(!e.target.closest(`#${config.wrap}`))closeStudentPicker(config);}});

    const today=localDateKey(), todayParts=today.split('-'); $('range-report-from').value=`${todayParts[0]}-${todayParts[1]}-01`; $('range-report-to').value=today; $('daily-report-date').value=today; $('student-dob').max=today;
    $('range-this-month').addEventListener('click',()=>{const current=localDateKey(),parts=current.split('-');$('range-report-from').value=`${parts[0]}-${parts[1]}-01`;$('range-report-to').value=current;generateRangeReport();});
    $('range-this-year').addEventListener('click',()=>{const current=localDateKey();$('range-report-from').value=`${current.slice(0,4)}-01-01`;$('range-report-to').value=current;generateRangeReport();});
    $('generate-range-report').addEventListener('click',generateRangeReport);
    $('range-export-excel').addEventListener('click',()=>reportCsv(state.rangeReportRows,'attendance-date-range-report'));
    $('range-export-pdf').addEventListener('click',()=>printReportAsPdf('Attendance Report',`${$('range-report-from').value} to ${$('range-report-to').value}`,state.rangeReportRows));
    $('generate-daily-report').addEventListener('click',generateDailyReport);
    $('daily-export-excel').addEventListener('click',()=>reportCsv(state.dailyReportRows,'daily-attendance-report'));
    $('daily-export-pdf').addEventListener('click',()=>printReportAsPdf('Daily Attendance Report',$('daily-report-date').value,state.dailyReportRows));
    $('leave-date').value=localDateKey(); $('leave-date').addEventListener('change',renderLeave); $('leave-student-search').addEventListener('focus',showLeaveStudentOptions); $('leave-student-search').addEventListener('click',showLeaveStudentOptions); $('leave-student-search').addEventListener('input',()=>{ $('leave-student').value=''; showLeaveStudentOptions(); }); $('leave-student-search').addEventListener('keydown',e=>{ const opts=[...$('leave-student-options').querySelectorAll('[data-student-id]')]; if(e.key==='Escape'){closeLeaveStudentOptions();return;} if(e.key==='ArrowDown' && opts.length){e.preventDefault();opts[0].focus();} if(e.key==='Enter' && !$('leave-student-options').hidden && opts.length){e.preventDefault();chooseLeaveStudent(opts[0].dataset.studentId);} }); $('leave-student-options').addEventListener('click',e=>{const option=e.target.closest('[data-student-id]');if(option)chooseLeaveStudent(option.dataset.studentId);}); $('leave-student-options').addEventListener('keydown',e=>{if(e.key==='Escape'){closeLeaveStudentOptions();$('leave-student-search').focus();}}); document.addEventListener('click',e=>{if(!e.target.closest('#leave-student-combo'))closeLeaveStudentOptions();}); $('leave-form').addEventListener('submit',submitLeave); $('leave-approvals-body').addEventListener('click',e=>{const btn=e.target.closest('button[data-action]');if(!btn)return;if(btn.dataset.action==='approve-leave-request')approveLeaveRequest(btn.dataset.id);if(btn.dataset.action==='reject-leave-request')rejectLeaveRequest(btn.dataset.id);}); $('leave-body').addEventListener('click',e=>{const btn=e.target.closest('[data-action=\"cancel-leave\"]');if(btn)cancelLeave(btn.dataset.id);});
    $('start-scan').addEventListener('click',startScanner); $('stop-scan').addEventListener('click',()=>stopScanner());
    $('manual-submit').addEventListener('click',async()=>{await prepareScanAudio();const val=$('manual-qr').value.trim();if(!val){notify('Enter a student QR ID first.','error');return;}await markAttendance(val);$('manual-qr').value='';});
    $('manual-qr').addEventListener('keydown',e=>{if(e.key==='Enter')$('manual-submit').click();});
    $('generate-qr').addEventListener('click',()=>generateQr($('qr-student').value));
    $('export-students').addEventListener('click',exportStudentsCsv); $('export-records').addEventListener('click',exportAttendanceCsv); $('backup-json').addEventListener('click',backupJson);
    $('restore-json-btn').addEventListener('click',()=>$('restore-json-file').click()); $('restore-json-file').addEventListener('change',e=>restoreJson(e.target.files[0])); $('reset-restore-json-btn').addEventListener('click',()=>{if(requireAdmin('Only the administrator can reset and restore the database.'))$('reset-restore-json-file').click();}); $('reset-restore-json-file').addEventListener('change',e=>resetRestoreJson(e.target.files[0]));
    $('clear-day').addEventListener('click',clearSelectedDay);
    $('qr-student').addEventListener('change',()=>{ $('qr-output').innerHTML='<div class="qr-empty-icon">⌗</div><b>Your QR code will appear here</b><p>Press Generate QR code to create the selected student\'s code.</p>'; });
  }
  async function boot() {
    $('header-date').textContent=readableDate();
    $('student-dob').max=localDateKey();
    bindEvents();
    window.addEventListener('online', () => { if (!state.currentRole) return; if (state.offlineMode && !state.authUser) { notify('Internet is back. Log out and sign in online again to securely sync pending changes.', 'info'); return; } refreshAll().catch(err => console.warn('Online sync failed', err)); });
    window.setInterval(() => { if (state.currentRole && navigator.onLine) refreshAll().catch(err => console.warn('Periodic sync failed', err)); }, 45000);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Offline app setup failed', err));
    $('login-screen').hidden=false;
    document.body.classList.remove('authenticated');
    $('login-username').focus();
  }
  document.addEventListener('DOMContentLoaded',boot);
})();