/* ═══════════════════════════════════════════════════════════════════════
   features.js  –  MediGuard AI: Teleconsultation + Live Pharmacy Inventory
   Append the contents of this file to the end of your existing script.js
   ═══════════════════════════════════════════════════════════════════════ */
const API = "http://127.0.0.1:5001";

/* ══════════════════════════════════════════════════════════════════════
   TELECONSULTATION
══════════════════════════════════════════════════════════════════════ */

let _teleTab = 'book';
let _allDoctors = [];

function switchTeleTab(tab) {
    _teleTab = tab;
    document.querySelectorAll('[id^="teleTab-"]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="telePanel-"]').forEach(p => p.style.display = 'none');
    const btn = document.getElementById(`teleTab-${tab}`);
    const panel = document.getElementById(`telePanel-${tab}`);
    if (btn) btn.classList.add('active');
    if (panel) panel.style.display = 'block';

    if (tab === 'doctors')  loadDoctors();
    if (tab === 'sessions') loadConsultations();
    if (tab === 'join')     loadUpcomingMeetings();
    if (tab === 'book')     loadDoctorPicker();
    loadTeleStats();
}

// ── Load telemedicine stats ────────────────────────────────────────────────
async function loadTeleStats() {
    try {
        const r = await fetch(`${API}/api/consultations/stats`);
        const d = await r.json();
        if (d.stats) {
            document.getElementById('statTotalCon').textContent = d.stats.total || 0;
            document.getElementById('statCompCon').textContent  = d.stats.completed || 0;
            document.getElementById('statSchedCon').textContent = d.stats.scheduled || 0;
            document.getElementById('statAvgDur').textContent   = d.stats.avg_duration ? d.stats.avg_duration + ' min' : '—';
        }
    } catch(e) {}
}

// ── Load doctors for picker grid ──────────────────────────────────────────
async function loadDoctorPicker() {
    try {
        const r = await fetch(`${API}/api/doctors`);
        const d = await r.json();
        _allDoctors = d.doctors || [];
        renderDoctorPicker(_allDoctors);
    } catch(e) {
        document.getElementById('teleDocPicker').innerHTML =
            '<div style="color:#ef4444;font-size:0.875rem;">Could not load doctors.</div>';
    }
}

function renderDoctorPicker(doctors) {
    const el = document.getElementById('teleDocPicker');
    if (!doctors.length) {
        el.innerHTML = '<div style="color:#94a3b8;font-size:0.875rem;">No doctors available.</div>';
        return;
    }
    el.innerHTML = doctors.map(doc => `
        <div class="doc-picker-card ${doc.status === 'offline' ? 'opacity-50' : ''}"
             id="docPick-${doc.id}"
             onclick="selectDoctor(${doc.id},'${doc.name.replace(/'/g,"\\'")}','${doc.specialty}')"
             style="cursor:pointer;display:flex;align-items:center;gap:0.75rem;padding:0.7rem 1rem;border:2px solid #e2e8f0;border-radius:0.75rem;margin-bottom:0.5rem;transition:all 0.2s;background:white;">
          <div style="min-width:44px;height:44px;border-radius:50%;background:${doc.avatar_color || '#3b82f6'};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:0.875rem;">${doc.avatar_initials || 'DR'}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.9rem;">${doc.name}</div>
            <div style="font-size:0.78rem;color:#64748b;">${doc.specialty} • ${doc.experience_yrs} yrs • ₹${doc.consult_fee}</div>
          </div>
          <div>
            <span class="badge ${doc.status === 'available' ? 'badge-ok' : doc.status === 'busy' ? 'badge-warning' : 'badge-danger'}"
                  style="font-size:0.7rem;">${doc.status}</span>
            <div style="font-size:0.75rem;color:#f59e0b;margin-top:0.2rem;text-align:right;">⭐ ${doc.rating}</div>
          </div>
        </div>`
    ).join('');
}

function selectDoctor(id, name, specialty) {
    document.querySelectorAll('.doc-picker-card').forEach(el => {
        el.style.borderColor = '#e2e8f0';
        el.style.background  = 'white';
    });
    const card = document.getElementById(`docPick-${id}`);
    if (card) {
        card.style.borderColor = '#2563eb';
        card.style.background  = '#eff6ff';
    }
    document.getElementById('teleSelectedDoctorId').value   = id;
    document.getElementById('teleSelectedDoctorName').value = name;
    // Auto-fill specialty
    const specSel = document.getElementById('teleSpecialty');
    for (let opt of specSel.options) {
        if (opt.value === specialty) { specSel.value = specialty; break; }
    }
    showToast(`Selected: ${name}`);
}

