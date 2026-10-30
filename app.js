(() => {
  'use strict';
  const DB_NAME = 'SmartAttendDB';
  const DB_VERSION = 1;
  const STORE_STUDENTS = 'students';
  const STORE_ATTENDANCE = 'attendance';
  const $ = (id) => document.getElementById(id);
  const state = { db: null, currentRole: null, scanner: null, scannerRunning: false, nativeScanning: false, nativeStream: null, nativeVideo: null, nativeFrameId: null, toastTimer: null, pendingPhoto: null, photoPreviewUrl: null };
  const PAGE_TITLES = { dashboard: 'Dashboard', students: 'Students', scan: 'Scan attendance', records: 'Attendance records', leave: 'Leave management', generator: 'QR generator' };

  function isAdmin() { return state.currentRole === 'admin'; }
  function requireAdmin(message = 'This action is only available to the administrator.') {
    if (isAdmin()) return true;
    notify(message, 'error');
    return false;
  }
  function applyRoleUI() {
    const admin = isAdmin();
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

  async function handleLogin(event) {
    event.preventDefault();
    const username = $('login-username').value.trim().toUpperCase();
    const password = $('login-password').value;
    let role = null;
    if (username === 'ADMIN' && password === 'SSC-TEACHER') role = 'admin';
    if (username === 'CS-STUDENTS' && password === '1122') role = 'student';
    if (!role) {
      $('login-error').textContent = 'Incorrect username or password. Please try again.';
      $('login-error').hidden = false;
      $('login-password').value = '';
      setPasswordVisibility(false);
      $('login-password').focus();
      return;
    }
    $('login-error').hidden = true;
    state.currentRole = role;
    document.body.classList.add('authenticated');
    $('login-screen').hidden = true;
    applyRoleUI();
    try {
      if (!state.db) state.db = await openDatabase();
      await refreshAll();
      await navigate('dashboard');
    } catch (err) {
      document.body.classList.remove('authenticated');
      $('login-screen').hidden = false;
      try { state.db?.close(); } catch (_) {}
      state.db = null;
      state.currentRole = null;
      $('login-error').textContent = `Could not open the local database: ${err.message || 'Unknown error'}`;
      $('login-error').hidden = false;
    }
  }
  async function logout() {
    if (state.scannerRunning) await stopScanner(false);
    closeStudentModal();
    state.currentRole = null;
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
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function readableDate(value = new Date()) { return new Intl.DateTimeFormat(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' }).format(value instanceof Date ? value : new Date(value)); }
  function readableTime(value) { return new Intl.DateTimeFormat(undefined, { hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date(value)); }
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
  async function getStudent(id) { return requestPromise(txStore(STORE_STUDENTS).get(id)); }
  async function saveStudent(student) { return requestPromise(txStore(STORE_STUDENTS,'readwrite').put(student)); }
  async function deleteStudent(id) { return requestPromise(txStore(STORE_STUDENTS,'readwrite').delete(id)); }
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
  }
  function avatarMarkup(student) { return student.photo ? `<img src="${student.photo}" alt="${escapeHtml(student.name)}">` : escapeHtml(initials(student.name)); }

  function statusMarkup(status='Present') {
    const normalized = status === 'Leave' ? 'Leave' : 'Present';
    return `<span class="status-pill${normalized==='Leave'?' status-leave':''}">${normalized==='Leave'?'On Leave':'Present'}</span>`;
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
    $('stat-absent').textContent = Math.max(0, students.length - new Set(todays.map(row=>row.studentId)).size);
    $('recent-body').innerHTML = todays.slice(0,8).map(row=>`<tr><td>${personCell(row)}</td><td>${escapeHtml(row.roll)}</td><td>${escapeHtml(readableTime(row.timestamp))}</td><td>${statusMarkup(row.status)}</td></tr>`).join('');
    setEmpty('recent-empty', todays.length===0);
  }
  async function renderStudents() {
    const [students, attendance] = await Promise.all([allStudents(),allAttendance()]);
    const query = $('student-search').value.trim().toLowerCase();
    const today = localDateKey();
    const todaysByStudent = new Map(attendance.filter(r=>r.date===today).map(r=>[r.studentId,r]));
    const filtered = students.filter(s=>[s.name,s.roll,s.className,s.email,s.phone].some(v=>String(v||'').toLowerCase().includes(query))).sort((a,b)=>a.name.localeCompare(b.name));
    $('student-grid').innerHTML = filtered.map(s=>{const rec=todaysByStudent.get(s.id);const status=rec?statusMarkup(rec.status):'Not marked';const adminActions=isAdmin()?`<button class="btn btn-outline btn-small" data-action="edit-student" data-id="${escapeHtml(s.id)}">Edit</button><button class="btn btn-danger-outline btn-small" data-action="delete-student" data-id="${escapeHtml(s.id)}">Delete</button>`:'';return `<article class="student-card"><div class="student-card-top"><div class="avatar">${avatarMarkup(s)}</div><div><div class="person-name">${escapeHtml(s.name)}</div><div class="person-sub">${escapeHtml(s.roll)}</div></div></div><div class="student-card-body"><div class="detail-line"><span>Class</span><span>${escapeHtml(s.className)}</span></div><div class="detail-line"><span>Email</span><span>${escapeHtml(s.email||'—')}</span></div><div class="detail-line"><span>Phone</span><span>${escapeHtml(s.phone||'—')}</span></div><div class="detail-line"><span>Today's status</span><span>${status}</span></div></div><div class="student-card-actions">${adminActions}<button class="btn btn-outline btn-small" data-action="student-qr" data-id="${escapeHtml(s.id)}">Make QR</button></div></article>`;}).join('');
    setEmpty('students-empty', filtered.length===0);
    if (students.length && !filtered.length) { $('students-empty').querySelector('b').textContent='No matching students'; $('students-empty').querySelector('p').textContent='Try another search term.'; $('students-empty').querySelector('[data-action="add-student"]').hidden=true; }
    else { $('students-empty').querySelector('b').textContent='No students registered'; $('students-empty').querySelector('p').textContent='Add your first student to get started.'; $('students-empty').querySelector('[data-action="add-student"]').hidden=false; }
  }
  async function renderRecords() {
    const [attendance, students] = await Promise.all([allAttendance(), allStudents()]);
    const selectedDate = $('record-date').value || localDateKey();
    const q = $('record-search').value.trim().toLowerCase();
    const byId = new Map(students.map(s=>[s.id,s]));
    const filtered = attendance.filter(r=>r.date===selectedDate && [r.name,r.roll,r.className].some(v=>String(v||'').toLowerCase().includes(q))).sort((a,b)=>b.timestamp-a.timestamp);
    $('records-body').innerHTML = filtered.map(r=>{
      const current = byId.get(r.studentId); const showRow = {...r, photo: current?.photo || ''};
      return `<tr><td>${personCell(showRow)}</td><td>${escapeHtml(r.roll)}</td><td>${escapeHtml(r.className)}</td><td>${escapeHtml(r.date)}</td><td>${escapeHtml(readableTime(r.timestamp))}</td><td>${statusMarkup(r.status)}${r.reason?`<small class="record-reason">${escapeHtml(r.reason)}</small>`:''}</td></tr>`;
    }).join('');
    setEmpty('records-empty', filtered.length===0);
  }
  async function populateLeaveSelect(preselect='') {
    const students=(await allStudents()).sort((a,b)=>a.name.localeCompare(b.name));
    $('leave-student').innerHTML='<option value="">Choose a student…</option>'+students.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.roll)}</option>`).join('');
    if(preselect && students.some(s=>s.id===preselect)) $('leave-student').value=preselect;
    $('leave-student').disabled=students.length===0;
  }
  async function renderLeave() {
    const [attendance, students] = await Promise.all([allAttendance(), allStudents()]);
    const selectedDate=$('leave-date').value || localDateKey();
    const byId=new Map(students.map(s=>[s.id,s]));
    const rows=attendance.filter(r=>r.date===selectedDate && r.status==='Leave').sort((a,b)=>b.timestamp-a.timestamp);
    $('leave-body').innerHTML=rows.map(r=>{const student=byId.get(r.studentId);const show={...r,photo:student?.photo||''};const action=isAdmin()?`<td><button class="btn btn-danger-outline btn-small" data-action="cancel-leave" data-id="${escapeHtml(r.id)}">Cancel leave</button></td>`:'';return `<tr><td>${personCell(show)}</td><td>${escapeHtml(r.className)}</td><td>${escapeHtml(r.reason||'—')}</td><td>${escapeHtml(readableTime(r.timestamp))}</td>${action}</tr>`;}).join('');
    setEmpty('leave-empty', rows.length===0);
  }
  async function submitLeave(event) {
    event.preventDefault();
    const studentId=$('leave-student').value;
    const date=$('leave-date').value;
    const reason=$('leave-reason').value.trim();
    if(!studentId || !date || !reason){notify('Choose a student, leave date, and reason.','error');return;}
    const student=await getStudent(studentId);
    if(!student){notify('Student not found. Refresh the page and try again.','error');return;}
    const existing=(await allAttendance()).find(r=>r.studentId===student.id && r.date===date);
    if(existing && !isAdmin()) { notify(`${student.name} already has a record for ${date}. Student accounts can add leave only when no record exists; ask the administrator to change an existing record.`, 'error'); return; }
    if(existing?.status==='Leave'){
      notify(`${student.name} already has leave recorded for ${date}.`,'error');
      return;
    }
    if(existing && !confirm(`${student.name} is currently marked Present on ${date}. Replace that status with On Leave?`)) return;
    const record={...(existing||{}),studentId:student.id,name:student.name,roll:student.roll,className:student.className,date,timestamp:Date.now(),status:'Leave',reason};
    try { await requestPromise(txStore(STORE_ATTENDANCE,'readwrite')[existing?'put':'add'](record)); $('leave-reason').value=''; await refreshAll(); $('leave-date').value=date; await renderLeave(); notify(`${student.name} marked on leave for ${date}.`,'success'); }
    catch(err){if(err.name==='ConstraintError')notify('Attendance or leave is already recorded for this student and date.','error');else notify(`Could not save leave: ${err.message||'database error'}`,'error');}
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
    const students=(await allStudents()).sort((a,b)=>a.name.localeCompare(b.name));
    $('qr-student').innerHTML='<option value="">Choose a student…</option>'+students.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.roll)}</option>`).join('');
    if(preselect && students.some(s=>s.id===preselect)) $('qr-student').value=preselect;
  }
  function openStudentModal(student=null) {
    if (!state.currentRole) return;
    if (student && !isAdmin()) { notify('Student account can add and view profiles, but cannot edit them.', 'error'); return; }
    $('student-form').reset(); $('edit-id').value=student?.id||''; state.pendingPhoto=null;
    $('modal-title').textContent=student?'Edit student':'Add student'; $('save-student').textContent=student?'Save changes':'Save student'; $('photo-preview').hidden=true; $('photo-preview').innerHTML='';
    $('student-name').value=student?.name||''; $('student-roll').value=student?.roll||''; $('student-class').value=student?.className||''; $('student-email').value=student?.email||''; $('student-phone').value=student?.phone||'';
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
    const id=$('edit-id').value || randomId();
    const name=$('student-name').value.trim(), roll=$('student-roll').value.trim(), className=$('student-class').value.trim();
    if(!name||!roll||!className){notify('Please complete all required fields.','error');return;}
    if(!/^\d{4}$/.test(roll)){notify('Roll number must be exactly 4 digits (numbers only).','error');$('student-roll').focus();return;}
    if(!['Computer Science','Pre-Engineering','Pre-Medical'].includes(className)){notify('Please select Computer Science, Pre-Engineering, or Pre-Medical.','error');$('student-class').focus();return;}
    const current=await getStudent(id); const rollLower=roll.toLocaleLowerCase();
    const students=await allStudents();
    if(students.some(s=>s.id!==id && s.rollLower===rollLower)){notify('That roll number is already assigned to another student.','error');$('student-roll').focus();return;}
    let photo=current?.photo||null;
    const file=$('student-photo').files[0];
    try { if(file) photo=await resizePhoto(file); } catch(err) { notify(err.message||'Could not process the photo.','error');return; }
    const student={id,name,roll,rollLower,className,email:$('student-email').value.trim(),phone:$('student-phone').value.trim(),photo,createdAt:current?.createdAt||Date.now(),updatedAt:Date.now()};
    try { await saveStudent(student); closeStudentModal(); await refreshAll(); notify(current?'Student profile updated.':'Student added successfully.'); }
    catch(err) { if(err.name==='QuotaExceededError') notify('Browser storage is full. Export a backup or remove large photos.','error'); else notify(`Could not save student: ${err.message||'database error'}`,'error'); }
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
    const record={studentId:student.id,name:student.name,roll:student.roll,className:student.className,date,timestamp:now,status:'Present'};
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
    const bannerClass=status==='Leave'?'leave-banner':duplicate?'duplicate-banner':'success-banner';
    const bannerText=status==='Leave'?`✓ ON LEAVE${record?.reason?' — '+escapeHtml(record.reason):''}`:duplicate?'✓ Already marked PRESENT today':'✓ PRESENT — Attendance saved';
    $('scan-result').innerHTML=`<div class="scan-person"><div class="scan-person-photo">${photo}</div><h3>${escapeHtml(student.name)}</h3><div class="roll-line">Roll number: <b>${escapeHtml(student.roll)}</b></div><div class="result-details"><div class="result-detail"><span>CLASS / DEPARTMENT</span><b>${escapeHtml(student.className)}</b></div><div class="result-detail"><span>STUDENT QR ID</span><b>${escapeHtml(student.id)}</b></div><div class="result-detail"><span>DATE</span><b>${escapeHtml(record?.date||localDateKey())}</b></div><div class="result-detail"><span>${status==='Leave'?'RECORD TIME':'CHECK-IN TIME'}</span><b>${record?escapeHtml(readableTime(record.timestamp)):'—'}</b></div>${student.email?`<div class="result-detail"><span>EMAIL</span><b>${escapeHtml(student.email)}</b></div>`:''}${student.phone?`<div class="result-detail"><span>PHONE</span><b>${escapeHtml(student.phone)}</b></div>`:''}</div><div class="${bannerClass}">${bannerText}</div></div>`;
  }
  async function startScanner() {
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
      await state.scanner.start({facingMode:'environment'},{fps:10,qrbox:(viewWidth,viewHeight)=>{const size=Math.floor(Math.min(viewWidth,viewHeight)*0.72);return {width:Math.min(280,size),height:Math.min(280,size)};},aspectRatio:1.0,disableFlip:false}, async (decodedText)=>{ if(!state.scannerRunning) return; state.scannerRunning=false; try{await state.scanner.stop();}catch(_){} $('start-scan').disabled=false; $('stop-scan').disabled=true; await markAttendance(decodedText); }, ()=>{});
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
    const output=$('qr-output'); output.innerHTML='<div class="qr-result-card"><div id="qr-canvas-wrap"></div><h3>'+escapeHtml(student.name)+'</h3><p>'+escapeHtml(student.roll)+' · '+escapeHtml(student.className)+'</p><div class="qr-id">'+escapeHtml(student.id)+'</div><div class="qr-actions"><button class="btn btn-primary" id="download-qr">Download PNG</button><button class="btn btn-outline" id="print-qr">Print QR</button></div></div>';
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
    win.document.write(`<!doctype html><html><head><title>QR — ${escapeHtml(student.name)}</title><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:95vh;text-align:center;color:#172b4d}.card{border:1px solid #ddd;border-radius:18px;padding:28px;width:300px}img{width:230px;height:230px}h2{font-size:20px;margin:15px 0 5px}p{font-size:13px;color:#555;margin:4px}.id{font-size:11px;margin-top:12px;color:#555}@media print{button{display:none}}</style></head><body><div class="card"><img src="${src}" alt="Student QR"><h2>${escapeHtml(student.name)}</h2><p>${escapeHtml(student.roll)}</p><p>${escapeHtml(student.className)}</p><div class="id">${escapeHtml(student.id)}</div><p><button onclick="window.print()">Print</button></p></div></body></html>`);
    win.document.close();
    win.addEventListener('load', () => setTimeout(() => win.print(), 300), { once: true });
  }
  function csvCell(value) { const s=String(value??''); return '"'+s.replace(/"/g,'""')+'"'; }
  function downloadText(filename,text,mime='text/plain;charset=utf-8') { const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function exportStudentsCsv() {
    const students=await allStudents(); const headers=['Student ID','Name','Roll Number','Class','Email','Phone','Created At'];
    const lines=[headers,...students.map(s=>[s.id,s.name,s.roll,s.className,s.email,s.phone,new Date(s.createdAt).toISOString()])].map(row=>row.map(csvCell).join(','));
    downloadText(`smart-students-attendance-students-${localDateKey()}.csv`,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8'); notify('Student CSV exported.');
  }
  async function exportAttendanceCsv() {
    const records=(await allAttendance()).sort((a,b)=>a.timestamp-b.timestamp); const headers=['Student ID','Name','Roll Number','Class','Date','Time','Status','Leave Reason'];
    const lines=[headers,...records.map(r=>[r.studentId,r.name,r.roll,r.className,r.date,readableTime(r.timestamp),r.status||'Present',r.reason||''])].map(row=>row.map(csvCell).join(','));
    downloadText(`smart-students-attendance-records-${localDateKey()}.csv`,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8'); notify('Attendance CSV exported.');
  }
  async function backupJson() {
    const [students,attendance]=await Promise.all([allStudents(),allAttendance()]);
    const backup={app:'SmartAttend',formatVersion:1,exportedAt:new Date().toISOString(),students,attendance};
    downloadText(`smart-students-attendance-backup-${localDateKey()}.json`,JSON.stringify(backup,null,2),'application/json;charset=utf-8'); notify('Backup downloaded. Store it somewhere safe.');
  }
  async function restoreJson(file) {
    if (!requireAdmin('Only the administrator can restore a backup.')) { $('restore-json-file').value=''; return; }
    if(!file)return;
    if(file.size>30*1024*1024){notify('Backup is too large (maximum 30 MB).','error');return;}
    let data; try{data=JSON.parse(await file.text());}catch(_){notify('This file is not valid JSON.','error');return;}
    if(data?.app!=='SmartAttend'||!Array.isArray(data.students)||!Array.isArray(data.attendance)){notify('This backup is not a valid Smart Students Attendance System backup.','error');return;}
    if(!confirm(`Restore ${data.students.length} students and ${data.attendance.length} attendance records? Existing student IDs may be overwritten; conflicting records are skipped. Export a backup of the current data first if needed.`))return;
    try{
      const currentStudents=await allStudents(); const currentAttendance=await allAttendance();
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
      const t=state.db.transaction([STORE_STUDENTS,STORE_ATTENDANCE],'readwrite');const ss=t.objectStore(STORE_STUDENTS);const aa=t.objectStore(STORE_ATTENDANCE);
      for(const s of cleaned)ss.put(s);
      for(const r of attendanceToAdd)aa.add(r);
      await new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error||new Error('Restore failed'));t.onabort=()=>reject(t.error||new Error('Restore was cancelled'));});
      await refreshAll();notify(`Backup restore completed. Added ${cleaned.length} student profiles and ${attendanceToAdd.length} new attendance records.`);
    }catch(err){notify(`Restore failed: ${err.message||'storage error'}`,'error');}
    finally{$('restore-json-file').value='';}
  }
  async function clearSelectedDay() {
    if (!requireAdmin('Only the administrator can clear attendance records.')) return;
    const date=$('record-date').value||localDateKey(); const matching=(await allAttendance()).filter(r=>r.date===date);
    if(!matching.length){notify('There are no attendance records for that date.','error');return;}
    if(!confirm(`Permanently delete all ${matching.length} attendance records for ${date}? This cannot be undone.`))return;
    try{const store=txStore(STORE_ATTENDANCE,'readwrite');for(const row of matching)store.delete(row.id);await new Promise((resolve,reject)=>{const tx=store.transaction;tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});await refreshAll();notify(`Removed ${matching.length} attendance records for ${date}.`);}catch(err){notify(`Could not clear records: ${err.message}`,'error');}
  }
  async function refreshAll() { await Promise.all([renderDashboard(),renderStudents(),renderRecords(),renderLeave(),populateQrSelect(),populateLeaveSelect()]); }
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
    $('record-date').value=localDateKey(); $('record-date').addEventListener('change',renderRecords); $('record-search').addEventListener('input',renderRecords);
    $('leave-date').value=localDateKey(); $('leave-date').addEventListener('change',renderLeave); $('leave-form').addEventListener('submit',submitLeave); $('leave-body').addEventListener('click',e=>{const btn=e.target.closest('[data-action=\"cancel-leave\"]');if(btn)cancelLeave(btn.dataset.id);});
    $('start-scan').addEventListener('click',startScanner); $('stop-scan').addEventListener('click',()=>stopScanner());
    $('manual-submit').addEventListener('click',async()=>{const val=$('manual-qr').value.trim();if(!val){notify('Enter a student QR ID first.','error');return;}await markAttendance(val);$('manual-qr').value='';});
    $('manual-qr').addEventListener('keydown',e=>{if(e.key==='Enter')$('manual-submit').click();});
    $('generate-qr').addEventListener('click',()=>generateQr($('qr-student').value));
    $('export-students').addEventListener('click',exportStudentsCsv); $('export-records').addEventListener('click',exportAttendanceCsv); $('backup-json').addEventListener('click',backupJson);
    $('restore-json-btn').addEventListener('click',()=>$('restore-json-file').click()); $('restore-json-file').addEventListener('change',e=>restoreJson(e.target.files[0]));
    $('clear-day').addEventListener('click',clearSelectedDay);
    $('qr-student').addEventListener('change',()=>{ $('qr-output').innerHTML='<div class="qr-empty-icon">⌗</div><b>Your QR code will appear here</b><p>Press Generate QR code to create the selected student\'s code.</p>'; });
  }
  async function boot() {
    $('header-date').textContent=readableDate();
    bindEvents();
    $('login-screen').hidden=false;
    document.body.classList.remove('authenticated');
    $('login-username').focus();
  }
  document.addEventListener('DOMContentLoaded',boot);
})();