// ── Book Consultation via Zoom ────────────────────────────────────────────
async function bookZoomConsultation() {
    const patName   = document.getElementById('telePatName').value.trim();
    const patPhone  = document.getElementById('telePhone')?.value.trim() || '';
    const doctorId  = document.getElementById('teleSelectedDoctorId').value;
    const doctorName= document.getElementById('teleSelectedDoctorName').value || 'MediGuard Doctor';
    const specialty = document.getElementById('teleSpecialty').value;
    const date      = document.getElementById('teleDate').value;
    const slot      = document.getElementById('teleSlot').value;
    const symptoms  = document.getElementById('teleSymptoms').value.trim();
    const mode      = document.querySelector('input[name="teleMode"]:checked')?.value || 'video';

    if (!patName) { showToast('Please enter patient name', 'error'); return; }
    if (!date)    { showToast('Please select a date', 'error'); return; }

    const scheduledAt = `${date}T${slot}:00`;
    const btn = document.getElementById('bookTeleBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating Zoom Meeting...';

    try {
        const res = await fetch(`${API}/api/consultations`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                patient_name:  patName,
                patient_phone: patPhone,
                doctor_id:     doctorId || null,
                doctor_name:   doctorName,
                specialty,
                scheduled_at:  scheduledAt,
                duration_minutes: 30,
                mode,
                notes: symptoms
            })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Booking failed');

        // Show confirmation card
        const card = document.getElementById('teleConfirmCard');
        const body = document.getElementById('teleConfirmBody');
        const isDemoMode = data.demo_mode;

        body.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:0.75rem;">
              <div style="display:flex;justify-content:space-between;font-size:0.875rem;padding:0.6rem;background:#f8fafc;border-radius:0.5rem;">
                <span>Doctor</span><strong>${doctorName}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:0.875rem;padding:0.6rem;background:#f8fafc;border-radius:0.5rem;">
                <span>Patient</span><strong>${patName}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:0.875rem;padding:0.6rem;background:#f8fafc;border-radius:0.5rem;">
                <span>Scheduled</span><strong>${new Date(scheduledAt).toLocaleString('en-IN')}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:0.875rem;padding:0.6rem;background:#f8fafc;border-radius:0.5rem;">
                <span>Meeting ID</span><code style="font-size:0.8rem;">${data.meeting_id}</code>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:0.875rem;padding:0.6rem;background:#f8fafc;border-radius:0.5rem;">
                <span>Password</span><code style="font-size:0.8rem;">${data.password}</code>
              </div>
              ${isDemoMode ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:0.5rem;padding:0.6rem;font-size:0.8rem;color:#92400e;">⚠️ Demo mode — configure Zoom credentials in .env for real meetings</div>` : ''}
              <a href="${data.join_url}" target="_blank" rel="noopener"
                 style="display:flex;align-items:center;justify-content:center;gap:0.5rem;background:#2563eb;color:white;text-decoration:none;padding:0.85rem;border-radius:0.75rem;font-weight:700;font-size:0.9rem;">
                🎥 Join Meeting on Zoom
              </a>
              <div style="font-size:0.78rem;color:#64748b;text-align:center;">Share this link with your doctor to start the session</div>
            </div>
        `;
        card.style.display = 'block';
        card.scrollIntoView({ behavior: 'smooth' });
        showToast('Zoom meeting created successfully!', 'success');
        loadTeleStats();

    } catch(err) {
        showToast(err.message || 'Booking failed', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="video" style="width:16px;height:16px"></i> Create Zoom Meeting & Book';
        if (window.lucide) lucide.createIcons();
    }
}

// ── Join meeting by ID ────────────────────────────────────────────────────
async function joinZoomMeeting() {
    const val = document.getElementById('joinMeetingId').value.trim();
    if (!val) { showToast('Enter a meeting ID', 'error'); return; }

    const resultEl = document.getElementById('joinMeetingResult');
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<div style="padding:1.5rem;text-align:center;color:#94a3b8;">Searching...</div>';

    try {
        const r = await fetch(`${API}/api/consultations/join/${encodeURIComponent(val)}`);
        const d = await r.json();
        if (!r.ok || !d.consultation) throw new Error(d.error || 'Meeting not found');
        const con = d.consultation;
        resultEl.innerHTML = `
            <div class="panel-card-header"><i data-lucide="check-circle" style="width:20px;height:20px;color:#16a34a"></i><h3>Meeting Found</h3></div>
            <div class="panel-card-body">
              <div style="display:grid;gap:0.5rem;margin-bottom:1rem;">
                <div style="display:flex;justify-content:space-between;font-size:0.875rem;"><span>Patient</span><strong>${con.patient_name}</strong></div>
                <div style="display:flex;justify-content:space-between;font-size:0.875rem;"><span>Doctor</span><strong>${con.doctor_name}</strong></div>
                <div style="display:flex;justify-content:space-between;font-size:0.875rem;"><span>Status</span><span class="badge ${con.status==='active'?'badge-ok':'badge-warning'}">${con.status}</span></div>
              </div>
              <a href="${con.zoom_join_url}" target="_blank"
                 style="display:flex;align-items:center;justify-content:center;gap:0.5rem;background:#2563eb;color:white;text-decoration:none;padding:0.85rem;border-radius:0.75rem;font-weight:700;">
                🎥 Join Zoom Meeting
              </a>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    } catch(err) {
        resultEl.innerHTML = `<div style="padding:1.5rem;text-align:center;color:#ef4444;font-size:0.875rem;">${err.message}</div>`;
    }
}

// ── Load upcoming meetings ─────────────────────────────────────────────────
async function loadUpcomingMeetings() {
    const el = document.getElementById('upcomingMeetings');
    try {
        const r = await fetch(`${API}/api/consultations?status=scheduled&limit=5`);
        const d = await r.json();
        const list = d.consultations || [];
        if (!list.length) {
            el.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:0.875rem;padding:1rem;">No upcoming meetings</div>';
            return;
        }
        el.innerHTML = list.map(c => `
            <div style="display:flex;gap:0.75rem;align-items:center;padding:0.75rem;border-bottom:1px solid #f1f5f9;">
              <div style="min-width:40px;height:40px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:0.75rem;font-weight:700;">${c.avatar_initials || 'DR'}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.patient_name} ↔ ${c.doctor_name}</div>
                <div style="font-size:0.78rem;color:#64748b;">${c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}) : '—'}</div>
              </div>
              <a href="${c.zoom_join_url}" target="_blank" style="font-size:0.75rem;background:#eff6ff;color:#2563eb;border-radius:0.5rem;padding:0.3rem 0.7rem;text-decoration:none;font-weight:700;white-space:nowrap;">Join</a>
            </div>`
        ).join('');
    } catch(e) {
        el.innerHTML = '<div style="color:#ef4444;font-size:0.875rem;padding:1rem;">Error loading meetings</div>';
    }
}

// ── Load consultations list ────────────────────────────────────────────────
async function loadConsultations() {
    const el      = document.getElementById('consultationsList');
    const status  = document.getElementById('sessionStatusFilter')?.value || '';
    el.innerHTML  = '<div style="text-align:center;color:#94a3b8;padding:3rem;">Loading...</div>';
    try {
        const r = await fetch(`${API}/api/consultations?status=${status}&limit=50`);
        const d = await r.json();
        const list = d.consultations || [];
        if (!list.length) {
            el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:3rem;">No consultations found</div>';
            return;
        }
        el.innerHTML = list.map(c => {
            const statusColors = {scheduled:'#f59e0b',active:'#22c55e',completed:'#2563eb',cancelled:'#ef4444'};
            const statusBg     = {scheduled:'#fffbeb',active:'#f0fdf4',completed:'#eff6ff',cancelled:'#fef2f2'};
            return `
            <div style="border:1px solid #e2e8f0;border-radius:0.75rem;overflow:hidden;margin-bottom:0.75rem;background:white;">
              <div style="padding:1rem 1.25rem;border-left:4px solid ${statusColors[c.status]||'#94a3b8'};background:${statusBg[c.status]||'white'};">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
                  <div>
                    <div style="font-weight:700;font-size:0.95rem;">${c.patient_name} <span style="color:#64748b;font-weight:400;">with</span> ${c.doctor_name}</div>
                    <div style="font-size:0.8rem;color:#64748b;margin-top:0.2rem;">${c.specialty} • ${c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}) : '—'} • ID #${c.id}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                    <span style="font-size:0.75rem;background:${statusBg[c.status]||'#f8fafc'};color:${statusColors[c.status]||'#64748b'};border:1px solid ${statusColors[c.status]||'#e2e8f0'};border-radius:0.4rem;padding:0.2rem 0.6rem;font-weight:700;">${c.status.toUpperCase()}</span>
                    ${c.status === 'scheduled' ? `<a href="${c.zoom_join_url}" target="_blank" class="btn-sm btn-sm-blue" style="text-decoration:none;font-size:0.78rem;padding:0.3rem 0.8rem;">🎥 Join</a>` : ''}
                    ${c.status === 'scheduled' || c.status === 'active' ?
                      `<button onclick="startConsultation(${c.id},'${c.zoom_start_url?.replace(/'/g,"\\'")||''}')" class="btn-sm" style="background:#22c55e;color:white;border:none;border-radius:0.5rem;padding:0.3rem 0.8rem;cursor:pointer;font-size:0.78rem;">▶ Start</button>
                       <button onclick="openEndConsultModal(${c.id})" class="btn-sm" style="background:#ef4444;color:white;border:none;border-radius:0.5rem;padding:0.3rem 0.8rem;cursor:pointer;font-size:0.78rem;">■ End</button>` : ''}
                    ${c.status === 'completed' && c.prescription_issued ? `<span title="Prescription issued" style="cursor:default;">📋</span>` : ''}
                  </div>
                </div>
                ${c.diagnosis ? `<div style="margin-top:0.5rem;font-size:0.8rem;color:#475569;"><strong>Dx:</strong> ${c.diagnosis}</div>` : ''}
                ${c.duration_minutes ? `<div style="font-size:0.78rem;color:#64748b;margin-top:0.2rem;">Duration: ${c.duration_minutes} min</div>` : ''}
              </div>
            </div>`;
        }).join('');
        if (window.lucide) lucide.createIcons();
    } catch(e) {
        el.innerHTML = '<div style="color:#ef4444;padding:2rem;text-align:center;">Error loading consultations</div>';
    }
}

// ── Start consultation ────────────────────────────────────────────────────
async function startConsultation(cid, startUrl) {
    try {
        await fetch(`${API}/api/consultations/${cid}/start`, { method: 'POST' });
        if (startUrl) window.open(startUrl, '_blank');
        showToast('Consultation started');
        loadConsultations();
    } catch(e) { showToast('Error', 'error'); }
}

// ── End consultation modal ────────────────────────────────────────────────
function openEndConsultModal(cid) {
    document.getElementById('endConsultId').value    = cid;
    document.getElementById('endDiagnosis').value    = '';
    document.getElementById('endNotes').value        = '';
    document.getElementById('endPrescription').value = '';
    document.getElementById('endFollowUp').value     = '';
    openModal('endConsultModal');
}

async function submitEndConsultation() {
    const cid = document.getElementById('endConsultId').value;
    const payload = {
        diagnosis:           document.getElementById('endDiagnosis').value,
        notes:               document.getElementById('endNotes').value,
        prescription_issued: document.getElementById('endPrescription').value,
        follow_up_date:      document.getElementById('endFollowUp').value || null
    };
    try {
        const r = await fetch(`${API}/api/consultations/${cid}/end`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
        const d = await r.json();
        closeModal('endConsultModal');
        showToast(`Session ended. Duration: ${d.duration_minutes || '—'} min`);
        loadConsultations();
        loadTeleStats();
    } catch(e) { showToast('Error saving', 'error'); }
}

// ── Load doctors grid ─────────────────────────────────────────────────────
async function loadDoctors() {
    const el      = document.getElementById('doctorsGrid');
    const spec    = document.getElementById('docSpecFilter')?.value || '';
    el.innerHTML  = '<div style="text-align:center;color:#94a3b8;padding:3rem;grid-column:1/-1;">Loading...</div>';
    try {
        const r = await fetch(`${API}/api/doctors?specialty=${encodeURIComponent(spec)}`);
        const d = await r.json();
        const docs = d.doctors || [];
        if (!docs.length) {
            el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:3rem;grid-column:1/-1;">No doctors found</div>';
            return;
        }
        el.innerHTML = docs.map(doc => `
            <div class="tele-doctor-card" style="background:white;border:1px solid #e2e8f0;border-radius:1rem;overflow:hidden;transition:all 0.2s;">
              <div style="height:6px;background:${doc.avatar_color||'#2563eb'};"></div>
              <div style="padding:1.5rem;text-align:center;">
                <div style="width:72px;height:72px;border-radius:50%;background:${doc.avatar_color||'#2563eb'};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:1.2rem;margin:0 auto 1rem;">${doc.avatar_initials||'DR'}</div>
                <div style="font-weight:700;font-size:1rem;margin-bottom:0.25rem;">${doc.name}</div>
                <div style="font-size:0.8rem;color:#64748b;margin-bottom:0.5rem;">${doc.specialty}</div>
                <div style="font-size:0.78rem;color:#64748b;margin-bottom:0.75rem;">${doc.qualification || ''} • ${doc.experience_yrs} yrs exp</div>
                <div style="display:flex;justify-content:center;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
                  <span class="badge ${doc.status==='available'?'badge-ok':doc.status==='busy'?'badge-warning':'badge-danger'}">${doc.status}</span>
                  <span style="font-size:0.78rem;background:#fef3c7;color:#92400e;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:600;">⭐ ${doc.rating}</span>
                </div>
                <div style="font-weight:800;font-size:1.1rem;color:#2563eb;margin-bottom:1rem;">₹${doc.consult_fee}</div>
                <button onclick="selectDoctorAndBook(${doc.id},'${doc.name.replace(/'/g,"\\'")}')"
                        ${doc.status==='offline'?'disabled':''} class="btn-blue w-full"
                        style="font-size:0.875rem;padding:0.6rem;">
                  ${doc.status==='offline'?'Offline':'Book Consultation'}
                </button>
              </div>
            </div>`
        ).join('');
    } catch(e) {
        el.innerHTML = '<div style="color:#ef4444;padding:3rem;text-align:center;grid-column:1/-1;">Error loading doctors</div>';
    }
}

function selectDoctorAndBook(id, name) {
    switchTeleTab('book');
    setTimeout(() => {
        const card = document.getElementById(`docPick-${id}`);
        if (card) {
            card.click();
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 300);
}

// ── Navigate to telemedicine when page loads ──────────────────────────────
function medicinePage() {
    // Set min date to today
    const dateEl = document.getElementById('teleDate');
    if (dateEl) dateEl.min = new Date().toISOString().split('T')[0];
    loadDoctorPicker();
    loadTeleStats();

    const bookBtn = document.querySelector('#page-telemedicine .btn-blue');
    if (bookBtn && currentUser && currentUser.role !== 'patient') {
      bookBtn.disabled = true;
      bookBtn.title = 'Only patients can book consultations';
      bookBtn.style.opacity = '0.6';
      bookBtn.style.cursor = 'not-allowed';
}
}


/* ══════════════════════════════════════════════════════════════════════
   LIVE PHARMACY INVENTORY
══════════════════════════════════════════════════════════════════════ */

let _pharmMap = null;
let _pharmMarkers = [];
let _pharmData = [];
let _userLat = null;
let _userLng = null;


// ── Switch pharmacy tabs ───────────────────────────────────────────────────
function switchPharmTab(tab) {
    document.querySelectorAll('[id^="pharmTab-"]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="pharmPanel-"]').forEach(p => p.style.display = 'none');
    document.getElementById(`pharmTab-${tab}`)?.classList.add('active');
    document.getElementById(`pharmPanel-${tab}`).style.display = 'block';
    if (tab === 'map')  loadPharmacies();
    if (tab === 'list') renderPharmacyCards(_pharmData);
}

// ── Get user location ──────────────────────────────────────────────────────
function getUserLocation() {
    if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
    showToast('Getting your location...');
    navigator.geolocation.getCurrentPosition(pos => {
        _userLat = pos.coords.latitude;
        _userLng = pos.coords.longitude;
        showToast(`Location found: ${_userLat.toFixed(4)}, ${_userLng.toFixed(4)}`);
        loadPharmacies();
        if (_pharmMap) {
            const pos2 = { lat: _userLat, lng: _userLng };
            _pharmMap.setCenter(pos2);
            _pharmMap.setZoom(13);
            new google.maps.Marker({
                position: pos2, map: _pharmMap,
                title: 'Your Location',
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10,
                        fillColor: '#3b82f6', fillOpacity: 1,
                        strokeColor: 'white', strokeWeight: 2 }
            });
        }
    }, () => {
        // Fallback: use Pune center
        _userLat = 18.5204; _userLng = 73.8567;
        showToast('Using Pune as default location');
        loadPharmacies();
    });
}


function updatePharmStats(pharmacies) {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('pharmInStockCount',  pharmacies.filter(p => !p.is_24hr).length + pharmacies.filter(p => p.is_24hr).length);
    setEl('pharmLowStockCount', pharmacies.filter(p => p.is_24hr).length);
    setEl('pharmOutCount',      0);
}

// ── Plot markers on Google Map ────────────────────────────────────────────
function plotPharmaciesOnMap(pharmacies) {
    if (!_pharmMap || !window.google) {
        renderFallbackPins(pharmacies);
        return;
    }
    // Clear old markers
    _pharmMarkers.forEach(m => m.setMap(null));
    _pharmMarkers = [];

    pharmacies.forEach(p => {
        if (!p.latitude || !p.longitude) return;
        const marker = new google.maps.Marker({
            position: { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) },
            map:      _pharmMap,
            title:    p.name,
            icon: {
                path:        google.maps.SymbolPath.CIRCLE,
                scale:       p.is_24hr ? 12 : 9,
                fillColor:   p.is_24hr ? '#22c55e' : '#0d9488',
                fillOpacity: 1,
                strokeColor: 'white',
                strokeWeight: 2
            }
        });

        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="font-family:sans-serif;min-width:200px;padding:0.25rem;">
                  <strong style="font-size:0.9rem;">${p.name}</strong>
                  <div style="font-size:0.78rem;color:#64748b;margin:0.25rem 0;">${p.area} • ${p.city}</div>
                  ${p.is_24hr ? '<span style="background:#f0fdf4;color:#16a34a;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:0.3rem;font-weight:700;">24 HOURS</span>' : ''}
                  ${p.has_delivery ? '<span style="background:#eff6ff;color:#2563eb;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:0.3rem;font-weight:700;margin-left:0.3rem;">DELIVERY</span>' : ''}
                  <div style="font-size:0.8rem;margin-top:0.5rem;">📞 ${p.phone || '—'}</div>
                  <div style="font-size:0.78rem;color:#64748b;">🕐 ${p.open_hours}</div>
                  ${p.distance_km != null ? `<div style="font-size:0.78rem;margin-top:0.25rem;color:#0d9488;font-weight:600;">📍 ${p.distance_km} km away</div>` : ''}
                  <div style="display:flex;gap:0.4rem;margin-top:0.6rem;">
                    <a href="${buildOpenStreetMapUrl(p.latitude, p.longitude)}" target="_blank" rel="noopener noreferrer"
                       style="font-size:0.75rem;background:#2563eb;color:white;border-radius:0.4rem;padding:0.25rem 0.6rem;text-decoration:none;font-weight:600;">Directions</a>
                    <a onclick="openPharmacyDetail(${p.id})"
                       style="font-size:0.75rem;background:#0d9488;color:white;border-radius:0.4rem;padding:0.25rem 0.6rem;cursor:pointer;font-weight:600;">Stock</a>
                  </div>
                </div>`
        });

        marker.addListener('click', () => {
            infoWindow.open(_pharmMap, marker);
        });
        _pharmMarkers.push(marker);
    });
}

// Fallback: render pins as HTML badges when Google Maps is unavailable
function renderFallbackPins(pharmacies) {
    const el = document.getElementById('fallbackPharmPins');
    if (!el) return;
    el.innerHTML = pharmacies.slice(0, 12).map(p => `
        <div onclick="openPharmacyDetail(${p.id})" style="cursor:pointer;background:white;border:1px solid #e2e8f0;border-radius:0.5rem;padding:0.4rem 0.75rem;font-size:0.78rem;font-weight:600;display:flex;align-items:center;gap:0.35rem;">
          <span style="width:8px;height:8px;border-radius:50%;background:${p.is_24hr?'#22c55e':'#0d9488'};display:inline-block;"></span>
          ${p.name.replace('Apollo Pharmacy – ','').replace('MedPlus Pharmacy – ','').replace('MedPlus – ','').substring(0,22)}
        </div>`
    ).join('');
}

// ── Sidebar pharmacy list (map view) ─────────────────────────────────────
function renderPharmSidebar(pharmacies) {
    const el = document.getElementById('pharmSidebarList');
    if (!el) return;
    if (!pharmacies.length) {
        el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:2rem;font-size:0.875rem;">No pharmacies found</div>';
        return;
    }
    el.innerHTML = pharmacies.map(p => `
        <div onclick="openPharmacyDetail(${p.id})" style="cursor:pointer;padding:0.85rem 1rem;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:0.75rem;transition:background 0.15s;"
             onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
          <div style="min-width:40px;height:40px;background:linear-gradient(135deg,#0f766e,#0d9488);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:0.7rem;font-weight:800;">
            ${p.is_24hr ? '24h' : '🏥'}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
            <div style="font-size:0.75rem;color:#64748b;">${p.area} • ⭐ ${p.rating}</div>
          </div>
          <div style="text-align:right;font-size:0.75rem;">
            ${p.distance_km != null ? `<div style="color:#0d9488;font-weight:700;">${p.distance_km} km</div>` : ''}
            ${p.has_delivery ? '<div style="color:#2563eb;">Delivery</div>' : ''}
          </div>
        </div>`
    ).join('');
}

// ── Pharmacy cards grid (list view) ──────────────────────────────────────
function renderPharmacyCards(pharmacies) {
    const el = document.getElementById('pharmacyCardsGrid');
    if (!el) return;
    if (!pharmacies.length) {
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#94a3b8;">No pharmacies found</div>';
        return;
    }
    el.innerHTML = pharmacies.map(p => `
        <div class="pharmacy-card" style="background:white;border:1px solid #e2e8f0;border-radius:1rem;overflow:hidden;transition:all 0.2s;">
          <div style="background:linear-gradient(135deg,#0f766e,#0d9488);padding:1.25rem;color:white;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
              <h4 style="color:white;font-size:0.95rem;margin:0;line-height:1.4;">${p.name}</h4>
              ${p.is_24hr ? '<span style="background:rgba(255,255,255,0.2);font-size:0.7rem;border-radius:0.4rem;padding:0.15rem 0.5rem;white-space:nowrap;font-weight:700;">24 HRS</span>' : ''}
            </div>
            <div style="font-size:0.78rem;opacity:0.85;margin-top:0.4rem;">${p.area}, Pune</div>
          </div>
          <div style="padding:1rem;">
            <div style="font-size:0.8rem;color:#475569;margin-bottom:0.3rem;">📍 ${p.address || p.area + ', Pune'}</div>
            <div style="font-size:0.8rem;color:#475569;margin-bottom:0.3rem;">📞 ${p.phone || '—'}</div>
            <div style="font-size:0.8rem;color:#475569;margin-bottom:0.3rem;">🕐 ${p.open_hours}</div>
            <div style="display:flex;gap:0.4rem;margin:0.75rem 0;flex-wrap:wrap;">
              <span style="background:#f0fdf4;color:#16a34a;font-size:0.72rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:600;">⭐ ${p.rating}</span>
              ${p.has_delivery ? '<span style="background:#eff6ff;color:#2563eb;font-size:0.72rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:600;">🚚 Delivery</span>' : ''}
              ${p.distance_km != null ? `<span style="background:#f0fdf4;color:#0d9488;font-size:0.72rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:600;">📍 ${p.distance_km} km</span>` : ''}
            </div>
            <div style="display:flex;gap:0.5rem;">
              <button onclick="openPharmacyDetail(${p.id})" class="btn-sm" style="flex:1;background:#0d9488;color:white;border:none;border-radius:0.5rem;padding:0.45rem;cursor:pointer;font-size:0.8rem;font-weight:600;">View Stock</button>
              <a href="${buildOpenStreetMapUrl(p.latitude, p.longitude)}"
                 target="_blank" class="btn-sm" style="flex:1;background:#2563eb;color:white;border:none;border-radius:0.5rem;padding:0.45rem;cursor:pointer;font-size:0.8rem;font-weight:600;text-decoration:none;text-align:center;">
                🗺 Directions
              </a>
            </div>
          </div>
        </div>`
    ).join('');
}

// ── Open pharmacy detail modal ────────────────────────────────────────────
async function openPharmacyDetail(pid) {
    document.getElementById('pharmDetailTitle').textContent = 'Loading...';
    document.getElementById('pharmacyDetailBody').innerHTML =
        '<div style="padding:2rem;text-align:center;color:#94a3b8;">Loading inventory...</div>';
    openModal('pharmacyDetailModal');

    try {
        const r = await fetch(`${API}/api/pharmacies/${pid}/inventory`);
        const d = await r.json();
        const p = d.pharmacy;
        const inv = d.inventory || [];

        document.getElementById('pharmDetailTitle').textContent = p.name;

        const stockSummary = {in_stock: 0, low_stock: 0, out_of_stock: 0};
        inv.forEach(i => { if (stockSummary[i.stock_status] !== undefined) stockSummary[i.stock_status]++; });

        document.getElementById('pharmacyDetailBody').innerHTML = `
            <div style="padding:1.5rem;border-bottom:1px solid #f1f5f9;">
              <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
                <div style="flex:1;min-width:180px;">
                  <div style="font-size:0.8rem;color:#64748b;">📍 ${p.address || p.area + ', Pune'}</div>
                  <div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">📞 ${p.phone || '—'}</div>
                  <div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">🕐 ${p.open_hours}</div>
                </div>
                <div>
                  <a href="${buildOpenStreetMapUrl(p.latitude, p.longitude)}" target="_blank" rel="noopener noreferrer"
                     style="display:inline-flex;align-items:center;gap:0.4rem;background:#2563eb;color:white;text-decoration:none;border-radius:0.6rem;padding:0.5rem 1rem;font-size:0.85rem;font-weight:700;">
                    🗺 Get Directions
                  </a>
                </div>
              </div>
              <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:0.5rem;padding:0.5rem 1rem;text-align:center;">
                  <div style="font-size:1.1rem;font-weight:800;color:#16a34a;">${stockSummary.in_stock}</div>
                  <div style="font-size:0.72rem;color:#64748b;">In Stock</div>
                </div>
                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:0.5rem;padding:0.5rem 1rem;text-align:center;">
                  <div style="font-size:1.1rem;font-weight:800;color:#f59e0b;">${stockSummary.low_stock}</div>
                  <div style="font-size:0.72rem;color:#64748b;">Low Stock</div>
                </div>
                <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:0.5rem;padding:0.5rem 1rem;text-align:center;">
                  <div style="font-size:1.1rem;font-weight:800;color:#ef4444;">${stockSummary.out_of_stock}</div>
                  <div style="font-size:0.72rem;color:#64748b;">Out of Stock</div>
                </div>
              </div>
            </div>
            <div style="padding:1rem 1.5rem;">
              <h4 style="font-size:0.95rem;font-weight:700;margin-bottom:0.75rem;">Medicine Inventory (${inv.length} items)</h4>
              <div style="display:flex;flex-direction:column;gap:0.35rem;max-height:350px;overflow-y:auto;">
                ${inv.map(item => `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;background:${item.stock_status==='out_of_stock'?'#fef2f2':item.stock_status==='low_stock'?'#fffbeb':'#f8fafc'};border-radius:0.5rem;gap:0.5rem;">
                      <div style="min-width:0;">
                        <div style="font-size:0.85rem;font-weight:600;">${item.medicine_name}</div>
                        ${item.generic_name ? `<div style="font-size:0.72rem;color:#94a3b8;">${item.generic_name}</div>` : ''}
                      </div>
                      <div style="display:flex;align-items:center;gap:0.75rem;flex-shrink:0;">
                        <span style="font-size:0.8rem;font-weight:700;color:${item.stock_status==='out_of_stock'?'#ef4444':item.stock_status==='low_stock'?'#f59e0b':'#16a34a'};">
                          ${item.quantity > 0 ? item.quantity + ' units' : 'Out of Stock'}
                        </span>
                        ${item.unit_price > 0 ? `<span style="font-size:0.8rem;color:#475569;font-weight:600;">₹${item.unit_price}</span>` : ''}
                      </div>
                    </div>`
                ).join('')}
              </div>
            </div>`;
    } catch(e) {
        document.getElementById('pharmacyDetailBody').innerHTML =
            '<div style="padding:2rem;text-align:center;color:#ef4444;">Error loading inventory</div>';
    }
}

// ── Search pharmacy by medicine ────────────────────────────────────────────
async function searchPharmacyByMedicine() {
    const medicine = document.getElementById('pharmMedSearch').value.trim();
    if (!medicine) return;
    // Switch to medicine tab and run search
    switchPharmTab('medicine');
    document.getElementById('medSearchDetailed').value = medicine;
    searchMedicineDetailed();
}

async function searchMedicineDetailed() {
    const medicine = document.getElementById('medSearchDetailed').value.trim();
    if (!medicine) return;

    const el = document.getElementById('medSearchResults');
    el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:2rem;">Searching pharmacies...</div>';

    let url = `${API}/api/pharmacies/search?medicine=${encodeURIComponent(medicine)}`;
    if (_userLat) url += `&lat=${_userLat}&lng=${_userLng}&radius=25`;

    try {
        const r = await fetch(url);
        const d = await r.json();
        const results = d.results || [];

        if (!results.length) {
            el.innerHTML = `<div style="text-align:center;padding:3rem;color:#94a3b8;">
                <div style="font-size:3rem;margin-bottom:1rem;">🔍</div>
                <div style="font-weight:700;margin-bottom:0.5rem;">No pharmacies found with "${medicine}"</div>
                <div style="font-size:0.875rem;">Try a different name or check spelling</div>
            </div>`;
            return;
        }

        // Update stats
        const inStock  = results.filter(r => r.stock_status !== 'out_of_stock').length;
        const outStock = results.filter(r => r.stock_status === 'out_of_stock').length;
        const lowStock = results.filter(r => r.stock_status === 'low_stock').length;
        document.getElementById('pharmInStockCount').textContent  = inStock;
        document.getElementById('pharmLowStockCount').textContent = lowStock;
        document.getElementById('pharmOutCount').textContent      = outStock;

        el.innerHTML = `
            <div style="margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
              <div>
                <h3 style="font-weight:800;margin:0;">"${medicine}" — ${results.length} pharmacies</h3>
                <div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">${inStock} available • ${outStock} out of stock</div>
              </div>
              <button onclick="plotMedResultsOnMap()" style="background:#0f766e;color:white;border:none;border-radius:0.5rem;padding:0.5rem 1rem;cursor:pointer;font-size:0.85rem;font-weight:600;">🗺 Show on Map</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem;">
              ${results.map(item => `
                  <div style="background:white;border:2px solid ${item.stock_status==='out_of_stock'?'#fecaca':item.stock_status==='low_stock'?'#fde68a':'#bbf7d0'};border-radius:0.75rem;overflow:hidden;">
                    <div style="background:${item.stock_status==='out_of_stock'?'#fef2f2':item.stock_status==='low_stock'?'#fffbeb':'#f0fdf4'};padding:0.75rem 1rem;display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <div style="font-weight:700;font-size:0.9rem;">${item.name}</div>
                        <div style="font-size:0.75rem;color:#64748b;">${item.area} • ⭐ ${item.rating}</div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-weight:800;font-size:1rem;color:${item.stock_status==='out_of_stock'?'#ef4444':item.stock_status==='low_stock'?'#f59e0b':'#16a34a'};">
                          ${item.quantity > 0 ? item.quantity + ' units' : 'Out of Stock'}
                        </div>
                        ${item.unit_price > 0 ? `<div style="font-size:0.8rem;color:#475569;">₹${item.unit_price}</div>` : ''}
                      </div>
                    </div>
                    <div style="padding:0.75rem 1rem;">
                      <div style="font-size:0.78rem;color:#64748b;margin-bottom:0.5rem;">${item.phone || '—'} • ${item.is_24hr ? '24 Hrs' : item.open_hours}</div>
                      ${item.distance_km != null ? `<div style="font-size:0.78rem;color:#0d9488;font-weight:700;margin-bottom:0.5rem;">📍 ${item.distance_km} km away</div>` : ''}
                      <div style="display:flex;gap:0.4rem;">
                        <button onclick="openPharmacyDetail(${item.id})" style="flex:1;background:#0d9488;color:white;border:none;border-radius:0.5rem;padding:0.4rem;cursor:pointer;font-size:0.78rem;font-weight:600;">View All Stock</button>
                        <a href="${buildOpenStreetMapUrl(item.latitude, item.longitude)}" target="_blank" rel="noopener noreferrer"
                           style="flex:1;background:#2563eb;color:white;text-decoration:none;border-radius:0.5rem;padding:0.4rem;font-size:0.78rem;font-weight:600;text-align:center;">
                           🗺 Directions
                        </a>
                      </div>
                    </div>
                  </div>`
              ).join('')}
            </div>`;

        // Also update map markers
        plotPharmaciesOnMap(results.map(r2 => ({...r2,
            is_24hr: r2.is_24hr,
            has_delivery: r2.has_delivery
        })));

    } catch(e) {
        el.innerHTML = '<div style="color:#ef4444;padding:2rem;text-align:center;">Search failed</div>';
    }
}

function quickSearchMed(medicine) {
    document.getElementById('medSearchDetailed').value = medicine;
    searchMedicineDetailed();
}

// ── Medicine autocomplete ──────────────────────────────────────────────────
let _acTimer = null;
async function pharmacyMedAutoComplete(val) {
    clearTimeout(_acTimer);
    const dd = document.getElementById('pharmMedDropdown');
    if (!val || val.length < 2) { dd.style.display = 'none'; return; }
    _acTimer = setTimeout(async () => {
        try {
            const r = await fetch(`${API}/api/pharmacies/medicines/list?q=${encodeURIComponent(val)}`);
            const d = await r.json();
            const meds = (d.medicines || []).slice(0, 8);
            if (!meds.length) { dd.style.display = 'none'; return; }
            dd.innerHTML = meds.map(m => `
                <div onclick="document.getElementById('pharmMedSearch').value='${m.medicine_name.replace(/'/g,"\\'")}';document.getElementById('pharmMedDropdown').style.display='none';"
                     style="padding:0.6rem 1rem;cursor:pointer;font-size:0.875rem;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;"
                     onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                  <span>${m.medicine_name}</span>
                  ${m.generic_name ? `<span style="color:#94a3b8;font-size:0.78rem;">${m.generic_name}</span>` : ''}
                </div>`
            ).join('');
            dd.style.display = 'block';
        } catch(e) {}
    }, 300);
}

// ── Init pharmacy page ─────────────────────────────────────────────────────
function initPharmacyPage() {
    loadPharmacies();
    // Try to init map if Google Maps loaded synchronously
    if (window.google && window.google.maps) initPharmacyMap();
}

let _pharmUserMarker = null;

initPharmacyMap = function() {
    if (!window.L) return null;
    const mapDiv = document.getElementById('googleMapDiv');
    if (!mapDiv) return null;

    if (!_pharmMap) {
        _pharmMap = L.map(mapDiv, {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([18.5204, 73.8567], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(_pharmMap);
    }

    setTimeout(() => _pharmMap.invalidateSize(), 0);
    return _pharmMap;
};

getUserLocation = function() {
    if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
    showToast('Getting your location...');
    navigator.geolocation.getCurrentPosition(pos => {
        _userLat = pos.coords.latitude;
        _userLng = pos.coords.longitude;
        showToast(`Location found: ${_userLat.toFixed(4)}, ${_userLng.toFixed(4)}`);
        loadPharmacies();

        const map = initPharmacyMap();
        if (map && window.L) {
            const coords = [_userLat, _userLng];
            map.setView(coords, 13);
            if (_pharmUserMarker) _pharmUserMarker.remove();
            _pharmUserMarker = L.marker(coords, {
                icon: createLeafletCircleIcon('#3b82f6', 'U')
            }).addTo(map).bindPopup('Your Location');
        }
    }, () => {
        _userLat = 18.5204;
        _userLng = 73.8567;
        showToast('Using Pune as default location');
        loadPharmacies();
    });
};

plotPharmaciesOnMap = function(pharmacies) {
    const map = initPharmacyMap();
    if (!map || !window.L) {
        renderFallbackPins(pharmacies);
        return;
    }

    clearLeafletMarkers(_pharmMarkers);
    const bounds = [];

    pharmacies.forEach(p => {
        if (!p.latitude || !p.longitude) return;
        const lat = parseFloat(p.latitude);
        const lng = parseFloat(p.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lng)) return;

        bounds.push([lat, lng]);
        const marker = L.marker([lat, lng], {
            icon: createLeafletCircleIcon(p.is_24hr ? '#22c55e' : '#0d9488')
        }).addTo(map);

        marker.bindPopup(`
            <div style="font-family:sans-serif;min-width:200px;padding:0.25rem;">
              <strong style="font-size:0.9rem;">${p.name}</strong>
              <div style="font-size:0.78rem;color:#64748b;margin:0.25rem 0;">${p.area} • ${p.city}</div>
              ${p.is_24hr ? '<span style="background:#f0fdf4;color:#16a34a;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:0.3rem;font-weight:700;">24 HOURS</span>' : ''}
              ${p.has_delivery ? '<span style="background:#eff6ff;color:#2563eb;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:0.3rem;font-weight:700;margin-left:0.3rem;">DELIVERY</span>' : ''}
              <div style="font-size:0.8rem;margin-top:0.5rem;">Phone: ${p.phone || '—'}</div>
              <div style="font-size:0.78rem;color:#64748b;">Hours: ${p.open_hours}</div>
              ${p.distance_km != null ? `<div style="font-size:0.78rem;margin-top:0.25rem;color:#0d9488;font-weight:600;">${p.distance_km} km away</div>` : ''}
              <div style="display:flex;gap:0.4rem;margin-top:0.6rem;">
                <a href="${buildOpenStreetMapUrl(lat, lng)}" target="_blank" rel="noopener noreferrer"
                   style="font-size:0.75rem;background:#2563eb;color:white;border-radius:0.4rem;padding:0.25rem 0.6rem;text-decoration:none;font-weight:600;">Open in OSM</a>
                <a onclick="openPharmacyDetail(${p.id})"
                   style="font-size:0.75rem;background:#0d9488;color:white;border-radius:0.4rem;padding:0.25rem 0.6rem;cursor:pointer;font-weight:600;">Stock</a>
              </div>
            </div>`);

        _pharmMarkers.push(marker);
    });

    if (bounds.length === 1) {
        map.setView(bounds[0], 14);
    } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
};

initPharmacyPage = function() {
    loadPharmacies();
    if (window.L) initPharmacyMap();
};

function initTelemedicinePage() {
  // Set min date to today
  const dateEl = document.getElementById('teleDate');
  if (dateEl) dateEl.min = new Date().toISOString().split('T')[0];
  loadDoctorPicker();
  loadTeleStats();

  // Apply role-based restrictions
  applyTelemedicineRestrictions();
}
/* ══════════════════════════════════════════════════════════════════════
   PATCH: Override navigate() to call init functions
   (Find your existing navigate function in script.js and add these
   cases, OR add this snippet which wraps the navigate calls)
══════════════════════════════════════════════════════════════════════ */

// Store original navigate
const _origNavigate = typeof navigate === 'function' ? navigate : null;

const _navOrig = navigate;
navigate = function(page, ...args) {
  _navOrig(page, ...args);
  if (page === 'telemedicine') setTimeout(initTelemedicinePage, 100);
  if (page === 'pharmacy')     setTimeout(initPharmacyPage, 100);
};


function restrictTelemedicineAccess() {
  const bookBtn = document.querySelector('#page-telemedicine .btn-blue');
  if (bookBtn && currentUser && currentUser.role !== 'patient') {
    bookBtn.disabled = true;
    bookBtn.title = '🚫 Only patients can book consultations';
    bookBtn.style.opacity = '0.5';
    bookBtn.style.cursor = 'not-allowed';
    bookBtn.innerHTML = '🚫 Only patients can book';
  }
}

/* --- NEW RESTRUCTURED PHARMACY LOGIC --- */
let _pharmMode = 'place'; 

function switchPharmacyFinder(mode) {
    _pharmMode = mode;
    const input = document.getElementById('pharm-search-input');
    
    // Update tab UI
    document.querySelectorAll('.pharm-tab-btn').forEach(t => t.classList.remove('active'));
    if (event) event.target.classList.add('active');

    input.placeholder = (mode === 'place') ? "Search any place (Global Maps)..." : "Search medicine name (Local Stock)...";
}

async function handlePharmacySearch() {
    const query = document.getElementById('pharm-search-input').value;
    const results = document.getElementById('pharmacy-results');
    if(!query) return;
    results.innerHTML = "Searching...";

    if (_pharmMode === 'place') {
        const res = await fetch(`${API}/api/places/search?query=${query}`);
        const data = await res.json();
        results.innerHTML = data.results.map(p => `
            <div class="pharmacy-card">
                <strong>${p.name}</strong><br>${p.formatted_address || p.vicinity}
            </div>`).join('');
    } else {
        const res = await fetch(`${API}/api/inventory/live?medicine=${query}`);
        const data = await res.json();
        results.innerHTML = data.pharmacies.map(p => `
            <div class="pharmacy-card">
                <strong>${p.name}</strong><br>Stock: ${p.quantity} units
            </div>`).join('');
    }
}

/* --- OWN STOCK MANAGEMENT (For Pharmacists) --- */
async function loadMyInventory() {
    const res = await fetch(`${API}/api/my-pharmacy/inventory`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    const list = document.getElementById('own-inventory-list');
    
    if(!data.inventory || data.inventory.length === 0) {
        list.innerHTML = `<button onclick="initializeMyStock()">Setup Inventory (20 units default)</button>`;
        return;
    }

    list.innerHTML = data.inventory.map(item => `
        <div class="stock-item ${item.quantity <= 5 ? 'alert-low' : ''}">
            <strong>${item.medicine_name}</strong>
            <span>Current Qty: ${item.quantity}</span>
            <div class="controls">
                <button onclick="updateMyStock(${item.id}, 1)">+</button>
                <button onclick="updateMyStock(${item.id}, -1)">-</button>
            </div>
            ${item.quantity <= 5 ? '<small style="color:red">LOW STOCK ALERT!</small>' : ''}
        </div>`).join('');
}

async function updateMyStock(id, change) {
    await fetch(`${API}/api/my-pharmacy/update`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`},
        body: JSON.stringify({id, change})
    });
    loadMyInventory();
}

async function initializeMyStock() {
    await fetch(`${API}/api/my-pharmacy/initialize`, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${authToken}`}
    });
    loadMyInventory();
}

/* --- UPDATE NAVIGATION WRAPPER --- */
const _oldNavigate = navigate;
navigate = function(page, ...args) {
  if (typeof _oldNavigate === 'function') _oldNavigate(page, ...args);
  if (page === 'pharmacy') setTimeout(() => switchPharmacyFinder('place'), 100);
  if (page === 'inventory') setTimeout(loadMyInventory, 100);
};
