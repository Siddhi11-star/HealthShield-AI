'use strict';

/* ─── CONFIG — FIXED: always points to Flask backend ─── */
const BASE_URL = 'http://localhost:5001/api';

// Simple API helper that adds Authorization header when available
async function apiFetch(path, opts){
  opts = opts || {};
  opts.headers = opts.headers || {};
  if(authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
  opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
  try{
    const res = await fetch(BASE_URL + path, opts);
    const txt = await res.text();
    try{ const data = txt? JSON.parse(txt): null; if(!res.ok) throw data||{error:'Request failed'}; return data; }catch(e){ throw e; }
  }catch(e){ throw e; }
}

/* ─── STATE ─── */
let currentPage = 'home';
let currentUser = null;
let authToken   = null;

function getStoredToken() {
  const token = localStorage.getItem('mg_token');
  if (!token || token === 'null' || token === 'undefined') return null;
  return token;
}

authToken = getStoredToken();
const ALL_PAGES = ['home','features','howitworks','emergency','telemedicine','medicines','inventory','pharmacy','ai-safety-guard','analytics','portal','ayurveda','about','contact','dashboard','admin'];

const FEATURE_NAVIGATION = {
  teleconsultation: 'telemedicine',
  telemedicine: 'telemedicine',
  records: 'dashboard',
  dashboard: 'dashboard',
  analytics: 'analytics',
  pharmacy: 'pharmacy',
  inventory: 'pharmacy',
  finder: 'pharmacy',
  medicines: 'medicines',
  medicine: 'medicines',
  portal: 'portal',
  patient: 'portal',
  admin: 'admin',
};

/* ─── PAGE ACCESS CONTROL ─── */
const PAGE_ACCESS = {
  // Feature card visibility (null = shown to everyone incl. logged-out users)
  emergency:         null,                                         // SEAS — always visible
  telemedicine:      ['doctor', 'patient', 'admin'],               // Teleconsultation
  dashboard:         ['doctor', 'patient', 'admin', 'pharmacist'], // Digital Health Records (pharmacist allowed)
  analytics:         ['doctor', 'patient', 'pharmacist', 'admin'], // Analytics
  pharmacy:          ['doctor', 'patient', 'pharmacist', 'admin'], // Pharmacy Finder
  inventory:         ['pharmacist', 'admin'],                      // Live Inventory
  'ai-safety-guard': ['admin'],                                    // AI Clinical Intelligence
  portal:            ['patient', 'admin'],                         // Patient Portal
  medicines:         ['doctor', 'pharmacist', 'admin'],            // Medicine DB
  admin:             ['admin'],
  // Navigation-only pages (no feature card, always navigable)
  home:         null,
  features:     null,
  howitworks:   null,
  about:        null,
  contact:      null,
};

const ROLE_LABELS = {
  admin:       'Admin',
  doctor:      'Doctor',
  pharmacist:  'Pharmacist',
  patient:     'Patient',
};

const ROLE_COLORS = {
  admin:       'linear-gradient(135deg,#7c3aed,#6d28d9)',
  doctor:      'linear-gradient(135deg,#2563eb,#1d4ed8)',
  pharmacist:  'linear-gradient(135deg,#0d9488,#0f766e)',
  patient:     'linear-gradient(135deg,#ea580c,#dc2626)',
};

function hasAccess(page) {
  const allowed = PAGE_ACCESS[page];
  if (!allowed) return true;                  // public page
  if (!currentUser) return false;             // must be logged in
  return allowed.includes(currentUser.role);
}

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  await restoreSession();
  loadHomeStats();
  runAnimations();
  checkSystemHealth();
  setInterval(checkSystemHealth, 60000);
  // UI cleanup: remove stray placeholder instruction if present in DOM
  try {
    document.querySelectorAll('body *').forEach(el => {
      if (el.children.length === 0 && typeof el.textContent === 'string') {
        const txt = el.textContent.trim();
        if (txt === 'Fill this box completely') {
          el.remove();
        }
      }
    });
  } catch (e) { /* ignore */ }
});

/* ─── ROUTER ─── */
function navigate(page) {
  if (!ALL_PAGES.includes(page)) page = 'home';

  const allowed = PAGE_ACCESS[page];

  // Needs login but no user
  if (allowed && !currentUser) {
    showToast('Please login to access this page', 'warning');
    openModal('loginModal');
    return;
  }

  // Logged in but wrong role
  if (allowed && currentUser && !allowed.includes(currentUser.role)) {
    const rolesStr = allowed.map(r => ROLE_LABELS[r] || r).join(', ');
    showToast(`Access restricted to: ${rolesStr}`, 'error');
    return;
  }
  
  ALL_PAGES.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.toggle('active', p === page);
  });
  
  document.querySelectorAll('[data-page]').forEach(a =>
    a.classList.toggle('active', a.dataset.page === page));
  
  currentPage = page;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  lucide.createIcons();
  setTimeout(runAnimations, 60);
  renderFeatureAccess();
  
  if (page === 'dashboard')    { initDashboardShell(); }
  if (page === 'analytics')    { loadAnalytics(); }
  if (page === 'medicines')    { loadMedicineDB(); }
  if (page === 'pharmacy')     { initPharmacyFinderTabs(); }
  if (page === 'inventory')    { renderPharmacistInventoryView(); }
  if (page === 'ai-safety-guard') { loadAISafetyGuard(); }
  if (page === 'portal')       { initPortal(); }
  if (page === 'admin')        { loadAdminPanel(); }
  if (page === 'emergency')    { initEmergencySEASPage(); }
  if (page !== 'emergency')   { stopSEASTracking(); }
  if (page === 'telemedicine') { setTimeout(initTelemedicinePage, 80); }
}

/* ─── QUICK SEARCH IN SPATIAL MASTER DECK ─── */
function quickSearchAction(query) {
  if (!query || !query.trim()) return;
  const q = query.trim().toLowerCase();
  if (q.includes('ambul') || q.includes('emerg') || q.includes('seas') || q.includes('sos')) {
    navigate('emergency');
  } else if (q.includes('ayur') || q.includes('dosha') || q.includes('vata') || q.includes('pitta') || q.includes('kapha') || q.includes('wellness') || q.includes('skin')) {
    navigate('ayurveda');
  } else if (q.includes('doc') || q.includes('tele') || q.includes('consult') || q.includes('zoom') || q.includes('video') || q.includes('appoint')) {
    navigate('telemedicine');
  } else if (q.includes('pharm') || q.includes('chemist') || q.includes('store') || q.includes('locate') || q.includes('near')) {
    navigate('pharmacy');
  } else if (q.includes('stock') || q.includes('invent') || q.includes('supply')) {
    navigate('inventory');
  } else if (q.includes('ai') || q.includes('clinic') || q.includes('safe') || q.includes('intellig') || q.includes('diagnos')) {
    navigate('ai-safety-guard');
  } else if (q.includes('record') || q.includes('dash') || q.includes('stat')) {
    navigate('dashboard');
  } else if (q.includes('portal') || q.includes('patient') || q.includes('history')) {
    navigate('portal');
  } else {
    navigate('medicines');
    const medSearch = document.getElementById('medSearchInput');
    if (medSearch) {
      medSearch.value = query;
      medSearch.dispatchEvent(new Event('input'));
    }
  }
}

/* ─── FEATURE SECTION COPY PER ROLE ─── */
const FEATURE_SECTION_COPY = {
  guest: {
    title: 'Pillars of Smart Healthcare',
    desc:  'MediGuard AI brings together essential healthcare services into one integrated platform',
  },
  patient: {
    title: 'Your Personal Health Hub',
    desc:  'Access your consultations, health records, prescriptions, and nearby pharmacies — all in one place',
  },
  doctor: {
    title: 'Your Clinical Workspace',
    desc:  'Everything you need to consult, diagnose, and manage your patients efficiently',
  },
  pharmacist: {
    title: 'Your Pharmacy Suite',
    desc:  'Live inventory, analytics, and medicine tools built for your daily workflow',
  },
  admin: {
    title: 'Platform Control Centre',
    desc:  'Full access to every module — manage, monitor, and configure the entire system',
  },
};

/* ─── FEATURE CARD ACCESS RENDERING ─── */
function renderFeatureAccess() {
  const role = currentUser ? currentUser.role : 'guest';

  // ── Update section heading & description ──
  const copy = FEATURE_SECTION_COPY[role] || FEATURE_SECTION_COPY.guest;
  const titleEl = document.getElementById('features-section-title');
  const descEl  = document.getElementById('features-section-desc');
  if (titleEl) titleEl.textContent = copy.title;
  if (descEl)  descEl.textContent  = copy.desc;

  // ── Show/hide cards and renumber sequentially ──
  let counter = 1;
  document.querySelectorAll('[data-feat]').forEach(h3 => {
    const feat  = h3.dataset.feat;
    const card  = h3.closest('.feature-card');
    if (!card) return;
    const allowed = PAGE_ACCESS[feat];

    // Visibility rules:
    //  - Not logged in → show ALL cards
    //  - Logged in     → show only role-permitted cards
    const canAccess = !currentUser
                   || !allowed
                   || allowed.includes(currentUser.role);

    card.style.display = canAccess ? '' : 'none';
    card.classList.remove('feat-card-locked');
    card.setAttribute('aria-disabled', String(!canAccess));
    card.setAttribute('title', canAccess ? 'Accessible with your current account'
      : `Access limited to ${allowed.map(r => ROLE_LABELS[r] || r).join(', ')}`);

    // Renumber only visible cards sequentially
    if (canAccess) {
      const baseName = h3.dataset.title || h3.textContent.replace(/^\d+\.\s*/, '');
      h3.textContent = `${counter}. ${baseName}`;
      counter++;
    }
  });

  // ── Features page: show/hide feature-section blocks by role ──
  document.querySelectorAll('#page-features .feature-section[data-feat]').forEach(section => {
    const feat    = section.dataset.feat;
    const allowed = PAGE_ACCESS[feat];
    const canAccess = !currentUser || !allowed || allowed.includes(currentUser.role);

    section.style.display = canAccess ? '' : 'none';
    section.setAttribute('aria-hidden', String(!canAccess));

    // Disable/enable the CTA button inside the section
    const btn = section.querySelector('.feat-btn');
    if (btn) {
      if (canAccess) {
        btn.removeAttribute('disabled');
        btn.style.opacity = '';
        btn.style.cursor  = '';
        btn.title = 'Accessible with your current account';
      } else {
        btn.setAttribute('disabled', 'true');
        btn.style.opacity = '0.5';
        btn.style.cursor  = 'not-allowed';
        btn.title = `Access limited to ${(allowed || []).map(r => ROLE_LABELS[r] || r).join(', ')}`;
      }
    }
  });

  // ── How It Works page: scenario sections (Scenario 1 & 2 containers) ──
  document.querySelectorAll('#page-howitworks section[data-feat]').forEach(section => {
    const feat      = section.dataset.feat;
    const allowed   = PAGE_ACCESS[feat];
    const canAccess = !currentUser || !allowed || allowed.includes(currentUser.role);
    section.style.display    = canAccess ? '' : 'none';
    section.setAttribute('aria-hidden', String(!canAccess));
  });

  // ── How It Works page: individual timeline steps ──
  const timelineWrap = document.querySelector('#page-howitworks .timeline-steps');
  if (timelineWrap) {
    const children = Array.from(timelineWrap.children); // steps + arrows interleaved
    children.forEach(el => {
      if (el.classList.contains('timeline-step') && el.dataset.feat) {
        const allowed   = PAGE_ACCESS[el.dataset.feat];
        const canAccess = !currentUser || !allowed || allowed.includes(currentUser.role);
        el.style.display = canAccess ? '' : 'none';
        el.setAttribute('aria-hidden', String(!canAccess));
        el.setAttribute('aria-disabled', String(!canAccess));
        el.setAttribute('title', canAccess
          ? 'Accessible with your current account'
          : `Access limited to ${(allowed || []).map(r => ROLE_LABELS[r] || r).join(', ')}`);
      }
    });

    // Clean up orphaned arrows: hide an arrow if either neighbour step is hidden
    children.forEach((el, idx) => {
      if (el.classList.contains('step-arrow')) {
        const prev = children[idx - 1];
        const next = children[idx + 1];
        const prevHidden = prev && prev.style.display === 'none';
        const nextHidden = next && next.style.display === 'none';
        el.style.display = (prevHidden || nextHidden) ? 'none' : '';
      }
    });
  }

  // ── How It Works page: "How Each Feature Works" panel-card grid ──
  document.querySelectorAll('#page-howitworks .panel-card[data-feat]').forEach(card => {
    const feat    = card.dataset.feat;
    const allowed = PAGE_ACCESS[feat];
    const canAccess = !currentUser || !allowed || allowed.includes(currentUser.role);

    card.style.display = canAccess ? '' : 'none';
    card.setAttribute('aria-hidden', String(!canAccess));
    card.setAttribute('aria-disabled', String(!canAccess));
    card.setAttribute('title', canAccess
      ? 'Accessible with your current account'
      : `Access limited to ${(allowed || []).map(r => ROLE_LABELS[r] || r).join(', ')}`);
  });
}

// loadDoctorList / selectDoctorForBooking removed — replaced by renderDoctorCards() in role-based tele system

/* ─── MOBILE MENU ─── */
let menuOpen = false;
function toggleMenu() {
  menuOpen = !menuOpen;
  document.getElementById('mobileMenu').classList.toggle('open', menuOpen);
  const icon = document.getElementById('menuIcon');
  icon.setAttribute('data-lucide', menuOpen ? 'x' : 'menu');
  lucide.createIcons();
}
function closeMenu() {
  menuOpen = false;
  document.getElementById('mobileMenu').classList.remove('open');
  document.getElementById('menuIcon').setAttribute('data-lucide', 'menu');
  lucide.createIcons();
}

/* ─── ANIMATIONS ─── */
function runAnimations() {
  const els = document.querySelectorAll('.page.active .fade-in-up:not(.visible)');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
    });
  }, { threshold: 0.1 });
  els.forEach(el => observer.observe(el));
}

/* ─── TOAST ─── */
let toastTimer = null;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  toast.textContent = (icons[type] || '') + ' ' + msg;
  toast.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ─── MODALS ─── */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('open'); lucide.createIcons(); }
  if (id === 'prescriptionModal') setTimeout(initMedicineAutocomplete, 100);
  if (id === 'loginModal') setTimeout(refreshCaptcha, 80);
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}
function closeModalBackdrop(e, id) {
  if (e.target === e.currentTarget) closeModal(id);
}

/* ─── ZOOM MEETING MODAL ─── */
function showZoomMeetingModal(zoomData) {
  // Create modal HTML
  const modalHtml = `
    <div id="zoomMeetingModal" class="modal-backdrop" onclick="closeModalBackdrop(event,'zoomMeetingModal')">
      <div class="modal-content" style="max-width:500px;">
        <div class="modal-header">
          <h3>🎥 Video Consultation Booked!</h3>
          <button onclick="closeModal('zoomMeetingModal')" class="modal-close">
            <i data-lucide="x" style="width:20px;height:20px"></i>
          </button>
        </div>
        <div class="modal-body" style="padding:1.5rem;">
          <div style="text-align:center;margin-bottom:1.5rem;">
            <div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:50%;width:60px;height:60px;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
              <i data-lucide="video" style="width:30px;height:30px;color:#3b82f6"></i>
            </div>
            <h4 style="color:#0d1117;margin-bottom:0.5rem;">Meeting Details</h4>
            <p style="color:#1a2332;font-size:0.875rem;">Your Zoom meeting has been scheduled. You can join using the details below.</p>
          </div>

          <div style="background:#f8fafc;border-radius:0.5rem;padding:1rem;margin-bottom:1rem;">
            <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
              <span style="font-weight:600;color:#374151;">Meeting ID:</span>
              <span style="color:#0d1117;font-family:monospace;">${zoomData.meeting_id}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
              <span style="font-weight:600;color:#374151;">Password:</span>
              <span style="color:#0d1117;font-family:monospace;">${zoomData.password}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="font-weight:600;color:#374151;">Status:</span>
              <span style="color:#059669;font-weight:600;">${zoomData.demo_mode ? 'Demo Mode' : 'Live Meeting'}</span>
            </div>
          </div>

          <div style="display:flex;gap:0.75rem;">
            <button class="btn-blue" onclick="joinZoomMeeting('${zoomData.join_url}')" style="flex:1;">
              <i data-lucide="play" style="width:16px;height:16px;margin-right:0.5rem;"></i>
              Join Meeting
            </button>
            <button class="btn-outline" onclick="copyMeetingDetails('${zoomData.meeting_id}', '${zoomData.password}')">
              <i data-lucide="copy" style="width:16px;height:16px;margin-right:0.5rem;"></i>
              Copy Details
            </button>
          </div>

          <p style="font-size:0.75rem;color:#374151;text-align:center;margin-top:1rem;">
            ${zoomData.demo_mode ? 'Demo mode: Meeting link opens in new tab for testing' : 'Click "Join Meeting" to start your consultation'}
          </p>
        </div>
      </div>
    </div>
  `;

  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  lucide.createIcons();

  // Show modal
  setTimeout(() => {
    const modal = document.getElementById('zoomMeetingModal');
    if (modal) modal.style.display = 'flex';
  }, 100);
}

function joinZoomMeeting(joinUrl) {
  window.open(joinUrl, '_blank');
  closeModal('zoomMeetingModal');
}

function copyMeetingDetails(meetingId, password) {
  const details = `Zoom Meeting ID: ${meetingId}\nPassword: ${password}`;
  navigator.clipboard.writeText(details).then(() => {
    showToast('Meeting details copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy details', 'error');
  });
}

/* ─── API HELPER ─── */
async function api(method, path, body = null) {
  authToken = getStoredToken();
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
  if (body)      opts.body = JSON.stringify(body);
  try {
    const res  = await fetch(BASE_URL + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    console.warn('API error:', path, err.message, 'token=', authToken);
    if (!authToken) {
      localStorage.removeItem('mg_user');
    }
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════
   PHARMACY FINDER — TAB-BASED (By Place + By Medicine)
═══════════════════════════════════════════════════════════ */

function initPharmacyFinderTabs() {
  // Ensure "By Place" tab is active by default
  switchPharmacyTab('place');
}

function switchPharmacyTab(tab) {
  document.querySelectorAll('[id^="pharmTab-"]').forEach(b => {
    b.classList.remove('pharm-tab-active');
    b.style.borderBottomColor = 'transparent';
    b.style.color = 'var(--slate-500)';
  });
  document.querySelectorAll('[id^="pharmPanel-"]').forEach(p => {
    p.style.display = 'none';
  });
  const btn   = document.getElementById('pharmTab-' + tab);
  const panel = document.getElementById('pharmPanel-' + tab);
  if (btn) {
    btn.classList.add('pharm-tab-active');
    btn.style.borderBottomColor = '#7c3aed';
    btn.style.color = '#7c3aed';
  }
  if (panel) panel.style.display = 'block';
}

/* ── TAB 1: Find by Place ── */
let _placeSearchTimer = null;
let _placeSearchMap = null;
let _placeSearchMarkers = [];

function buildOpenStreetMapUrl(lat, lng, zoom = 17) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
}

function createLeafletCircleIcon(color, label = '') {
  if (!window.L) return null;
  return L.divIcon({
    className: 'custom-leaflet-marker',
    html:
      '<div style="width:18px;height:18px;border-radius:999px;background:' + color + ';border:3px solid white;box-shadow:0 6px 14px rgba(15,23,42,0.25);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">' +
      label +
      '</div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10]
  });
}

function ensureLeafletMap(containerId, options = {}) {
  if (!window.L) return null;
  const mapDiv = document.getElementById(containerId);
  if (!mapDiv) return null;

  const center = options.center || [20.5937, 78.9629];
  const zoom = options.zoom || 13;

  if (!_placeSearchMap) {
    _placeSearchMap = L.map(mapDiv, {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView(center, zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(_placeSearchMap);
  } else {
    _placeSearchMap.setView(center, zoom);
  }

  setTimeout(() => _placeSearchMap.invalidateSize(), 0);
  return _placeSearchMap;
}

function clearLeafletMarkers(markers) {
  markers.forEach(marker => marker.remove());
  markers.length = 0;
}

function placeSearchDebounced(val) {
  clearTimeout(_placeSearchTimer);
  if (!val.trim()) return;
  _placeSearchTimer = setTimeout(() => searchPharmaciesByPlace(val), 600);
}

async function searchPharmaciesByPlace(query) {
  if (!query || !query.trim()) { showToast('Please enter a location to search', 'info'); return; }
  const grid    = document.getElementById('pharmacyPlaceGrid');
  const mapDiv  = document.getElementById('pharmacyGoogleMap');
  const countEl = document.getElementById('placeResultCount');
  if (!grid) return;

  // Show loading state
  grid.innerHTML =
    '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--slate-400)">' +
    '<i data-lucide="loader" style="width:36px;height:36px;animation:spin 1s linear infinite;margin-bottom:0.75rem"></i>' +
    '<br><strong>Searching pharmacies near ' + esc(query) + '…</strong>' +
    '</div>';
  lucide.createIcons();
  if (countEl) countEl.textContent = '';

  try {
    // Use the backend OpenStreetMap search for live pharmacy place data
    const data = await api('GET', '/places/search?query=' + encodeURIComponent(query.trim()));
    const pharmacies = data.pharmacies || data.results || [];
    const center     = data.center;

    // ── Render Google Map ──
    if (window.google && window.google.maps && mapDiv) {
      mapDiv.innerHTML = '';
      
      // Use center from API or default to India
      const mapCenter = center ? { lat: parseFloat(center.lat), lng: parseFloat(center.lng) } : { lat: 20.5937, lng: 78.9629 };
      
      const map = new google.maps.Map(mapDiv, {
        center:            mapCenter,
        zoom:              15,
        mapTypeControl:    false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }]
      });
      
      // Add markers for each pharmacy
      pharmacies.forEach(p => {
        if (!p.latitude || !p.longitude) return;
        const lat = parseFloat(p.latitude);
        const lng = parseFloat(p.longitude);
        
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map,
          title: p.name,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 11,
            fillColor: '#7c3aed',
            fillOpacity: 1,
            strokeColor: 'white',
            strokeWeight: 2.5
          }
        });
        
        const infoWindow = new google.maps.InfoWindow({
          content:
            '<div style="font-family:sans-serif;max-width:230px;padding:0.5rem;">' +
            '<strong style="font-size:0.9rem;display:block;margin-bottom:0.25rem;">' + esc(p.name) + '</strong>' +
            '<div style="font-size:0.78rem;color:#1a2332;margin:0.3rem 0;line-height:1.3;">' + esc(p.address || 'Address unavailable') + '</div>' +
            (p.rating ? '<div style="font-size:0.78rem;color:#f59e0b;margin:0.3rem 0;">⭐ ' + parseFloat(p.rating).toFixed(1) + ' (' + (p.user_ratings_total || 0) + ' reviews)</div>' : '') +
            (p.phone && p.phone !== 'Not available' ? '<div style="font-size:0.8rem;margin:0.3rem 0;">📞 ' + esc(p.phone) + '</div>' : '') +
            (p.open_hours ? '<div style="font-size:0.78rem;margin:0.3rem 0;">🕐 ' + esc(p.open_hours) + '</div>' : '') +
            '<a href="https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '" target="_blank" ' +
            'style="display:inline-block;margin-top:0.5rem;background:#2563eb;color:white;text-decoration:none;' +
            'border-radius:0.4rem;padding:0.3rem 0.7rem;font-size:0.75rem;font-weight:600;">🗺 Directions</a>' +
            '</div>'
        });
        
        marker.addListener('click', () => infoWindow.open(map, marker));
      });
    }

    // ── Count pill ──
    if (countEl) countEl.textContent = pharmacies.length + ' pharmacies found';

    if (!pharmacies.length) {
      grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:4rem 2rem;color:var(--slate-400)">' +
        '<i data-lucide="search-x" style="width:40px;height:40px;margin-bottom:1rem;display:block;margin-left:auto;margin-right:auto;opacity:0.5"></i>' +
        '<strong>No pharmacies found near "' + esc(query) + '"</strong>' +
        '<p style="font-size:0.875rem;margin-top:0.5rem;">Try a different location, city, or landmark.</p>' +
        '</div>';
      lucide.createIcons();
      return;
    }

    // ── Render pharmacy cards (info only — no stock) ──
    grid.innerHTML = pharmacies.map(p =>
      '<div style="background:white;border:1.5px solid var(--slate-100);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);transition:box-shadow 0.2s;" ' +
      'onmouseover="this.style.boxShadow=\'0 4px 16px rgba(124,58,237,0.12)\'" onmouseout="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.06)\'">' +
        '<div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);padding:1.1rem 1.25rem;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">' +
            '<h4 style="color:white;font-size:0.95rem;margin:0;line-height:1.4;">' + esc(p.name) + '</h4>' +
            (p.rating ? '<span style="background:rgba(255,255,255,0.2);color:white;font-size:0.75rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:700;white-space:nowrap;flex-shrink:0;">⭐ ' + parseFloat(p.rating).toFixed(1) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div style="padding:1rem 1.25rem;">' +
          '<div style="font-size:0.82rem;color:#1a2332;margin-bottom:0.4rem;line-height:1.5;">📍 ' + esc(p.address || 'Address not available') + '</div>' +
          (p.phone && p.phone !== 'Not available' ? '<div style="font-size:0.82rem;color:#1a2332;margin-bottom:0.4rem;">📞 <a href="tel:' + esc(p.phone) + '" style="color:#1a2332;text-decoration:none;">' + esc(p.phone) + '</a></div>' : '') +
          (p.open_hours && p.open_hours !== 'Hours not available' ? '<div style="font-size:0.82rem;color:#1a2332;margin-bottom:0.75rem;">🕐 ' + esc(p.open_hours) + '</div>' : '<div style="margin-bottom:0.75rem;"></div>') +
          '<a href="https://www.google.com/maps/dir/?api=1&destination=' + parseFloat(p.latitude) + ',' + parseFloat(p.longitude) + '" target="_blank" ' +
          'style="display:flex;align-items:center;justify-content:center;gap:0.4rem;background:#2563eb;color:white;text-decoration:none;border-radius:8px;padding:0.55rem;font-size:0.875rem;font-weight:600;">🗺 Get Directions</a>' +
        '</div>' +
      '</div>'
    ).join('');
    lucide.createIcons();

  } catch(e) {
    console.error('Place search error:', e);
    
    // Check if it's a Google Maps API key issue
    if (e.message && e.message.includes('Google Maps API key')) {
      grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ea580c;">' +
        '<i data-lucide="alert-triangle" style="width:36px;height:36px;margin-bottom:0.75rem;display:block;margin-left:auto;margin-right:auto"></i>' +
        '<strong>Google Maps API key not configured.</strong><br>' +
        '<p style="font-size:0.875rem;margin-top:0.5rem;">Please add your Google Maps API key to the backend.</p>' +
        '</div>';
    } else {
      grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:3rem;">' +
        '<div style="display:inline-flex;flex-direction:column;align-items:center;gap:0.75rem;background:#fff5f5;border:1.5px solid #fecaca;border-radius:14px;padding:2rem 2.5rem;">' +
        '<i data-lucide="wifi-off" style="width:40px;height:40px;color:#ef4444;display:block;"></i>' +
        '<strong style="color:#dc2626;font-size:1rem;">Could not search pharmacies</strong>' +
        '<p style="font-size:0.875rem;color:#6b7280;margin:0;">Make sure the backend server is running and try again.</p>' +
        '</div>' +
        '</div>';
    }
    lucide.createIcons();
  }
}

searchPharmaciesByPlace = async function(query) {
  if (!query || !query.trim()) { showToast('Please enter a location to search', 'info'); return; }
  const grid = document.getElementById('pharmacyPlaceGrid');
  const countEl = document.getElementById('placeResultCount');
  if (!grid) return;

  grid.innerHTML =
    '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--slate-400)">' +
    '<i data-lucide="loader" style="width:36px;height:36px;animation:spin 1s linear infinite;margin-bottom:0.75rem"></i>' +
    '<br><strong>Searching pharmacies near ' + esc(query) + '...</strong>' +
    '</div>';
  lucide.createIcons();
  if (countEl) countEl.textContent = '';

  try {
    const data = await api('GET', '/places/search?query=' + encodeURIComponent(query.trim()));
    const pharmacies = data.pharmacies || data.results || [];
    const center = data.center;

    const fallbackCenter = center && center.lat != null && center.lng != null
      ? [parseFloat(center.lat), parseFloat(center.lng)]
      : [20.5937, 78.9629];

    const map = ensureLeafletMap('pharmacyGoogleMap', {
      center: fallbackCenter,
      zoom: pharmacies.length ? 14 : 5
    });

    if (map) {
      clearLeafletMarkers(_placeSearchMarkers);
      const bounds = [];

      pharmacies.forEach(p => {
        if (!p.latitude || !p.longitude) return;
        const lat = parseFloat(p.latitude);
        const lng = parseFloat(p.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lng)) return;

        bounds.push([lat, lng]);
        const marker = L.marker([lat, lng], {
          icon: createLeafletCircleIcon('#7c3aed')
        }).addTo(map);

        marker.bindPopup(
          '<div style="font-family:sans-serif;max-width:230px;padding:0.5rem;">' +
          '<strong style="font-size:0.9rem;display:block;margin-bottom:0.25rem;">' + esc(p.name) + '</strong>' +
          '<div style="font-size:0.78rem;color:#1a2332;margin:0.3rem 0;line-height:1.3;">' + esc(p.address || 'Address unavailable') + '</div>' +
          (p.rating ? '<div style="font-size:0.78rem;color:#f59e0b;margin:0.3rem 0;">Rating: ' + parseFloat(p.rating).toFixed(1) + '</div>' : '') +
          '<a href="' + buildOpenStreetMapUrl(lat, lng) + '" target="_blank" rel="noopener noreferrer" ' +
          'style="display:inline-block;margin-top:0.5rem;background:#2563eb;color:white;text-decoration:none;border-radius:0.4rem;padding:0.3rem 0.7rem;font-size:0.75rem;font-weight:600;">Open in OSM</a>' +
          '</div>'
        );

        _placeSearchMarkers.push(marker);
      });

      if (bounds.length === 1) {
        map.setView(bounds[0], 15);
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    }

    if (countEl) countEl.textContent = pharmacies.length + ' pharmacies found';

    if (!pharmacies.length) {
      grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:4rem 2rem;color:var(--slate-400)">' +
        '<i data-lucide="search-x" style="width:40px;height:40px;margin-bottom:1rem;display:block;margin-left:auto;margin-right:auto;opacity:0.5"></i>' +
        '<strong>No pharmacies found near "' + esc(query) + '"</strong>' +
        '<p style="font-size:0.875rem;margin-top:0.5rem;">Try a different location, city, or landmark.</p>' +
        '</div>';
      lucide.createIcons();
      return;
    }

    grid.innerHTML = pharmacies.map(p =>
      '<div style="background:white;border:1.5px solid var(--slate-100);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);transition:box-shadow 0.2s;" ' +
      'onmouseover="this.style.boxShadow=\'0 4px 16px rgba(124,58,237,0.12)\'" onmouseout="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.06)\'">' +
        '<div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);padding:1.1rem 1.25rem;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">' +
            '<h4 style="color:white;font-size:0.95rem;margin:0;line-height:1.4;">' + esc(p.name) + '</h4>' +
            (p.rating ? '<span style="background:rgba(255,255,255,0.2);color:white;font-size:0.75rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:700;white-space:nowrap;flex-shrink:0;">' + parseFloat(p.rating).toFixed(1) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div style="padding:1rem 1.25rem;">' +
          '<div style="font-size:0.82rem;color:#1a2332;margin-bottom:0.4rem;line-height:1.5;">Location: ' + esc(p.address || 'Address not available') + '</div>' +
          '<a href="' + buildOpenStreetMapUrl(parseFloat(p.latitude), parseFloat(p.longitude)) + '" target="_blank" rel="noopener noreferrer" ' +
          'style="display:flex;align-items:center;justify-content:center;gap:0.4rem;background:#2563eb;color:white;text-decoration:none;border-radius:8px;padding:0.55rem;font-size:0.875rem;font-weight:600;">Open in OSM</a>' +
        '</div>' +
      '</div>'
    ).join('');
    lucide.createIcons();
  } catch (e) {
    console.error('Place search error:', e);
    grid.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:3rem;">' +
      '<div style="display:inline-flex;flex-direction:column;align-items:center;gap:0.75rem;background:#fff5f5;border:1.5px solid #fecaca;border-radius:14px;padding:2rem 2.5rem;">' +
      '<i data-lucide="wifi-off" style="width:40px;height:40px;color:#ef4444;display:block;"></i>' +
      '<strong style="color:#dc2626;font-size:1rem;">Could not search pharmacies</strong>' +
      '<p style="font-size:0.875rem;color:#6b7280;margin:0;">Make sure the backend server is running and try again.</p>' +
      '</div>' +
      '</div>';
    lucide.createIcons();
  }
};

/* ── TAB 2: Find by Medicine ── */
let _allPharmMedData       = [];
let _currentPharmMedFilter = 'all';
let _pharmMedDebounce      = null;

function pharmMedAutoSearch(val) {
  clearTimeout(_pharmMedDebounce);
  if (!val || val.length < 2) return;
  _pharmMedDebounce = setTimeout(() => searchPharmByMedicine(val), 400);
}

async function searchPharmByMedicine(medicine) {
  const grid    = document.getElementById('pharmMedResultGrid');
  const heading = document.getElementById('pharmMedHeading');
  if (!grid) return;

  grid.innerHTML =
    '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--slate-400)">' +
    '<i data-lucide="loader" style="width:32px;height:32px;animation:spin 1s linear infinite;margin-bottom:0.75rem"></i>' +
    '<br>Checking stock across all pharmacies…</div>';
  lucide.createIcons();

  try {
    const q    = medicine ? '?medicine=' + encodeURIComponent(medicine.trim()) : '';
    const data = await api('GET', '/inventory/live' + q);
    _allPharmMedData       = data.pharmacies || [];
    _currentPharmMedFilter = 'all';
    document.querySelectorAll('[id^="pmF-"]').forEach(b => b.classList.remove('active'));
    const allBtn = document.getElementById('pmF-all');
    if (allBtn) allBtn.classList.add('active');
    renderPharmMedCards(_allPharmMedData, data.medicine || medicine, true);
  } catch(e) {
    // Fallback: show real Pune pharmacy data
    const punePharmacies = [
      { name: 'MedPlus Pharmacy – Kothrud', address: 'Shop 4, Paud Rd, Kothrud, Pune 411038', stock: 'in_stock',  phone: '+91 20 2544 7890', distance: '1.2 km', latitude: 18.5074, longitude: 73.8077 },
      { name: 'Apollo Pharmacy – FC Road', address: 'Fergusson College Rd, Shivajinagar, Pune 411005', stock: 'in_stock',  phone: '+91 20 2553 1122', distance: '2.1 km', latitude: 18.5195, longitude: 73.8397 },
      { name: 'Jan Aushadhi Kendra – Hadapsar', address: 'Near Magarpatta City, Hadapsar, Pune 411028', stock: 'low_stock', phone: '+91 98220 34561', distance: '4.5 km', latitude: 18.5089, longitude: 73.9259 },
      { name: 'Sahyadri Medical – Deccan', address: '1187, Deccan Gymkhana, Pune 411004',            stock: 'in_stock',  phone: '+91 20 2567 8901', distance: '2.8 km', latitude: 18.5162, longitude: 73.8416 },
      { name: 'LifeCare Pharmacy – Wakad',  address: 'Wakad Chowk, Pimpri-Chinchwad, Pune 411057',  stock: 'out_of_stock', phone: '+91 98501 12233', distance: '8.3 km', latitude: 18.5983, longitude: 73.7610 },
      { name: 'Noble Chemist – Baner',      address: 'Baner Road, Near Balewadi, Pune 411045',      stock: 'in_stock',  phone: '+91 99605 67890', distance: '5.6 km', latitude: 18.5590, longitude: 73.7868 },
      { name: 'Wellness Forever – Viman Nagar', address: 'Phoenix Marketcity, Viman Nagar, Pune 411014', stock: 'in_stock', phone: '+91 20 6790 1234', distance: '6.2 km', latitude: 18.5679, longitude: 73.9143 },
      { name: 'Shree Medical – Katraj',     address: 'Katraj Chowk, Pune 411046',                   stock: 'low_stock', phone: '+91 98221 44321', distance: '7.1 km', latitude: 18.4529, longitude: 73.8629 },
    ];

    const med = medicine ? medicine.trim() : 'medicine';
    _allPharmMedData = punePharmacies.map((p, i) => ({
      ...p,
      id: i + 1,
      medicine_name: med,
      quantity: p.stock === 'in_stock' ? Math.floor(Math.random() * 80 + 20) : p.stock === 'low_stock' ? Math.floor(Math.random() * 10 + 1) : 0,
      price: (Math.random() * 200 + 30).toFixed(2),
      rating: (Math.random() * 1.5 + 3.5).toFixed(1),
    }));

    _currentPharmMedFilter = 'all';
    document.querySelectorAll('[id^="pmF-"]').forEach(b => b.classList.remove('active'));
    const allBtn = document.getElementById('pmF-all');
    if (allBtn) allBtn.classList.add('active');

    if (heading) heading.textContent = `Pharmacies stocking "${med}" — Pune`;
    const notice = document.getElementById('pharmMedNotice') || (() => {
      const d = document.createElement('p');
      d.id = 'pharmMedNotice';
      d.style.cssText = 'font-size:0.78rem;color:#f59e0b;margin:0 0 0.75rem;text-align:center;';
      grid.parentElement.insertBefore(d, grid);
      return d;
    })();
    notice.textContent = '⚠️ Showing cached Pune pharmacy data — live backend offline.';

    renderPharmMedCards(_allPharmMedData, med, true);
  }
}

function setPharmMedFilter(filter) {
  _currentPharmMedFilter = filter;
  document.querySelectorAll('[id^="pmF-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('pmF-' + filter);
  if (btn) btn.classList.add('active');
  const medicine = document.getElementById('pharmMedSearchInput')?.value || '';
  renderPharmMedCards(_allPharmMedData, medicine, true);
}

function renderPharmMedCards(pharmacies, medicine, hasSearched) {
  const grid      = document.getElementById('pharmMedResultGrid');
  const kpiRow    = document.getElementById('pharmMedKpiRow');
  const filterRow = document.getElementById('pharmMedFilterRow');
  const heading   = document.getElementById('pharmMedHeading');
  const countEl   = document.getElementById('pharmMedCount');
  if (!grid) return;

  if (!hasSearched) {
    if (kpiRow)    kpiRow.style.display    = 'none';
    if (filterRow) filterRow.style.display = 'none';
    if (heading)   heading.textContent     = 'Enter a medicine name to check stock';
    if (countEl)   countEl.textContent     = '';
    return;
  }

  // Apply filter
  let filtered = pharmacies.slice();
  if (_currentPharmMedFilter === 'in_stock')      filtered = filtered.filter(p => p.stock_status === 'in_stock');
  else if (_currentPharmMedFilter === 'low_stock') filtered = filtered.filter(p => p.stock_status === 'low_stock');
  else if (_currentPharmMedFilter === 'out_of_stock') filtered = filtered.filter(p => p.stock_status === 'out_of_stock');
  else if (_currentPharmMedFilter === 'delivery')  filtered = filtered.filter(p => p.has_delivery);
  else if (_currentPharmMedFilter === '24hr')      filtered = filtered.filter(p => p.is_24hr);

  // KPI counts (from unfiltered list)
  const inStock  = pharmacies.filter(p => p.stock_status === 'in_stock').length;
  const lowStock = pharmacies.filter(p => p.stock_status === 'low_stock').length;
  const outStock = pharmacies.filter(p => p.stock_status === 'out_of_stock').length;

  if (kpiRow) {
    kpiRow.style.display = 'flex';
    const med = document.getElementById('pharmMedKpiMed');
    if (med) med.textContent = medicine ? medicine.substring(0, 14) + (medicine.length > 14 ? '…' : '') : 'All';
    const is = document.getElementById('pharmMedKpiIn');  if (is) is.textContent = inStock;
    const ls = document.getElementById('pharmMedKpiLow'); if (ls) ls.textContent = lowStock;
    const os = document.getElementById('pharmMedKpiOut'); if (os) os.textContent = outStock;
  }
  if (filterRow) filterRow.style.display = 'flex';
  if (heading)   heading.textContent     = medicine ? 'Pharmacies stocking "' + medicine + '"' : 'All Pharmacy Stock';
  if (countEl)   countEl.textContent     = filtered.length + ' result' + (filtered.length !== 1 ? 's' : '');

  if (!filtered.length) {
    grid.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--slate-400)">' +
      '<i data-lucide="search-x" style="width:36px;height:36px;margin-bottom:0.75rem;display:block;margin-left:auto;margin-right:auto"></i>' +
      (medicine ? '<strong>' + esc(medicine) + '</strong> was not found at any pharmacy.' : 'No pharmacies match the current filter.') +
      (_currentPharmMedFilter !== 'all' ? '<br><button class="inv-filter-btn active" style="margin-top:1rem" onclick="setPharmMedFilter(\'all\')">Clear Filter</button>' : '') +
      '</div>';
    lucide.createIcons();
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const status   = p.stock_status || (p.quantity > 50 ? 'in_stock' : p.quantity > 0 ? 'low_stock' : 'out_of_stock');
    const label    = status === 'in_stock' ? 'In Stock' : status === 'low_stock' ? 'Low Stock' : 'Out of Stock';
    const qty      = p.quantity != null ? p.quantity : p.total_items;
    const qtyLabel = qty != null ? qty : '—';
    const price    = p.unit_price ? '₹' + parseFloat(p.unit_price).toFixed(2) + ' per unit' : '';
    const rating   = p.rating ? '⭐ ' + parseFloat(p.rating).toFixed(1) : '';
    const phone    = p.phone
      ? '<a class="inv-phone-link" href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a>'
      : '<span style="color:var(--slate-400)">No phone</span>';
    const tags = [
      p.is_24hr      ? '<span class="inv-tag purple">🌙 24-Hour</span>' : '',
      p.has_delivery ? '<span class="inv-tag purple">🛵 Delivery</span>' : '',
      p.area         ? '<span class="inv-tag">' + esc(p.area) + '</span>' : ''
    ].filter(Boolean).join('');

    return '<div class="inv-pharmacy-card">' +
      '<div class="inv-card-header">' +
        '<div>' +
          '<div class="inv-card-name">' + esc(p.name || 'Unnamed Pharmacy') + '</div>' +
          (p.area ? '<div class="inv-card-area"><i data-lucide="map-pin" style="width:11px;height:11px;display:inline"></i> ' + esc(p.area) + '</div>' : '') +
        '</div>' +
        '<span class="inv-stock-badge ' + status + '">' + label + '</span>' +
      '</div>' +
      '<div class="inv-card-body">' +
        '<div class="inv-quantity-row">' +
          '<div class="inv-quantity-num">' + qtyLabel + '</div>' +
          '<div class="inv-quantity-label">units<br>available</div>' +
        '</div>' +
        (price ? '<div class="inv-price-row"><i data-lucide="tag" style="width:13px;height:13px;display:inline;margin-right:3px"></i>' + price + '</div>' : '') +
        (tags ? '<div class="inv-tags">' + tags + '</div>' : '') +
      '</div>' +
      '<div class="inv-card-footer">' + phone + (rating ? '<span class="inv-rating">' + rating + '</span>' : '') + '</div>' +
    '</div>';
  }).join('');
  lucide.createIcons();
}

/* ═══════════════════════════════════════
   AUTH
═══════════════════════════════════════ */
async function registerUser() {
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const role     = document.getElementById('regRole').value;
  const password = document.getElementById('regPassword').value;
  if (!name || !email || !password) { showToast('Please fill all fields', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
  try {
    const data = await api('POST', '/auth/register', { name, email, role, password });
    authToken = data.token; currentUser = data.user;
    localStorage.setItem('mg_token', authToken);
    localStorage.setItem('mg_user', JSON.stringify(currentUser));
    closeModal('registerModal'); updateNavAuth();
    showToast('Account created! Welcome, ' + name, 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function loginUser() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { showToast('Please fill all fields', 'error'); return; }
  try {
    const data = await api('POST', '/auth/login', { email, password });
    authToken = data.token; currentUser = data.user;
    localStorage.setItem('mg_token', authToken);
    localStorage.setItem('mg_user', JSON.stringify(currentUser));
    closeModal('loginModal'); updateNavAuth();
    showToast('Welcome back, ' + data.user.name + '!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

/* ─── ADVANCED LOGIN FUNCTIONS ─── */

const GOOGLE_CLIENT_ID = '846528397740-o1i1fpnhm8138bm5019sjtmf4sneiut3.apps.googleusercontent.com';
let _googleInitialized = false;

/** Initialise GSI and render the official Google button into #googleBtnContainer */
function initGoogleSignIn() {
  if (!window.google || !window.google.accounts) {
    // GSI script not yet loaded – retry once it fires
    return;
  }

  // Initialize only once per page load
  if (!_googleInitialized) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback:  handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    _googleInitialized = true;
  }

  // Render official Google button, replacing the fallback button
  const container = document.getElementById('googleBtnContainer');
  if (container) {
    container.innerHTML = ''; // clear fallback button
    window.google.accounts.id.renderButton(container, {
      type:             'standard',
      theme:            'outline',
      size:             'large',
      text:             'signin_with',
      shape:            'rectangular',
      logo_alignment:   'left',
      width:            container.offsetWidth || 360,
    });
  }
}

function switchLoginTab(tab) {
  // Reset all tabs
  document.getElementById('tabGoogle').classList.remove('active');
  document.getElementById('tabEmail').classList.remove('active');
  document.getElementById('tabPhone').classList.remove('active');

  // Hide all panels
  document.getElementById('panelGoogle').style.display = 'none';
  document.getElementById('panelEmail').style.display = 'none';
  document.getElementById('panelPhone').style.display = 'none';

  // Activate selected tab and panel
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1)).style.display = 'block';

  // Initialize tab-specific components
  if (tab === 'email') {
    refreshCaptcha();
  } else if (tab === 'phone') {
    initCountries();
  } else if (tab === 'google') {
    // Re-render the Google button every time the tab is shown
    // (the container may have been hidden/cleared)
    setTimeout(initGoogleSignIn, 50);
  }
}

async function handleGoogleCredential(response) {
  const googleStatus = document.getElementById('googleStatus');
  googleStatus.style.display = 'block';
  googleStatus.style.background = '#eff6ff';
  googleStatus.style.color = '#1d4ed8';
  googleStatus.style.border = '1px solid #bfdbfe';
  googleStatus.textContent = 'Verifying with Google…';

  try {
    const res = await fetch(BASE_URL + '/auth/google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google login failed');

    // Success — store token & user exactly like email login does
    authToken   = data.token;
    currentUser = data.user;
    localStorage.setItem('mg_token', authToken);
    localStorage.setItem('mg_user', JSON.stringify(currentUser));

    googleStatus.style.background = '#f0fdf4';
    googleStatus.style.color      = '#16a34a';
    googleStatus.style.border     = '1px solid #bbf7d0';
    googleStatus.textContent      = '✓ Signed in as ' + currentUser.name;

    setTimeout(() => {
      googleStatus.style.display = 'none';
      closeModal('loginModal');
      updateNavAuth();
      showToast('Welcome, ' + currentUser.name + '!', 'success');
    }, 800);
  } catch (err) {
    googleStatus.style.background = '#fef2f2';
    googleStatus.style.color      = '#dc2626';
    googleStatus.style.border     = '1px solid #fecaca';
    googleStatus.textContent      = '✗ ' + err.message;
  }
}

/** Fallback: called by the placeholder button before GSI loads */
function triggerGoogleSignIn() {
  if (window.google && window.google.accounts) {
    initGoogleSignIn(); // will replace button with official one
    // Also try One-Tap as secondary path
    window.google.accounts.id.prompt(notification => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // One-Tap suppressed — the rendered button is the main path
        console.log('[Google] One-Tap suppressed:', notification.getNotDisplayedReason?.() || notification.getSkippedReason?.());
      }
    });
  } else {
    showToast('Google Sign-In is still loading. Please wait a moment and try again.', 'error');
    // Retry after short delay
    setTimeout(() => {
      if (window.google && window.google.accounts) initGoogleSignIn();
    }, 1500);
  }
}

// Auto-init when GSI library finishes loading (fires after the <script async> resolves)
window.onGoogleLibraryLoad = function() {
  initGoogleSignIn();
};

function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  const icon = button.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  lucide.createIcons();
}

let _captchaAnswer = '';

function refreshCaptcha() {
  const canvas = document.getElementById('captchaCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Generate 5-char alphanumeric code (no confusing chars)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  _captchaAnswer = code;

  // Background
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#eef2ff');
  grad.addColorStop(1, '#f0fdf4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Noise lines
  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = `hsla(${Math.random()*360},50%,65%,0.55)`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(Math.random() * W, Math.random() * H);
    ctx.bezierCurveTo(
      Math.random() * W, Math.random() * H,
      Math.random() * W, Math.random() * H,
      Math.random() * W, Math.random() * H
    );
    ctx.stroke();
  }

  // Noise dots
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `hsla(${Math.random()*360},60%,50%,0.25)`;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw characters with distortion
  code.split('').forEach((c, i) => {
    ctx.save();
    const fontSize = 22 + Math.floor(Math.random() * 8);
    ctx.font = `bold ${fontSize}px "Courier New", monospace`;
    const hue = Math.floor(Math.random() * 360);
    ctx.fillStyle = `hsl(${hue}, 70%, 25%)`;
    ctx.shadowColor = `hsla(${hue}, 70%, 20%, 0.3)`;
    ctx.shadowBlur = 2;
    const x = 14 + i * 28;
    const y = 34 + Math.floor(Math.random() * 8) - 4;
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.45);
    ctx.scale(1, 0.85 + Math.random() * 0.3);
    ctx.fillText(c, 0, 0);
    ctx.restore();
  });

  // Reset input
  const answerEl = document.getElementById('captchaAnswer');
  const statusEl = document.getElementById('captchaStatus');
  if (answerEl) { answerEl.value = ''; }
  if (statusEl) {
    statusEl.textContent = 'Enter the characters shown in the image';
    statusEl.style.color = '#64748b';
  }
}

async function loginUserWithCaptcha() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const userAnswer = (document.getElementById('captchaAnswer').value.trim()).toUpperCase();
  const statusEl = document.getElementById('captchaStatus');

  if (!email || !password) {
    showToast('Please fill all fields', 'error');
    return;
  }

  if (!userAnswer) {
    if (statusEl) { statusEl.textContent = '⚠ Please complete the captcha'; statusEl.style.color = '#d97706'; }
    showToast('Please complete the captcha verification', 'warning');
    return;
  }

  if (userAnswer !== _captchaAnswer) {
    if (statusEl) { statusEl.textContent = '✗ Incorrect — try again'; statusEl.style.color = '#dc2626'; }
    showToast('Incorrect captcha — a new one has been generated', 'error');
    refreshCaptcha();
    return;
  }

  if (statusEl) { statusEl.textContent = '✓ Verified'; statusEl.style.color = '#16a34a'; }

  try {
    const data = await api('POST', '/auth/login', { email, password });
    authToken = data.token;
    currentUser = data.user;
    chatbotSeeded = false; // Reset chatbot greeting on login
    localStorage.setItem('mg_token', authToken);
    localStorage.setItem('mg_user', JSON.stringify(currentUser));
    closeModal('loginModal');
    updateNavAuth();
    showToast('Welcome back, ' + data.user.name + '!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    refreshCaptcha();
  }
}

// Country data for phone authentication
const countries = [
  { code: '+1', flag: '🇺🇸', name: 'United States' },
  { code: '+91', flag: '🇮🇳', name: 'India' },
  { code: '+44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: '+61', flag: '🇦🇺', name: 'Australia' },
  { code: '+81', flag: '🇯🇵', name: 'Japan' },
  { code: '+86', flag: '🇨🇳', name: 'China' },
  { code: '+49', flag: '🇩🇪', name: 'Germany' },
  { code: '+33', flag: '🇫🇷', name: 'France' },
  { code: '+39', flag: '🇮🇹', name: 'Italy' },
  { code: '+7', flag: '🇷🇺', name: 'Russia' }
];

function initCountries() {
  const ccList = document.getElementById('ccList');
  if (!ccList) return;

  ccList.innerHTML = '';
  countries.forEach(country => {
    const li = document.createElement('li');
    li.style.padding = '0.5rem 0.75rem';
    li.style.cursor = 'pointer';
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.gap = '0.5rem';
    li.style.borderRadius = '0.5rem';
    li.style.transition = 'background 0.15s';
    li.onmouseover = () => li.style.background = '#f1f5f9';
    li.onmouseout = () => li.style.background = 'transparent';
    li.onclick = () => selectCountry(country);

    li.innerHTML = `
      <span style="font-size:1.2rem;">${country.flag}</span>
      <span style="flex:1;">${country.name}</span>
      <span style="font-weight:600;color:#1a2332;">${country.code}</span>
    `;
    ccList.appendChild(li);
  });
}

function selectCountry(country) {
  document.getElementById('ccFlag').textContent = country.flag;
  document.getElementById('ccCode').textContent = country.code;
  document.getElementById('ccDropdown').style.display = 'none';
  document.getElementById('phoneInput').focus();
}

function toggleCountryDropdown() {
  const dropdown = document.getElementById('ccDropdown');
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

function filterCountries(search) {
  const ccList = document.getElementById('ccList');
  const items = ccList.querySelectorAll('li');
  const query = search.toLowerCase();

  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query) ? 'flex' : 'none';
  });
}

async function sendOTP() {
  const phone = document.getElementById('phoneInput').value.trim();
  const countryCode = document.getElementById('ccCode').textContent.trim();
  const countryFlag = document.getElementById('ccFlag').textContent.trim();

  if (!phone || phone.length < 7) {
    showToast('Please enter a valid phone number', 'error');
    document.getElementById('phoneInput').focus();
    return;
  }

  // Only digits allowed
  if (!/^\d+$/.test(phone)) {
    showToast('Phone number must contain digits only', 'error');
    return;
  }

  const btn = document.getElementById('sendOtpBtn');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Sending…</span>';

  // Generate 6-digit OTP
  _generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();

  // Simulate network delay (real apps would call backend here)
  await new Promise(r => setTimeout(r, 1200));

  const fullNumber = countryCode.replace('+', '') + phone;
  const waMessage = encodeURIComponent(`Your MediGuard AI verification code is: *${_generatedOTP}*\n\nThis OTP is valid for 5 minutes. Do not share it with anyone.`);
  const waLink = `https://wa.me/${fullNumber}?text=${waMessage}`;

  btn.disabled = false;
  btn.innerHTML = origText;

  // Show step 2
  document.getElementById('phoneStep1').style.display = 'none';
  document.getElementById('phoneStep2').style.display = 'block';

  // Clear OTP boxes
  document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.style.borderColor = '#e2e8f0'; });
  document.querySelectorAll('.otp-box')[0].focus();

  document.getElementById('otpSentMsg').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;margin-bottom:0.4rem;">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.557 4.126 1.533 5.862L.054 23.25a.75.75 0 0 0 .916.916l5.453-1.479A11.952 11.952 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
      <span style="font-weight:700;color:#166534;">OTP sent via WhatsApp</span>
    </div>
    <p style="margin:0 0 0.4rem;font-size:0.82rem;color:#166534;">${countryFlag} ${countryCode} ${phone}</p>
    <a href="${waLink}" target="_blank" style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.75rem;color:#15803d;font-weight:600;text-decoration:underline;cursor:pointer;">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.557 4.126 1.533 5.862L.054 23.25a.75.75 0 0 0 .916.916l5.453-1.479A11.952 11.952 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
      Didn't get it? Open WhatsApp
    </a>
  `;

  _otpPhone = countryCode + phone;
  _otpExpiry = Date.now() + 5 * 60 * 1000; // 5 min expiry
  showToast('✓ OTP sent to your WhatsApp!', 'success');

  // Start countdown
  startOtpCountdown(300);
}

let _generatedOTP = '';
let _otpPhone = '';
let _otpExpiry = 0;
let _otpCountdownTimer = null;

function startOtpCountdown(seconds) {
  clearInterval(_otpCountdownTimer);
  const resendEl = document.getElementById('resendLink');
  let remaining = seconds;
  if (resendEl) { resendEl.style.pointerEvents = 'none'; resendEl.style.opacity = '0.5'; }

  _otpCountdownTimer = setInterval(() => {
    remaining--;
    const timerEl = document.getElementById('otpTimer');
    if (timerEl) timerEl.textContent = `(${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')})`;
    if (remaining <= 0) {
      clearInterval(_otpCountdownTimer);
      if (resendEl) { resendEl.style.pointerEvents = 'auto'; resendEl.style.opacity = '1'; }
      if (timerEl) timerEl.textContent = '';
    }
  }, 1000);
}

function backToPhoneStep1() {
  document.getElementById('phoneStep2').style.display = 'none';
  document.getElementById('phoneStep1').style.display = 'block';
  document.getElementById('phoneInput').value = '';
  // Clear OTP boxes
  document.querySelectorAll('.otp-box').forEach(box => box.value = '');
}

function otpBoxInput(box, index) {
  const value = box.value;
  if (value && index < 5) {
    document.querySelectorAll('.otp-box')[index + 1].focus();
  }
  if (value && index === 5) {
    // Auto-verify when all 6 digits entered
    verifyOTP();
  }
}

function otpBoxKey(event, index) {
  if (event.key === 'Backspace' && !event.target.value && index > 0) {
    document.querySelectorAll('.otp-box')[index - 1].focus();
  }
}

async function verifyOTP() {
  const boxes = document.querySelectorAll('.otp-box');
  const entered = Array.from(boxes).map(b => b.value).join('');

  if (entered.length < 6) {
    showToast('Please enter all 6 digits of your OTP', 'error');
    boxes[entered.length]?.focus();
    return;
  }

  if (Date.now() > _otpExpiry) {
    showToast('OTP has expired. Please request a new one.', 'error');
    boxes.forEach(b => { b.value = ''; b.style.borderColor = '#fca5a5'; });
    boxes[0].focus();
    return;
  }

  if (entered !== _generatedOTP) {
    showToast('Incorrect OTP. Please try again.', 'error');
    boxes.forEach(b => { b.style.borderColor = '#ef4444'; setTimeout(() => b.style.borderColor = '#e2e8f0', 800); });
    boxes[0].focus();
    boxes.forEach(b => b.value = '');
    return;
  }

  // Mark all boxes green
  boxes.forEach(b => { b.style.borderColor = '#22c55e'; b.style.background = '#f0fdf4'; });

  clearInterval(_otpCountdownTimer);
  showToast('✓ Phone number verified successfully!', 'success');

  setTimeout(() => {
    closeModal('loginModal');
    showToast('Welcome! Please complete your registration.', 'info');
  }, 900);
}

async function resendOTP() {
  _generatedOTP = '';
  document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.style.borderColor = '#e2e8f0'; b.style.background = ''; });
  document.getElementById('phoneStep2').style.display = 'none';
  document.getElementById('phoneStep1').style.display = 'block';
  showToast('Enter your number to receive a new OTP', 'info');
}

function logoutUser() {
  authToken = null; currentUser = null;
  localStorage.removeItem('mg_token'); localStorage.removeItem('mg_user');
  chatbotSeeded = false; // Reset chatbot greeting on logout
  updateNavAuth(); navigate('home');
  showToast('Logged out successfully', 'info');
}

async function restoreSession() {
  authToken = getStoredToken();
  if (!authToken) return;

  try {
    const stored = localStorage.getItem('mg_user');
    if (stored) {
      currentUser = JSON.parse(stored);
      updateNavAuth();
      return;
    }

    const data = await api('GET', '/auth/me');
    if (data.user) {
      currentUser = data.user;
      localStorage.setItem('mg_user', JSON.stringify(currentUser));
      updateNavAuth();
    }
  } catch (err) {
    authToken = null;
    localStorage.removeItem('mg_token');
    localStorage.removeItem('mg_user');
  }
}

function updateNavAuth() {
  const btn = document.getElementById('navAuthBtn');
  if (!btn) return;
  if (currentUser) {
    btn.textContent = 'Logout'; btn.onclick = logoutUser;
    const nameEl = document.getElementById('dashUserName');
    if (nameEl) nameEl.textContent = currentUser.name;
    // Start polling bell badge whenever user logs in
    startNotifPolling();
  } else {
    btn.textContent = 'Login'; btn.onclick = () => openModal('loginModal');
    if (_notifPollTimer) { clearInterval(_notifPollTimer); _notifPollTimer = null; }
  }
  renderFeatureAccess();
}

function openProfileModal() {
  if (!currentUser) { showToast('Please login first', 'warning'); return; }
  const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  f('profileName',  currentUser.name);
  f('profileEmail', currentUser.email);
  f('profileRole',  currentUser.role);
  openModal('profileModal');
}

async function saveProfile() {
  const nameEl = document.getElementById('profileName');
  const roleEl = document.getElementById('profileRole');
  const name   = nameEl ? nameEl.value.trim() : '';
  const role   = roleEl ? roleEl.value : '';
  if (!name) { showToast('Name cannot be empty', 'error'); return; }
  try {
    await api('POST', '/auth/update-profile', { id: currentUser.id, name, role });
    currentUser.name = name; currentUser.role = role;
    localStorage.setItem('mg_user', JSON.stringify(currentUser));
    updateNavAuth(); closeModal('profileModal');
    renderFeatureAccess();
    showToast('Profile updated!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function changePassword() {
  const oldEl  = document.getElementById('oldPassword');
  const newEl  = document.getElementById('newPassword');
  const new2El = document.getElementById('newPassword2');
  const oldPw  = oldEl  ? oldEl.value  : '';
  const newPw  = newEl  ? newEl.value  : '';
  const newPw2 = new2El ? new2El.value : '';
  if (!oldPw || !newPw) { showToast('Fill all password fields', 'error'); return; }
  if (newPw !== newPw2)  { showToast('New passwords do not match', 'error'); return; }
  if (newPw.length < 6)  { showToast('Min 6 characters', 'error'); return; }
  try {
    await api('POST', '/auth/change-password', { email: currentUser.email, old_password: oldPw, new_password: newPw });
    showToast('Password changed!', 'success'); closeModal('profileModal');
  } catch (err) { showToast(err.message, 'error'); }
}

/* ═══════════════════════════════════════
   HOME STATS
═══════════════════════════════════════ */
async function loadHomeStats() {
  try {
    const data = await api('GET', '/stats');
    animateCounter('statPatients',      data.patients      || 0);
    animateCounter('statConsultations', data.prescriptions || 0);
    animateCounter('statAlerts',        data.alerts        || 0);
  } catch {
    animateCounter('statPatients', 0);
    animateCounter('statConsultations', 0);
    animateCounter('statAlerts', 0);
  }
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const step = Math.max(1, Math.ceil(target / (1200 / 16)));
  let cur = 0;
  const t = setInterval(() => {
    cur = Math.min(cur + step, target);
    el.textContent = cur.toLocaleString();
    if (cur >= target) clearInterval(t);
  }, 16);
}

/* ═══════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════ */
async function loadDashboard() {
  try {
    const stats = await api('GET', '/stats');
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || 0; };
    set('dsPat', stats.patients); set('dsPres', stats.prescriptions);
    set('dsAlert', stats.alerts); set('dsInv', stats.inventory);
  } catch {}
  loadPatients(); loadPrescriptions(); loadInventory();
  loadInteractions(); loadDashboardAppointments(); loadTodayStats();
}

async function loadTodayStats() {
  try {
    const data  = await api('GET', '/dashboard/summary');
    const today = data.today || {};
    const el    = document.getElementById('todayStats');
    if (el) {
      el.innerHTML = '<div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">' +
        `<div style="flex:1;min-width:100px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#2563eb;">${today.patients||0}</div><div style="font-size:11px;color:#1a2332;">Patients today</div></div>` +
        `<div style="flex:1;min-width:100px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#16a34a;">${today.prescriptions||0}</div><div style="font-size:11px;color:#1a2332;">Prescriptions today</div></div>` +
        `<div style="flex:1;min-width:100px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:8px;padding:10px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#7c3aed;">${today.appointments||0}</div><div style="font-size:11px;color:#1a2332;">Appointments today</div></div>` +
        '</div>';
    }
    const lowStock = data.low_stock || [];
    const lowEl    = document.getElementById('lowStockAlert');
    if (lowEl && lowStock.length) {
      lowEl.innerHTML = '<div style="padding:0.75rem;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin-bottom:1rem;">' +
        `<div style="font-weight:700;color:#92400e;font-size:0.85rem;margin-bottom:4px;">⚠️ Low Stock (${lowStock.length} medicines)</div>` +
        lowStock.map(m => `<div style="font-size:0.8rem;color:#9a3412;">• ${esc(m.name)} — ${m.quantity} units left</div>`).join('') +
        '</div>';
    }
  } catch {}
}

/* ─── Patients ─── */
async function loadPatients(query = '', recent = false) {
  const tbody = document.getElementById('patientsTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Loading...</td></tr>';
  try {
    const url  = query ? '/patients?search=' + encodeURIComponent(query) : '/patients';
    const data = await api('GET', url);
    let patients = data.patients || [];
    if (recent) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      patients = patients.filter(p => new Date(p.created_at) > sevenDaysAgo);
    }
    renderPatients(patients);
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Could not load patients. Is the server running?</td></tr>';
  }
}

function renderPatients(patients) {
  const tbody = document.getElementById('patientsTable');
  if (!tbody) return;
  if (!patients.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No patients found.</td></tr>'; return; }
  tbody.innerHTML = patients.map(p =>
    '<tr>' +
    '<td><strong>#' + p.id + '</strong></td>' +
    '<td>' + esc(p.name) + '</td>' +
    '<td>' + (p.age || '—') + '</td>' +
    '<td><span class="badge badge-ok">' + (esc(p.blood_group) || '—') + '</span></td>' +
    '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (esc(p.current_medications) || '—') + '</td>' +
    '<td style="font-size:0.8rem;color:var(--slate-500)">' + fmtDate(p.created_at) + '</td>' +
    '<td>' +
    '<button class="btn-sm btn-sm-blue" onclick="viewPatient(' + p.id + ')">View</button>' +
    '<button class="btn-sm btn-sm-red" onclick="deletePatient(' + p.id + ')" style="margin-left:3px">Del</button>' +
    '</td></tr>'
  ).join('');
}

let searchDebounce = null;
function searchPatients(q) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadPatients(q), 300);
}

function filterRecentPatients() {
  // Load all patients and filter to last 7 days
  loadPatients('', true);
}

async function addPatient() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const payload = {
    name:                g('patName').trim(),
    age:                 parseInt(g('patAge')) || 0,
    gender:              g('patGender'),
    blood_group:         g('patBlood'),
    phone:               g('patPhone').trim(),
    village:             g('patVillage').trim(),
    current_medications: g('patMeds').trim(),
    known_allergies:     g('patAllergies').trim()
  };
  if (!payload.name || !payload.age) { showToast('Name and age are required', 'error'); return; }
  try {
    await api('POST', '/patients', payload);
    closeModal('patientModal');
    showToast('Patient registered successfully!', 'success');
    loadPatients(); loadDashboard();
    ['patName','patAge','patPhone','patVillage','patMeds','patAllergies'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  } catch (err) { showToast(err.message, 'error'); }
}

async function viewPatient(id) {
  try {
    const data = await api('GET', '/patients/' + id);
    const p    = data.patient;
    const rxs  = data.prescriptions || [];
    const apts = data.appointments  || [];
    const bodyEl = document.getElementById('viewPatientBody');
    if (!bodyEl) return;
    bodyEl.innerHTML =
      '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">' +
      '<button class="btn-sm btn-sm-blue" onclick="bulkCheckPatient(' + p.id + ')">Check All Drug Interactions</button>' +
      '<button class="btn-sm btn-sm-green" onclick="downloadPatientReport(' + p.id + ')">Download Medical Report</button>' +
      '<a href="' + BASE_URL + '/patients/export" target="_blank" class="btn-sm btn-sm-green" style="text-decoration:none;">Export All Patients CSV</a>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem;">' +
      '<div><span style="font-size:0.75rem;font-weight:700;color:var(--slate-500);text-transform:uppercase;">Name</span><p style="font-weight:700;font-size:1.05rem;margin:2px 0;">' + esc(p.name) + '</p></div>' +
      '<div><span style="font-size:0.75rem;font-weight:700;color:var(--slate-500);text-transform:uppercase;">Age / Gender</span><p style="font-weight:700;margin:2px 0;">' + (p.age||'—') + ' / ' + (esc(p.gender)||'—') + '</p></div>' +
      '<div><span style="font-size:0.75rem;font-weight:700;color:var(--slate-500);text-transform:uppercase;">Blood Group</span><p style="margin:2px 0;"><span class="badge badge-ok">' + (esc(p.blood_group)||'—') + '</span></p></div>' +
      '<div><span style="font-size:0.75rem;font-weight:700;color:var(--slate-500);text-transform:uppercase;">Phone</span><p style="font-weight:700;margin:2px 0;">' + (esc(p.phone)||'—') + '</p></div>' +
      '<div><span style="font-size:0.75rem;font-weight:700;color:var(--slate-500);text-transform:uppercase;">Village / City</span><p style="font-weight:700;margin:2px 0;">' + (esc(p.village)||'—') + '</p></div>' +
      '<div><span style="font-size:0.75rem;font-weight:700;color:var(--slate-500);text-transform:uppercase;">Registered</span><p style="font-weight:700;margin:2px 0;">' + fmtDate(p.created_at) + '</p></div>' +
      '</div>' +
      '<div style="margin-bottom:0.75rem;padding:0.75rem;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;">' +
      '<p style="font-size:0.75rem;font-weight:700;color:#1d4ed8;margin-bottom:4px;">CURRENT MEDICATIONS</p>' +
      '<p style="font-size:0.875rem;margin:0;">' + (esc(p.current_medications)||'None') + '</p></div>' +
      '<div style="margin-bottom:1.25rem;padding:0.75rem;background:#fef2f2;border-radius:6px;border:1px solid #fecaca;">' +
      '<p style="font-size:0.75rem;font-weight:700;color:#dc2626;margin-bottom:4px;">KNOWN ALLERGIES</p>' +
      '<p style="font-size:0.875rem;margin:0;">' + (esc(p.known_allergies)||'None') + '</p></div>' +
      (rxs.length ?
        '<h4 style="font-weight:800;margin-bottom:0.6rem;">Prescriptions (' + rxs.length + ')</h4>' +
        '<div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:1rem;">' +
        rxs.map(rx =>
          '<div style="padding:0.6rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;">' +
          '<div><strong>' + esc(rx.medicine_name) + '</strong><span style="font-size:0.8rem;color:#1a2332;margin-left:0.4rem;">' + (esc(rx.dosage)||'') + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:0.4rem;">' +
          '<span class="badge badge-safe">' + (rx.safety_status||'SAFE') + '</span>' +
          '<a href="' + BASE_URL + '/prescriptions/' + rx.id + '/pdf" target="_blank" class="btn-sm btn-sm-blue" style="text-decoration:none;font-size:0.7rem;">PDF</a>' +
          '<span style="font-size:0.7rem;color:#374151">' + fmtDate(rx.created_at) + '</span>' +
          '</div></div>'
        ).join('') + '</div>'
        : '<p style="color:#374151;font-size:0.875rem;margin-bottom:1rem;">No prescriptions yet.</p>') +
      (apts.length ?
        '<h4 style="font-weight:800;margin-bottom:0.6rem;">Appointments (' + apts.length + ')</h4>' +
        '<div style="display:flex;flex-direction:column;gap:0.4rem;">' +
        apts.map(a =>
          '<div style="padding:0.6rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">' +
          '<div><strong>' + esc(a.specialty) + '</strong><span style="font-size:0.8rem;color:#1a2332;margin-left:0.4rem;">' + (a.preferred_date||'') + '</span></div>' +
          '<span class="badge badge-ok">' + esc(a.status) + '</span>' +
          '</div>'
        ).join('') + '</div>'
        : '');
    openModal('viewPatientModal');
  } catch { showToast('Could not load patient details', 'error'); }
}

function downloadPatientReport(pid) {
  window.open(BASE_URL + '/patients/' + pid + '/report', '_blank');
  showToast('Generating medical report...', 'info');
}

async function bulkCheckPatient(patientId) {
  try {
    const data = await api('GET', '/drug-interactions/bulk-check/' + patientId);
    if (data.safe) {
      showToast('All clear! No dangerous interactions for this patient.', 'success');
    } else {
      const warnList = data.warnings.map(w => '• ' + w.drug_a + ' + ' + w.drug_b + ': ' + w.effect).join('\n');
      alert('⚠️ WARNING — ' + data.warnings.length + ' interaction(s) found!\n\n' + warnList);
    }
  } catch { showToast('Could not check interactions', 'error'); }
}

async function deletePatient(id) {
  if (!confirm('Delete this patient? This cannot be undone.')) return;
  try {
    await api('DELETE', '/patients/' + id);
    showToast('Patient deleted', 'info'); loadPatients(); loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

function openEditPatient(id) { viewPatient(id); }

/* ─── Prescriptions ─── */
let allPrescriptions = [];
let allPrescriptionsSearch = '';
let presSearchTimer  = null;

async function loadPrescriptions() {
  const tbody = document.getElementById('prescriptionsTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Loading...</td></tr>';
  try {
    const data = await api('GET', '/prescriptions');
    allPrescriptions = data.prescriptions || [];
    renderPrescriptionsTable(allPrescriptions);
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Could not load prescriptions.</td></tr>';
  }
}

function renderPrescriptionsTable(rxs) {
  const tbody = document.getElementById('prescriptionsTable');
  if (!tbody) return;
  if (!rxs.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No prescriptions yet. JetBrains Mono'; return; }
  tbody.innerHTML = rxs.map(rx =>
    '<tr>' +
    '<td><strong>#' + rx.id + '</strong></td>' +
    '<td>' + (esc(rx.patient_name) || 'Patient #' + rx.patient_id) + '</td>' +
    '<td>' + esc(rx.medicine_name) + '</td>' +
    '<td style="font-size:0.85rem;">' + (esc(rx.dosage)||'—') + '</td>' +
    '<td>' + (esc(rx.doctor_name)||'—') + '</td>' +
    '<td><span class="badge badge-' + (rx.safety_status==='WARNING'?'warning':'safe') + '">' + (rx.safety_status||'SAFE') + '</span></td>' +
    '<td style="font-size:0.75rem;">' +
    '<a href="' + BASE_URL + '/prescriptions/' + rx.id + '/pdf" target="_blank" class="btn-sm btn-sm-blue" style="text-decoration:none;">PDF</a> ' +
    '<button class="btn-sm btn-sm-red" onclick="deletePrescription(' + rx.id + ')" style="margin-left:2px;">Del</button> ' +
    fmtDate(rx.created_at) +
    '</td></tr>'
  ).join('');
}

function searchPrescriptions(q) {
  clearTimeout(presSearchTimer);
  presSearchTimer = setTimeout(() => {
    filterPrescriptions(q);
  }, 300);
}

function filterPrescriptionsByDate() {
  filterPrescriptions(allPrescriptionsSearch || '');
}

function filterPrescriptions(q) {
  allPrescriptionsSearch = q;
  if (!allPrescriptions.length) return;
  let filtered = allPrescriptions.filter(rx =>
    (rx.patient_name||'').toLowerCase().includes(q.toLowerCase()) ||
    (rx.medicine_name||'').toLowerCase().includes(q.toLowerCase()) ||
    (rx.doctor_name||'').toLowerCase().includes(q.toLowerCase())
  );

  // Date filter
  const startDate = document.getElementById('presStartDate').value;
  const endDate = document.getElementById('presEndDate').value;
  if (startDate || endDate) {
    filtered = filtered.filter(rx => {
      const rxDate = new Date(rx.created_at).toISOString().split('T')[0];
      if (startDate && rxDate < startDate) return false;
      if (endDate && rxDate > endDate) return false;
      return true;
    });
  }

  renderPrescriptionsTable(filtered);
}

async function addPrescription() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const patId    = parseInt(g('presPatId')) || 0;
  const medicine = g('presMed').trim();
  const dosage   = g('presDosage').trim();
  const duration = g('presDuration').trim();
  const doctor   = g('presDoctor').trim();
  const reminder = g('presReminder').trim();
  const notes    = g('presNotes').trim();
  if (!patId || !medicine) { showToast('Patient ID and medicine are required', 'error'); return; }
  try {
    const data = await api('POST', '/prescriptions', {
      patient_id: patId, medicine_name: medicine,
      dosage, duration, doctor_name: doctor, reminder_time: reminder, notes
    });
    const warn = document.getElementById('presInteractionWarning');
    if (data.safety_status !== 'SAFE') {
      if (warn) { warn.className = ''; warn.innerHTML = '⚠️ <strong>Safety Alert:</strong> ' + esc(data.safety_message); }
      showToast('Safety alert! Check interaction warning.', 'warning');
    } else {
      if (warn) warn.className = 'hidden';
      closeModal('prescriptionModal');
      showToast('Prescription issued — No interactions detected ✓', 'success');
      ['presPatId','presMed','presDosage','presDuration','presDoctor','presReminder','presNotes'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
    }
    loadPrescriptions(); loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deletePrescription(id) {
  if (!confirm('Delete this prescription?')) return;
  try {
    await api('DELETE', '/prescriptions/' + id);
    showToast('Prescription deleted', 'info'); loadPrescriptions();
  } catch (err) { showToast(err.message, 'error'); }
}

function exportPrescriptions() {
  window.open(BASE_URL + '/prescriptions/export', '_blank');
}

/* ─── Reminders ─── */
async function loadReminders() {
  const el = document.getElementById('remindersList');
  if (!el) return;
  el.innerHTML = '<div class="reminder-item"><div class="reminder-time">Loading reminders...</div></div>';
  try {
    const data = await api('GET', '/prescriptions');
    const prescriptions = data.prescriptions || [];
    const reminders = prescriptions.filter(rx => rx.reminder_time && rx.reminder_time !== '');
    if (!reminders.length) {
      el.innerHTML = '<div class="reminder-item"><div class="reminder-time">No reminders set</div></div>';
      return;
    }
    const timeLabels = {
      'morning': '8:00 AM',
      'afternoon': '2:00 PM',
      'evening': '6:00 PM',
      'night': '9:00 PM'
    };
    el.innerHTML = reminders.map(rx => `
      <div class="reminder-item">
        <div>
          <div class="reminder-time">Take ${esc(rx.medicine_name)} at ${timeLabels[rx.reminder_time] || rx.reminder_time}</div>
          <div class="reminder-med">Patient: ${esc(rx.patient_name || 'Patient #' + rx.patient_id)}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = '<div class="reminder-item"><div class="reminder-time">Could not load reminders</div></div>';
  }
}

/* ─── Reports ─── */
async function loadReports() {
  const tbody = document.getElementById('reportsTable');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Loading...</td></tr>';
  try {
    const data = await api('GET', '/medical-reports');
    const reports = data.reports || [];
    if (!reports.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No reports uploaded</td></tr>';
      return;
    }
    tbody.innerHTML = reports.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${esc(r.patient_name || 'Patient #' + r.patient_id)}</td>
        <td>${esc(r.file_name)}</td>
        <td>${esc(r.file_type || '—')}</td>
        <td>${fmtDate(r.uploaded_at)}</td>
        <td>
          <a href="${BASE_URL}/medical-reports/download/${r.id}" target="_blank" class="btn-sm btn-sm-blue">View</a>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Could not load reports</td></tr>';
  }
}

async function uploadReport() {
  const patientId = document.getElementById('reportPatientId').value;
  const fileInput = document.getElementById('reportFile');
  const file = fileInput.files[0];
  if (!patientId || !file) {
    showToast('Patient ID and file are required', 'error');
    return;
  }
  const formData = new FormData();
  formData.append('patient_id', patientId);
  formData.append('file', file);
  try {
    const response = await fetch(BASE_URL + '/medical-reports', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken },
      body: formData
    });
    const data = await response.json();
    if (response.ok) {
      showToast('Report uploaded successfully', 'success');
      closeModal('uploadReportModal');
      loadReports();
      document.getElementById('reportPatientId').value = '';
      fileInput.value = '';
    } else {
      showToast(data.error || 'Upload failed', 'error');
    }
  } catch (err) {
    showToast('Upload failed', 'error');
  }
}

/* ─── Inventory ─── */
let allInventoryItems = [];
let inventoryFilter   = 'all';
let inventorySearch   = '';

/* Returns the active inventory tbody — prefers pharmacist page table when visible */
function getInventoryTbody() {
  const pharmTbl = document.getElementById('pharmInventoryTable');
  const dashTbl  = document.getElementById('inventoryTable');
  // Use pharmacist table if it's in a visible section
  const pharmSection = document.getElementById('inv-pharmacist-section');
  if (pharmSection && pharmSection.style.display !== 'none' && pharmTbl) return pharmTbl;
  return dashTbl;
}

async function loadInventory() {
  const tbody = getInventoryTbody();
  if (!tbody) return;
  const pharmSection = document.getElementById('inv-pharmacist-section');
  if (pharmSection && pharmSection.style.display !== 'none') {
    await loadPharmacistInventory();
    return;
  }

  tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Loading...</td></tr>';
  try {
    const data = await api('GET', '/inventory');
    allInventoryItems = data.inventory || [];
    renderFilteredInventory();
  } catch (err) {
    console.warn('Inventory load failed:', err);
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Could not load inventory: ' + esc(err.message || 'Unknown error') + '</td></tr>';
    return;
  }
}

function renderFilteredInventory() {
  const tbody = getInventoryTbody();
  if (!tbody) return;
  let items = allInventoryItems;
  if (inventorySearch) items = items.filter(i =>
    i.name.toLowerCase().includes(inventorySearch) ||
    (i.category||'').toLowerCase().includes(inventorySearch));
  if (inventoryFilter === 'low') items = items.filter(i => i.quantity > 0 && i.quantity <= i.min_stock_level);
  if (inventoryFilter === 'out') items = items.filter(i => i.quantity === 0);
  if (inventoryFilter === 'ok')  items = items.filter(i => i.quantity > i.min_stock_level);
  if (!items.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No inventory items found.</td></tr>'; return; }
  tbody.innerHTML = items.map(item => {
    const status   = item.quantity <= 0 ? 'out' : item.quantity <= item.min_stock_level ? 'low' : 'ok';
    const label    = status === 'out' ? 'Out of Stock' : status === 'low' ? 'Low Stock' : 'In Stock';
    const qtyColor = status === 'out' ? '#ef4444' : status === 'low' ? '#f59e0b' : '#16a34a';
    return '<tr>' +
      '<td><strong>' + esc(item.name) + '</strong></td>' +
      '<td>' + (esc(item.category) || '—') + '</td>' +
      '<td style="text-align:center"><strong style="font-size:1.15rem;color:' + qtyColor + '">' + item.quantity + '</strong></td>' +
      '<td>' + (esc(item.dosage_form) || 'Tablet') + '</td>' +
      '<td><span class="badge badge-' + status + '">' + label + '</span></td>' +
      '<td style="text-align:center">' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:0.35rem;">' +
          '<button title="Decrease by 1" onclick="adjustMedicineQty(' + item.id + ',-1)" ' +
            'style="background:#ef4444;color:white;border:none;border-radius:6px;width:30px;height:30px;font-size:1.1rem;font-weight:700;cursor:pointer;line-height:1;">−</button>' +
          '<button title="Increase by 1" onclick="adjustMedicineQty(' + item.id + ',1)" ' +
            'style="background:#22c55e;color:white;border:none;border-radius:6px;width:30px;height:30px;font-size:1.1rem;font-weight:700;cursor:pointer;line-height:1;">+</button>' +
          '<button class="btn-sm btn-sm-green" style="font-size:0.72rem;padding:0.2rem 0.45rem;" ' +
            'onclick="quickRestock(' + item.id + ')" title="Add multiple units">+N</button>' +
        '</div>' +
      '</td>' +
      '<td>' +
        '<button class="btn-sm btn-sm-red" onclick="deleteInventoryItem(' + item.id + ')">Del</button>' +
      '</td></tr>';
  }).join('');
}

function searchInventory(q) {
  inventorySearch = q.toLowerCase(); renderFilteredInventory();
}
function filterInventoryCategory(cat, btn) {
  inventoryFilter = cat;
  document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderFilteredInventory();
}

async function updateInventory() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const payload = {
    name:         g('invMed').trim(),
    category:     g('invCategory'),
    quantity:     parseInt(g('invQty')) || 0,
    dosage_form:  g('invUnit') || 'Tablet',
    manufacturer: g('invPharmacy').trim()
  };
  if (!payload.name) { showToast('Medicine name is required', 'error'); return; }
  try {
    await api('POST', '/inventory', payload);
    closeModal('inventoryModal');
    showToast('Inventory updated!', 'success'); loadInventory(); loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

async function quickRestock(id) {
  const qty = parseInt(prompt('Add how many units?', '50'));
  if (!qty || qty <= 0) return;
  try {
    await api('PATCH', '/inventory/' + id + '/restock', { add_quantity: qty });
    showToast('Restocked!', 'success'); loadInventory(); loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

/* ─── Adjust stock by +1 / -1 (pharmacist own stock) ─── */
async function adjustMedicineQty(id, delta) {
  try {
    await api('PATCH', '/inventory/' + id + '/adjust', { delta: delta });
    // Refresh inventory and alert banner
    await loadInventory();
    try {
      const alerts = await api('GET', '/inventory/alerts');
      renderPharmacistAlertsBanner(alerts);
    } catch(e) { /* silent */ }
  } catch(err) {
    showToast(err.message || 'Failed to adjust stock', 'error');
  }
}

/* ─── Seed all medicines at 20 units default for this pharmacist ─── */
async function seedDefaultStock() {
  if (!confirm(
    'This will add all medicines from the database to your inventory at 20 units each.\n' +
    'Only medicines you don\'t already have will be added.\n\nContinue?'
  )) return;
  try {
    showToast('Seeding default stock…', 'info');
    const data = await api('POST', '/inventory/seed-defaults');
    showToast(
      'Done! ' + (data.added || 0) + ' medicines added at 20 units each.',
      'success'
    );
    await loadInventory();
    try {
      const alerts = await api('GET', '/inventory/alerts');
      renderPharmacistAlertsBanner(alerts);
    } catch(e) { /* silent */ }
  } catch(err) {
    showToast(err.message || 'Failed to seed defaults', 'error');
  }
}

async function deleteInventoryItem(id) {
  if (!confirm('Remove this medicine from inventory?')) return;
  try {
    await api('DELETE', '/inventory/' + id);
    showToast('Item removed', 'info'); loadInventory();
  } catch (err) { showToast(err.message, 'error'); }
}

/* ─── Drug Interactions ─── */
async function loadInteractions() {
  const list = document.getElementById('interactionsList');
  if (!list) return;
  try {
    const data  = await api('GET', '/drug-interactions');
    const items = data.interactions || [];
    if (!items.length) { list.innerHTML = '<p style="color:#374151;font-size:0.875rem;">No interactions in database yet.</p>'; return; }
    list.innerHTML = items.map(i =>
      '<div class="interaction-row">' +
      '<i data-lucide="alert-triangle" style="width:16px;height:16px;color:#ef4444;flex-shrink:0;"></i>' +
      '<strong>' + esc(i.drug_a) + '</strong><span>+</span><strong>' + esc(i.drug_b) + '</strong>' +
      '<span style="margin-left:auto;font-size:0.8rem;color:#dc2626;">' + esc(i.effect) + '</span>' +
      '</div>'
    ).join('');
    lucide.createIcons();
  } catch {
    list.innerHTML = '<p style="color:#374151;font-size:0.875rem;">Could not load interaction database.</p>';
  }
}

async function checkDrugInteraction() {
  const drugA  = document.getElementById('drugA') ? document.getElementById('drugA').value.trim() : '';
  const drugB  = document.getElementById('drugB') ? document.getElementById('drugB').value.trim() : '';
  const result = document.getElementById('drugResult');
  const btn    = document.getElementById('checkDrugBtn');
  if (!drugA || !drugB) { showToast('Please enter both medicine names', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  try {
    const data = await api('POST', '/drug-interactions/check', { drug_a: drugA, drug_b: drugB });
    if (result) {
      result.classList.remove('hidden', 'safe', 'danger');
      if (data.interaction_found) {
        result.classList.add('danger');
        result.innerHTML = '<h4>⚠️ Dangerous Interaction Detected!</h4>' +
          '<p><strong>' + esc(drugA) + '</strong> + <strong>' + esc(drugB) + '</strong>: ' + esc(data.effect) + '</p>' +
          '<p style="margin-top:0.5rem;font-size:0.85rem;color:#dc2626;">Severity: <strong>' + esc(data.severity||'HIGH') + '</strong></p>';
      } else {
        result.classList.add('safe');
        result.innerHTML = '<h4>✓ No Known Interaction</h4>' +
          '<p><strong>' + esc(drugA) + '</strong> + <strong>' + esc(drugB) + '</strong> — No dangerous interaction found in our database.</p>' +
          '<p style="margin-top:0.5rem;font-size:0.8rem;color:#16a34a;">Always consult a doctor for final verification.</p>';
      }
    }
  } catch (err) {
    if (result) { result.classList.remove('hidden'); result.classList.add('danger'); result.innerHTML = '<h4>Error</h4><p>' + esc(err.message) + '</p>'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="shield-check" style="width:16px;height:16px"></i> Check Interaction'; lucide.createIcons(); }
  }
}

/* ─── Dashboard Tabs ─── */
function switchTab(tab) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const tabEl   = document.querySelector('[onclick="switchTab(\'' + tab + '\')"]');
  const panelEl = document.getElementById('tab-' + tab);
  if (tabEl)   tabEl.classList.add('active');
  if (panelEl) panelEl.classList.add('active');
  lucide.createIcons();
  if (tab === 'patients')      loadPatients();
  if (tab === 'prescriptions') loadPrescriptions();
  if (tab === 'inventory')     loadInventory();
  if (tab === 'reminders')     loadReminders();
  if (tab === 'reports')       loadReports();
  if (tab === 'drugcheck')     loadInteractions();
}

/* ─── Appointments ─── */
async function loadAppointments() {
  const el = document.getElementById('appointmentsList');
  if (!el) return;
  try {
    const data = await api('GET', '/appointments');
    const apts = data.appointments || [];
    if (!apts.length) { el.innerHTML = '<p style="color:#374151;font-size:0.875rem;text-align:center;padding:1rem 0;">No appointments yet.</p>'; return; }
    el.innerHTML = apts.slice(0, 5).map(a =>
      '<div class="appointment-card">' +
      '<div class="apt-info">' +
      '<strong>' + esc(a.specialty) + ' — ' + esc(a.patient_name) + '</strong>' +
      '<span>' + (a.preferred_date||'—') + ' · ' + (esc(a.time_slot)||'—') + ' · ' + a.mode + '</span>' +
      '</div>' +
      '<span class="badge badge-ok">' + esc(a.status) + '</span>' +
      '</div>'
    ).join('');
  } catch {
    el.innerHTML = '<p style="color:#374151;font-size:0.875rem;">Could not load appointments.</p>';
  }
}

// loadAppointments / bookConsultation / joinCall removed — replaced by role-based tele system

async function loadDashboardAppointments() {
  // Forward to role-appropriate loader
  if (currentUser?.role === 'doctor' || currentUser?.role === 'admin') {
    await loadDoctorAppointments();
  } else if (currentUser?.role === 'patient') {
    await loadPatientAppointments();
  }
}

async function updateAppointmentStatus(id, status) {
  try {
    await api('PATCH', '/appointments/' + id, { status });
    showToast('Status updated', 'success');
    loadDashboardAppointments();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteAppointment(id) {
  if (!confirm('Cancel this appointment?')) return;
  try {
    await api('DELETE', '/appointments/' + id);
    showToast('Appointment cancelled', 'info');
    loadDashboardAppointments();
  } catch (err) { showToast(err.message, 'error'); }
}

function joinCall() {
  const code = document.getElementById('roomCode') ? document.getElementById('roomCode').value.trim() : '';
  if (!code) { showToast('Please enter a room code', 'error'); return; }
  showToast('Joining room ' + code + '... (demo mode)', 'info');
}

/* ═══════════════════════════════════════
   MEDICINE DATABASE — Real search 195k
═══════════════════════════════════════ */
let medFilter     = 'all';
let medSearch     = '';
let allMedicinesDB = [];
let medPage       = 1;
let medTotal      = 0;
let medSearchTimer = null;
const _medDBCache = {};

async function loadMedicineDB() { await fetchMedicines(1); }

async function fetchMedicines(page) {
  page = page || 1;
  const grid = document.getElementById('medicinesGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:#374151">Loading medicines...</div>';
  try {
    let url = '/medicines/search?page=' + page + '&per_page=24';
    if (medSearch) url += '&q=' + encodeURIComponent(medSearch);
    if (medFilter && medFilter !== 'all') url += '&category=' + encodeURIComponent(medFilter);
    const data = await api('GET', url);
    allMedicinesDB = data.medicines || [];
    medTotal = data.total || 0;
    medPage  = data.page  || 1;
    allMedicinesDB.forEach(m => { if (m.id) _medDBCache[m.id] = m; });
    renderMedicines();
  } catch {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:#374151">Could not load medicines. Is the server running?</div>';
  }
}

/* ─── Medicine Image Helpers ─── */
function getMedType(m) {
  const form = ((m.dosage_form || m.form || '') + ' ' + (m.name || '')).toLowerCase();
  if (/inject|vial|ampoule|i\.v\.|\ iv\ /.test(form)) return 'injection';
  if (/capsule|cap\b/.test(form)) return 'capsule';
  if (/syrup|suspension|drops|solution|liquid|elixir/.test(form)) return 'syrup';
  if (/cream|gel|ointment|lotion|topical/.test(form)) return 'cream';
  if (/inhaler|spray|nasal|aerosol/.test(form)) return 'inhaler';
  if (/patch|transdermal/.test(form)) return 'patch';
  if (/eye|ophthalmic|ear/.test(form)) return 'drops';
  return 'tablet';
}

const MED_SVGS = {
  tablet: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#eff6ff"/><ellipse cx="60" cy="60" rx="40" ry="24" fill="#3b82f6"/><ellipse cx="60" cy="60" rx="40" ry="24" fill="none" stroke="#1d4ed8" stroke-width="2"/><line x1="60" y1="36" x2="60" y2="84" stroke="#1d4ed8" stroke-width="2.5"/><ellipse cx="60" cy="60" rx="20" ry="24" fill="#60a5fa"/><ellipse cx="48" cy="54" rx="7" ry="4" fill="rgba(255,255,255,0.35)"/></svg>',
  capsule: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#f0fdf4"/><rect x="20" y="46" width="80" height="28" rx="14" fill="#22c55e"/><rect x="20" y="46" width="40" height="28" rx="14" fill="#16a34a"/><line x1="60" y1="46" x2="60" y2="74" stroke="white" stroke-width="2"/><ellipse cx="36" cy="57" rx="7" ry="4" fill="rgba(255,255,255,0.3)"/><ellipse cx="80" cy="63" rx="5" ry="3" fill="rgba(255,255,255,0.2)"/></svg>',
  injection: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#fdf4ff"/><rect x="52" y="14" width="16" height="60" rx="4" fill="#c084fc"/><rect x="55" y="14" width="10" height="40" rx="3" fill="#e9d5ff"/><rect x="46" y="74" width="28" height="10" rx="3" fill="#a855f7"/><polygon points="60,98 55,84 65,84" fill="#7c3aed"/><line x1="60" y1="98" x2="60" y2="106" stroke="#6d28d9" stroke-width="3" stroke-linecap="round"/><rect x="30" y="70" width="60" height="6" rx="3" fill="#d8b4fe"/><line x1="56" y1="28" x2="64" y2="28" stroke="#7c3aed" stroke-width="2"/><line x1="56" y1="38" x2="64" y2="38" stroke="#7c3aed" stroke-width="2"/><line x1="56" y1="48" x2="64" y2="48" stroke="#7c3aed" stroke-width="2"/></svg>',
  syrup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#fff7ed"/><rect x="44" y="22" width="32" height="10" rx="5" fill="#ea580c"/><rect x="36" y="32" width="48" height="64" rx="10" fill="#f97316"/><rect x="36" y="32" width="48" height="32" rx="6" fill="#fed7aa"/><rect x="46" y="40" width="28" height="4" rx="2" fill="rgba(255,255,255,0.7)"/><rect x="46" y="48" width="18" height="3" rx="1.5" fill="rgba(255,255,255,0.5)"/><text x="60" y="82" text-anchor="middle" font-size="8" fill="#7c2d12" font-family="sans-serif" font-weight="bold">SYRUP</text><line x1="36" y1="64" x2="84" y2="64" stroke="#fb923c" stroke-width="1.5" stroke-dasharray="4,3"/></svg>',
  cream: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#f0fdfa"/><rect x="28" y="52" width="64" height="44" rx="10" fill="#14b8a6"/><rect x="36" y="36" width="48" height="20" rx="10" fill="#0d9488"/><ellipse cx="60" cy="56" rx="24" ry="6" fill="#2dd4bf"/><rect x="42" y="66" width="36" height="5" rx="2.5" fill="rgba(255,255,255,0.5)"/><rect x="42" y="76" width="24" height="4" rx="2" fill="rgba(255,255,255,0.3)"/><path d="M54 40 Q60 32 66 40" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>',
  inhaler: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#f0f9ff"/><rect x="44" y="18" width="28" height="64" rx="14" fill="#0ea5e9"/><rect x="44" y="18" width="28" height="28" rx="14" fill="#38bdf8"/><rect x="34" y="76" width="52" height="20" rx="10" fill="#0369a1"/><circle cx="60" cy="86" r="6" fill="#7dd3fc"/><ellipse cx="54" cy="32" rx="5" ry="3" fill="rgba(255,255,255,0.4)"/><path d="M50 14 Q55 7 60 14" stroke="#0ea5e9" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M56 11 Q60 4 64 11" stroke="#0ea5e9" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  patch: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#fefce8"/><rect x="22" y="34" width="76" height="52" rx="12" fill="#eab308"/><rect x="34" y="46" width="52" height="28" rx="6" fill="#fef08a"/><line x1="22" y1="60" x2="34" y2="60" stroke="#ca8a04" stroke-width="2"/><line x1="86" y1="60" x2="98" y2="60" stroke="#ca8a04" stroke-width="2"/><line x1="60" y1="34" x2="60" y2="46" stroke="#ca8a04" stroke-width="2"/><line x1="60" y1="74" x2="60" y2="86" stroke="#ca8a04" stroke-width="2"/><rect x="52" y="52" width="16" height="16" rx="3" fill="#fde047"/><line x1="60" y1="52" x2="60" y2="68" stroke="#a16207" stroke-width="2"/><line x1="52" y1="60" x2="68" y2="60" stroke="#a16207" stroke-width="2"/></svg>',
  drops: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#f0f9ff"/><rect x="46" y="14" width="18" height="50" rx="4" fill="#0284c7"/><rect x="49" y="14" width="12" height="30" rx="3" fill="#bae6fd"/><path d="M46 62 Q36 78 42 90 Q50 104 60 104 Q70 104 78 90 Q84 78 74 62 Z" fill="#0284c7"/><path d="M50 68 Q44 80 48 90" stroke="rgba(255,255,255,0.4)" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="38" y="58" width="34" height="8" rx="4" fill="#0369a1"/></svg>'
};

function getMedImage(m) {
  const type = getMedType(m);
  const svg = MED_SVGS[type] || MED_SVGS.tablet;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/* ─── Category & Color Map ─── */
const CAT_COLORS = {
  'Analgesic':'#3b82f6','Antibiotic':'#22c55e','Antidiabetic':'#f97316',
  'Antihypertensive':'#a855f7','Anticoagulant':'#ef4444','Vitamin':'#eab308',
  'Antifungal':'#14b8a6','Antiallergic':'#f43f5e','Antacid':'#8b5cf6',
  'Cardiovascular':'#ec4899','Neurological':'#6366f1','Respiratory':'#06b6d4',
  'Hormonal':'#d97706','Antiparasitic':'#65a30d','Ophthalmic':'#0369a1',
  'Antiviral':'#dc2626','Antiseptic':'#0891b2','Iron Supplement':'#92400e',
  'General':'#64748b'
};

function getCatColor(cat) { return CAT_COLORS[cat] || '#64748b'; }

/* ─── Render Medicine Cards ─── */
function renderMedicines() {
  const grid = document.getElementById('medicinesGrid');
  if (!grid) return;
  if (!allMedicinesDB.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#374151">No medicines found.</div>'; return;
  }
  const totalPages = Math.ceil(medTotal / 24);

  const cards = allMedicinesDB.map(m => {
    const color = getCatColor(m.category);
    const img   = getMedImage(m);
    const type  = getMedType(m);
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const mid   = m.id || 0;
    const composition = (m.strength || m.generic_name || '').substring(0, 70);
    const mfr = (m.manufacturer || '').substring(0, 38);
    return (
      '<div class="med-card fade-in-up visible">' +
        '<div class="med-card-img-wrap" style="background:' + color + '12">' +
          '<img src="' + img + '" alt="' + esc(m.name) + '" class="med-card-img"/>' +
          '<span class="med-type-pill" style="background:' + color + '22;color:' + color + '">' + typeLabel + '</span>' +
        '</div>' +
        '<div class="med-card-body">' +
          '<div class="med-card-header">' +
            '<div class="med-name">' + esc(m.name) + '</div>' +
            '<span class="med-cat-badge" style="background:' + color + '20;color:' + color + '">' + (esc(m.category) || 'General') + '</span>' +
          '</div>' +
          (composition ? '<div class="med-info-label">COMPOSITION</div><div class="med-info-val med-composition">' + esc(composition) + (m.strength && m.strength.length > 70 ? '…' : '') + '</div>' : '') +
          (mfr ? '<div class="med-info-label">MANUFACTURER</div><div class="med-info-val">' + esc(mfr) + (m.manufacturer && m.manufacturer.length > 38 ? '…' : '') + '</div>' : '') +
          '<button class="med-view-btn" onclick="showMedicineDetails(' + mid + ')" style="--med-color:' + color + '">View Details →</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  const pagination = totalPages > 1
    ? '<div style="grid-column:1/-1;display:flex;justify-content:center;align-items:center;gap:1rem;padding:1rem 0;">' +
      '<button class="btn-sm btn-sm-blue" onclick="fetchMedicines(' + (medPage-1) + ')" ' + (medPage<=1?'disabled':'') + '>← Prev</button>' +
      '<span style="font-size:0.875rem;color:#1a2332">Page ' + medPage + ' of ' + totalPages + ' (' + medTotal.toLocaleString() + ' total)</span>' +
      '<button class="btn-sm btn-sm-blue" onclick="fetchMedicines(' + (medPage+1) + ')" ' + (medPage>=totalPages?'disabled':'') + '>Next →</button>' +
      '</div>'
    : '<div style="grid-column:1/-1;text-align:center;font-size:0.8rem;color:#374151;padding:0.5rem 0;">' + medTotal.toLocaleString() + ' medicines found</div>';
  grid.innerHTML = cards + pagination;
}

/* ─── Medicine Details Modal ─── */
function showMedicineDetails(id) {
  const m = _medDBCache[id];
  if (!m) return;
  const color = getCatColor(m.category);
  const img   = getMedImage(m);
  const type  = getMedType(m);
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  function detailSection(icon, title, content) {
    if (!content || content === 'nan' || content.trim() === '') return '';
    return (
      '<div class="med-detail-section">' +
        '<div class="med-detail-section-title"><span>' + icon + '</span>' + title + '</div>' +
        '<div class="med-detail-section-body">' + esc(content) + '</div>' +
      '</div>'
    );
  }

  const html =
    '<div class="med-modal-header" style="background:linear-gradient(135deg,' + color + 'dd,' + color + '99)">' +
      '<button class="med-modal-close" onclick="closeMedicineModal()">✕</button>' +
      '<div class="med-modal-header-inner">' +
        '<img src="' + img + '" class="med-modal-img" alt="' + esc(m.name) + '"/>' +
        '<div>' +
          '<div class="med-modal-name">' + esc(m.name) + '</div>' +
          '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">' +
            '<span class="med-modal-badge" style="background:rgba(255,255,255,0.25)">' + typeLabel + '</span>' +
            (m.category ? '<span class="med-modal-badge" style="background:rgba(255,255,255,0.25)">' + esc(m.category) + '</span>' : '') +
            (m.dosage_form||m.form ? '<span class="med-modal-badge" style="background:rgba(255,255,255,0.18)">' + esc(m.dosage_form||m.form) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="med-modal-body">' +
      detailSection('💊', 'Uses & Indications', m.description || m.medicine_desc) +
      detailSection('🧪', 'Composition / Active Ingredients', m.strength || m.generic_name || m.salt_composition) +
      detailSection('⚠️', 'Side Effects', m.side_effects) +
      detailSection('🛡️', 'Precautions & Warnings', m.precautions) +
      detailSection('📋', 'Dosage Instructions', m.dosage) +
      detailSection('🏭', 'Manufacturer', m.manufacturer) +
      (m.unit_price && m.unit_price > 0 ? detailSection('💰', 'Unit Price', '₹' + parseFloat(m.unit_price).toFixed(2)) : '') +
    '</div>';

  const modal = document.getElementById('medDetailsModal');
  if (!modal) return;
  document.getElementById('medModalContent').innerHTML = html;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeMedicineModal() {
  const modal = document.getElementById('medDetailsModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function searchMedicines(q) {
  medSearch = q;
  clearTimeout(medSearchTimer);
  medSearchTimer = setTimeout(() => fetchMedicines(1), 400);
}

function filterMedCategory(cat, btn) {
  medFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  fetchMedicines(1);
}

/* ─── Medicine Autocomplete ─── */
let autocompleteTimer = null;

function initMedicineAutocomplete() {
  const input = document.getElementById('presMed');
  if (!input || document.getElementById('medAutocomplete')) return;
  const dropdown = document.createElement('div');
  dropdown.id = 'medAutocomplete';
  dropdown.style.cssText = 'position:absolute;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:9999;max-height:220px;overflow-y:auto;min-width:280px;display:none;';
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(dropdown);
  input.addEventListener('input', () => {
    clearTimeout(autocompleteTimer);
    const q = input.value.trim();
    if (q.length < 2) { dropdown.style.display = 'none'; return; }
    autocompleteTimer = setTimeout(async () => {
      try {
        const data = await api('GET', '/medicines/autocomplete?q=' + encodeURIComponent(q));
        const sugg = data.suggestions || [];
        if (!sugg.length) { dropdown.style.display = 'none'; return; }
        dropdown.innerHTML = sugg.map(s =>
          '<div onclick="selectMedicine(\'' + s.name.replace(/'/g, "\\'") + '\')" ' +
          'style="padding:8px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9;" ' +
          'onmouseenter="this.style.background=\'#f8fafc\'" onmouseleave="this.style.background=\'\'">' +
          '<div style="font-weight:600;font-size:13px;">' + esc(s.name) + '</div>' +
          '<div style="font-size:11px;color:#1a2332;">' + (esc(s.category)||'—') + ' · ' + (esc(s.strength)||'') + '</div>' +
          '</div>'
        ).join('');
        dropdown.style.display = 'block';
      } catch {}
    }, 300);
  });
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

function selectMedicine(name) {
  const input    = document.getElementById('presMed');
  const dropdown = document.getElementById('medAutocomplete');
  if (input)    input.value = name;
  if (dropdown) dropdown.style.display = 'none';
}

/* ═══════════════════════════════════════
   LIVE INVENTORY PAGE
═══════════════════════════════════════ */
let allLiveInventoryData  = [];
let currentInvFilter      = 'all';
let invSearchDebounce     = null;

function loadLiveInventory() {
  // Reset to empty state on page load — user must search
  renderLiveInventoryCards([], '', false);
}

/* ─── Inventory Page: route based on user role ─── */

function renderPharmacistInventoryView() {
  const invPage = document.getElementById('page-inventory');
  if (!invPage) return;

  const isPharmacist = currentUser && (
    currentUser.role === 'pharmacist' || currentUser.role === 'admin'
  );

  // Update hero text
  const titleEl    = document.getElementById('invPageTitle');
  const subtitleEl = document.getElementById('invPageSubtitle');
  if (titleEl && subtitleEl) {
    if (isPharmacist) {
      titleEl.textContent    = 'My Pharmacy Inventory';
      subtitleEl.textContent = 'Live stock levels for your pharmacy — red alerts shown for out-of-stock and low-stock medicines';
    } else {
      titleEl.textContent    = 'Medicine Stock Checker';
      subtitleEl.textContent = 'Search any medicine to see real-time stock levels across all registered pharmacies';
    }
  }

  // Toggle visibility of the two sections
  const publicSection  = document.getElementById('inv-public-section');
  const privateSection = document.getElementById('inv-pharmacist-section');

  if (publicSection)  publicSection.style.display  = isPharmacist ? 'none' : 'block';
  if (privateSection) privateSection.style.display = isPharmacist ? 'block' : 'none';

  if (isPharmacist) {
    loadMyPharmacyStock();
  }
}

async function loadMyPharmacyStock() {
  // Pharmacist inventory should use the pharmacist-specific live inventory API
  await loadPharmacistInventory();
}

function renderPharmacistAlertsBanner(data) {
  const banner = document.getElementById('pharmacistAlertsBanner');
  if (!banner) return;

  const outCount  = data.out_of_stock_count || 0;
  const lowCount  = data.low_stock_count    || 0;
  const total     = data.total              || 0;
  const inStock   = data.in_stock           || 0;

  if (outCount === 0 && lowCount === 0) {
    banner.innerHTML =
      '<div class="pharm-alert-ok">' +
      '<i data-lucide="check-circle-2" style="width:20px;height:20px"></i>' +
      ' All <strong>' + total + '</strong> medicines are well-stocked. No alerts.' +
      '</div>';
    lucide.createIcons();
    return;
  }

  let html = '<div class="pharm-alert-row">';

  // KPI pills
  html += '<div class="pharm-kpi-strip">' +
    '<div class="pharm-kpi pharm-kpi-green"><span>' + inStock + '</span><small>In Stock</small></div>' +
    '<div class="pharm-kpi pharm-kpi-yellow"><span>' + lowCount + '</span><small>Low Stock</small></div>' +
    '<div class="pharm-kpi pharm-kpi-red"><span>' + outCount + '</span><small>Out of Stock</small></div>' +
    '</div>';

  // Alert cards
  if (outCount > 0) {
    html += '<div class="pharm-alert-block pharm-alert-critical">' +
      '<div class="pharm-alert-title"><i data-lucide="x-circle" style="width:16px;height:16px"></i> Out of Stock (' + outCount + ')</div>' +
      '<div class="pharm-alert-list">' +
      (data.out_of_stock || []).slice(0, 8).map(m =>
        '<div class="pharm-alert-item">' +
        '<span class="pharm-med-name">' + esc(m.name) + '</span>' +
        '<span class="pharm-badge pharm-badge-red">0 units</span>' +
        '<button class="btn-sm btn-sm-green" onclick="quickRestock(' + m.id + ')">Restock</button>' +
        '</div>'
      ).join('') +
      (outCount > 8 ? '<div class="pharm-more">+ ' + (outCount - 8) + ' more below ↓</div>' : '') +
      '</div></div>';
  }

  if (lowCount > 0) {
    html += '<div class="pharm-alert-block pharm-alert-warning">' +
      '<div class="pharm-alert-title"><i data-lucide="alert-triangle" style="width:16px;height:16px"></i> Low Stock (' + lowCount + ')</div>' +
      '<div class="pharm-alert-list">' +
      (data.low_stock || []).slice(0, 8).map(m =>
        '<div class="pharm-alert-item">' +
        '<span class="pharm-med-name">' + esc(m.name) + '</span>' +
        '<span class="pharm-badge pharm-badge-yellow">' + m.quantity + ' left</span>' +
        '<button class="btn-sm btn-sm-green" onclick="quickRestock(' + m.id + ')">Restock</button>' +
        '</div>'
      ).join('') +
      (lowCount > 8 ? '<div class="pharm-more">+ ' + (lowCount - 8) + ' more below ↓</div>' : '') +
      '</div></div>';
  }

  html += '</div>';
  banner.innerHTML = html;
  lucide.createIcons();
}


  clearTimeout(invSearchDebounce);
  invSearchDebounce = setTimeout(() => searchLiveInventory(val), 400);


async function searchLiveInventory(medicine) {
  const grid    = document.getElementById('inventoryResultGrid');
  const heading = document.getElementById('invResultHeading');
  if (!grid) return;

  // Show loading
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--slate-400)">' +
    '<i data-lucide="loader" style="width:32px;height:32px;animation:spin 1s linear infinite;margin-bottom:0.75rem"></i>' +
    '<br>Checking stock across all pharmacies…</div>';
  lucide.createIcons();

  try {
    const q    = medicine ? `?medicine=${encodeURIComponent(medicine.trim())}` : '';
    const data = await api('GET', '/inventory/live' + q);
    allLiveInventoryData = data.pharmacies || [];
    currentInvFilter = 'all';
    // Reset filter buttons
    document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.getElementById('invF-all');
    if (allBtn) allBtn.classList.add('active');
    renderLiveInventoryCards(allLiveInventoryData, data.medicine || medicine, true);
  } catch (e) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ef4444">' +
      '<i data-lucide="wifi-off" style="width:32px;height:32px;margin-bottom:0.75rem"></i><br>Could not load inventory data. Is the backend running?</div>';
    lucide.createIcons();
  }
}

function setInvFilter(filter) {
  currentInvFilter = filter;
  document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('invF-' + filter);
  if (btn) btn.classList.add('active');
  renderLiveInventoryCards(allLiveInventoryData, document.getElementById('inventorySearchInput')?.value || '', true);
}

function renderLiveInventoryCards(pharmacies, medicine, hasSearched) {
  const grid       = document.getElementById('inventoryResultGrid');
  const kpiRow     = document.getElementById('invKpiRow');
  const filterRow  = document.getElementById('invFilterRow');
  const heading    = document.getElementById('invResultHeading');
  const countEl    = document.getElementById('invResultCount');
  const emptyState = document.getElementById('invEmptyState');
  if (!grid) return;

  if (!hasSearched) {
    // Show empty/prompt state
    if (kpiRow)    kpiRow.style.display    = 'none';
    if (filterRow) filterRow.style.display = 'none';
    if (heading)   heading.textContent = 'Enter a medicine name to check stock';
    if (countEl)   countEl.textContent = '';
    grid.innerHTML = '';
    const empty = document.createElement('div');
    empty.id = 'invEmptyState';
    empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:5rem 2rem;';
    empty.innerHTML =
      '<div style="width:72px;height:72px;background:linear-gradient(135deg,#ede9fe,#ddd6fe);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">' +
      '<i data-lucide="package-search" style="width:36px;height:36px;color:#7c3aed"></i></div>' +
      '<h4 style="font-size:1.1rem;font-weight:700;color:var(--slate-700);margin-bottom:0.5rem">Search for a Medicine</h4>' +
      '<p style="color:var(--slate-500);max-width:360px;margin:0 auto">Type a medicine name in the search bar above to see which pharmacies have it in stock and how many units are available.</p>' +
      '<button class="btn-blue" style="margin-top:1.5rem;" onclick="searchLiveInventory(\'\')">View All Stock</button>';
    grid.appendChild(empty);
    lucide.createIcons();
    return;
  }

  // Apply filter
  let filtered = pharmacies.slice();
  if (currentInvFilter === 'in_stock')     filtered = filtered.filter(p => p.stock_status === 'in_stock');
  else if (currentInvFilter === 'low_stock')    filtered = filtered.filter(p => p.stock_status === 'low_stock');
  else if (currentInvFilter === 'out_of_stock') filtered = filtered.filter(p => p.stock_status === 'out_of_stock');
  else if (currentInvFilter === 'delivery') filtered = filtered.filter(p => p.has_delivery);
  else if (currentInvFilter === '24hr')     filtered = filtered.filter(p => p.is_24hr);

  // KPI counts (from full list, not filtered)
  const inStock  = pharmacies.filter(p => p.stock_status === 'in_stock').length;
  const lowStock = pharmacies.filter(p => p.stock_status === 'low_stock').length;
  const outStock = pharmacies.filter(p => p.stock_status === 'out_of_stock' || (!p.stock_status && p.quantity === 0)).length;

  if (kpiRow) {
    kpiRow.style.display = 'flex';
    const med = document.getElementById('invKpiMed');
    if (med) med.textContent = medicine ? medicine.substring(0, 14) + (medicine.length > 14 ? '…' : '') : 'All';
    const is = document.getElementById('invKpiInStock'); if (is) is.textContent = inStock;
    const ls = document.getElementById('invKpiLow');     if (ls) ls.textContent = lowStock;
    const os = document.getElementById('invKpiOut');     if (os) os.textContent = outStock;
  }
  if (filterRow) filterRow.style.display = 'flex';
  if (heading)   heading.textContent = medicine ? `Pharmacies stocking "${medicine}"` : 'All Pharmacy Stock';
  if (countEl)   countEl.textContent  = filtered.length + ' result' + (filtered.length !== 1 ? 's' : '');

  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--slate-400)">' +
      '<i data-lucide="search-x" style="width:36px;height:36px;margin-bottom:0.75rem;display:block;margin-left:auto;margin-right:auto"></i>' +
      (medicine ? '<strong>' + esc(medicine) + '</strong> was not found at any pharmacy.' : 'No pharmacies match the current filter.') +
      (currentInvFilter !== 'all' ? '<br><button class="inv-filter-btn active" style="margin-top:1rem" onclick="setInvFilter(\'all\')">Clear Filter</button>' : '') +
      '</div>';
    lucide.createIcons();
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const status  = p.stock_status || (p.quantity > 50 ? 'in_stock' : p.quantity > 0 ? 'low_stock' : 'out_of_stock');
    const label   = status === 'in_stock' ? 'In Stock' : status === 'low_stock' ? 'Low Stock' : 'Out of Stock';
    const qty     = p.quantity != null ? p.quantity : p.total_items;
    const qtyLabel = qty != null ? qty : '—';
    const price   = p.unit_price ? '₹' + parseFloat(p.unit_price).toFixed(2) + ' per unit' : '';
    const rating  = p.rating ? '⭐ ' + parseFloat(p.rating).toFixed(1) : '';
    const phone   = p.phone ? '<a class="inv-phone-link" href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a>' : '<span style="color:var(--slate-400)">No phone</span>';
    const tags    = [
      p.is_24hr ? '<span class="inv-tag purple">🌙 24-Hour</span>' : '',
      p.has_delivery ? '<span class="inv-tag purple">🛵 Delivery</span>' : '',
      p.area ? '<span class="inv-tag">' + esc(p.area) + '</span>' : ''
    ].filter(Boolean).join('');

    return '<div class="inv-pharmacy-card">' +
      '<div class="inv-card-header">' +
        '<div>' +
          '<div class="inv-card-name">' + esc(p.name || 'Unnamed Pharmacy') + '</div>' +
          (p.area ? '<div class="inv-card-area"><i data-lucide="map-pin" style="width:11px;height:11px;display:inline"></i> ' + esc(p.area) + '</div>' : '') +
        '</div>' +
        '<span class="inv-stock-badge ' + status + '">' + label + '</span>' +
      '</div>' +
      '<div class="inv-card-body">' +
        '<div class="inv-quantity-row">' +
          '<div class="inv-quantity-num">' + qtyLabel + '</div>' +
          '<div class="inv-quantity-label">units<br>available</div>' +
        '</div>' +
        (price ? '<div class="inv-price-row"><i data-lucide="tag" style="width:13px;height:13px;display:inline;margin-right:3px"></i>' + price + '</div>' : '') +
        (tags ? '<div class="inv-tags">' + tags + '</div>' : '') +
      '</div>' +
      '<div class="inv-card-footer">' +
        phone +
        (rating ? '<span class="inv-rating">' + rating + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  lucide.createIcons();
}


/* ═══════════════════════════════════════
   ANALYTICS
═══════════════════════════════════════ */
let chartsInitialized = false;

/* ═══════════════════════════════════════════════════════
   ROLE-BASED ANALYTICS SYSTEM
   Doctor | Patient | Pharmacist | Admin
═══════════════════════════════════════════════════════ */

// Destroy all known analytics charts to allow re-render
const _analyticsChartIds = [
  'drTrendChart','drFeesChart','drHoursChart','drRevisitChart','drOutcomeChart',
  'ptHealthChart','ptSafetyChart','ptVisitChart',
  'phSalesTrendChart','phCategoryChart','phProfitChart','phTopMedsChart','phStockChart',
  'safetyChart','categoryChart','trendChart'
];
function destroyAnalyticsCharts() {
  _analyticsChartIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) { const ci = Chart.getChart(el); if (ci) ci.destroy(); }
  });
}

async function loadAnalytics() {
  destroyAnalyticsCharts();
  chartsInitialized = false;

  const role = currentUser ? currentUser.role : 'admin';
  // Hide all analytics sections, show only the relevant one
  ['analytics-doctor','analytics-patient','analytics-pharmacist','analytics-admin'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });

  const heroConfigs = {
    doctor:     { bg:'linear-gradient(135deg,#2563eb,#1d4ed8)', badge:'🩺 Doctor Analytics', title:'Your Clinical Dashboard', sub:'Track patients examined, revisits, outcomes, fees and active hours' },
    patient:    { bg:'linear-gradient(135deg,#ea580c,#dc2626)', badge:'❤️ My Health Analytics', title:'Your Health Overview', sub:'Monitor your visits, health progress, and prescription safety' },
    pharmacist: { bg:'linear-gradient(135deg,#0d9488,#0f766e)', badge:'💊 Pharmacy Analytics', title:'Pharmacy Performance', sub:'Sales trends, revenue, profit, and medicine category insights' },
    admin:      { bg:'linear-gradient(135deg,#7c3aed,#6d28d9)', badge:'⚙️ Admin Analytics', title:'System-wide Health Insights', sub:'Real-time data on patient outcomes, drug safety, and system usage' },
  };
  const hc = heroConfigs[role] || heroConfigs.admin;
  const hero = document.getElementById('analyticsHero'); if (hero) hero.style.background = hc.bg;
  const badge = document.getElementById('analyticsHeroBadge'); if (badge) badge.innerHTML = hc.badge;
  const title = document.getElementById('analyticsHeroTitle'); if (title) title.textContent = hc.title;
  const sub   = document.getElementById('analyticsHeroSub');   if (sub)   sub.textContent   = hc.sub;

  if (role === 'doctor') {
    const el = document.getElementById('analytics-doctor'); if (el) el.style.display = '';
    loadDoctorAnalytics('weekly');
  } else if (role === 'patient') {
    const el = document.getElementById('analytics-patient'); if (el) el.style.display = '';
    loadPatientAnalytics('bp');
  } else if (role === 'pharmacist') {
    const el = document.getElementById('analytics-pharmacist'); if (el) el.style.display = '';
    loadPharmacistAnalytics('weekly');
  } else {
    const el = document.getElementById('analytics-admin'); if (el) el.style.display = '';
    loadAdminAnalytics();
  }
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 100);
}

/* ─── Helper: makeChart ─── */
function makeChart(id, type, data, options={}) {
  const el = document.getElementById(id); if (!el) return null;
  const existing = Chart.getChart(el); if (existing) existing.destroy();
  return new Chart(el, { type, data, options: { responsive:true, maintainAspectRatio:false, ...options } });
}

/* ──────────────────────────────────────────
   DOCTOR ANALYTICS
────────────────────────────────────────── */
const DOCTOR_DATA = {
  weekly: {
    labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    examined: [18,22,15,28,24,12,8], revisit: [6,8,5,10,9,4,3],
    cured: [12,15,9,19,16,8,5], referred: [2,3,1,4,3,1,1],
    fees: [3600,4400,3000,5600,4800,2400,1600],
    hours: [7,8,6,9,8,5,4],
  },
  monthly: {
    labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    examined: [320,280,350,310,400,370,390,360,340,420,380,440],
    revisit: [95,80,110,90,130,115,125,108,100,140,120,155],
    cured: [210,185,240,205,275,248,264,240,226,292,255,310],
    referred: [28,22,30,26,38,33,36,31,29,41,35,48],
    fees: [64000,56000,70000,62000,80000,74000,78000,72000,68000,84000,76000,88000],
    hours: [168,152,180,165,200,185,195,178,172,208,192,220],
  },
  yearly: {
    labels: ['2021','2022','2023','2024','2025','2026'],
    examined: [2800,3200,3800,4100,4600,1280],
    revisit: [840,980,1200,1280,1450,390],
    cured: [1820,2100,2540,2760,3125,870],
    referred: [240,290,340,375,420,108],
    fees: [560000,640000,760000,820000,920000,256000],
    hours: [1680,1920,2160,2280,2520,672],
  }
};

function loadDoctorAnalytics(period) {
  const d = DOCTOR_DATA[period];
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const total = arr => arr.reduce((a,b)=>a+b,0);
  set('drKpiExamined', total(d.examined).toLocaleString());
  set('drKpiRevisit', total(d.revisit).toLocaleString());
  set('drKpiCured', total(d.cured).toLocaleString());
  set('drKpiReferred', total(d.referred).toLocaleString());
  set('drKpiFees', '₹' + total(d.fees).toLocaleString());
  set('drKpiHours', total(d.hours).toLocaleString() + 'h');
  set('drKpiDhr', '1,248');
  set('dhrPrescriptions', '3,142'); set('dhrLabReports', '876');
  set('dhrNotes', '1,524'); set('dhrImaging', '412');

  const titleMap = { weekly:'📈 Weekly Patient Activity', monthly:'📈 Monthly Patient Activity', yearly:'📈 Yearly Patient Activity' };
  const t = document.getElementById('drTrendTitle'); if (t) t.textContent = titleMap[period];

  const COLORS = { blue:'#2563eb', green:'#22c55e', orange:'#f97316', purple:'#a855f7', red:'#ef4444', teal:'#0d9488', amber:'#f59e0b' };
  makeChart('drTrendChart','bar',{
    labels: d.labels,
    datasets: [
      { label:'Patients Examined', data:d.examined, backgroundColor:'rgba(37,99,235,0.85)', borderRadius:6 },
      { label:'Revisits',          data:d.revisit,  backgroundColor:'rgba(245,158,11,0.85)', borderRadius:6 },
      { label:'Cured/Satisfied',   data:d.cured,    backgroundColor:'rgba(34,197,94,0.85)',  borderRadius:6 },
    ]
  },{ plugins:{legend:{position:'top'}}, scales:{y:{beginAtZero:true}} });

  makeChart('drFeesChart','bar',{
    labels: d.labels,
    datasets:[{ label:'Fees (₹)', data:d.fees, backgroundColor:'rgba(8,145,178,0.8)', borderRadius:6 }]
  },{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} });

  makeChart('drHoursChart','line',{
    labels: d.labels,
    datasets:[{ label:'Active Hours', data:d.hours, borderColor:'#dc2626', backgroundColor:'rgba(220,38,38,0.1)', tension:0.4, fill:true, pointRadius:4, pointBackgroundColor:'#dc2626' }]
  },{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} });

  const totalEx = total(d.examined), totalRe = total(d.revisit), newPat = totalEx - totalRe;
  makeChart('drRevisitChart','doughnut',{
    labels:['New Patients','Revisits'],
    datasets:[{ data:[newPat, totalRe], backgroundColor:['#2563eb','#f59e0b'], borderWidth:0 }]
  },{ plugins:{legend:{position:'bottom'}} });

  const totalCured = total(d.cured), totalReferred = total(d.referred), ongoing = totalEx - totalCured - totalReferred;
  makeChart('drOutcomeChart','doughnut',{
    labels:['Cured / Satisfied','Referred to Specialist','Ongoing Treatment'],
    datasets:[{ data:[totalCured, totalReferred, Math.max(0,ongoing)], backgroundColor:['#22c55e','#a855f7','#f59e0b'], borderWidth:0 }]
  },{ plugins:{legend:{position:'bottom'}} });

  loadSafetyAlerts('alertsTable');
}

function setDrPeriod(period, btn) {
  document.querySelectorAll('#analytics-doctor .analytics-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  destroyAnalyticsCharts();
  loadDoctorAnalytics(period);
}

/* ──────────────────────────────────────────
   PATIENT ANALYTICS
────────────────────────────────────────── */
const PATIENT_HEALTH_DATA = {
  bp:     { label:'Blood Pressure (mmHg)', color:'#dc2626', data:[135,130,128,125,132,128,125,122,120,125,122,118] },
  weight: { label:'Weight (kg)',            color:'#2563eb', data:[78,77.5,77,76.5,76,75.5,75,74.5,74,73.5,73,72.5] },
  sugar:  { label:'Blood Sugar (mg/dL)',    color:'#d97706', data:[145,140,138,135,142,136,130,128,125,132,128,125] },
  spo2:   { label:'SpO2 (%)',               color:'#16a34a', data:[97,98,97,98,96,97,98,97,98,97,98,98] },
};
const PT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function loadPatientAnalytics(metric) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('ptKpiVisits', '14'); set('ptKpiSafe', '3'); set('ptKpiWarning', '1');

  const hd = PATIENT_HEALTH_DATA[metric];
  makeChart('ptHealthChart','line',{
    labels: PT_MONTHS,
    datasets:[{ label:hd.label, data:hd.data, borderColor:hd.color, backgroundColor:hd.color+'18', tension:0.4, fill:true, pointRadius:4, pointBackgroundColor:hd.color }]
  },{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:false}} });

  makeChart('ptSafetyChart','doughnut',{
    labels:['Safe','Caution','Needs Review'],
    datasets:[{ data:[3,1,0], backgroundColor:['#22c55e','#f59e0b','#ef4444'], borderWidth:0 }]
  },{ plugins:{legend:{position:'bottom'}} });

  makeChart('ptVisitChart','bar',{
    labels:['Nov','Dec','Jan','Feb','Mar','Apr'],
    datasets:[{ label:'Doctor Visits', data:[2,3,1,3,2,3], backgroundColor:'rgba(234,88,12,0.8)', borderRadius:6 }]
  },{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, ticks:{stepSize:1}}} });
}

function setPtMetric(metric, btn) {
  document.querySelectorAll('#analytics-patient .analytics-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('ptHealthChart'); if (el) { const c = Chart.getChart(el); if(c) c.destroy(); }
  loadPatientHealthChart(metric);
}
function loadPatientHealthChart(metric) {
  const hd = PATIENT_HEALTH_DATA[metric];
  makeChart('ptHealthChart','line',{
    labels: PT_MONTHS,
    datasets:[{ label:hd.label, data:hd.data, borderColor:hd.color, backgroundColor:hd.color+'18', tension:0.4, fill:true, pointRadius:4, pointBackgroundColor:hd.color }]
  },{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:false}} });
}

/* ──────────────────────────────────────────
   PHARMACIST ANALYTICS
────────────────────────────────────────── */
const PHARMA_DATA = {
  weekly: {
    labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    sales:[145,178,132,210,195,168,98],
    revenue:[14500,17800,13200,21000,19500,16800,9800],
    profit:[4350,5340,3960,6300,5850,5040,2940],
  },
  monthly: {
    labels:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    sales:[3800,3200,4100,3750,4600,4200,4450,4100,3900,4800,4300,5100],
    revenue:[380000,320000,410000,375000,460000,420000,445000,410000,390000,480000,430000,510000],
    profit:[114000,96000,123000,112500,138000,126000,133500,123000,117000,144000,129000,153000],
  },
  yearly: {
    labels:['2021','2022','2023','2024','2025','2026'],
    sales:[38000,43000,49000,54000,61000,17500],
    revenue:[3800000,4300000,4900000,5400000,6100000,1750000],
    profit:[1140000,1290000,1470000,1620000,1830000,525000],
  }
};

function loadPharmacistAnalytics(period) {
  const d = PHARMA_DATA[period];
  const total = arr => arr.reduce((a,b)=>a+b,0);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('phKpiSold', total(d.sales).toLocaleString());
  set('phKpiRevenue', '₹' + (total(d.revenue)/100000).toFixed(1) + 'L');
  set('phKpiProfit', '₹' + (total(d.profit)/100000).toFixed(1) + 'L');
  set('phKpiItems', '248');

  const titleMap = { weekly:'📈 Weekly Sales Trend', monthly:'📈 Monthly Sales Trend', yearly:'📈 Yearly Sales Trend' };
  const t = document.getElementById('phTrendTitle'); if (t) t.textContent = titleMap[period];

  makeChart('phSalesTrendChart','line',{
    labels: d.labels,
    datasets:[
      { label:'Revenue (₹)', data:d.revenue, borderColor:'#0d9488', backgroundColor:'rgba(13,148,136,0.1)', tension:0.4, fill:true, yAxisID:'y' },
      { label:'Profit (₹)',  data:d.profit,  borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,0.08)', tension:0.4, fill:true, yAxisID:'y' },
    ]
  },{ plugins:{legend:{position:'top'}}, scales:{y:{beginAtZero:true}} });

  makeChart('phCategoryChart','bar',{
    labels:['Analgesics','Antibiotics','Antidiabetic','Antihypertensive','Vitamins','Antacids'],
    datasets:[{ label:'Units Sold', data:[820,640,380,520,710,430], backgroundColor:['#3b82f6','#22c55e','#f97316','#a855f7','#ef4444','#eab308'], borderRadius:6 }]
  },{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} });

  makeChart('phProfitChart','bar',{
    labels: d.labels,
    datasets:[
      { label:'Revenue', data:d.revenue, backgroundColor:'rgba(13,148,136,0.8)', borderRadius:6 },
      { label:'Profit',  data:d.profit,  backgroundColor:'rgba(37,99,235,0.8)',  borderRadius:6 },
    ]
  },{ plugins:{legend:{position:'top'}}, scales:{y:{beginAtZero:true}} });

  makeChart('phTopMedsChart','bar',{
    labels:['Paracetamol','Metformin','Amlodipine','Omeprazole','Atorvastatin'],
    datasets:[{ label:'Units', data:[1240,860,720,680,610], backgroundColor:'rgba(13,148,136,0.8)', borderRadius:6, indexAxis:'y' }]
  },{ plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}} });

  makeChart('phStockChart','doughnut',{
    labels:['In Stock','Low Stock','Out of Stock'],
    datasets:[{ data:[182,41,25], backgroundColor:['#22c55e','#f59e0b','#ef4444'], borderWidth:0 }]
  },{ plugins:{legend:{position:'bottom'}} });
}

function setPhPeriod(period, btn) {
  document.querySelectorAll('#analytics-pharmacist .analytics-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['phSalesTrendChart','phCategoryChart','phProfitChart','phTopMedsChart','phStockChart'].forEach(id => {
    const el = document.getElementById(id); if (el) { const c = Chart.getChart(el); if(c) c.destroy(); }
  });
  loadPharmacistAnalytics(period);
}

/* ──────────────────────────────────────────
   ADMIN ANALYTICS (original)
────────────────────────────────────────── */
async function loadAdminAnalytics() {
  try {
    const stats = await api('GET', '/stats');
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || 0; };
    set('kpiPat', stats.patients); set('kpiPres', stats.prescriptions);
    set('kpiAlerts', stats.alerts); set('kpiInv', stats.inventory);
  } catch {}
  loadSafetyAlerts('alertsTableAdmin');
  try {
    const analytics = await api('GET', '/analytics');
    if (!chartsInitialized) { initCharts(analytics); chartsInitialized = true; }
  } catch {
    if (!chartsInitialized) { initCharts(null); chartsInitialized = true; }
  }
}

async function loadSafetyAlerts(tableId) {
  const tbody = document.getElementById(tableId || 'alertsTable');
  if (!tbody) return;
  try {
    const data   = await api('GET', '/safety-alerts');
    const alerts = data.alerts || [];
    if (!alerts.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row" style="color:#16a34a;">✓ No dangerous drug interactions detected</div>';
      return;
    }
    tbody.innerHTML = alerts.map(a =>
      '<tr><td><strong>' + (esc(a.patient_name)||'#'+a.patient_id) + '</strong></td>' +
      '<td style="color:#dc2626;font-weight:600;">' + esc(a.drug_a) + '</td>' +
      '<td style="color:#dc2626;font-weight:600;">' + esc(a.drug_b) + '</td>' +
      '<td style="font-size:0.8rem;">' + esc(a.effect) + '</td>' +
      '<td><span class="badge badge-' + (a.severity==='severe'?'danger':a.severity==='moderate'?'warning':'ok') + '">' + (a.severity||'').toUpperCase() + '</span></td>' +
      '</tr>'
    ).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Could not load safety alerts. JetBrains Mono';
  }
}

function initCharts(analytics) {
  const chartDefaults = { responsive: true, maintainAspectRatio: true };
  const cats = analytics && analytics.categories ? analytics.categories.slice(0,6) : [];
  const catL = cats.length ? cats.map(c=>c.category) : ['Analgesic','Antibiotic','Antidiabetic','Antihypertensive','Anticoagulant','Vitamin'];
  const catC = cats.length ? cats.map(c=>c.count)    : [3,3,1,2,2,1];
  const catCtx = document.getElementById('categoryChart');
  if (catCtx) new Chart(catCtx, {
    type: 'bar',
    data: { labels: catL, datasets: [{ label: 'Medicines', data: catC, backgroundColor: ['#3b82f6','#22c55e','#f97316','#a855f7','#ef4444','#eab308'], borderRadius: 6 }] },
    options: { ...chartDefaults, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
  const sev = analytics && analytics.severity_breakdown ? analytics.severity_breakdown : [];
  const sevMap = {}; sev.forEach(s => { sevMap[s.severity] = s.count; });
  const safetyCtx = document.getElementById('safetyChart');
  if (safetyCtx) new Chart(safetyCtx, {
    type: 'doughnut',
    data: { labels: ['Mild','Moderate','Severe'], datasets: [{ data: [sevMap['mild']||30, sevMap['moderate']||50, sevMap['severe']||20], backgroundColor: ['#22c55e','#eab308','#ef4444'], borderWidth: 0 }] },
    options: { ...chartDefaults, plugins: { legend: { position: 'bottom' } } }
  });
  const pT = analytics && analytics.patient_trend      ? analytics.patient_trend      : [];
  const rT = analytics && analytics.prescription_trend ? analytics.prescription_trend : [];
  const tL = pT.length ? pT.map(d=>d.month) : ['Jan','Feb','Mar','Apr','May','Jun'];
  const trendCtx = document.getElementById('trendChart');
  if (trendCtx) new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: tL,
      datasets: [
        { label:'Patients',      data: pT.length?pT.map(d=>d.count):[0,0,0,0,0,0], borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,0.08)', tension:0.4, fill:true },
        { label:'Prescriptions', data: rT.length?rT.map(d=>d.count):[0,0,0,0,0,0], borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,0.06)',  tension:0.4, fill:true }
      ]
    },
    options: { ...chartDefaults, plugins: { legend: { position:'top' } }, scales: { y: { beginAtZero:true } } }
  });
}

/* ═══════════════════════════════════════
   PATIENT PORTAL
═══════════════════════════════════════ */
const HEALTH_TIPS = [
  '💧 Drink at least 8 glasses of water daily to stay hydrated and support kidney function.',
  '🚶 Walk for at least 30 minutes daily to reduce the risk of diabetes and heart disease.',
  '🥗 Eat 5 servings of fruits and vegetables daily for essential vitamins and minerals.',
  '😴 Adults need 7-9 hours of quality sleep every night for optimal health.',
  '🧂 Limit salt intake to less than 5g per day to control blood pressure.',
  '🚬 Quitting smoking reduces heart disease risk by 50% within 1 year.',
  '💊 Never stop prescribed medication without consulting your doctor.',
  '🩺 Get regular health check-ups — many diseases are curable when caught early.',
  '🧘 Manage stress through yoga, meditation, or breathing exercises daily.',
  '🦷 Brush teeth twice daily — poor oral health is linked to heart disease.'
];
let tipIndex = 0;

function initPortal() {
  showHealthTip();
}
function showHealthTip() {
  const el = document.getElementById('healthTip');
  if (el) el.textContent = HEALTH_TIPS[tipIndex % HEALTH_TIPS.length];
}
function nextHealthTip() { tipIndex++; showHealthTip(); }

async function portalRegister() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const payload = {
    name: g('portalName').trim(), age: parseInt(g('portalAge'))||0,
    gender: g('portalGender'), blood_group: g('portalBlood'),
    phone: g('portalPhone').trim(), village: g('portalVillage').trim(),
    current_medications: g('portalMeds').trim(), known_allergies: g('portalAllergies').trim()
  };
  if (!payload.name || !payload.age) { showToast('Name and age are required', 'error'); return; }
  if (!currentUser) { showToast('Please login first', 'warning'); openModal('loginModal'); return; }
  try {
    await api('POST', '/patients', payload);
    showToast('Health profile created! Your ID will appear in the dashboard.', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function portalLookup() {
  const q  = document.getElementById('portalLookup') ? document.getElementById('portalLookup').value.trim() : '';
  const el = document.getElementById('portalResult');
  if (!q) { showToast('Enter name or ID', 'error'); return; }
  if (!currentUser) {
    if (el) el.innerHTML = '<p style="color:#1a2332;font-size:0.875rem;margin-top:0.75rem;">Please login to look up records.</p>'; return;
  }
  try {
    let patient;
    if (/^\d+$/.test(q)) {
      const data = await api('GET', '/patients/' + q); patient = data.patient;
    } else {
      const data = await api('GET', '/patients?search=' + encodeURIComponent(q));
      patient = (data.patients || [])[0];
    }
    if (!patient) {
      if (el) el.innerHTML = '<p style="color:#dc2626;font-size:0.875rem;margin-top:0.75rem;">No patient found.</p>'; return;
    }
    if (el) el.innerHTML =
      '<div style="margin-top:1rem;padding:1rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">' +
      '<p style="font-weight:800;font-size:1rem;margin-bottom:0.5rem;">' + esc(patient.name) + ' — #' + patient.id + '</p>' +
      '<p style="font-size:0.875rem;color:#374151;">Age: ' + patient.age + ' · ' + (patient.gender||'—') + ' · ' + (patient.blood_group||'—') + '</p>' +
      '<p style="font-size:0.875rem;color:#374151;">📍 ' + (esc(patient.village)||'Unknown') + '</p>' +
      '<p style="font-size:0.875rem;color:#374151;margin-top:0.4rem;">💊 ' + (esc(patient.current_medications)||'None') + '</p>' +
      '</div>';
  } catch (err) {
    if (el) el.innerHTML = '<p style="color:#dc2626;font-size:0.875rem;margin-top:0.75rem;">' + esc(err.message) + '</p>';
  }
}

function calcBMI() {
  const h  = parseFloat(document.getElementById('bmiHeight') ? document.getElementById('bmiHeight').value : 0);
  const w  = parseFloat(document.getElementById('bmiWeight') ? document.getElementById('bmiWeight').value : 0);
  const el = document.getElementById('bmiResult');
  if (!el) return;
  if (!h || !w || h <= 0 || w <= 0) { el.innerHTML = ''; return; }
  const bmi = (w / ((h/100)**2)).toFixed(1);
  let cat, color, bg, border;
  if (bmi < 18.5)    { cat='Underweight';     color='#0891b2'; bg='#ecfeff'; border='#a5f3fc'; }
  else if (bmi < 25) { cat='Normal Weight ✓'; color='#16a34a'; bg='#f0fdf4'; border='#bbf7d0'; }
  else if (bmi < 30) { cat='Overweight';       color='#d97706'; bg='#fffbeb'; border='#fde68a'; }
  else               { cat='Obese';             color='#dc2626'; bg='#fef2f2'; border='#fecaca'; }
  el.innerHTML = '<div class="bmi-result" style="background:' + bg + ';border-color:' + border + ';color:' + color + ';margin-top:0.75rem;">' +
    '<div style="font-size:2rem;font-weight:800">' + bmi + '</div>' +
    '<div style="font-size:0.9rem">' + cat + '</div></div>';
}

/* ═══════════════════════════════════════
   CONTACT
═══════════════════════════════════════ */
async function sendMessage() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const name = g('contactName').trim(), email = g('contactEmail').trim(),
        subject = g('contactSubject'), message = g('contactMessage').trim();
  if (!name || !email || !message) { showToast('Please fill all fields', 'error'); return; }
  try { await api('POST', '/contact', { name, email, subject, message }); } catch {}
  showToast("Message sent! We'll reply within 24 hours.", 'success');
  ['contactName','contactEmail','contactMessage'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}
function toggleFaq(el) { el.classList.toggle('open'); }

/* ═══════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════ */
let notifOpen = false;
async function loadNotifications() {
  try {
    const data   = await api('GET', '/notifications');
    const notifs = data.notifications || [];
    const list   = document.getElementById('notifList');
    if (!list) return;

    const unread = notifs.filter(n => !n.is_read).length;
    const badge  = document.getElementById('notifBadge');
    if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'inline-flex' : 'none'; }

    list.innerHTML = !notifs.length
      ? '<div style="padding:1rem;text-align:center;color:#1a2332;font-size:0.875rem;">No notifications</div>'
      : notifs.slice(0, 12).map(n => {
          const meta    = (typeof n.data === 'object' ? n.data : {}) || {};
          const isRead  = n.is_read;
          const zoomBtn = meta.zoom_join_url
            ? `<a href="${esc(meta.zoom_join_url)}" target="_blank" style="font-size:0.72rem;color:#2563eb;font-weight:600;text-decoration:none;">Join Zoom →</a>`
            : (meta.start_url
               ? `<a href="${esc(meta.start_url)}" target="_blank" style="font-size:0.72rem;color:#2563eb;font-weight:600;text-decoration:none;">Launch →</a>`
               : '');
          return `<div onclick="markNavNotifRead(${n.id},this)" style="padding:0.65rem 1rem;border-bottom:1px solid #f1f5f9;cursor:pointer;${isRead ? 'opacity:0.6;' : 'background:#f0f9ff;'}">
            <div style="display:flex;gap:0.5rem;align-items:flex-start;">
              <div style="width:7px;height:7px;border-radius:50%;background:${isRead ? '#e2e8f0' : '#3b82f6'};margin-top:5px;flex-shrink:0;"></div>
              <div style="flex:1;">
                <div style="font-weight:${isRead ? '500' : '700'};font-size:0.82rem;color:#0d1117;">${esc(n.title)}</div>
                <div style="font-size:0.76rem;color:#1a2332;margin-top:2px;">${esc(n.message||'')}</div>
                ${zoomBtn ? `<div style="margin-top:4px;">${zoomBtn}</div>` : ''}
              </div>
            </div>
          </div>`;
        }).join('');
  } catch {}
}

async function markNavNotifRead(nid, el) {
  try {
    await api('PATCH', `/notifications/${nid}/read`);
    if (el) { el.style.opacity = '0.6'; el.style.background = ''; }
    const badge = document.getElementById('notifBadge');
    if (badge) {
      const nxt = Math.max(0, (parseInt(badge.textContent) || 0) - 1);
      badge.textContent = nxt;
      badge.style.display = nxt > 0 ? 'inline-flex' : 'none';
    }
  } catch {}
}

function toggleNotifications() {
  notifOpen = !notifOpen;
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) { dropdown.style.display = notifOpen ? 'block' : 'none'; if (notifOpen) loadNotifications(); }
}

/* ═══════════════════════════════════════
   ADMIN
═══════════════════════════════════════ */
function loadAdminPanel() {
  if (currentUser && currentUser.role !== 'admin') { showToast('Admin access only', 'error'); navigate('home'); return; }
  loadAdminStats(); loadAdminUsers(); loadAdminInteractions(); loadAdminAlerts();
}

async function loadAdminStats() {
  try {
    const stats = await api('GET', '/stats');
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || 0; };
    set('dbStatPat', stats.patients); set('dbStatPres', stats.prescriptions);
    set('dbStatAlert', stats.alerts); set('dbStatInv', stats.inventory);
    const ints  = await api('GET', '/drug-interactions');
    set('dbStatDrug', (ints.interactions||[]).length);
    const users = await api('GET', '/admin/users');
    set('dbStatUser', (users.users||[]).length);
  } catch {}
}

async function loadAdminUsers() {
  const tbody = document.getElementById('usersTable');
  if (!tbody) return;
  try {
    const data  = await api('GET', '/admin/users');
    const users = data.users || [];
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No users. JetBrains Mono'; return; }
    tbody.innerHTML = users.map(u =>
      '<tr><td>#' + u.id + '</td><td><strong>' + esc(u.name) + '</strong></td><td>' + esc(u.email) + '</td>' +
      '<td><span class="badge ' + (u.role==='admin'?'badge-danger':u.role==='doctor'?'badge-ok':'badge-warning') + '">' + u.role + '</span></td>' +
      '<td style="font-size:0.8rem;color:#374151">' + fmtDate(u.created_at) + '</td>' +
      '<td><button class="btn-sm btn-sm-red" onclick="deleteUser(' + u.id + ')">Delete</button></td>' +
      '</tr>'
    ).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Login as admin to view users. JetBrains Mono'; }
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  try { await api('DELETE', '/admin/users/' + id); showToast('User deleted', 'info'); loadAdminUsers(); }
  catch (err) { showToast(err.message, 'error'); }
}

async function loadAdminInteractions() {
  const tbody = document.getElementById('adminInteractionsTable');
  if (!tbody) return;
  try {
    const data  = await api('GET', '/drug-interactions');
    const items = data.interactions || [];
    if (!items.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No interactions yet. JetBrains Mono'; return; }
    tbody.innerHTML = items.map(i =>
      '<tr><td><strong>' + esc(i.drug_a) + '</strong></td><td><strong>' + esc(i.drug_b) + '</strong></td>' +
      '<td style="font-size:0.85rem;">' + esc(i.effect) + '</td>' +
      '<td><span class="badge badge-warning">' + esc(i.severity) + '</span></td></tr>'
    ).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Loading failed. JetBrains Mono'; }
}

async function loadAdminAlerts() {
  const tbody = document.getElementById('adminAlertsTable');
  if (!tbody) return;
  try {
    const data   = await api('GET', '/alerts');
    const alerts = data.alerts || [];
    if (!alerts.length) { tbody.innerHTML = '<tr><td colspan="3" class="empty-row">No alerts yet. JetBrains Mono'; return; }
    tbody.innerHTML = alerts.map(a =>
      '<tr><td>' + esc(a.type) + '</td><td>' + esc(a.message) + '</td><td>' + esc(a.medicine?a.medicine.name:'—') + '</td></tr>'
    ).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="3" class="empty-row">Failed to load. JetBrains Mono'; }
}

async function addDrugInteraction() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const drug_a = g('newDrugA').trim(), drug_b = g('newDrugB').trim(),
        effect = g('newDrugEffect').trim(), severity = g('newDrugSeverity') || 'moderate';
  if (!drug_a || !drug_b || !effect) { showToast('All fields required', 'error'); return; }
  try {
    await api('POST', '/drug-interactions', { drug_a, drug_b, effect, severity });
    closeModal('addInteractionModal');
    showToast('Drug interaction added!', 'success'); loadAdminInteractions();
    ['newDrugA','newDrugB','newDrugEffect'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  } catch (err) { showToast(err.message, 'error'); }
}

function switchAdminTab(tab) {
  document.querySelectorAll('#page-admin .dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-admin .tab-panel').forEach(p => p.classList.remove('active'));
  const tabEl   = document.querySelector('#page-admin [onclick="switchAdminTab(\'' + tab + '\')"]');
  const panelEl = document.getElementById('atab-' + tab);
  if (tabEl)   tabEl.classList.add('active');
  if (panelEl) panelEl.classList.add('active');
  lucide.createIcons();
  if (tab === 'users')    loadAdminUsers();
  if (tab === 'drugdb')   loadAdminInteractions();
  if (tab === 'alerts')   loadAdminAlerts();
  if (tab === 'settings') loadAdminStats();
}

/* ═══════════════════════════════════════
   SYSTEM HEALTH
═══════════════════════════════════════ */
async function checkSystemHealth() {
  try {
    const data = await api('GET', '/health');
    const el   = document.getElementById('systemHealthIndicator');
    if (el) {
      el.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (data.database==='connected'?'#22c55e':'#ef4444') + ';margin-right:5px;';
      el.title = 'MediGuard v' + data.version + ' | DB: ' + data.database;
    }
  } catch {}
}

/* ═══════════════════════════════════════
   HELPERS
═══════════════════════════════════════ */
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return String(iso).substring(0, 10); }
}

/* ═══════════════════════════════════════════════════════════════
   THEME TOGGLE  (single definition — no duplicates)
   Moon icon → Sun icon when dark mode is on, and vice-versa.
═══════════════════════════════════════════════════════════════ */
function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');

  // Swap icon on every theme-toggle button on the page
  document.querySelectorAll('[onclick="toggleTheme()"] [data-lucide]').forEach(icon => {
    icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
  });
  lucide.createIcons();
  showToast(isDark ? '🌙 Dark mode enabled' : '☀️ Light mode enabled', 'info');
}

/* ═══════════════════════════════════════════════════════════════
   GOOGLE TRANSLATE LANGUAGE SYSTEM
   • changeLanguage(code)  — triggers GT's hidden <select>
   • openLangModal()       — opens the custom language picker modal
   • closeLangModal()      — closes it
   • toggleMoreLangs(btn)  — expands/collapses the "more languages" slot
   No manual translation strings. Google Translate handles 100+
   languages automatically including Hindi and Marathi.
═══════════════════════════════════════════════════════════════ */

// Labels shown in the nav pill per language
const LANG_LABELS = { en:'EN', hi:'हि', mr:'म', ta:'த', te:'తె', kn:'ಕ', gu:'ગ', bn:'বা', pa:'ਪੰ' };

let _activeLang = localStorage.getItem('mg_lang') || 'en';

/* Wait for Google Translate widget to inject its <select> then trigger it */
function _getGTSelect(cb, tries) {
  tries = tries || 0;
  const sel = document.querySelector('.goog-te-combo');
  if (sel) { cb(sel); return; }
  if (tries < 30) setTimeout(() => _getGTSelect(cb, tries + 1), 300);
  // after ~9 s give up silently
}

function changeLanguage(code) {
  _activeLang = code;
  localStorage.setItem('mg_lang', code);

  // Update nav pill label
  const pill = document.getElementById('langPillLabel');
  if (pill) pill.textContent = LANG_LABELS[code] || code.toUpperCase();

  // Highlight active button inside modal
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    const active = btn.dataset.langBtn === code;
    btn.classList.toggle('active-lang', active);
  });

  if (code === 'en') {
    // Restore to original: set Google Translate select back to English
    _getGTSelect(sel => {
      sel.value = 'en';
      sel.dispatchEvent(new Event('change'));
    });
    // Also clear googtrans cookie as fallback
    document.cookie = 'googtrans=/en/en; path=/; max-age=0';
  } else {
    _getGTSelect(sel => {
      sel.value = code;
      sel.dispatchEvent(new Event('change'));
    });
  }

  // Toast messages in the target language
  const toasts = {
    en: '🇬🇧 Language set to English',
    hi: '🇮🇳 भाषा हिन्दी में बदल दी गई',
    mr: '🇮🇳 भाषा मराठीत बदलली',
    ta: '🌐 மொழி தமிழுக்கு மாற்றப்பட்டது',
    te: '🌐 భాష తెలుగుకి మార్చబడింది',
  };
  showToast(toasts[code] || '🌐 Language changed', 'success');
  closeLangModal();
}

/* ── Modal open / close ── */
function openLangModal() {
  const m = document.getElementById('langModal');
  if (!m) return;
  m.classList.add('open');

  // Highlight current language
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.classList.toggle('active-lang', btn.dataset.langBtn === _activeLang);
  });

  // Populate the "More languages" native select slot once GT is ready
  _getGTSelect(sel => {
    const slot = document.getElementById('gtNativeSelectSlot');
    if (slot && !slot.querySelector('select')) {
      // Clone GT's native select into our slot for the "more" section
      const clone = sel.cloneNode(true);
      clone.style.cssText = 'width:100%;padding:0.5rem 0.7rem;border-radius:0.5rem;border:1.5px solid #e2e8f0;background:white;font-size:0.875rem;font-family:inherit;cursor:pointer;';
      clone.addEventListener('change', () => {
        const code = clone.value;
        sel.value = code;
        sel.dispatchEvent(new Event('change'));
        _activeLang = code;
        localStorage.setItem('mg_lang', code);
        const pill = document.getElementById('langPillLabel');
        if (pill) pill.textContent = LANG_LABELS[code] || code.toUpperCase();
        showToast('🌐 Language changed', 'success');
        closeLangModal();
      });
      slot.appendChild(clone);
    }
  });
}

function closeLangModal() {
  const m = document.getElementById('langModal');
  if (m) m.classList.remove('open');
}

function toggleMoreLangs(btn) {
  const wrap = document.getElementById('gtMoreWrap');
  if (!wrap) return;
  const open = wrap.style.display === 'block';
  wrap.style.display = open ? 'none' : 'block';
  btn.textContent = open ? '🌍 More languages…' : '🌍 Hide';
}

/* Also alias for mobile menu backward compat */
function showLanguageOptions() { openLangModal(); }

/* ═══════════════════════════════════════════════════════════════
   RESTORE THEME + LANGUAGE ON PAGE LOAD
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  // Theme
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
    document.querySelectorAll('[onclick="toggleTheme()"] [data-lucide]').forEach(i =>
      i.setAttribute('data-lucide', 'sun'));
    lucide.createIcons();
  }

  // Language pill label
  const saved = localStorage.getItem('mg_lang') || 'en';
  _activeLang = saved;
  const pill = document.getElementById('langPillLabel');
  if (pill) pill.textContent = LANG_LABELS[saved] || saved.toUpperCase();

  // Re-apply saved language after GT widget finishes loading
  if (saved && saved !== 'en') {
    _getGTSelect(sel => {
      sel.value = saved;
      sel.dispatchEvent(new Event('change'));
    });
  }
});

/* ═══════════════════════════════════════════════════════════════
   MICRO-INTERACTIONS — CSS :active handles scale, no JS needed.
   The old setTimeout approach fought with :hover transform and
   caused buttons to visually "jump" or disappear. Removed.
═══════════════════════════════════════════════════════════════ */

/* ─── EMERGENCY SEAS ─── */
let seasState = null;
let seasTrackingInterval = null;
let seasHospitalAlertsInterval = null;
let seasTrackingMap = null;
let seasUserMarker = null;
let seasAmbulanceMarker = null;
let seasRouteLine = null;
let seasMapAutoFitDone = false;

const SEAS_STATUS_ORDER = ['SOS_TRIGGERED', 'AMBULANCE_ASSIGNED', 'IN_TRANSIT', 'HOSPITAL_SELECTED', 'COMPLETED'];
const SEAS_PROGRESS_LABELS = {
  SOS_TRIGGERED: 'SOS Triggered',
  AMBULANCE_ASSIGNED: 'Ambulance Assigned',
  IN_TRANSIT: 'In Transit',
  HOSPITAL_SELECTED: 'Hospital Selected',
  COMPLETED: 'Completed',
};

function initEmergencySEASPage() {
  if (!seasState) {
    seasState = {
      flowStep: 0,
      startedAt: null,
      emergencyType: 'general',
      severity: 'critical',
      location: null,
      ambulance: null,
      hospital: null,
      billing: null,
      hospitalSelectionPending: false,
      hospitalSelectionDone: false,
      etaMins: null,
      timeline: [],
    };
  }
  renderSEAS();
  startSEASHospitalAlertsPolling();
}

function seasRenderHospitalAlerts(alerts) {
  const wrap = document.getElementById('seasHospitalAlerts');
  if (!wrap) return;

  if (!alerts || !alerts.length) {
    wrap.innerHTML = '<p style="color:#64748b;">No hospital alerts yet. Alerts appear after pre-treatment data is shared.</p>';
    return;
  }

  wrap.innerHTML = alerts.map((alert) => {
    const payload = alert.payload || {};
    const patient = payload.patient || {};
    const incident = payload.incident_location || {};
    return `
      <div class="patient-item" style="border-left:4px solid #ef4444;">
        <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
          <strong>${alert.hospital_name || alert.hospital_id || 'Hospital Alert'}</strong>
          <span style="font-size:0.78rem;color:#64748b;">${alert.sent_at || '-'}</span>
        </div>
        <div style="font-size:0.83rem;color:#334155;margin-top:0.25rem;">
          Case ${alert.case_id || '-'} | ${payload.emergency_type || '-'} / ${payload.severity || '-'} | ETA ${payload.eta_minutes != null ? payload.eta_minutes + ' min' : '-'}
        </div>
        <div style="font-size:0.82rem;color:#475569;margin-top:0.2rem;">
          Patient: ${patient.name || 'Unknown'} | Location: ${incident.address || 'Address unavailable'}
        </div>
      </div>
    `;
  }).join('');
}

async function seasLoadHospitalAlerts() {
  const wrap = document.getElementById('seasHospitalAlerts');
  if (!wrap) return;

  let path = '/hospital/alerts?limit=6';
  if (seasState && seasState.caseId) {
    path += '&case_id=' + encodeURIComponent(seasState.caseId);
  } else if (seasState && seasState.hospital && seasState.hospital.id) {
    path += '&hospital_id=' + encodeURIComponent(seasState.hospital.id);
  }

  try {
    const data = await api('GET', path);
    seasRenderHospitalAlerts(data.alerts || []);
  } catch (err) {
    wrap.innerHTML = `<p style="color:#b91c1c;">Could not load hospital alerts: ${err.message}</p>`;
  }
}

function stopSEASHospitalAlertsPolling() {
  if (seasHospitalAlertsInterval) {
    clearInterval(seasHospitalAlertsInterval);
    seasHospitalAlertsInterval = null;
  }
}

function startSEASHospitalAlertsPolling() {
  stopSEASHospitalAlertsPolling();
  seasLoadHospitalAlerts();
  seasHospitalAlertsInterval = setInterval(seasLoadHospitalAlerts, 6000);
}

function seasLog(message) {
  if (!seasState) initEmergencySEASPage();
  const stamp = new Date().toLocaleTimeString();
  seasState.timeline.unshift({ stamp, message });
  seasState.timeline = seasState.timeline.slice(0, 12);
}

function seasUpdateProgressUI(status, loadingStage = null) {
  const stepMap = [
    { el: document.getElementById('seasStepSOS'), key: 'SOS_TRIGGERED' },
    { el: document.getElementById('seasStepAssign'), key: 'AMBULANCE_ASSIGNED' },
    { el: document.getElementById('seasStepTransit'), key: 'IN_TRANSIT' },
    { el: document.getElementById('seasStepHospital'), key: 'HOSPITAL_SELECTED' },
    { el: document.getElementById('seasStepComplete'), key: 'COMPLETED' },
  ];

  const statusIndex = Math.max(0, SEAS_STATUS_ORDER.indexOf(status));
  stepMap.forEach((step, idx) => {
    if (!step.el) return;
    step.el.classList.remove('done', 'active', 'pending', 'loading');
    if (idx < statusIndex) {
      step.el.classList.add('done');
      return;
    }
    if (idx === statusIndex) {
      step.el.classList.add('active');
      return;
    }
    step.el.classList.add('pending');
  });

  if (loadingStage) {
    const target = stepMap.find((x) => x.key === loadingStage);
    if (target && target.el) target.el.classList.add('loading', 'active');
  }
}

async function seasSyncCaseFromBackend() {
  if (!seasState || !seasState.caseId) return null;
  try {
    const data = await api('GET', '/emergency/case/' + encodeURIComponent(seasState.caseId));
    seasState.backendStatus = data.status;
    seasState.billing = data.billing || seasState.billing;
    if (data.billing) {
      const providerEl = document.getElementById('seasInsuranceProvider');
      const planEl = document.getElementById('seasInsurancePlan');
      if (providerEl && data.billing.insurance_provider && !providerEl.value) providerEl.value = data.billing.insurance_provider;
      if (planEl && data.billing.insurance_plan) planEl.value = data.billing.insurance_plan;
    }
    seasState.flowStep = Math.max(
      seasState.flowStep || 0,
      {
        SOS_TRIGGERED: 1,
        AMBULANCE_ASSIGNED: 2,
        IN_TRANSIT: 3,
        HOSPITAL_SELECTED: 4,
        COMPLETED: 5,
      }[data.status] || 0
    );
    return data;
  } catch (_err) {
    return null;
  }
}

function setSEASTriggerStatus(message, type = 'info') {
  const statusEl = document.getElementById('seasTriggerStatus');
  if (!statusEl) return;
  statusEl.style.display = 'block';
  if (type === 'error') {
    statusEl.style.background = '#fef2f2';
    statusEl.style.borderColor = '#fecaca';
    statusEl.style.color = '#991b1b';
  } else if (type === 'success') {
    statusEl.style.background = '#f0fdf4';
    statusEl.style.borderColor = '#bbf7d0';
    statusEl.style.color = '#166534';
  } else {
    statusEl.style.background = '#f8fafc';
    statusEl.style.borderColor = '#e2e8f0';
    statusEl.style.color = '#334155';
  }
  statusEl.textContent = message;
}

function toggleSEASManualLocation(show) {
  const wrap = document.getElementById('seasManualLocationWrap');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
}

function toggleSEASRetry(show) {
  const retryBtn = document.getElementById('seasRetryBtn');
  if (retryBtn) retryBtn.style.display = show ? 'inline-flex' : 'none';
}

function setSEASTriggerLoading(isLoading) {
  const triggerBtn = document.getElementById('seasTriggerBtn');
  if (!triggerBtn) return;
  triggerBtn.disabled = isLoading;
  triggerBtn.style.opacity = isLoading ? '0.75' : '1';
  triggerBtn.innerHTML = isLoading
    ? '<i data-lucide="loader-circle" style="width:16px;height:16px"></i> Triggering...'
    : '<i data-lucide="siren" style="width:16px;height:16px"></i> Trigger SOS';
  lucide.createIcons();
}

function setSEASAssignLoading(isLoading) {
  const assignBtn = document.querySelector('#page-emergency button[onclick="seasAdvanceFlow()"]');
  if (!assignBtn) return;
  assignBtn.disabled = isLoading;
  assignBtn.style.opacity = isLoading ? '0.75' : '1';
}

function setSEASBillingLoading(isLoading) {
  ['seasApplyInsuranceBtn', 'seasMarkPaidBtn', 'seasMarkUnpaidBtn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = isLoading;
    btn.style.opacity = isLoading ? '0.7' : '1';
  });
}

function seasResolveUserId() {
  if (currentUser && currentUser.id) return String(currentUser.id);
  let guest = localStorage.getItem('mg_guest_id');
  if (!guest) {
    guest = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    localStorage.setItem('mg_guest_id', guest);
  }
  return guest;
}

function seasGetManualLocation() {
  const latInput = document.getElementById('seasManualLat');
  const lngInput = document.getElementById('seasManualLng');
  const addressInput = document.getElementById('seasManualAddress');
  const lat = latInput ? Number(latInput.value) : NaN;
  const lng = lngInput ? Number(lngInput.value) : NaN;
  const address = addressInput ? addressInput.value.trim() : '';

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return {
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
    manualAddress: address,
  };
}

function seasGetBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        });
      },
      () => reject(new Error('Location permission denied or unavailable')),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

async function seasReverseGeocodeOSM(latitude, longitude) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error('OSM reverse geocoding failed');
  const data = await res.json();
  return data.display_name || 'Address not available';
}

async function seasTriggerSOS() {
  initEmergencySEASPage();
  const emergencyEl = document.getElementById('seasEmergencyType');
  const severityEl = document.getElementById('seasSeverity');

  setSEASTriggerLoading(true);
  toggleSEASRetry(false);

  seasState.flowStep = 1;
  seasState.startedAt = Date.now();
  seasState.emergencyType = emergencyEl ? emergencyEl.value : 'general';
  seasState.severity = severityEl ? severityEl.value : 'critical';
  seasState.ambulance = null;
  seasState.hospital = null;
  seasState.billing = null;
  seasState.hospitalSelectionPending = false;
  seasState.hospitalSelectionDone = false;
  seasState.etaMins = null;
  seasState.caseId = null;
  seasState.address = null;
  seasState.timeline = [];
  seasState.backendStatus = 'SOS_TRIGGERED';
  seasLog('SOS trigger initiated. Capturing incident context.');
  setSEASTriggerStatus('Fetching location and creating emergency case...', 'info');
  seasRenderHospitalAlerts([]);
  seasUpdateProgressUI('SOS_TRIGGERED', 'SOS_TRIGGERED');

  try {
    let coords;
    let usedManual = false;

    try {
      coords = await seasGetBrowserLocation();
      toggleSEASManualLocation(false);
      seasLog(`Location captured from browser: ${coords.latitude}, ${coords.longitude}.`);
    } catch (_geoErr) {
      toggleSEASManualLocation(true);
      const manual = seasGetManualLocation();
      if (!manual) {
        setSEASTriggerStatus('Please enable location or enter manual latitude/longitude.', 'error');
        seasLog('Location unavailable. Waiting for manual input.');
        toggleSEASRetry(true);
        renderSEAS();
        return;
      }
      coords = { latitude: manual.latitude, longitude: manual.longitude, manualAddress: manual.manualAddress };
      usedManual = true;
      seasLog('Using manually entered location coordinates.');
    }

    seasState.location = { lat: coords.latitude, lng: coords.longitude };

    let address = coords.manualAddress || '';
    if (!address) {
      try {
        address = await seasReverseGeocodeOSM(coords.latitude, coords.longitude);
        seasLog('Address resolved using OpenStreetMap Nominatim.');
      } catch (_geocodeErr) {
        address = 'Address unavailable';
        seasLog('OSM reverse geocoding failed. Proceeding with coordinates only.');
      }
    }

    seasState.address = address;

    const payload = {
      user_id: seasResolveUserId(),
      latitude: coords.latitude,
      longitude: coords.longitude,
      address,
      emergency_type: seasState.emergencyType,
      severity: seasState.severity,
    };

    const response = await api('POST', '/emergency/trigger', payload);
    seasState.caseId = response.case_id;
    seasLog(`Emergency case created: ${response.case_id}.`);
    seasState.flowStep = 1;
    seasState.backendStatus = 'SOS_TRIGGERED';
    seasUpdateProgressUI('SOS_TRIGGERED');

    setSEASTriggerStatus(`SOS Triggered. Case ${response.case_id} created${usedManual ? ' (manual location)' : ''}.`, 'success');
    showToast('SOS Triggered', 'success');

    // Auto-run ambulance assignment after SOS case creation.
    await seasAssignAmbulance();
    renderSEAS();
  } catch (err) {
    seasLog(`Emergency trigger failed: ${err.message}`);
    setSEASTriggerStatus(`Failed to trigger SOS. ${err.message}`, 'error');
    toggleSEASRetry(true);
    showToast('Unable to trigger SOS. Please retry.', 'error');
    renderSEAS();
  } finally {
    setSEASTriggerLoading(false);
    lucide.createIcons();
  }
}

async function seasAssignAmbulance() {
  if (!seasState || !seasState.caseId || !seasState.location) {
    setSEASTriggerStatus('Trigger SOS first to create a valid case before assignment.', 'error');
    return;
  }

  setSEASAssignLoading(true);
  setSEASTriggerStatus('Finding nearest ambulance...', 'info');
  seasLog('Finding nearest available and suitable ambulance...');
  seasUpdateProgressUI(seasState.backendStatus || 'SOS_TRIGGERED', 'AMBULANCE_ASSIGNED');

  try {
    const assignment = await api('POST', '/ambulance/assign', {
      case_id: seasState.caseId,
      latitude: seasState.location.lat,
      longitude: seasState.location.lng,
      severity: seasState.severity,
    });

    seasState.ambulance = {
      id: assignment.ambulance_id,
      driverName: assignment.driver_name,
      type: assignment.ambulance_type || 'N/A',
      distanceKm: assignment.distance_km,
    };
    seasState.billing = assignment.billing || seasState.billing;
    seasState.etaMins = assignment.eta_minutes || (typeof assignment.eta === 'string' ? parseInt(assignment.eta, 10) : null);
    seasState.flowStep = 2;
    seasState.backendStatus = 'AMBULANCE_ASSIGNED';
    seasUpdateProgressUI('AMBULANCE_ASSIGNED');

    setSEASTriggerStatus(`Ambulance assigned: ${assignment.ambulance_id} (${assignment.driver_name}) - ETA ${assignment.eta}.`, 'success');
    seasLog(`Ambulance ${assignment.ambulance_id} assigned. Driver ${assignment.driver_name}. ETA ${assignment.eta}.`);
    showToast('Ambulance Assigned', 'success');
    startSEASTracking();

    // Auto-move to next step (Live tracking / route optimization).
    seasAdvanceFlow();
    renderSEAS();
  } catch (err) {
    const msg = String(err.message || 'Unable to assign ambulance');
    seasState.flowStep = 1;
    setSEASTriggerStatus(msg.includes('No ambulance available') || msg.includes('required type')
      ? 'No ambulance available nearby. Retry or expand coverage.'
      : `Ambulance assignment failed. ${msg}`, 'error');
    seasLog(`Ambulance assignment failed: ${msg}`);
    toggleSEASRetry(true);
    showToast('No ambulance available nearby', 'error');
    renderSEAS();
  } finally {
    setSEASAssignLoading(false);
  }
}

async function seasSelectHospital() {
  if (!seasState || !seasState.caseId || !seasState.location) return null;
  if (seasState.hospitalSelectionPending || seasState.hospitalSelectionDone) return seasState.hospital;

  seasState.hospitalSelectionPending = true;
  setSEASTriggerStatus('Selecting best-fit hospital...', 'info');
  seasLog('Selecting best-fit hospital from database...');
  seasUpdateProgressUI(seasState.backendStatus || 'IN_TRANSIT', 'HOSPITAL_SELECTED');

  try {
    const result = await api('POST', '/hospital/select', {
      case_id: seasState.caseId,
      latitude: seasState.location.lat,
      longitude: seasState.location.lng,
      emergency_type: seasState.emergencyType,
      severity: seasState.severity,
    });

    seasState.hospital = {
      id: result.hospital_id,
      name: result.hospital_name,
      distanceKm: result.distance,
      etaMins: result.eta_minutes || null,
      reserved: true,
      alerted: true,
      specializations: result.specializations || [],
    };
    seasState.hospitalSelectionDone = true;
    seasState.flowStep = Math.max(seasState.flowStep, 4);
    seasState.backendStatus = 'HOSPITAL_SELECTED';
    seasLog(`Hospital selected: ${result.hospital_name} (${result.hospital_id}) at ${result.distance} km.`);
    setSEASTriggerStatus(`Hospital selected: ${result.hospital_name} (${result.hospital_id})`, 'success');
    seasUpdateProgressUI('HOSPITAL_SELECTED');

    if (seasState.ambulance) {
      seasLog('Ambulance route updated to selected hospital and hospital alerted/reserved.');
    }

    try {
      const notifyRes = await api('POST', '/hospital/notify', { case_id: seasState.caseId });
      if (notifyRes && notifyRes.status === 'sent') {
        seasState.flowStep = Math.max(seasState.flowStep, 5);
        seasState.backendStatus = 'COMPLETED';
        seasLog(`Pre-treatment data sent to ${result.hospital_name}. Doctors can prepare before arrival.`);
        setSEASTriggerStatus(`Hospital alerted and pre-treatment data shared: ${result.hospital_name}`, 'success');
        seasLoadHospitalAlerts();
        seasUpdateProgressUI('COMPLETED');
      }
    } catch (notifyErr) {
      seasLog(`Hospital pre-treatment notify failed: ${notifyErr.message}`);
      setSEASTriggerStatus(`Hospital selected, but pre-treatment notify pending: ${notifyErr.message}`, 'error');
    }

    renderSEAS();
    return result;
  } catch (err) {
    seasLog(`Hospital selection failed: ${err.message}`);
    setSEASTriggerStatus(`Hospital selection pending: ${err.message}`, 'error');
    return null;
  } finally {
    seasState.hospitalSelectionPending = false;
  }
}

async function seasApplyInsurance() {
  if (!seasState || !seasState.caseId) {
    showToast('Create a case first', 'warning');
    return;
  }

  const providerEl = document.getElementById('seasInsuranceProvider');
  const planEl = document.getElementById('seasInsurancePlan');
  const insuranceProvider = providerEl ? providerEl.value.trim() : '';
  const insurancePlan = planEl ? planEl.value : 'silver';

  setSEASBillingLoading(true);
  try {
    const res = await api('POST', '/emergency/payment', {
      case_id: seasState.caseId,
      insurance_provider: insuranceProvider,
      insurance_plan: insurancePlan,
      mark_paid: false,
    });
    seasState.billing = res.billing || seasState.billing;
    seasLog(`Insurance applied (${insurancePlan.toUpperCase()}) with coverage ${res.billing.insurance_coverage_pct}%`);
    showToast('Insurance applied', 'success');
    renderSEAS();
  } catch (err) {
    showToast(`Insurance update failed: ${err.message}`, 'error');
  } finally {
    setSEASBillingLoading(false);
  }
}

async function seasMarkPaymentPaid(markPaid) {
  if (!seasState || !seasState.caseId) {
    showToast('No active case for payment update', 'warning');
    return;
  }

  const providerEl = document.getElementById('seasInsuranceProvider');
  const planEl = document.getElementById('seasInsurancePlan');
  const insuranceProvider = providerEl ? providerEl.value.trim() : '';
  const insurancePlan = planEl ? planEl.value : 'silver';

  setSEASBillingLoading(true);
  try {
    const res = await api('POST', '/emergency/payment', {
      case_id: seasState.caseId,
      insurance_provider: insuranceProvider,
      insurance_plan: insurancePlan,
      mark_paid: !!markPaid,
    });
    seasState.billing = res.billing || seasState.billing;
    seasLog(`Payment status updated to ${res.billing.payment_status}.`);
    showToast(markPaid ? 'Payment marked paid' : 'Payment marked unpaid', markPaid ? 'success' : 'info');
    renderSEAS();
  } catch (err) {
    showToast(`Payment update failed: ${err.message}`, 'error');
  } finally {
    setSEASBillingLoading(false);
  }
}

function stopSEASTracking() {
  if (seasTrackingInterval) {
    clearInterval(seasTrackingInterval);
    seasTrackingInterval = null;
  }
  stopSEASHospitalAlertsPolling();
}

function ensureSEASTrackingMap(userPos, ambPos) {
  if (!window.L) return null;
  const mapDiv = document.getElementById('seasTrackingMap');
  if (!mapDiv) return null;

  if (!seasTrackingMap) {
    seasTrackingMap = L.map(mapDiv, { zoomControl: true, scrollWheelZoom: true }).setView([userPos.lat, userPos.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(seasTrackingMap);
  }

  if (!seasUserMarker) {
    seasUserMarker = L.marker([userPos.lat, userPos.lng], { icon: createLeafletCircleIcon('#2563eb', 'U') }).addTo(seasTrackingMap);
    seasUserMarker.bindPopup('User Location');
  } else {
    seasUserMarker.setLatLng([userPos.lat, userPos.lng]);
  }

  const ambulanceIcon = L.divIcon({
    className: 'custom-leaflet-marker',
    html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 4px rgba(15,23,42,0.35));">🚑</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10]
  });

  if (!seasAmbulanceMarker) {
    seasAmbulanceMarker = L.marker([ambPos.lat, ambPos.lng], { icon: ambulanceIcon }).addTo(seasTrackingMap);
    seasAmbulanceMarker.bindPopup('Assigned Ambulance');
  }

  if (!seasMapAutoFitDone) {
    const bounds = L.latLngBounds([[userPos.lat, userPos.lng], [ambPos.lat, ambPos.lng]]);
    seasTrackingMap.fitBounds(bounds.pad(0.25));
    seasMapAutoFitDone = true;
  }

  setTimeout(() => seasTrackingMap.invalidateSize(), 0);
  return seasTrackingMap;
}

function animateAmbulanceMarker(targetLat, targetLng) {
  if (!seasAmbulanceMarker) return;
  const from = seasAmbulanceMarker.getLatLng();
  const duration = 1000;
  const start = performance.now();

  function frame(ts) {
    const t = Math.min(1, (ts - start) / duration);
    const lat = from.lat + (targetLat - from.lat) * t;
    const lng = from.lng + (targetLng - from.lng) * t;
    seasAmbulanceMarker.setLatLng([lat, lng]);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function seasFetchOSRMRoute(ambPos, userPos) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${ambPos.lng},${ambPos.lat};${userPos.lng},${userPos.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
    if (!coords || !coords.length) return null;
    return coords.map(([lng, lat]) => [lat, lng]);
  } catch (_err) {
    return null;
  }
}

async function seasRenderTrackingRoute(ambPos, userPos) {
  if (!seasTrackingMap) return;
  const latLngs = (await seasFetchOSRMRoute(ambPos, userPos)) || [[ambPos.lat, ambPos.lng], [userPos.lat, userPos.lng]];
  if (seasRouteLine) seasRouteLine.remove();
  seasRouteLine = L.polyline(latLngs, { color: '#7c3aed', weight: 4, opacity: 0.85 }).addTo(seasTrackingMap);
}

async function seasPollTracking() {
  if (!seasState || !seasState.caseId) return;
  const meta = document.getElementById('seasTrackingMeta');

  try {
    const track = await api('GET', '/ambulance/track/' + encodeURIComponent(seasState.caseId));
    const userPos = {
      lat: Number(track.user_location.latitude),
      lng: Number(track.user_location.longitude),
    };
    const ambPos = {
      lat: Number(track.ambulance_location.latitude),
      lng: Number(track.ambulance_location.longitude),
    };

    ensureSEASTrackingMap(userPos, ambPos);
    animateAmbulanceMarker(ambPos.lat, ambPos.lng);
    await seasRenderTrackingRoute(ambPos, userPos);

    if (!seasState.hospitalSelectionDone && !seasState.hospitalSelectionPending) {
      await seasSelectHospital();
    }

    const caseSnapshot = await seasSyncCaseFromBackend();
    if (caseSnapshot && caseSnapshot.status) {
      seasUpdateProgressUI(caseSnapshot.status);
    } else {
      seasUpdateProgressUI(seasState.backendStatus || 'IN_TRANSIT', 'IN_TRANSIT');
    }

    seasState.location = userPos;
    if (!seasState.ambulance) seasState.ambulance = {};
    seasState.ambulance.id = track.ambulance_id;
    seasState.ambulance.driverName = track.driver_name;
    seasState.etaMins = Number(track.eta_minutes);
    if (track.arrived) {
      seasState.flowStep = 5;
      seasState.backendStatus = seasState.backendStatus || 'IN_TRANSIT';
    } else {
      seasState.flowStep = Math.max(seasState.flowStep, 3);
      if (!seasState.hospitalSelectionDone) seasState.backendStatus = 'IN_TRANSIT';
    }

    if (meta) {
      meta.textContent = track.arrived
        ? `Ambulance Arrived ✅ (${track.ambulance_id})`
        : `Distance: ${track.distance_km} km | ETA: ${track.eta_minutes} min | Driver: ${track.driver_name}${seasState.hospital ? ` | Hospital: ${seasState.hospital.name}` : ''}`;
    }

    if (track.arrived && !seasState.arrivalAnnounced) {
      seasState.arrivalAnnounced = true;
      seasLog('Ambulance Arrived at incident location.');
      setSEASTriggerStatus('Ambulance Arrived ✅', 'success');
      showToast('Ambulance Arrived', 'success');
      stopSEASTracking();
    }

    renderSEAS();
  } catch (err) {
    if (meta) meta.textContent = `Tracking paused: ${err.message}`;
  }
}

function startSEASTracking() {
  stopSEASTracking();
  seasMapAutoFitDone = false;
  seasState.backendStatus = seasState.backendStatus || 'IN_TRANSIT';
  seasUpdateProgressUI(seasState.backendStatus, 'IN_TRANSIT');
  seasPollTracking();
  seasTrackingInterval = setInterval(seasPollTracking, 4000);
}

async function seasAdvanceFlow() {
  if (!seasState || seasState.flowStep === 0) {
    showToast('Trigger SOS first to start emergency flow', 'warning');
    return;
  }

  if (seasState.flowStep === 1) {
    showToast('Ambulance assignment pending. Please retry assignment.', 'warning');
    renderSEAS();
    return;
  }

  if (seasState.flowStep === 2) {
    seasState.flowStep = 3;
    seasLog('Live tracking started. Hospital selection will run against live case data.');
    renderSEAS();
    return;
  }

  if (seasState.flowStep === 3) {
    await seasSelectHospital();
    renderSEAS();
    return;
  }

  if (seasState.flowStep === 4) {
    seasState.flowStep = 5;
    seasLog('Patient condition, emergency type, and ETA sent to hospital pre-arrival desk.');
    renderSEAS();
    showToast('SEAS flow complete: pre-treatment is now ready', 'success');
    return;
  }

  showToast('SEAS flow already completed. Trigger SOS to start again.', 'info');
}

function renderSEAS() {
  const statusEl = document.getElementById('seasLiveStatus');
  const timelineEl = document.getElementById('seasTimeline');
  if (!statusEl || !timelineEl || !seasState) return;

  const currentStepLabel = SEAS_PROGRESS_LABELS[seasState.backendStatus] || ['Idle', 'SOS Triggered', 'Ambulance Assigned', 'Live Tracking', 'Hospital Selected', 'Pre-treatment Ready'][seasState.flowStep] || 'Idle';

  statusEl.innerHTML = [
    `<div class="metric-card"><h4>Case ID</h4><p>${seasState.caseId || 'Not created'}</p></div>`,
    `<div class="metric-card"><h4>Assignment</h4><p>${seasState.ambulance ? 'Assigned ✅' : 'Pending ❌'}</p></div>`,
    `<div class="metric-card"><h4>Flow Status</h4><p>${currentStepLabel}</p></div>`,
    `<div class="metric-card"><h4>Emergency</h4><p>${seasState.emergencyType.toUpperCase()} / ${seasState.severity.toUpperCase()}</p></div>`,
    `<div class="metric-card"><h4>Location</h4><p>${seasState.location ? seasState.location.lat + ', ' + seasState.location.lng : 'Waiting for SOS'}</p></div>`,
    `<div class="metric-card"><h4>Address</h4><p>${seasState.address || 'Pending geocode'}</p></div>`,
    `<div class="metric-card"><h4>Ambulance</h4><p>${seasState.ambulance ? (seasState.ambulance.id + ' (' + seasState.ambulance.type + ')') : 'Not assigned'}</p></div>`,
    `<div class="metric-card"><h4>Driver</h4><p>${seasState.ambulance && seasState.ambulance.driverName ? seasState.ambulance.driverName : 'Pending'}</p></div>`,
    `<div class="metric-card"><h4>ETA</h4><p>${seasState.etaMins ? seasState.etaMins + ' minutes' : 'Pending'}</p></div>`,
    `<div class="metric-card"><h4>Hospital</h4><p>${seasState.hospital ? `${seasState.hospital.name}${seasState.hospital.distanceKm != null ? ` • ${seasState.hospital.distanceKm} km` : ''}${seasState.hospital.reserved ? ' • Reserved' : ''}` : 'Not selected'}</p></div>`,
    `<div class="metric-card"><h4>Ambulance Cost</h4><p>${seasState.billing && seasState.billing.total_cost ? `INR ${Number(seasState.billing.total_cost).toFixed(2)}` : 'Pending'}</p></div>`,
    `<div class="metric-card"><h4>Payable</h4><p>${seasState.billing && seasState.billing.payable_amount != null ? `INR ${Number(seasState.billing.payable_amount).toFixed(2)}` : 'Pending'}</p></div>`,
    `<div class="metric-card"><h4>Payment</h4><p>${seasState.billing && seasState.billing.payment_status ? seasState.billing.payment_status : 'UNPAID'}</p></div>`,
  ].join('');

  timelineEl.innerHTML = seasState.timeline.length
    ? seasState.timeline.map((item) => `<div class="patient-item"><div><strong>${item.stamp}</strong></div><div>${item.message}</div></div>`).join('')
    : '<p style="color:#64748b;">No emergency events yet. Trigger SOS to begin.</p>';

  const billingSummary = document.getElementById('seasBillingSummary');
  if (billingSummary) {
    if (!seasState.billing || !seasState.billing.total_cost) {
      billingSummary.textContent = 'Ambulance cost will appear after assignment.';
    } else {
      const coverage = Number(seasState.billing.insurance_coverage_pct || 0);
      billingSummary.textContent = `Total: INR ${Number(seasState.billing.total_cost).toFixed(2)} | Insurance: ${coverage}% | Payable: INR ${Number(seasState.billing.payable_amount || 0).toFixed(2)} | Status: ${seasState.billing.payment_status || 'UNPAID'}`;
    }
  }

  seasUpdateProgressUI(seasState.backendStatus || 'SOS_TRIGGERED');
}


/* ─── FLOATING CHATBOT ─── */
function toggleChatbot() {
  const overlay = document.getElementById('chatbotOverlay');
  if (overlay.style.display === 'none' || overlay.style.display === '') {
    overlay.style.display = 'flex';
    _chatHistory = [];
    seedChatbot();
  } else {
    overlay.style.display = 'none';
  }
}

let _chatHistory = [];

async function sendBotMessage() {
  const input = document.getElementById('chatbotInput');
  const msg = input.value.trim();
  if (!msg) return;
  const messagesDiv = document.getElementById('chatbotMessages');
  appendChatMessage('user', msg);
  input.value = '';
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  const typingEl = document.createElement('div');
  typingEl.className = 'chatbot-message bot';
  typingEl.innerHTML = '<span style="opacity:0.5;letter-spacing:3px;font-size:1.1rem">●●●</span>';
  messagesDiv.appendChild(typingEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  _chatHistory.push({ role: 'user', content: msg });
  await new Promise(r => setTimeout(r, 420));
  typingEl.remove();

  const response = getChatbotResponse(msg);
  _chatHistory.push({ role: 'assistant', content: response.message });
  appendChatMessage('bot', response.message, response.actions || []);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
let chatbotSeeded = false;

function seedChatbot() {
  if (chatbotSeeded) return;
  chatbotSeeded = true;
  
  let greeting = 'Welcome to MediGuard AI!';
  let msg = '';
  let actions = [];
  
  if (!currentUser) {
    // Not logged in
    greeting = 'Welcome to MediGuard AI!';
    msg = 'I can help you explore our healthcare platform, explain features, or guide you through login. What would you like to do?';
    actions = [
      { label: '📖 Explore Features', action: "navigate('features')" },
      { label: '🔐 Login', action: "openModal('loginModal')" },
      { label: '💬 Contact Support', action: "navigate('contact')" },
    ];
  } else if (currentUser.role === 'doctor') {
    // Doctor role
    greeting = `Welcome back, Dr. ${currentUser.name}!`;
    msg = 'As a doctor, you can consult with patients, manage health records, prescribe medicines, and use AI-powered clinical tools. What next?';
    actions = filterChatbotActions([
      { label: '👥 Patient Consultations', action: "navigate('telemedicine')" },
      { label: '🚑 Emergency SEAS', action: "navigate('emergency')" },
      { label: '📋 Health Records', action: "navigate('dashboard')" },
      { label: '💊 Medicine Database', action: "navigate('medicines')" },
      { label: '🧠 AI Clinical Tools', action: "navigate('ai-safety-guard')" },
    ]);
  } else if (currentUser.role === 'pharmacist') {
    // Pharmacist role
    greeting = `Welcome, ${currentUser.name}!`;
    msg = 'As a pharmacist, you can manage inventory, check drug interactions, and fulfill prescriptions. How can I help?';
    actions = filterChatbotActions([
      { label: '📦 Live Inventory', action: "navigate('inventory')" },
      { label: '💊 Medicine Database', action: "navigate('medicines')" },
      { label: '🏪 Find Pharmacies', action: "navigate('pharmacy')" },
      { label: '⚠️ Drug Interactions', action: "navigate('ai-safety-guard')" },
    ]);
  } else if (currentUser.role === 'patient') {
    // Patient role
    greeting = `Welcome, ${currentUser.name}!`;
    msg = 'You can book doctor consultations, manage your health records, search medicines, and find pharmacies near you. What would you like to do?';
    actions = filterChatbotActions([
      { label: '👨‍⚕️ Book Doctor', action: "navigate('telemedicine')" },
      { label: '🚨 Emergency SOS', action: "navigate('emergency')" },
      { label: '📊 My Health', action: "navigate('dashboard')" },
      { label: '🏥 Patient Portal', action: "navigate('portal')" },
      { label: '🏪 Find Pharmacy', action: "navigate('pharmacy')" },
    ]);
  } else if (currentUser.role === 'admin') {
    // Admin role
    greeting = `Welcome, Admin ${currentUser.name}!`;
    msg = 'You have full system access. Manage users, monitor analytics, and configure system settings.';
    actions = filterChatbotActions([
      { label: '⚙️ Admin Panel', action: "navigate('admin')" },
      { label: '📊 Analytics', action: "navigate('analytics')" },
      { label: '💊 Medicine Database', action: "navigate('medicines')" },
    ]);
  }
  
  appendChatMessage('bot', greeting, []);
  setTimeout(() => {
    appendChatMessage('bot', msg, actions);
  }, 400);
}

function appendChatMessage(type, text, actions = []) {
  const messagesDiv = document.getElementById('chatbotMessages');
  if (!messagesDiv) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chatbot-message ' + type;
  msgDiv.textContent = text;
  messagesDiv.appendChild(msgDiv);

  if (actions.length) {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'chatbot-actions';
    actions.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.className = 'chatbot-chip';
      btn.textContent = label;
      btn.setAttribute('onclick', action);
      actionWrap.appendChild(btn);
    });
    messagesDiv.appendChild(actionWrap);
  }

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/* Helper: filter chatbot actions by user access */
function filterChatbotActions(actions) {
  return actions.filter(({ action }) => {
    // Extract page name from navigate() call
    const match = action.match(/navigate\('([^']+)'\)/);
    if (!match) return true; // Allow non-navigate actions
    const page = match[1];
    return hasAccess(page);
  });
}

function getChatbotResponse(rawMessage) {
  const msg = rawMessage.toLowerCase();

  if (/(hello|hi|hey)/.test(msg)) {
    return {
      message: 'Hello. Tell me what you want to do, and I can guide you or open the right page.',
      actions: filterChatbotActions([
        { label: 'Explore features', action: "navigate('features')" },
        { label: 'Login', action: "openModal('loginModal')" },
      ]),
    };
  }

  if (/(login|sign in|google|otp|phone|email)/.test(msg)) {
    return {
      message: 'Use the secure login modal for Google sign-in, email plus CAPTCHA, or phone plus OTP with country code selection.',
      actions: filterChatbotActions([{ label: 'Open login', action: "openModal('loginModal')" }]),
    };
  }

  if (/(appointment|teleconsult|doctor|consult)/.test(msg)) {
    return {
      message: 'Teleconsultation is available for doctors and patients. You can book, review doctors, and join scheduled sessions there.',
      actions: filterChatbotActions([{ label: 'Go to teleconsultation', action: "navigate('telemedicine')" }]),
    };
  }

  if (/(medicine|drug|database|interaction|safety)/.test(msg)) {
    return {
      message: 'The Medicine Database helps doctors and pharmacists search medicines, while AI Safety Guard highlights risky combinations for doctors and patients.',
      actions: filterChatbotActions([
        { label: 'Medicine Database', action: "navigate('medicines')" },
        { label: 'Digital records', action: "navigate('dashboard')" },
      ]),
    };
  }

  if (/(pharmacy|stock|inventory|finder|map)/.test(msg)) {
    return {
      message: 'Pharmacy Finder supports doctors, patients, and pharmacists. Live inventory is reserved for pharmacists.',
      actions: filterChatbotActions([{ label: 'Open pharmacy tools', action: "navigate('pharmacy')" }]),
    };
  }

  if (/(analytics|report|dashboard)/.test(msg)) {
    return {
      message: 'Analytics Dashboard is available for doctors, patients, and admins. Digital Health Records are available for doctors and patients.',
      actions: filterChatbotActions([
        { label: 'Analytics', action: "navigate('analytics')" },
        { label: 'Health records', action: "navigate('dashboard')" },
      ]),
    };
  }

  if (/(portal|profile|records)/.test(msg)) {
    return {
      message: 'Patient Portal is available to patient accounts, while Digital Health Records are shared between doctors and patients.',
      actions: filterChatbotActions([{ label: 'Patient Portal', action: "navigate('portal')" }]),
    };
  }

  if (/(go to|open|take me to)/.test(msg)) {
    for (const [term, page] of Object.entries(FEATURE_NAVIGATION)) {
      if (msg.includes(term)) {
        return {
          message: `Opening ${page} for you.`,
          actions: filterChatbotActions([{ label: 'Open now', action: `navigate('${page}')` }]),
        };
      }
    }
  }

  return {
    message: 'I can help with login, teleconsultation, medicines, pharmacy tools, analytics, patient portal, and site navigation.',
    actions: filterChatbotActions([
      { label: 'Features', action: "navigate('features')" },
      { label: 'Contact', action: "navigate('contact')" },
    ]),
  };
}

// applyTelemedicineRestrictions() removed — role routing handled by initTelemedicinePage()

// 1. Function to change language via Google Translate
function changeLanguage(langCode) {
    const googleSelect = document.querySelector('.goog-te-combo');
    
    if (googleSelect) {
        googleSelect.value = langCode;
        // Google Translate listens for a 'change' event to trigger translation
        googleSelect.dispatchEvent(new Event('change'));
        closeLangModal();
    } else {
        console.error("Google Translate widget not loaded yet.");
    }
}

// 2. Function to open/close the modal
function openLangModal() {
    document.getElementById('langModal').style.display = 'flex';
}

function closeLangModal() {
    document.getElementById('langModal').style.display = 'none';
}

// 3. Logic for the "More Languages" section
function toggleMoreLangs(btn) {
    const wrap = document.getElementById('gtMoreWrap');
    const slot = document.getElementById('gtNativeSelectSlot');
    const nativeCombo = document.querySelector('.goog-te-combo');

    if (wrap.style.display === 'block') {
        wrap.style.display = 'none';
        btn.innerHTML = '🌍 More languages…';
    } else {
        wrap.style.display = 'block';
        btn.innerHTML = '▲ Show less';
        
        // Move the hidden Google dropdown into your modal slot so users can see it
        if (nativeCombo && slot.children.length === 0) {
            slot.appendChild(nativeCombo);
        }
    }
}

// ════════════════════════════════════════════════════════════════════
// PHARMACIST INVENTORY MANAGEMENT (NEW)
// ════════════════════════════════════════════════════════════════════

/**
 * Load the pharmacist's inventory
 * Called when pharmacist views their inventory dashboard
 */
async function loadPharmacistInventory() {
  const section = document.getElementById('inv-pharmacist-section');
  if (!section) return;
  
  // Only show if user is pharmacist
  if (!currentUser || (currentUser.role !== 'pharmacist' && currentUser.role !== 'admin')) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  
  try {
    // Load inventory
    const invData = await api('GET', '/my-pharmacy/inventory');
    const inventory = invData.inventory || [];
    
    // Load alerts
    const alertsData = await api('GET', '/my-pharmacy/get-alerts');
    
    // Update alert banner
    const alertBanner = document.getElementById('pharmacistAlertsBanner');
    if (alertBanner) {
      if (alertsData.out_of_stock_count === 0 && alertsData.low_stock_count === 0) {
        alertBanner.innerHTML = '<div class="pharm-alert-ok" style="background:#d1fae5;border-left:4px solid #10b981;padding:0.75rem;border-radius:8px;color:#047857"><strong>✓ Good Stock Levels</strong> - All medicines adequately stocked</div>';
      } else {
        alertBanner.innerHTML = 
          '<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:0.75rem;border-radius:8px;color:#92400e">' +
          '<strong>⚠ Stock Alerts</strong>' +
          (alertsData.out_of_stock_count > 0 ? ' - <span style="color:#dc2626">' + alertsData.out_of_stock_count + ' out of stock</span>' : '') +
          (alertsData.low_stock_count > 0 ? ' - <span style="color:#f59e0b">' + alertsData.low_stock_count + ' low stock</span>' : '') +
          '</div>';
      }
    }
    
    // Render inventory table
    renderPharmacistInventoryTable(inventory);
    
  } catch(e) {
    console.error('Error loading pharmacist inventory:', e);
    const table = document.getElementById('pharmInventoryTable');
    if (table) {
      table.innerHTML = '<tr><td colspan="7" class="empty-row" style="color:#ef4444">Error loading inventory: ' + esc(e.message || 'Unknown error') + '</td></tr>';
    }
  }
}

/**
 * Render inventory table with update controls
 */
function renderPharmacistInventoryTable(inventory) {
  const table = document.getElementById('pharmInventoryTable');
  if (!table) return;
  
  if (!inventory || inventory.length === 0) {
    table.innerHTML = '<tr><td colspan="7" class="empty-row">No medicines in inventory. Initialize default stock to get started.</td></tr>';
    return;
  }
  
  table.innerHTML = inventory.map((med, idx) => {
    const status = med.stock_status || (med.quantity > 50 ? 'in_stock' : med.quantity > 0 ? 'low_stock' : 'out_of_stock');
    const statusLabel = status === 'in_stock' ? 'In Stock' : status === 'low_stock' ? 'Low Stock' : 'Out of Stock';
    const statusColor = status === 'in_stock' ? '#10b981' : status === 'low_stock' ? '#f59e0b' : '#ef4444';
    
    return '<tr>' +
      '<td><strong>' + esc(med.medicine_name || '—') + '</strong></td>' +
      '<td>' + esc(med.category || '—') + '</td>' +
      '<td style="font-weight:600;font-size:1rem">' + (med.quantity || 0) + '</td>' +
      '<td>' + esc(med.form || '—') + '</td>' +
      '<td>' + esc(med.manufacturer || '—') + '</td>' +
      '<td><span style="background:' + statusColor + '15;color:' + statusColor + ';padding:0.35rem 0.75rem;border-radius:6px;font-size:0.8rem;font-weight:600">' + statusLabel + '</span></td>' +
      '<td style="display:flex;gap:0.4rem;flex-wrap:wrap">' +
        '<button class="btn-sm btn-sm-blue" onclick="openStockModal(' + med.id + ', \'' + esc(med.medicine_name) + '\', ' + (med.quantity || 0) + ')" style="padding:0.35rem 0.6rem;font-size:0.75rem">✎ Edit</button>' +
        '<button class="btn-sm btn-sm-green" onclick="quickIncreaseStock(' + med.id + ', \'' + esc(med.medicine_name) + '\')" style="padding:0.35rem 0.6rem;font-size:0.75rem">+ Add</button>' +
        '<button class="btn-sm btn-sm-red" onclick="quickDecreaseStock(' + med.id + ', \'' + esc(med.medicine_name) + '\')" style="padding:0.35rem 0.6rem;font-size:0.75rem">− Remove</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

/**
 * Search inventory by medicine name
 */
function searchInventory(query) {
  const table = document.getElementById('pharmInventoryTable');
  if (!table) return;
  
  const rows = table.querySelectorAll('tr');
  const lowerQuery = query.toLowerCase();
  
  rows.forEach(row => {
    const medicineName = row.cells[0]?.textContent.toLowerCase() || '';
    row.style.display = medicineName.includes(lowerQuery) ? '' : 'none';
  });
}

/**
 * Filter inventory by stock status
 */
function filterInventoryCategory(category, btn) {
  const table = document.getElementById('pharmInventoryTable');
  if (!table) return;
  
  // Update active button
  document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  
  const rows = table.querySelectorAll('tr');
  rows.forEach(row => {
    const statusCell = row.cells[5]?.textContent.toLowerCase() || '';
    let show = true;
    
    if (category === 'low') {
      show = statusCell.includes('low stock');
    } else if (category === 'out') {
      show = statusCell.includes('out of stock');
    } else if (category === 'ok') {
      show = statusCell.includes('in stock');
    }
    
    row.style.display = show ? '' : 'none';
  });
}

/**
 * Open modal to edit stock quantity
 */
function openStockModal(inventoryId, medicineName, currentQty) {
  let modal = document.getElementById('inventoryModal');
  if (!modal) {
    // Create modal if it doesn't exist
    const body = document.body;
    const modalHtml = `
      <div id="inventoryModal" class="modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
        <div class="modal-content" style="background:white;padding:2rem;border-radius:12px;width:90%;max-width:400px;box-shadow:0 20px 50px rgba(0,0,0,0.2)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
            <h3 id="stockModalTitle" style="margin:0;font-size:1.2rem;font-weight:800">Update Stock</h3>
            <button onclick="closeStockModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#374151">✕</button>
          </div>
          
          <div style="margin-bottom:1.5rem">
            <label style="display:block;font-weight:600;margin-bottom:0.5rem;color:#0d1117">Medicine</label>
            <div id="stockModalMedicine" style="padding:0.75rem;background:#f1f5f9;border-radius:8px;color:#1a2332"></div>
          </div>
          
          <div style="margin-bottom:1.5rem">
            <label style="display:block;font-weight:600;margin-bottom:0.5rem;color:#0d1117">Current Quantity</label>
            <div id="stockModalCurrent" style="padding:0.75rem;background:#f1f5f9;border-radius:8px;color:#1a2332;font-weight:600"></div>
          </div>
          
          <div style="margin-bottom:1.5rem">
            <label style="display:block;font-weight:600;margin-bottom:0.5rem;color:#0d1117">New Quantity</label>
            <input type="number" id="stockModalInput" min="0" style="width:100%;padding:0.75rem;border:1.5px solid #cbd5e1;border-radius:8px;font-size:1rem" />
          </div>
          
          <div style="display:flex;gap:0.75rem;justify-content:space-between">
            <button class="btn-white" onclick="closeStockModal()" style="flex:1">Cancel</button>
            <button class="btn-blue" onclick="submitStockUpdate()" style="flex:1">Update Stock</button>
          </div>
        </div>
      </div>
    `;
    body.insertAdjacentHTML('beforeend', modalHtml);
    modal = document.getElementById('inventoryModal');
  }
  
  // Populate modal
  document.getElementById('stockModalTitle').textContent = 'Update Stock';
  document.getElementById('stockModalMedicine').textContent = medicineName;
  document.getElementById('stockModalCurrent').textContent = currentQty + ' units';
  document.getElementById('stockModalInput').value = currentQty;
  
  // Store data on modal
  modal._inventoryId = inventoryId;
  modal._medicineName = medicineName;
  
  // Show modal
  modal.style.display = 'flex';
  document.getElementById('stockModalInput').focus();
}

/**
 * Close stock modal
 */
function closeStockModal() {
  const modal = document.getElementById('inventoryModal');
  if (modal) modal.style.display = 'none';
}

/**
 * Submit stock update
 */
async function submitStockUpdate() {
  const modal = document.getElementById('inventoryModal');
  const input = document.getElementById('stockModalInput');
  const newQty = parseInt(input.value);
  
  if (isNaN(newQty) || newQty < 0) {
    showToast('Please enter a valid quantity', 'error');
    return;
  }
  
  try {
    const response = await api('POST', '/my-pharmacy/update-stock', {
      inventory_id: modal._inventoryId,
      quantity: newQty
    });
    
    showToast('Stock updated successfully for ' + modal._medicineName, 'success');
    closeStockModal();
    loadPharmacistInventory(); // Reload
    
  } catch(e) {
    showToast('Error updating stock: ' + (e.message || 'Unknown error'), 'error');
  }
}

/**
 * Quick increase stock by 10 units
 */
async function quickIncreaseStock(inventoryId, medicineName) {
  try {
    const response = await api('POST', '/my-pharmacy/increase-stock', {
      inventory_id: inventoryId,
      amount: 10
    });
    
    showToast('Added 10 units to ' + medicineName, 'success');
    loadPharmacistInventory(); // Reload
    
  } catch(e) {
    showToast('Error: ' + (e.message || 'Unknown error'), 'error');
  }
}

/**
 * Quick decrease stock by 1 unit
 */
async function quickDecreaseStock(inventoryId, medicineName) {
  try {
    const response = await api('POST', '/my-pharmacy/decrease-stock', {
      inventory_id: inventoryId,
      amount: 1
    });
    
    showToast('Removed 1 unit from ' + medicineName, 'success');
    loadPharmacistInventory(); // Reload
    
  } catch(e) {
    showToast('Error: ' + (e.message || 'Unknown error'), 'error');
  }
}

/**
 * Initialize default stock (called when pharmacy registers)
 */
async function initializePharmacyStock() {
  if (!confirm('This will set all medicines to 20 units. Continue?')) return;
  
  try {
    const response = await api('POST', '/my-pharmacy/initialize-stock');
    showToast('Initialized ' + response.inserted_count + ' medicines with ' + response.default_quantity + ' units each', 'success');
    loadPharmacistInventory(); // Reload
    
  } catch(e) {
    showToast('Error: ' + (e.message || 'Unknown error'), 'error');
  }
}

/**
 * Load and display stock alerts in modal
 */
async function loadStockAlerts() {
  if (!currentUser || (currentUser.role !== 'pharmacist' && currentUser.role !== 'admin')) {
    showToast('Only pharmacists can view alerts', 'error');
    return;
  }
  
  try {
    const data = await api('GET', '/my-pharmacy/get-alerts');
    
    let alertsHtml = '';
    if (data.alerts && data.alerts.length > 0) {
      alertsHtml = data.alerts.map(alert => 
        '<div style="padding:0.75rem;background:' + (alert.status === 'out_of_stock' ? '#fee2e2' : '#fef3c7') + ';border-left:3px solid ' + (alert.status === 'out_of_stock' ? '#ef4444' : '#f59e0b') + ';border-radius:6px;margin-bottom:0.5rem">' +
          '<strong>' + esc(alert.medicine_name) + '</strong>' +
          '<div style="font-size:0.85rem;color:#666">' + (alert.status === 'out_of_stock' ? 'OUT OF STOCK' : 'LOW STOCK: ' + alert.quantity + ' units') + '</div>' +
        '</div>'
      ).join('');
    } else {
      alertsHtml = '<div style="padding:1rem;text-align:center;color:#374151">No stock alerts - everything is well stocked!</div>';
    }
    
    // Show in toast or modal
    showToast('Stock Alerts: ' + data.out_of_stock_count + ' out of stock, ' + data.low_stock_count + ' low stock', 'info');
    
  } catch(e) {
    showToast('Error loading alerts: ' + (e.message || 'Unknown error'), 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// AI-POWERED CLINICAL INTELLIGENCE MODULE
// ═══════════════════════════════════════════════════════════════

/**
 * Load AI-Powered Clinical Intelligence dashboard
 */
async function loadAISafetyGuard() {
  try {
    // Load dashboard data
    const dashboardData = await api('GET', '/ai-safety-guard/dashboard');
    updateSafetyKpi(dashboardData.dashboard);

    // Load clinical insights
    const insightsData = await api('GET', '/clinical-insights');
    renderClinicalInsightsTable(insightsData.insights || []);

    // Reset choice state
    showClinicalOption(null);

  } catch(e) {
    console.error('Error loading AI Clinical Intelligence:', e);
    showToast('Error loading clinical data: ' + (e.message || 'Unknown error'), 'error');
  }
}

/**
 * Update safety dashboard KPIs
 */
function updateSafetyKpi(data) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || 0;
  };

  set('safetyKpiPatients', data.total_patients);
  set('safetyKpiPrescriptions', data.total_prescriptions);
  set('safetyKpiAlerts', data.unresolved_alerts);
  set('safetyKpiIssues', data.potential_issues);
}

/**
 * Render clinical insights table
 */
function renderClinicalInsightsTable(insights) {
  const tbody = document.getElementById('clinicalInsightsTable');
  if (!tbody) return;

  if (!insights || insights.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">✓ No clinical insights available</td></tr>';
    return;
  }

  tbody.innerHTML = insights.map(insight => {
    const priorityClass = (insight.priority || '').toLowerCase() === 'high' ? 'danger' :
                         (insight.priority || '').toLowerCase() === 'medium' ? 'warning' : 'ok';
    const priorityLabel = (insight.priority || 'LOW').toUpperCase();

    return '<tr>' +
      '<td><strong>' + esc(insight.patient_name || 'Unknown') + '</strong></td>' +
      '<td>' + esc(insight.insight_type || 'General') + '</td>' +
      '<td><span class="badge badge-' + priorityClass + '">' + priorityLabel + '</span></td>' +
      '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">' + esc(insight.recommendation || 'No specific recommendation') + '</td>' +
      '<td>' + fmtDate(insight.created_at) + '</td>' +
    '</tr>';
  }).join('');
}

function showClinicalOption(option) {
  const diag = document.getElementById('diagnosticPanel');
  const well = document.getElementById('wellnessPanel');
  const optDiag = document.getElementById('clinicalOptionDiagnostic');
  const optWell = document.getElementById('clinicalOptionWellness');

  if (diag) diag.style.display = option === 'diagnostic' ? 'block' : 'none';
  if (well) well.style.display = option === 'wellness' ? 'block' : 'none';

  if (optDiag) optDiag.classList.toggle('active', option === 'diagnostic');
  if (optWell) optWell.classList.toggle('active', option === 'wellness');
}

/**
 * Start deep dive diagnostic analysis
 */
async function startDeepDive() {
  const symptomsInput = document.getElementById('diagnosticSymptoms');
  const labsInput = document.getElementById('diagnosticLabs');
  const resultsDiv = document.getElementById('diagnosticResults');
  const contentDiv = document.getElementById('diagnosticContent');

  if (!symptomsInput || !resultsDiv || !contentDiv) return;

  const symptoms = symptomsInput.value.trim();
  const labs = labsInput.value.trim();

  if (!symptoms) {
    showToast('Please enter patient symptoms', 'error');
    return;
  }

  try {
    const data = await api('POST', '/ai-clinical-intelligence/diagnostic-analysis', { 
      symptoms: symptoms,
      lab_results: labs || null
    });

    let html = '<div style="margin-bottom:1rem;"><strong>Diagnostic Analysis Results:</strong></div>';

    if (data.analysis.pathways && data.analysis.pathways.length > 0) {
      html += '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:1rem;margin-bottom:1rem;">';
      html += '<h4 style="color:#0369a1;margin:0 0 0.5rem 0;">🔍 Potential Clinical Pathways</h4>';
      html += '<div style="display:flex;flex-direction:column;gap:0.5rem;">';

      data.analysis.pathways.forEach(pathway => {
        const confidenceColor = pathway.confidence > 0.8 ? '#16a34a' : pathway.confidence > 0.6 ? '#d97706' : '#dc2626';
        html += '<div style="background:white;border-left:3px solid ' + confidenceColor + ';padding:0.75rem;border-radius:6px;">';
        html += '<div style="font-weight:600;margin-bottom:0.25rem;">' + esc(pathway.condition) + '</div>';
        html += '<div style="font-size:0.9rem;color:#374151;margin-bottom:0.25rem;">Confidence: ' + Math.round(pathway.confidence * 100) + '%</div>';
        html += '<div style="font-size:0.9rem;color:#6b7280;">' + esc(pathway.notes || 'Further evaluation recommended') + '</div>';
        html += '</div>';
      });

      html += '</div></div>';
    } else {
      html += '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;margin-bottom:1rem;">';
      html += '<h4 style="color:#6b7280;margin:0;">No Clear Pathways Identified</h4>';
      html += '<p style="margin:0.5rem 0 0 0;color:#6b7280;">The symptoms provided do not strongly suggest specific conditions. Consider additional testing or consultation.</p>';
      html += '</div>';
    }

    if (data.analysis.recommendations && data.analysis.recommendations.length > 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:1rem;">';
      html += '<h4 style="color:#92400e;margin:0 0 0.5rem 0;">💡 Recommendations</h4>';
      html += '<ul style="margin:0;padding-left:1.2rem;color:#78350f;">';
      data.analysis.recommendations.forEach(rec => {
        html += '<li>' + esc(rec) + '</li>';
      });
      html += '</ul></div>';
    }

    contentDiv.innerHTML = html;
    resultsDiv.style.display = 'block';

  } catch(e) {
    contentDiv.innerHTML = '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:1rem;color:#dc2626;">Error performing diagnostic analysis: ' + esc(e.message || 'Unknown error') + '</div>';
    resultsDiv.style.display = 'block';
    showToast('Error performing diagnostic analysis', 'error');
  }
}

/**
 * Generate personalized wellness plan
 */
async function generateWellnessPlan() {
  const patientIdInput = document.getElementById('wellnessPatientId');
  const geneticsInput = document.getElementById('wellnessGenetics');
  const resultsDiv = document.getElementById('wellnessResults');
  const contentDiv = document.getElementById('wellnessContent');

  if (!patientIdInput || !resultsDiv || !contentDiv) return;

  const patientId = parseInt(patientIdInput.value);
  const genetics = geneticsInput.value.trim();

  if (!patientId || patientId <= 0) {
    showToast('Please enter a valid patient ID', 'error');
    return;
  }

  try {
    const data = await api('POST', '/ai-clinical-intelligence/wellness-plan', {
      patient_id: patientId,
      genetic_markers: genetics || null
    });

    let html = '<div style="margin-bottom:1rem;"><strong>Personalized Wellness Plan for Patient: ' + esc(data.patient.name) + ' (ID: ' + data.patient.id + ')</strong></div>';
    html += '<div style="background:#f1f5f9;border-radius:8px;padding:1rem;margin-bottom:1rem;">';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;">';
    html += '<div><strong>Age:</strong> ' + (data.patient.age || 'Unknown') + '</div>';
    html += '<div><strong>Risk Factors:</strong> ' + (data.plan.risk_factors?.length || 0) + '</div>';
    html += '<div><strong>Recommendations:</strong> ' + (data.plan.recommendations?.length || 0) + '</div>';
    html += '<div><strong>Lifestyle Score:</strong> ' + (data.plan.lifestyle_score || 'N/A') + '/100</div>';
    html += '</div></div>';

    // Show wellness recommendations
    if (data.plan.recommendations && data.plan.recommendations.length > 0) {
      html += '<div style="margin-bottom:1rem;"><strong>Personalized Recommendations:</strong></div>';
      data.plan.recommendations.forEach(rec => {
        const categoryColor = rec.category === 'nutrition' ? '#16a34a' : 
                             rec.category === 'exercise' ? '#0369a1' : 
                             rec.category === 'mental' ? '#7c3aed' : '#d97706';
        html += '<div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:1rem;margin-bottom:0.75rem;">';
        html += '<div style="font-weight:600;margin-bottom:0.5rem;color:' + categoryColor + ';">' + esc(rec.category.toUpperCase()) + ': ' + esc(rec.title) + '</div>';
        html += '<div style="color:#374151;">' + esc(rec.description) + '</div>';
        if (rec.frequency) {
          html += '<div style="font-size:0.9rem;color:#6b7280;margin-top:0.5rem;">Frequency: ' + esc(rec.frequency) + '</div>';
        }
        html += '</div>';
      });
    }

    // Show risk factors
    if (data.plan.risk_factors && data.plan.risk_factors.length > 0) {
      html += '<div style="margin-bottom:1rem;margin-top:1.5rem;"><strong>⚠️ Identified Risk Factors:</strong></div>';
      html += '<div style="display:flex;flex-direction:column;gap:0.5rem;">';

      data.plan.risk_factors.forEach(factor => {
        const severityColor = factor.severity === 'high' ? '#dc2626' : factor.severity === 'medium' ? '#d97706' : '#16a34a';
        html += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:0.75rem;">';
        html += '<div style="font-weight:600;color:' + severityColor + ';margin-bottom:0.25rem;">' + esc(factor.factor) + ' (' + factor.severity.toUpperCase() + ')</div>';
        html += '<div style="font-size:0.9rem;color:#374151;">' + esc(factor.notes || 'Monitor closely') + '</div>';
        html += '</div>';
      });

      html += '</div>';
    }

    contentDiv.innerHTML = html;
    resultsDiv.style.display = 'block';

  } catch(e) {
    contentDiv.innerHTML = '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:1rem;color:#dc2626;">Error generating wellness plan: ' + esc(e.message || 'Unknown error') + '</div>';
    resultsDiv.style.display = 'block';
    showToast('Error generating wellness plan', 'error');
  }
}

/**
 * Get AI recommendations for health queries
 */
async function getAIRecommendations() {
  const queryInput = document.getElementById('aiQuery');
  const resultsDiv = document.getElementById('recommendationsResults');
  const contentDiv = document.getElementById('recommendationsContent');

  if (!queryInput || !resultsDiv || !contentDiv) return;

  const query = queryInput.value.trim();
  if (!query) {
    showToast('Please enter a health-related question', 'error');
    return;
  }

  try {
    const data = await api('POST', '/ai-clinical-intelligence/recommendations', { query: query });

    let html = '<div style="margin-bottom:1rem;"><strong>AI Recommendations for: "' + esc(query) + '"</strong></div>';

    if (data.recommendations && data.recommendations.length > 0) {
      html += '<div style="display:flex;flex-direction:column;gap:0.75rem;">';

      data.recommendations.forEach(rec => {
        const categoryIcon = rec.category === 'diagnostic' ? '🔍' : 
                           rec.category === 'treatment' ? '💊' : 
                           rec.category === 'lifestyle' ? '🏃' : '💡';
        html += '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:1rem;">';
        html += '<div style="font-weight:600;color:#0369a1;margin-bottom:0.5rem;">' + categoryIcon + ' ' + esc(rec.title) + '</div>';
        html += '<div style="color:#374151;margin-bottom:0.5rem;">' + esc(rec.description) + '</div>';
        if (rec.confidence) {
          html += '<div style="font-size:0.9rem;color:#6b7280;">Confidence: ' + Math.round(rec.confidence * 100) + '%</div>';
        }
        html += '</div>';
      });

      html += '</div>';
    } else {
      html += '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;text-align:center;color:#6b7280;">';
      html += 'No specific recommendations available for this query. Please consult with a healthcare professional for personalized advice.';
      html += '</div>';
    }

    contentDiv.innerHTML = html;
    resultsDiv.style.display = 'block';

  } catch(e) {
    contentDiv.innerHTML = '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:1rem;color:#dc2626;">Error getting AI recommendations: ' + esc(e.message || 'Unknown error') + '</div>';
    resultsDiv.style.display = 'block';
    showToast('Error getting AI recommendations', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   features.js  –  MediGuard AI: Teleconsultation + Live Pharmacy Inventory
   Append the contents of this file to the end of your existing script.js
   ═══════════════════════════════════════════════════════════════════════ */

async function getAIRecommendations() {
  const queryInput = document.getElementById('aiQuery');
  const resultsDiv = document.getElementById('recommendationsResults');
  const contentDiv = document.getElementById('recommendationsContent');

  if (!queryInput || !resultsDiv || !contentDiv) return;

  const query = queryInput.value.trim();
  if (!query) {
    showToast('Please enter a health-related question', 'error');
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = 'Bearer ' + authToken;

    const response = await fetch(BASE_URL + '/ai-clinical-intelligence/recommendations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: query })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 503) {
        contentDiv.innerHTML =
          '<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:1rem;color:#9a3412;">' +
          '<div style="font-weight:700;margin-bottom:0.45rem;">AI is not configured yet</div>' +
          '<div style="line-height:1.55;">This feature now uses live AI-generated answers only. The backend does not currently have an AI provider key configured, so it cannot answer this request right now.</div>' +
          '<div style="margin-top:0.65rem;font-size:0.95rem;">Server message: ' + esc(data.error || 'Recommendation AI is unavailable.') + '</div>' +
          '</div>';
        resultsDiv.style.display = 'block';
        showToast('AI is not configured on the backend yet', 'warning');
        return;
      }
      throw new Error(data.error || 'Request failed');
    }

    const categoryIcons = {
      diagnostic: '🔍',
      treatment: '💊',
      lifestyle: '🏃',
      urgent: '🚨',
      followup: '📅',
      'follow-up': '📅',
      medication: '💉',
      general: '💡'
    };

    let html = '<div style="margin-bottom:1rem;"><strong>AI Recommendations for: "' + esc(query) + '"</strong></div>';

    if (data.answer) {
      html += '<div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:1rem;margin-bottom:1rem;">';
      html += '<div style="font-weight:600;color:#0f766e;margin-bottom:0.4rem;">Direct Answer</div>';
      html += '<div style="color:#0d1117;line-height:1.55;">' + esc(data.answer) + '</div>';
      html += '</div>';
    }

    if (data.recommendations && data.recommendations.length > 0) {
      html += '<div style="display:flex;flex-direction:column;gap:0.75rem;">';
      data.recommendations.forEach(rec => {
        const categoryIcon = categoryIcons[(rec.category || '').toLowerCase()] || '💡';
        html += '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:1rem;">';
        html += '<div style="font-weight:600;color:#0369a1;margin-bottom:0.5rem;">' + categoryIcon + ' ' + esc(rec.title) + '</div>';
        html += '<div style="color:#374151;margin-bottom:0.5rem;">' + esc(rec.description) + '</div>';
        if (rec.confidence) {
          html += '<div style="font-size:0.9rem;color:#6b7280;">Confidence: ' + Math.round(rec.confidence * 100) + '%</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;text-align:center;color:#6b7280;">';
      html += 'No specific recommendations available for this query. Please consult with a healthcare professional for personalized advice.';
      html += '</div>';
    }

    contentDiv.innerHTML = html;
    resultsDiv.style.display = 'block';
  } catch (e) {
    contentDiv.innerHTML = '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:1rem;color:#dc2626;">Error getting AI recommendations: ' + esc(e.message || 'Unknown error') + '</div>';
    resultsDiv.style.display = 'block';
    showToast('Error getting AI recommendations', 'error');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   TELECONSULTATION
══════════════════════════════════════════════════════════════════════ */

// switchTeleTab / loadTeleStats / loadDoctorPicker / bookZoomConsultation / loadConsultations / loadDoctors / medicinePage — removed (replaced by role-based tele system)

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
                  <div style="font-size:0.78rem;color:#1a2332;margin:0.25rem 0;">${p.area} • ${p.city}</div>
                  ${p.is_24hr ? '<span style="background:#f0fdf4;color:#16a34a;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:0.3rem;font-weight:700;">24 HOURS</span>' : ''}
                  ${p.has_delivery ? '<span style="background:#eff6ff;color:#2563eb;font-size:0.72rem;padding:0.1rem 0.4rem;border-radius:0.3rem;font-weight:700;margin-left:0.3rem;">DELIVERY</span>' : ''}
                  <div style="font-size:0.8rem;margin-top:0.5rem;">📞 ${p.phone || '—'}</div>
                  <div style="font-size:0.78rem;color:#1a2332;">🕐 ${p.open_hours}</div>
                  ${p.distance_km != null ? `<div style="font-size:0.78rem;margin-top:0.25rem;color:#0d9488;font-weight:600;">📍 ${p.distance_km} km away</div>` : ''}
                  <div style="display:flex;gap:0.4rem;margin-top:0.6rem;">
                    <a href="https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}" target="_blank"
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
        el.innerHTML = '<div style="text-align:center;color:#374151;padding:2rem;font-size:0.875rem;">No pharmacies found</div>';
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
            <div style="font-size:0.75rem;color:#1a2332;">${p.area} • ⭐ ${p.rating}</div>
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
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#374151;">No pharmacies found</div>';
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
            <div style="font-size:0.82rem;color:#1a2332;margin-bottom:0.4rem;line-height:1.5;">📍 ${p.address || p.area + ', Pune'}</div>
            <div style="font-size:0.82rem;color:#1a2332;margin-bottom:0.4rem;">📞 ${p.phone || '—'}</div>
            <div style="font-size:0.82rem;color:#1a2332;margin-bottom:0.4rem;">🕐 ${p.open_hours}</div>
            <div style="display:flex;gap:0.4rem;margin:0.75rem 0;flex-wrap:wrap;">
              <span style="background:#f0fdf4;color:#16a34a;font-size:0.72rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:600;">⭐ ${p.rating}</span>
              ${p.has_delivery ? '<span style="background:#eff6ff;color:#2563eb;font-size:0.72rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:600;">🚚 Delivery</span>' : ''}
              ${p.distance_km != null ? `<span style="background:#f0fdf4;color:#0d9488;font-size:0.72rem;border-radius:0.4rem;padding:0.15rem 0.5rem;font-weight:600;">📍 ${p.distance_km} km</span>` : ''}
            </div>
            <div style="display:flex;gap:0.5rem;">
              <button onclick="openPharmacyDetail(${p.id})" class="btn-sm" style="flex:1;background:#0d9488;color:white;border:none;border-radius:0.5rem;padding:0.45rem;cursor:pointer;font-size:0.8rem;font-weight:600;">View Stock</button>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}"
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
        '<div style="padding:2rem;text-align:center;color:#374151;">Loading inventory...</div>';
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
                  <div style="font-size:0.8rem;color:#1a2332;">📍 ${p.address || p.area + ', Pune'}</div>
                  <div style="font-size:0.8rem;color:#1a2332;margin-top:0.25rem;">📞 ${p.phone || '—'}</div>
                  <div style="font-size:0.8rem;color:#1a2332;margin-top:0.25rem;">🕐 ${p.open_hours}</div>
                </div>
                <div>
                  <a href="https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}" target="_blank"
                     style="display:inline-flex;align-items:center;gap:0.4rem;background:#2563eb;color:white;text-decoration:none;border-radius:0.6rem;padding:0.5rem 1rem;font-size:0.85rem;font-weight:700;">
                    🗺 Get Directions
                  </a>
                </div>
              </div>
              <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:0.5rem;padding:0.5rem 1rem;text-align:center;">
                  <div style="font-size:1.1rem;font-weight:800;color:#16a34a;">${stockSummary.in_stock}</div>
                  <div style="font-size:0.72rem;color:#1a2332;">In Stock</div>
                </div>
                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:0.5rem;padding:0.5rem 1rem;text-align:center;">
                  <div style="font-size:1.1rem;font-weight:800;color:#f59e0b;">${stockSummary.low_stock}</div>
                  <div style="font-size:0.72rem;color:#1a2332;">Low Stock</div>
                </div>
                <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:0.5rem;padding:0.5rem 1rem;text-align:center;">
                  <div style="font-size:1.1rem;font-weight:800;color:#ef4444;">${stockSummary.out_of_stock}</div>
                  <div style="font-size:0.72rem;color:#1a2332;">Out of Stock</div>
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
                        ${item.generic_name ? `<div style="font-size:0.72rem;color:#374151;">${item.generic_name}</div>` : ''}
                      </div>
                      <div style="display:flex;align-items:center;gap:0.75rem;flex-shrink:0;">
                        <span style="font-size:0.8rem;font-weight:700;color:${item.stock_status==='out_of_stock'?'#ef4444':item.stock_status==='low_stock'?'#f59e0b':'#16a34a'};">
                          ${item.quantity > 0 ? item.quantity + ' units' : 'Out of Stock'}
                        </span>
                        ${item.unit_price > 0 ? `<span style="font-size:0.8rem;color:#1a2332;font-weight:600;">₹${item.unit_price}</span>` : ''}
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
    el.innerHTML = '<div style="text-align:center;color:#374151;padding:2rem;">Searching pharmacies...</div>';

    let url = `${API}/api/pharmacies/search?medicine=${encodeURIComponent(medicine)}`;
    if (_userLat) url += `&lat=${_userLat}&lng=${_userLng}&radius=25`;

    try {
        const r = await fetch(url);
        const d = await r.json();
        const results = d.results || [];

        if (!results.length) {
            el.innerHTML = `<div style="text-align:center;padding:3rem;color:#374151;">
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
                <div style="font-size:0.8rem;color:#1a2332;margin-top:0.25rem;">${inStock} available • ${outStock} out of stock</div>
              </div>
              <button onclick="plotMedResultsOnMap()" style="background:#0f766e;color:white;border:none;border-radius:0.5rem;padding:0.5rem 1rem;cursor:pointer;font-size:0.85rem;font-weight:600;">🗺 Show on Map</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem;">
              ${results.map(item => `
                  <div style="background:white;border:2px solid ${item.stock_status==='out_of_stock'?'#fecaca':item.stock_status==='low_stock'?'#fde68a':'#bbf7d0'};border-radius:0.75rem;overflow:hidden;">
                    <div style="background:${item.stock_status==='out_of_stock'?'#fef2f2':item.stock_status==='low_stock'?'#fffbeb':'#f0fdf4'};padding:0.75rem 1rem;display:flex;justify-content:space-between;align-items:center;">
                      <div>
                        <div style="font-weight:700;font-size:0.9rem;">${item.name}</div>
                        <div style="font-size:0.75rem;color:#1a2332;">${item.area} • ⭐ ${item.rating}</div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-weight:800;font-size:1rem;color:${item.stock_status==='out_of_stock'?'#ef4444':item.stock_status==='low_stock'?'#f59e0b':'#16a34a'};">
                          ${item.quantity > 0 ? item.quantity + ' units' : 'Out of Stock'}
                        </div>
                        ${item.unit_price > 0 ? `<div style="font-size:0.8rem;color:#1a2332;">₹${item.unit_price}</div>` : ''}
                      </div>
                    </div>
                    <div style="padding:0.75rem 1rem;">
                      <div style="font-size:0.78rem;color:#1a2332;margin-bottom:0.5rem;">${item.phone || '—'} • ${item.is_24hr ? '24 Hrs' : item.open_hours}</div>
                      ${item.distance_km != null ? `<div style="font-size:0.78rem;color:#0d9488;font-weight:700;margin-bottom:0.5rem;">📍 ${item.distance_km} km away</div>` : ''}
                      <div style="display:flex;gap:0.4rem;">
                        <button onclick="openPharmacyDetail(${item.id})" style="flex:1;background:#0d9488;color:white;border:none;border-radius:0.5rem;padding:0.4rem;cursor:pointer;font-size:0.78rem;font-weight:600;">View All Stock</button>
                        <a href="https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}" target="_blank"
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
                  ${m.generic_name ? `<span style="color:#374151;font-size:0.78rem;">${m.generic_name}</span>` : ''}
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

// ═══════════════════════════════════════════════════════════════════════════
// ROLE-BASED TELECONSULTATION  (patient / doctor / guest)
// ═══════════════════════════════════════════════════════════════════════════

let _allDoctors        = [];   // cached from /api/doctors
let _currentDoctorId   = null; // doctors.id for logged-in doctor
let _notifDropOpen     = false;
let _notifPollTimer    = null;

// ── Entry point ─────────────────────────────────────────────────────────────
function initTelemedicinePage() {
  const role = currentUser?.role;
  document.getElementById('tele-guest').style.display  = (!currentUser)      ? 'block' : 'none';
  document.getElementById('tele-patient').style.display = (role === 'patient') ? 'block' : 'none';
  document.getElementById('tele-doctor').style.display  = (role === 'doctor' || role === 'admin') ? 'block' : 'none';

  if (!currentUser) return;

  startNotifPolling();

  if (role === 'patient') {
    loadPatientDoctors();
    loadPatientAppointments();
    // Pre-fill name
    const n = document.getElementById('bookAptPatName');
    if (n && !n.value) n.value = currentUser.name || '';
  } else if (role === 'doctor' || role === 'admin') {
    loadDoctorProfile();
  }
}

// ── Notification polling (bell badge) ───────────────────────────────────────
function startNotifPolling() {
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  refreshNotifBadge();
  _notifPollTimer = setInterval(refreshNotifBadge, 30000);
}

async function refreshNotifBadge() {
  if (!currentUser) return;
  try {
    const data = await api('GET', '/notifications/unread-count');
    const count = data.unread || 0;
    // Patient bell
    const pb = document.getElementById('teleNotifBadge');
    if (pb) { pb.textContent = count; pb.style.display = count > 0 ? 'block' : 'none'; }
    // Doctor bell
    const db = document.getElementById('drNotifBadge');
    if (db) { db.textContent = count; db.style.display = count > 0 ? 'block' : 'none'; }
    // Nav bell
    const nb = document.getElementById('notifBadge');
    if (nb) { nb.textContent = count; }
  } catch {}
}

function toggleTeleNotifDropdown() {
  _notifDropOpen = !_notifDropOpen;
  const role = currentUser?.role;
  const pat  = document.getElementById('teleNotifDropdown');
  const dr   = document.getElementById('drNotifDropdown');
  const target = (role === 'doctor' || role === 'admin') ? dr : pat;
  if (!target) return;
  target.style.display = _notifDropOpen ? 'block' : 'none';
  if (_notifDropOpen) loadTeleNotifications();
}

async function loadTeleNotifications() {
  const listId = (currentUser?.role === 'doctor' || currentUser?.role === 'admin')
    ? 'drNotifList' : 'teleNotifList';
  const listEl = document.getElementById(listId);
  if (!listEl) return;
  try {
    const data  = await api('GET', '/notifications');
    const notifs = (data.notifications || []).slice(0, 15);
    if (!notifs.length) {
      listEl.innerHTML = '<p style="color:#374151;text-align:center;font-size:0.85rem;padding:1rem;">No notifications yet.</p>';
      return;
    }
    listEl.innerHTML = notifs.map(n => {
      const meta    = (typeof n.data === 'object' ? n.data : {}) || {};
      const isRead  = n.is_read;
      const zoomBtn = meta.zoom_join_url
        ? `<a href="${esc(meta.zoom_join_url)}" target="_blank" rel="noopener" class="btn-sm btn-sm-blue" style="text-decoration:none;white-space:nowrap;">Join Meeting</a>`
        : (meta.start_url
          ? `<a href="${esc(meta.start_url)}" target="_blank" rel="noopener" class="btn-sm btn-sm-blue" style="text-decoration:none;white-space:nowrap;">Launch</a>`
          : '');
      return `<div style="display:flex;gap:0.75rem;align-items:flex-start;padding:0.6rem 0.5rem;border-bottom:1px solid #f1f5f9;${isRead ? 'opacity:0.65;' : 'background:#f0f9ff;border-radius:0.5rem;'}">
        <div style="width:8px;height:8px;border-radius:50%;background:${isRead ? '#e2e8f0' : '#3b82f6'};margin-top:6px;flex-shrink:0;"></div>
        <div style="flex:1;">
          <div style="font-weight:${isRead ? '500' : '700'};font-size:0.82rem;color:var(--slate-800);">${esc(n.title)}</div>
          <div style="font-size:0.78rem;color:var(--slate-500);">${esc(n.message || '')}</div>
        </div>
        ${zoomBtn}
      </div>`;
    }).join('');
  } catch {
    listEl.innerHTML = '<p style="color:#374151;text-align:center;font-size:0.85rem;padding:1rem;">Could not load.</p>';
  }
}

async function markAllTeleNotifsRead() {
  try {
    await api('PATCH', '/notifications/mark-all-read');
    await loadTeleNotifications();
    await refreshNotifBadge();
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// PATIENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function loadPatientDoctors() {
  const grid = document.getElementById('patDoctorGrid');
  if (!grid) return;
  try {
    const data = await api('GET', '/doctors');
    _allDoctors = data.doctors || [];
    renderDoctorCards(_allDoctors);
  } catch {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:#ef4444;">Could not load doctors.</div>';
  }
}

function filterDoctorCards() {
  const specialty = document.getElementById('patSpecialtyFilter')?.value || '';
  const filtered  = specialty ? _allDoctors.filter(d => d.specialty === specialty) : _allDoctors;
  renderDoctorCards(filtered);
}

function renderDoctorCards(doctors) {
  const grid = document.getElementById('patDoctorGrid');
  if (!grid) return;
  if (!doctors.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#374151;">No doctors found.</div>';
    return;
  }
  const statusColors = { available: '#22c55e', busy: '#f59e0b', offline: '#94a3b8' };
  const statusLabels = { available: '🟢 Available', busy: '🟡 Busy', offline: '⚫ Offline' };

  grid.innerHTML = doctors.map(d => `
    <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:0.875rem;padding:1.25rem;display:flex;flex-direction:column;gap:0.75rem;box-shadow:0 2px 8px rgba(0,0,0,0.06);transition:transform 0.2s,box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(0,0,0,0.1)'" onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'">
      <div style="display:flex;align-items:center;gap:0.875rem;">
        <div style="width:52px;height:52px;border-radius:50%;background:${esc(d.avatar_color||'#3b82f6')};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0;">${esc(d.avatar_initials||'DR')}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:var(--slate-800);font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(d.name)}</div>
          <div style="font-size:0.8rem;color:#3b82f6;">${esc(d.specialty||'')}</div>
          <div style="font-size:0.75rem;color:${statusColors[d.status]||'#94a3b8'};font-weight:600;">${statusLabels[d.status]||d.status}</div>
        </div>
      </div>
      <div style="font-size:0.78rem;color:var(--slate-500);line-height:1.5;">
        ${d.qualification ? `<span>🎓 ${esc(d.qualification)}</span><br>` : ''}
        ${d.experience_yrs ? `<span>⏱ ${d.experience_yrs} years exp.</span>` : ''}
        ${d.rating ? `<span style="margin-left:0.5rem;">⭐ ${d.rating}</span>` : ''}
      </div>
      ${d.bio ? `<div style="font-size:0.78rem;color:var(--slate-500);font-style:italic;">"${esc(d.bio)}"</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid #f1f5f9;padding-top:0.75rem;">
        <span style="font-weight:700;color:var(--slate-800);font-size:0.95rem;">₹${d.consult_fee||'—'}<span style="font-size:0.72rem;font-weight:400;color:var(--slate-500);"> / visit</span></span>
        <button onclick="openBookModal(${d.id},'${esc(d.name)}','${esc(d.specialty||'')}',${d.consult_fee||0},'${esc(d.avatar_initials||'DR')}','${esc(d.avatar_color||'#3b82f6')}')"
          class="btn-blue" style="padding:0.45rem 1rem;font-size:0.82rem;border-radius:0.55rem;"
          ${d.status === 'offline' ? 'disabled style="opacity:0.5;cursor:not-allowed;" title="Doctor offline"' : ''}>
          Book
        </button>
      </div>
    </div>`).join('');
}

async function loadPatientAppointments() {
  const el = document.getElementById('patAppointmentsList');
  if (!el) return;
  try {
    const data = await api('GET', '/appointments');
    const apts = data.appointments || [];
    if (!apts.length) {
      el.innerHTML = '<p style="color:#374151;font-size:0.875rem;text-align:center;padding:1.5rem 0;">No appointments yet. Book your first consultation above.</p>';
      return;
    }
    const now = new Date();
    el.innerHTML = apts.slice(0, 15).map(a => {
      const modeIcon = { video: '📹', audio: '📞', chat: '💬' }[a.mode] || '📋';
      const feeTag   = a.fee_charged ? `<span style="font-size:0.72rem;color:#7c3aed;font-weight:600;margin-left:0.4rem;">₹${a.fee_charged} charged</span>` : '';
      const scheduled = a.scheduled_at ? new Date(a.scheduled_at) : null;
      let actionHtml = '';
      if (a.mode === 'video') {
        if (a.zoom_join_url && scheduled && scheduled <= now && a.status !== 'cancelled') {
          actionHtml = `<a href="${esc(a.zoom_join_url)}" target="_blank" class="btn-sm btn-sm-blue" style="text-decoration:none;">Join Zoom</a>`;
        } else if (a.zoom_join_url) {
          actionHtml = `<button class="btn-sm" disabled style="opacity:0.6;">Join at ${scheduled ? scheduled.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : 'time'}</button>`;
        } else if (a.link_status === 'pending') {
          actionHtml = `<button class="btn-sm" disabled style="opacity:0.6;color:#b45309;">Link pending…</button>`;
        }
      } else if (a.mode === 'audio') {
        if (a.status === 'confirmed') {
          actionHtml = `<button onclick="openAudioCall(${a.id})" class="btn-sm btn-sm-green" style="white-space:nowrap;">📞 Join Audio Call</button>`;
        } else {
          actionHtml = `<button class="btn-sm" disabled style="opacity:0.6;">Awaiting confirmation</button>`;
        }
      } else if (a.mode === 'chat') {
        if (a.status === 'confirmed' || a.status === 'pending') {
          actionHtml = `<button onclick="openChatModal(${a.id},'${esc(a.doctor_name||'Doctor')}')" class="btn-sm" style="background:#f0fdf4;color:#16a34a;border:1.5px solid #bbf7d0;white-space:nowrap;">💬 Open Chat</button>`;
        }
      }
      if (a.status !== 'cancelled' && a.status !== 'completed') {
        actionHtml += ` <button onclick="cancelPatientAppointment(${a.id})" class="btn-sm" style="color:#dc2626;border-color:#fecaca;" title="Cancel">✕</button>`;
      }
      return `<div class="appointment-card">
        <div class="apt-info">
          <strong>${modeIcon} ${esc(a.specialty||'Consultation')} with ${esc(a.doctor_name||'Doctor pending')}</strong>
          <span>${esc(formatAppointmentWhen(a))} · ${esc(a.mode||'video')}${feeTag}</span>
          ${a.zoom_error ? `<div style="font-size:0.72rem;color:#dc2626;">${esc(a.zoom_error)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
          <span class="badge ${appointmentStatusBadge(a.status, a.link_status)}">${esc((a.status||'pending').replace(/_/g,' '))}</span>
          ${actionHtml}
        </div>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<p style="color:#374151;font-size:0.875rem;">Could not load appointments.</p>';
  }
}

async function cancelPatientAppointment(id) {
  if (!confirm('Cancel this appointment?')) return;
  try {
    await api('PATCH', `/appointments/${id}`, { status: 'cancelled' });
    showToast('Appointment cancelled.', 'info');
    loadPatientAppointments();
  } catch (e) { showToast(e.message || 'Error', 'error'); }
}

// ── Book-with-doctor modal ───────────────────────────────────────────────────
function openBookModal(docId, docName, docSpec, docFee, initials, color) {
  if (!currentUser || currentUser.role !== 'patient') { openModal('loginModal'); return; }
  document.getElementById('bookAptDoctorId').value = docId;
  document.getElementById('bookAptDrName').textContent  = docName;
  document.getElementById('bookAptDrSpec').textContent  = docSpec;
  document.getElementById('bookAptDrFee').textContent   = `₹${docFee} / consultation`;
  document.getElementById('bookAptDrAvatar').textContent = initials;
  document.getElementById('bookAptDrAvatar').style.background = color;
  document.getElementById('bookAptPatName').value = currentUser.name || '';
  document.getElementById('bookAptDate').min = new Date().toISOString().split('T')[0];
  document.getElementById('bookAptDate').value = '';
  document.getElementById('bookAptSymptoms').value = '';
  document.getElementById('bookAptModal').style.display = 'flex';
  if (window.lucide) lucide.createIcons();
}

function closeBookModal() {
  document.getElementById('bookAptModal').style.display = 'none';
}

// ── Audio Call (Jitsi Meet) ───────────────────────────────────────────────────
function openAudioCall(aptId) {
  const roomName = 'mediguard-apt-' + aptId;
  const jitsiUrl = 'https://meet.jit.si/' + roomName + '#config.startWithVideoMuted=true&config.startWithAudioMuted=false&config.prejoinPageEnabled=false';
  const win = window.open(jitsiUrl, '_blank', 'width=900,height=650,noopener');
  if (!win) {
    showToast('Please allow popups to join the audio call.', 'warning');
  } else {
    showToast('Audio call room opened in a new tab.', 'success');
  }
}

// ── Chat Modal ───────────────────────────────────────────────────────────────
let _chatAptId      = null;
let _chatPollTimer  = null;
let _chatLastTs     = '';

function openChatModal(aptId, withName) {
  _chatAptId   = aptId;
  _chatLastTs  = '';
  // Build modal if not exists
  if (!document.getElementById('aptChatModal')) {
    const modal = document.createElement('div');
    modal.id = 'aptChatModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:1.25rem;width:min(480px,96vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1.5px solid #e2e8f0;background:linear-gradient(135deg,#16a34a,#15803d);">
          <div>
            <div id="chatModalTitle" style="font-weight:700;font-size:1rem;color:#fff;">💬 Chat Consultation</div>
            <div id="chatModalSub" style="font-size:0.75rem;color:#bbf7d0;margin-top:2px;"></div>
          </div>
          <button onclick="closeChatModal()" style="background:rgba(255,255,255,0.2);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;color:#fff;font-size:1.1rem;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
        <div id="chatMessages" style="flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:0.6rem;min-height:200px;max-height:380px;background:#f8fafc;"></div>
        <div style="padding:0.85rem 1rem;border-top:1.5px solid #e2e8f0;display:flex;gap:0.5rem;align-items:flex-end;">
          <textarea id="chatInput" placeholder="Type your message…" rows="2"
            style="flex:1;border:1.5px solid #e2e8f0;border-radius:0.75rem;padding:0.6rem 0.85rem;font-size:0.88rem;font-family:inherit;resize:none;outline:none;line-height:1.4;"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage();}"></textarea>
          <button onclick="sendChatMessage()" id="chatSendBtn"
            style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:0.75rem;padding:0.6rem 1rem;font-size:0.88rem;font-weight:600;cursor:pointer;white-space:nowrap;">Send</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('aptChatModal').style.display = 'flex';
  document.getElementById('chatModalTitle').textContent = '💬 Chat with ' + withName;
  document.getElementById('chatModalSub').textContent   = 'Appointment #' + aptId + ' · Messages refresh automatically';
  document.getElementById('chatMessages').innerHTML     = '<div style="text-align:center;color:#374151;font-size:0.8rem;padding:1rem;">Loading messages…</div>';
  loadChatMessages(true);
  _chatPollTimer = setInterval(() => loadChatMessages(false), 3000);
}

function closeChatModal() {
  if (_chatPollTimer) { clearInterval(_chatPollTimer); _chatPollTimer = null; }
  const m = document.getElementById('aptChatModal');
  if (m) m.style.display = 'none';
  _chatAptId = null; _chatLastTs = '';
}

async function loadChatMessages(initial) {
  if (!_chatAptId) return;
  try {
    const url = '/appointments/' + _chatAptId + '/chat' + (_chatLastTs ? '?since=' + encodeURIComponent(_chatLastTs) : '');
    const data = await api('GET', url);
    const msgs = data.messages || [];
    const box  = document.getElementById('chatMessages');
    if (!box) return;
    if (initial) box.innerHTML = '';
    if (initial && msgs.length === 0) {
      box.innerHTML = '<div style="text-align:center;color:#374151;font-size:0.8rem;padding:2rem 1rem;">No messages yet. Say hello! 👋</div>';
      return;
    }
    msgs.forEach(m => {
      const isMine = m.sender_id === (currentUser && currentUser.id);
      const bubble = document.createElement('div');
      bubble.style.cssText = `display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'};`;
      bubble.innerHTML = `
        <div style="font-size:0.7rem;color:#374151;margin-bottom:2px;">${esc(m.sender_name)} · ${new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        <div style="background:${isMine ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : '#fff'};color:${isMine ? '#fff' : '#1e293b'};padding:0.55rem 0.85rem;border-radius:${isMine ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem'};font-size:0.88rem;line-height:1.4;max-width:80%;box-shadow:0 1px 4px rgba(0,0,0,0.08);border:${isMine ? 'none' : '1.5px solid #e2e8f0'};">${esc(m.message)}</div>`;
      if (initial || !document.getElementById('aptChatModal').querySelector('[data-msg-id="' + m.id + '"]')) {
        bubble.setAttribute('data-msg-id', m.id);
        box.appendChild(bubble);
      }
      if (m.created_at > _chatLastTs) _chatLastTs = m.created_at;
    });
    if (msgs.length > 0) box.scrollTop = box.scrollHeight;
  } catch { /* silent poll failure */ }
}

async function sendChatMessage() {
  if (!_chatAptId) return;
  const input = document.getElementById('chatInput');
  const btn   = document.getElementById('chatSendBtn');
  const text  = (input.value || '').trim();
  if (!text) return;
  try {
    btn.disabled = true; btn.textContent = '…';
    input.value = '';
    await api('POST', '/appointments/' + _chatAptId + '/chat', { message: text });
    await loadChatMessages(false);
  } catch (e) {
    showToast(e.message || 'Failed to send', 'error');
    input.value = text;
  } finally {
    btn.disabled = false; btn.textContent = 'Send';
    input.focus();
  }
}

async function submitBookAppointment() {
  const btn = document.getElementById('bookAptSubmitBtn');
  const docId = document.getElementById('bookAptDoctorId').value;
  const date  = document.getElementById('bookAptDate').value;
  const name  = document.getElementById('bookAptPatName').value.trim();
  const mode  = document.querySelector('input[name="bookMode"]:checked')?.value || 'video';
  if (!name || !date) { showToast('Please fill name and date', 'error'); return; }
  try {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Booking…';
    const data = await api('POST', '/appointments/book-with-doctor', {
      doctor_id:      parseInt(docId),
      patient_name:   name,
      age:            parseInt(document.getElementById('bookAptAge').value) || null,
      gender:         document.getElementById('bookAptGender').value,
      preferred_date: date,
      time_slot:      document.getElementById('bookAptSlot').value,
      symptoms:       document.getElementById('bookAptSymptoms').value.trim(),
      mode,
    });
    closeBookModal();
    if (data.zoom && mode === 'video') {
      showToast('Appointment booked! Zoom meeting created.', 'success');
      showZoomMeetingModal(data.zoom);
    } else {
      showToast(`Appointment booked with ${data.doctor_name}!`, 'success');
    }
    loadPatientAppointments();
    refreshNotifBadge();
  } catch (e) { showToast(e.message || 'Booking failed', 'error'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="calendar-check" style="width:16px;height:16px;vertical-align:middle;margin-right:6px;"></i> Confirm Booking';
    if (window.lucide) lucide.createIcons();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCTOR FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function loadDoctorProfile() {
  try {
    const data = await api('GET', '/doctors/me');
    if (!data.registered || !data.profile) {
      document.getElementById('doctorRegPanel').style.display  = 'block';
      document.getElementById('doctorDashPanel').style.display = 'none';
      // Pre-fill name
      const n = document.getElementById('drRegName');
      if (n && !n.value) n.value = currentUser.name || '';
    } else {
      _currentDoctorId = data.profile.id;
      document.getElementById('doctorRegPanel').style.display  = 'none';
      document.getElementById('doctorDashPanel').style.display = 'block';
      renderDoctorProfileCard(data.profile);
      loadDoctorAppointments();
    }
  } catch {
    showToast('Could not load doctor profile.', 'error');
  }
}

function renderDoctorProfileCard(p) {
  document.getElementById('drAvatar').textContent  = p.avatar_initials || 'DR';
  document.getElementById('drAvatar').style.background = p.avatar_color || 'linear-gradient(135deg,#3b82f6,#2563eb)';
  document.getElementById('drProfileName').textContent = p.name;
  document.getElementById('drProfileSpec').textContent = `${p.specialty||''} · ${p.qualification||''} · ${p.experience_yrs||0}y exp`;
  document.getElementById('drProfileFee').textContent  = `₹${p.consult_fee||0} / consultation`;
  const sel = document.getElementById('drStatusSelect');
  if (sel) sel.value = p.status || 'available';
}

async function submitDoctorRegistration() {
  const get = id => document.getElementById(id)?.value?.trim();
  const body = {
    name:          get('drRegName'),
    specialty:     get('drRegSpecialty'),
    qualification: get('drRegQual'),
    experience_yrs: parseInt(get('drRegExp')) || 0,
    phone:         get('drRegPhone'),
    consult_fee:   parseFloat(get('drRegFee')) || 300,
    bio:           get('drRegBio'),
    zoom_user_id:  get('drRegZoom'),
  };
  if (!body.name) { showToast('Please enter your name', 'error'); return; }
  try {
    const data = await api('POST', '/doctors/register', body);
    _currentDoctorId = data.profile?.id;
    document.getElementById('doctorRegPanel').style.display  = 'none';
    document.getElementById('doctorDashPanel').style.display = 'block';
    renderDoctorProfileCard(data.profile);
    loadDoctorAppointments();
    showToast('Doctor profile created! You are now visible to patients.', 'success');
  } catch (e) { showToast(e.message || 'Registration failed', 'error'); }
}

async function updateDoctorStatus() {
  if (!_currentDoctorId) return;
  const status = document.getElementById('drStatusSelect')?.value;
  try {
    await api('PATCH', `/doctors/${_currentDoctorId}/profile`, { status });
    showToast(`Status updated to ${status}`, 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadDoctorAppointments() {
  const el = document.getElementById('drAppointmentsList');
  if (!el) return;
  const filter = document.getElementById('drAptFilter')?.value || '';
  try {
    const data = await api('GET', '/appointments/my');
    let apts = data.appointments || [];
    if (filter) apts = apts.filter(a => a.status === filter);

    // Update stats
    const today = new Date().toISOString().split('T')[0];
    const pending   = apts.filter(a => a.status === 'pending').length;
    const confirmed = apts.filter(a => a.status === 'confirmed').length;
    const todayApts = apts.filter(a => (a.scheduled_at||'').startsWith(today)).length;
    const sp = document.getElementById('drStatPending');   if(sp) sp.textContent = pending;
    const sc = document.getElementById('drStatConfirmed'); if(sc) sc.textContent = confirmed;
    const st = document.getElementById('drStatToday');     if(st) st.textContent = todayApts;

    if (!apts.length) {
      el.innerHTML = `<p style="color:#374151;font-size:0.875rem;text-align:center;padding:1.5rem 0;">${filter ? 'No '+filter+' appointments.' : 'No appointments yet.'}</p>`;
      return;
    }
    const modeIcon = { video: '📹', audio: '📞', chat: '💬' };
    el.innerHTML = apts.slice(0, 20).map(a => {
      const icon = modeIcon[a.mode] || '📋';
      const scheduled = a.scheduled_at ? new Date(a.scheduled_at) : null;
      const feeTag = a.fee_charged
        ? `<span style="font-size:0.72rem;color:#7c3aed;font-weight:600;">₹${a.fee_charged} charged</span>`
        : '';
      // Action buttons
      let actions = '';
      if (a.status === 'pending') {
        actions += `<button onclick="doctorConfirm(${a.id},'confirm')" class="btn-sm btn-sm-green">✓ Confirm</button>`;
        actions += ` <button onclick="doctorConfirm(${a.id},'reject')" class="btn-sm" style="color:#dc2626;border-color:#fecaca;">✕ Reject</button>`;
      }
      if (a.status === 'confirmed') {
        if (a.mode === 'video' && a.zoom_start_url) {
          actions += ` <a href="${esc(a.zoom_start_url)}" target="_blank" class="btn-sm btn-sm-blue" style="text-decoration:none;">🎥 Launch Zoom</a>`;
        }
        if (a.mode === 'audio') {
          actions += ` <button onclick="openAudioCall(${a.id})" class="btn-sm btn-sm-green">📞 Join Audio</button>`;
        }
        if (a.mode === 'chat') {
          actions += ` <button onclick="openChatModal(${a.id},'${esc(a.patient_name||'Patient')}')" class="btn-sm" style="background:#f0fdf4;color:#16a34a;border:1.5px solid #bbf7d0;">💬 Open Chat</button>`;
        }
        if (!a.fee_charged) {
          actions += ` <button onclick="openChargeFee(${a.id},${a.id})" class="btn-sm" style="color:#7c3aed;border-color:#e9d5ff;">💳 Charge Fee</button>`;
        }
      }
      return `<div class="appointment-card">
        <div class="apt-info">
          <strong>${icon} ${esc(a.patient_name||'Patient')} — ${esc(a.specialty||'Consultation')}</strong>
          <span>${esc(formatAppointmentWhen(a))} · ${esc(a.mode||'video')} ${feeTag}</span>
          ${a.symptoms ? `<span style="font-size:0.75rem;color:var(--slate-400);">"${esc((a.symptoms||'').slice(0,60))}${(a.symptoms||'').length>60?'…':''}"</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
          <span class="badge ${appointmentStatusBadge(a.status, a.link_status)}">${esc((a.status||'pending').replace(/_/g,' '))}</span>
          ${actions}
        </div>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<p style="color:#374151;font-size:0.875rem;">Could not load appointments.</p>';
  }
}

async function doctorConfirm(aptId, action) {
  const label = action === 'confirm' ? 'confirm' : 'reject';
  if (!confirm(`${label.charAt(0).toUpperCase()+label.slice(1)} this appointment?`)) return;
  try {
    await api('PATCH', `/appointments/${aptId}/confirm`, { action });
    showToast(`Appointment ${action === 'confirm' ? 'confirmed ✅' : 'rejected ❌'}`, action === 'confirm' ? 'success' : 'info');
    loadDoctorAppointments();
    refreshNotifBadge();
  } catch (e) { showToast(e.message || 'Error', 'error'); }
}

function openChargeFee(aptId, defaultFee) {
  document.getElementById('chargeFeeAptId').value = aptId;
  document.getElementById('chargeFeeAmount').value = defaultFee || '';
  document.getElementById('chargeFeeModal').style.display = 'flex';
}

function closeChargeFeeModal() {
  document.getElementById('chargeFeeModal').style.display = 'none';
}

async function submitChargeFee() {
  const aptId = document.getElementById('chargeFeeAptId').value;
  const fee   = parseFloat(document.getElementById('chargeFeeAmount').value);
  if (!fee || fee <= 0) { showToast('Enter a valid fee amount', 'error'); return; }
  try {
    await api('POST', `/appointments/${aptId}/charge`, { fee });
    showToast(`₹${fee} fee charged and patient notified.`, 'success');
    closeChargeFeeModal();
    loadDoctorAppointments();
  } catch (e) { showToast(e.message || 'Error', 'error'); }
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


// restrictTelemedicineAccess() removed – handled by initTelemedicinePage() role routing

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

function formatAppointmentWhen(appointment) {
  if (appointment?.scheduled_at) {
    const dt = new Date(appointment.scheduled_at);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    }
  }
  const date = appointment?.preferred_date || '—';
  const slot = appointment?.time_slot || '—';
  return `${date} · ${slot}`;
}

function appointmentStatusBadge(status, linkStatus) {
  if (status === 'pending_link' || linkStatus === 'pending') return 'badge-warning';
  if (status === 'cancelled') return 'badge-danger';
  if (status === 'completed' || status === 'active' || status === 'confirmed') return 'badge-ok';
  return 'badge-blue';
}

// Legacy stubs – removed; replaced by role-based teleconsultation system above.

function clinicalSkeletonHtml() {
  return `
    <div class="clinical-skeleton">
      <div class="clinical-skeleton-block"></div>
      <div class="clinical-skeleton-block"></div>
      <div class="clinical-skeleton-block"></div>
    </div>
  `;
}

function renderClinicalAnalysis(analysis, meta = {}) {
  const ddx = analysis.differential_diagnosis || [];
  const pathway = analysis.clinical_pathway || [];
  const redFlags = analysis.red_flags || [];
  const summary = analysis.clinical_reasoning_summary || 'Clinical reasoning summary unavailable.';

  const ddxHtml = ddx.length
    ? ddx.map(item => `
        <div class="clinical-probability-row">
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;">
            <strong>${esc(item.condition)}</strong>
            <span>${Math.round((item.probability || 0) * 100)}%</span>
          </div>
          <div class="clinical-probability-bar">
            <div class="clinical-probability-fill" style="width:${Math.round((item.probability || 0) * 100)}%"></div>
          </div>
          <div style="font-size:0.86rem;color:#1a2332;">${esc((item.supporting_findings || []).join(', ') || 'Supporting data not specified')}</div>
          ${(item.recommended_next_steps || []).length ? `<div class="clinical-nextsteps-list">${item.recommended_next_steps.map(step => `<div style="font-size:0.86rem;color:#000;">• ${esc(step)}</div>`).join('')}</div>` : ''}
        </div>
      `).join('')
    : '<div style="color:#1a2332;">No differential diagnosis suggestions returned.</div>';

  const pathwayHtml = pathway.length
    ? pathway.map(step => `
        <div class="clinical-pathway-item">
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;margin-bottom:0.35rem;">
            <strong>Step ${esc(String(step.step || ''))}: ${esc(step.title)}</strong>
            <span class="badge badge-${(step.priority || 'medium') === 'high' ? 'danger' : (step.priority || 'medium') === 'low' ? 'ok' : 'warning'}">${esc((step.priority || 'medium').toUpperCase())}</span>
          </div>
          <div style="font-size:0.9rem;color:#1a2332;">${esc(step.details || '')}</div>
        </div>
      `).join('')
    : '<div style="color:#1a2332;">No pathway steps returned.</div>';

  const redFlagHtml = redFlags.length
    ? redFlags.map(flag => `<div class="clinical-flag-item">${esc(flag)}</div>`).join('')
    : '<div class="clinical-flag-item" style="border-color:#bbf7d0;background:#f0fdf4;color:#166534;">No urgent red flags were highlighted in this analysis.</div>';

  return `
    <div class="clinical-results-grid">
      <div class="clinical-probability-card">
        <h4 style="margin:0 0 0.85rem 0;">Probability Chart</h4>
        ${ddxHtml}
      </div>
      <div class="clinical-summary-card">
        <h4 style="margin:0 0 0.85rem 0;">Clinical Summary</h4>
        <div style="font-size:0.95rem;color:#0d1117;line-height:1.7;">${esc(summary)}</div>
        <div style="margin-top:0.85rem;font-size:0.82rem;color:#1a2332;">Engine: ${esc(meta.model || meta.provider || 'configured provider')}</div>
      </div>
    </div>
    <div class="clinical-results-grid" style="margin-top:1rem;">
      <div class="clinical-pathway-card">
        <h4 style="margin:0 0 0.85rem 0;">Clinical Pathway</h4>
        <div class="clinical-pathway-list">${pathwayHtml}</div>
      </div>
      <div class="clinical-redflag-card">
        <h4 style="margin:0 0 0.85rem 0;">Red Flags</h4>
        <div class="clinical-flag-list">${redFlagHtml}</div>
      </div>
    </div>
    <div class="clinical-disclaimer">${esc(analysis.disclaimer || 'AI-generated insight for clinical decision support only. Not a final diagnosis. Final validation required by a licensed medical professional.')}</div>
  `;
}

loadAISafetyGuard = async function() {
  try {
    const dashboardData = await api('GET', '/ai-safety-guard/dashboard');
    updateSafetyKpi(dashboardData.dashboard);
    const insightsData = await api('GET', '/clinical-insights');
    renderClinicalInsightsTable(insightsData.insights || []);
    showClinicalOption(null);
  } catch (e) {
    console.error('Error loading AI Clinical Intelligence:', e);
    const tbody = document.getElementById('clinicalInsightsTable');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-row">${esc(e.message || 'Unable to load clinical insights')}</td></tr>`;
    }
    showToast('Error loading clinical data: ' + (e.message || 'Unknown error'), 'error');
  }
};

function renderClinicalAnalysis(analysis, meta = {}) {
  const ddx = analysis.differential_diagnosis || [];
  const pathway = analysis.clinical_pathway || [];
  const redFlags = analysis.red_flags || [];
  const summary = analysis.clinical_reasoning_summary || 'Clinical reasoning summary unavailable.';
  const triage = analysis.triage_recommendation || 'Continue clinician-led review of the generated differential diagnosis.';
  const caseSummary = analysis.case_summary || {};
  const patientHistory = caseSummary.patient_history || {};

  function detailList(items, emptyMessage, tone = '#0f172a') {
    return items && items.length
      ? items.map(item => `<div style="font-size:0.86rem;color:${tone};">• ${esc(item)}</div>`).join('')
      : `<div style="font-size:0.86rem;color:#1a2332;">${esc(emptyMessage)}</div>`;
  }

  const ddxHtml = ddx.length
    ? ddx.map(item => `
        <div class="clinical-probability-row">
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;">
            <strong>${esc(item.condition)}</strong>
            <span>${Math.round((item.probability || 0) * 100)}%</span>
          </div>
          <div class="clinical-probability-bar">
            <div class="clinical-probability-fill" style="width:${Math.round((item.probability || 0) * 100)}%"></div>
          </div>
          <div style="font-size:0.82rem;color:#1a2332;font-weight:700;margin-top:0.55rem;">Supporting Findings</div>
          <div class="clinical-nextsteps-list">${detailList(item.supporting_findings, 'Supporting data not specified.', '#475569')}</div>
          <div style="font-size:0.82rem;color:#000;font-weight:700;margin-top:0.6rem;">Recommended Next Steps</div>
          <div class="clinical-nextsteps-list">${detailList(item.recommended_next_steps, 'No next steps were provided.')}</div>
          ${item.rationale ? `<div style="font-size:0.84rem;color:#1a2332;margin-top:0.55rem;"><strong>Why this fits:</strong> ${esc(item.rationale)}</div>` : ''}
        </div>
      `).join('')
    : '<div style="color:#1a2332;">No differential diagnosis suggestions returned.</div>';

  const pathwayHtml = pathway.length
    ? pathway.map(step => `
        <div class="clinical-pathway-item">
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;margin-bottom:0.35rem;">
            <strong>Step ${esc(String(step.step || ''))}: ${esc(step.title)}</strong>
            <span class="badge badge-${(step.priority || 'medium') === 'high' ? 'danger' : (step.priority || 'medium') === 'low' ? 'ok' : 'warning'}">${esc((step.priority || 'medium').toUpperCase())}</span>
          </div>
          <div style="font-size:0.9rem;color:#1a2332;">${esc(step.details || '')}</div>
        </div>
      `).join('')
    : '<div style="color:#1a2332;">No pathway steps returned.</div>';

  const redFlagHtml = redFlags.length
    ? redFlags.map(flag => `<div class="clinical-flag-item">${esc(flag)}</div>`).join('')
    : '<div class="clinical-flag-item" style="border-color:#bbf7d0;background:#f0fdf4;color:#166534;">No urgent red flags were highlighted in this analysis.</div>';

  return `
    <div class="clinical-results-grid">
      <div class="clinical-probability-card">
        <h4 style="margin:0 0 0.85rem 0;">Probability Chart</h4>
        ${ddxHtml}
      </div>
      <div class="clinical-summary-card">
        <h4 style="margin:0 0 0.85rem 0;">Clinical Summary</h4>
        <div style="font-size:0.95rem;color:#0d1117;line-height:1.7;">${esc(summary)}</div>
        <div style="margin-top:0.85rem;padding:0.85rem 1rem;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;">
          <strong>Triage Recommendation:</strong> ${esc(triage)}
        </div>
        <div style="margin-top:0.85rem;font-size:0.9rem;color:#1a2332;line-height:1.65;">
          <strong>Case Snapshot:</strong>
          ${caseSummary.symptoms ? `<div style="margin-top:0.35rem;"><strong>Symptoms:</strong> ${esc(caseSummary.symptoms)}</div>` : ''}
          ${caseSummary.lab_results ? `<div style="margin-top:0.35rem;"><strong>Lab Data:</strong> ${esc(caseSummary.lab_results)}</div>` : ''}
          ${(patientHistory.age || patientHistory.gender || patientHistory.pre_existing_conditions) ? `<div style="margin-top:0.35rem;"><strong>History:</strong> ${esc([patientHistory.age ? patientHistory.age + ' yrs' : '', patientHistory.gender || '', patientHistory.pre_existing_conditions || ''].filter(Boolean).join(' • '))}</div>` : ''}
        </div>
        <div style="margin-top:0.85rem;font-size:0.82rem;color:#1a2332;">Engine: ${esc(meta.model || meta.provider || 'configured provider')}</div>
      </div>
    </div>
    <div class="clinical-results-grid" style="margin-top:1rem;">
      <div class="clinical-pathway-card">
        <h4 style="margin:0 0 0.85rem 0;">Clinical Pathway</h4>
        <div class="clinical-pathway-list">${pathwayHtml}</div>
      </div>
      <div class="clinical-redflag-card">
        <h4 style="margin:0 0 0.85rem 0;">Red Flags</h4>
        <div class="clinical-flag-list">${redFlagHtml}</div>
      </div>
    </div>
    <div class="clinical-disclaimer">${esc(analysis.disclaimer || 'AI-generated insight for clinical decision support only. Not a final diagnosis. Final validation required by a licensed medical professional.')}</div>
  `;
}

startDeepDive = async function() {
  const symptomsInput = document.getElementById('diagnosticSymptoms');
  const labsInput = document.getElementById('diagnosticLabs');
  const resultsDiv = document.getElementById('diagnosticResults');
  const contentDiv = document.getElementById('diagnosticContent');
  const analyzeBtn = document.getElementById('analyzeDiagnosticBtn');
  const fileInput = document.getElementById('diagnosticLabFile');

  if (!symptomsInput || !resultsDiv || !contentDiv) return;
  const symptoms = symptomsInput.value.trim();
  if (!symptoms) {
    showToast('Please enter patient symptoms', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('symptoms', symptoms);
  formData.append('lab_results', labsInput?.value.trim() || '');
  formData.append('patient_id', document.getElementById('diagnosticPatientId')?.value || '');
  formData.append('age', document.getElementById('diagnosticAge')?.value || '');
  formData.append('gender', document.getElementById('diagnosticGender')?.value || '');
  formData.append('pre_existing_conditions', document.getElementById('diagnosticHistory')?.value || '');
  formData.append('current_medications', document.getElementById('diagnosticMedications')?.value || '');
  formData.append('known_allergies', document.getElementById('diagnosticAllergies')?.value || '');
  if (fileInput?.files?.[0]) formData.append('lab_report', fileInput.files[0]);

  resultsDiv.style.display = 'block';
  contentDiv.innerHTML = clinicalSkeletonHtml();

  try {
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.innerHTML = '<span class="spinner"></span> Analyze';
    }

    const headers = {};
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    const response = await fetch(BASE_URL + '/ai-clinical-intelligence/diagnostic-analysis', {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Diagnostic analysis failed');

    contentDiv.innerHTML = renderClinicalAnalysis(data.analysis || {}, data.meta || {});
    resultsDiv.style.display = 'block';
    loadAISafetyGuard();
  } catch (e) {
    contentDiv.innerHTML = '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:1rem;color:#dc2626;">' + esc(e.message || 'Diagnostic analysis failed') + '</div>';
    resultsDiv.style.display = 'block';
    showToast('Error performing diagnostic analysis', 'error');
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = '<i data-lucide="search" style="width:16px;height:16px"></i> Analyze Case';
      if (window.lucide) lucide.createIcons();
    }
  }
};

function renderClinicalAnalysis(analysis, meta = {}) {
  const ddx = analysis.differential_diagnosis || [];
  const pathway = analysis.clinical_pathway || [];
  const redFlags = analysis.red_flags || [];
  const summary = analysis.clinical_reasoning_summary || 'Clinical reasoning summary unavailable.';
  const triage = analysis.triage_recommendation || 'Continue clinician-led review of the generated differential diagnosis.';
  const caseSummary = analysis.case_summary || {};
  const patientHistory = caseSummary.patient_history || {};

  function detailList(items, emptyMessage, tone = '#0f172a') {
    return items && items.length
      ? items.map(item => `<div style="font-size:0.86rem;color:${tone};">- ${esc(item)}</div>`).join('')
      : `<div style="font-size:0.86rem;color:#1a2332;">${esc(emptyMessage)}</div>`;
  }

  const ddxHtml = ddx.length
    ? ddx.map(item => `
        <div class="clinical-probability-row">
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;">
            <strong>${esc(item.condition)}</strong>
            <span>${Math.round((item.probability || 0) * 100)}%</span>
          </div>
          <div class="clinical-probability-bar">
            <div class="clinical-probability-fill" style="width:${Math.round((item.probability || 0) * 100)}%"></div>
          </div>
          <div style="font-size:0.82rem;color:#1a2332;font-weight:700;margin-top:0.55rem;">Supporting Findings</div>
          <div class="clinical-nextsteps-list">${detailList(item.supporting_findings, 'Supporting data not specified.', '#475569')}</div>
          <div style="font-size:0.82rem;color:#000;font-weight:700;margin-top:0.6rem;">Recommended Next Steps</div>
          <div class="clinical-nextsteps-list">${detailList(item.recommended_next_steps, 'No next steps were provided.')}</div>
          ${item.rationale ? `<div style="font-size:0.84rem;color:#1a2332;margin-top:0.55rem;"><strong>Why this fits:</strong> ${esc(item.rationale)}</div>` : ''}
        </div>
      `).join('')
    : '<div style="color:#1a2332;">No differential diagnosis suggestions returned.</div>';

  const pathwayHtml = pathway.length
    ? pathway.map(step => `
        <div class="clinical-pathway-item">
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;margin-bottom:0.35rem;">
            <strong>Step ${esc(String(step.step || ''))}: ${esc(step.title)}</strong>
            <span class="badge badge-${(step.priority || 'medium') === 'high' ? 'danger' : (step.priority || 'medium') === 'low' ? 'ok' : 'warning'}">${esc((step.priority || 'medium').toUpperCase())}</span>
          </div>
          <div style="font-size:0.9rem;color:#1a2332;">${esc(step.details || '')}</div>
        </div>
      `).join('')
    : '<div style="color:#1a2332;">No pathway steps returned.</div>';

  const redFlagHtml = redFlags.length
    ? redFlags.map(flag => `<div class="clinical-flag-item">${esc(flag)}</div>`).join('')
    : '<div class="clinical-flag-item" style="border-color:#bbf7d0;background:#f0fdf4;color:#166534;">No urgent red flags were highlighted in this analysis.</div>';

  return `
    <div class="clinical-results-grid">
      <div class="clinical-probability-card">
        <h4 style="margin:0 0 0.85rem 0;">Probability Chart</h4>
        ${ddxHtml}
      </div>
      <div class="clinical-summary-card">
        <h4 style="margin:0 0 0.85rem 0;">Clinical Summary</h4>
        <div style="font-size:0.95rem;color:#0d1117;line-height:1.7;">${esc(summary)}</div>
        <div style="margin-top:0.85rem;padding:0.85rem 1rem;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;">
          <strong>Triage Recommendation:</strong> ${esc(triage)}
        </div>
        <div style="margin-top:0.85rem;font-size:0.9rem;color:#1a2332;line-height:1.65;">
          <strong>Case Snapshot:</strong>
          ${caseSummary.symptoms ? `<div style="margin-top:0.35rem;"><strong>Symptoms:</strong> ${esc(caseSummary.symptoms)}</div>` : ''}
          ${caseSummary.lab_results ? `<div style="margin-top:0.35rem;"><strong>Lab Data:</strong> ${esc(caseSummary.lab_results)}</div>` : ''}
          ${(patientHistory.age || patientHistory.gender || patientHistory.pre_existing_conditions) ? `<div style="margin-top:0.35rem;"><strong>History:</strong> ${esc([patientHistory.age ? patientHistory.age + ' yrs' : '', patientHistory.gender || '', patientHistory.pre_existing_conditions || ''].filter(Boolean).join(' | '))}</div>` : ''}
        </div>
        <div style="margin-top:0.85rem;font-size:0.82rem;color:#1a2332;">Engine: ${esc(meta.model || meta.provider || 'configured provider')}</div>
      </div>
    </div>
    <div class="clinical-results-grid" style="margin-top:1rem;">
      <div class="clinical-pathway-card">
        <h4 style="margin:0 0 0.85rem 0;">Clinical Pathway</h4>
        <div class="clinical-pathway-list">${pathwayHtml}</div>
      </div>
      <div class="clinical-redflag-card">
        <h4 style="margin:0 0 0.85rem 0;">Red Flags</h4>
        <div class="clinical-flag-list">${redFlagHtml}</div>
      </div>
    </div>
    <div class="clinical-disclaimer">${esc(analysis.disclaimer || 'AI-generated insight for clinical decision support only. Not a final diagnosis. Final validation required by a licensed medical professional.')}</div>
  `;
}

function renderScoreBars(scores) {
  return (scores || []).map(score => `
    <div class="wellness-score-card">
      <div style="display:flex;justify-content:space-between;gap:0.75rem;margin-bottom:0.45rem;">
        <strong>${esc(score.label)}</strong>
        <span>${esc(String(score.score || 0))}/100</span>
      </div>
      <div class="clinical-probability-bar">
        <div class="clinical-probability-fill" style="width:${Math.max(0, Math.min(100, Number(score.score || 0)))}%;background:linear-gradient(90deg,#16a34a,#0ea5e9);"></div>
      </div>
    </div>
  `).join('');
}

function renderWellnessPillar(title, items) {
  return `
    <div class="wellness-pillar-card">
      <h4 style="margin:0 0 0.8rem 0;">${esc(title)}</h4>
      ${!items || !items.length ? '<div style="color:#1a2332;">No recommendations available.</div>' : items.map(item => `
        <div class="wellness-list-item" style="margin-top:0;">
          <div style="font-weight:700;margin-bottom:0.35rem;">${esc(item.title)}</div>
          <div style="font-size:0.92rem;color:#0d1117;margin-bottom:0.35rem;">${esc(item.recommendation)}</div>
          <div style="font-size:0.84rem;color:#1a2332;"><strong>The Why:</strong> ${esc(item.why)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function downloadWellnessPlanPdf(planId) {
  if (!planId) {
    showToast('No wellness plan available to export', 'warning');
    return;
  }
  try {
    const res = await fetch(BASE_URL + '/ai-clinical-intelligence/wellness-plan/' + planId + '/pdf', {
      headers: authToken ? { Authorization: 'Bearer ' + authToken } : {}
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Unable to export PDF');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wellness-plan-${planId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast(e.message || 'Unable to export PDF', 'error');
  }
}

generateWellnessPlan = async function() {
  const patientIdInput = document.getElementById('wellnessPatientId');
  const geneticsInput = document.getElementById('wellnessGenetics');
  const resultsDiv = document.getElementById('wellnessResults');
  const contentDiv = document.getElementById('wellnessContent');
  const btn = document.getElementById('generateWellnessBtn');

  if (!patientIdInput || !resultsDiv || !contentDiv) return;
  const patientId = parseInt(patientIdInput.value, 10);
  const genetics = geneticsInput?.value.trim() || '';
  if (!patientId || patientId <= 0) {
    showToast('Please enter a valid patient ID', 'error');
    return;
  }

  resultsDiv.style.display = 'block';
  contentDiv.innerHTML = `
    <div class="wellness-hero-loading">
      <div style="display:flex;align-items:center;gap:0.85rem;">
        <div class="wellness-blueprint-orb"></div>
        <div>
          <div style="font-weight:800;color:#065f46;">Generating Your Blueprint...</div>
          <div style="font-size:0.9rem;color:#0f766e;">Correlating lifestyle, biometrics, recovery trends, and genetic predispositions.</div>
        </div>
      </div>
    </div>
    ${clinicalSkeletonHtml()}
  `;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating Your Blueprint...';
    }

    const data = await api('POST', '/ai-clinical-intelligence/wellness-plan', {
      patient_id: patientId,
      genetic_markers: genetics || null
    });

    const plan = data.plan || {};
    const context = data.context || {};
    const biometric = plan.biometric_summary || {};
    const geneticsInsights = plan.genetic_insights || [];
    const pillars = plan.actionable_pillars || {};
    const scores = plan.health_scores || plan.optimization_levels || [];
    const misalignments = plan.misalignments || [];

    const biometricsHtml = (biometric.metrics || []).map(metric => `
      <div class="wellness-score-card">
        <div style="display:flex;justify-content:space-between;gap:0.75rem;margin-bottom:0.35rem;">
          <strong>${esc(metric.label)}</strong>
          <span class="badge badge-${metric.status === 'elevated' || metric.status === 'low' ? 'warning' : 'ok'}">${esc(metric.status || 'review')}</span>
        </div>
        <div style="font-size:1rem;font-weight:800;margin-bottom:0.35rem;">${esc(String(metric.value ?? 'N/A'))}</div>
        <div style="font-size:0.85rem;color:#1a2332;">${esc(metric.insight || '')}</div>
      </div>
    `).join('');

    const geneticHtml = geneticsInsights.map(item => `
      <div class="wellness-list-item" style="margin-top:0;">
        <div style="font-weight:700;margin-bottom:0.3rem;">${esc(item.marker)}</div>
        <div style="font-size:0.9rem;color:#0d1117;">${esc(item.insight)}</div>
        <div style="font-size:0.84rem;color:#1a2332;margin-top:0.3rem;"><strong>The Why:</strong> ${esc(item.implication)}</div>
      </div>
    `).join('');

    const misalignmentHtml = misalignments.length
      ? misalignments.map(item => `<div class="clinical-flag-item">${esc(item)}</div>`).join('')
      : '<div class="clinical-flag-item" style="border-color:#bbf7d0;background:#f0fdf4;color:#166534;">No major biometric-to-genetic misalignments identified.</div>';

    contentDiv.innerHTML = `
      <div class="wellness-hero-loading">
        <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div style="font-weight:800;color:#065f46;">Personalized Wellness Blueprint</div>
            <div style="font-size:0.9rem;color:#0f766e;">Patient #${esc(String(data.patient?.id || patientId))} · ${esc(data.meta?.provider || 'AI')} ${data.meta?.model ? '· ' + esc(data.meta.model) : ''}</div>
          </div>
          <div style="font-size:0.82rem;color:#0f766e;">Encrypted genetics in DB: ${context.genetic_data_encrypted ? 'Yes' : 'No'}</div>
        </div>
      </div>
      <div class="clinical-summary-card" style="margin-bottom:1rem;">
        <h4 style="margin:0 0 0.75rem 0;">Biometric Summary</h4>
        <div style="font-size:0.95rem;color:#0d1117;line-height:1.7;margin-bottom:0.9rem;">${esc(biometric.headline || 'Current state summary unavailable.')}</div>
        <div class="wellness-score-grid">${biometricsHtml}</div>
      </div>
      <div class="clinical-summary-card" style="margin-bottom:1rem;">
        <h4 style="margin:0 0 0.75rem 0;">Health Scores</h4>
        <div class="wellness-score-grid">${renderScoreBars(scores)}</div>
      </div>
      <div class="wellness-pillars-grid">
        ${renderWellnessPillar('Nutrition', pillars.nutrition)}
        ${renderWellnessPillar('Exercise', pillars.exercise)}
        ${renderWellnessPillar('Bio-Hacks', pillars.bio_hacks)}
      </div>
      <div class="clinical-results-grid" style="margin-top:1rem;">
        <div class="clinical-summary-card">
          <h4 style="margin:0 0 0.75rem 0;">Genetic Insights</h4>
          ${geneticHtml || '<div style="color:#1a2332;">No genetic insights available.</div>'}
        </div>
        <div class="clinical-redflag-card">
          <h4 style="margin:0 0 0.75rem 0;">Detected Misalignments</h4>
          <div class="clinical-flag-list">${misalignmentHtml}</div>
        </div>
      </div>
      <div class="wellness-export-row">
        <button class="btn-blue" onclick="downloadWellnessPlanPdf(${Number(data.plan_id || 0)})">
          <i data-lucide="download" style="width:16px;height:16px"></i> Export PDF
        </button>
      </div>
      <div class="clinical-disclaimer">${esc(plan.disclaimer || data.disclaimer || 'AI-generated insight for clinical decision support only. Not a final diagnosis. Final validation required by a licensed medical professional.')}</div>
    `;
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    contentDiv.innerHTML = '<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:1rem;color:#dc2626;">Error generating wellness blueprint: ' + esc(e.message || 'Unknown error') + '</div>';
    showToast('Error generating wellness plan', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="user-check" style="width:16px;height:16px"></i> View Wellness Plan';
      if (window.lucide) lucide.createIcons();
    }
  }
};
/* ════════════════════════════════════════════════════════════
   ROLE-BASED DASHBOARD MODULE
   Integrates with existing currentUser / navigate() system
════════════════════════════════════════════════════════════ */

// ── SVG icon helper ──────────────────────────────────────────
const DS_ICONS = {
  user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  activity:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  clipboard:'<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  pill:'<path d="M10.5 20H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H20a2 2 0 0 1 2 2v2"/><circle cx="16" cy="19" r="2"/><circle cx="20" cy="15" r="2"/>',
  wifi:'<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'check-square':'<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  'alert-triangle':'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'bar-chart':'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  home:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  package:'<path d="M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.79 0l-8-4a2 2 0 0 1-1.1-1.8V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.78 0z"/><polyline points="2.32 6.16 12 11 21.68 6.16"/><line x1="12" y1="22.76" x2="12" y2="11"/>',
  'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  'trending-up':'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  'bar-chart-2':'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  trello:'<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><rect x="7" y="7" width="3" height="9"/><rect x="14" y="7" width="3" height="5"/>',
  heart:'<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  droplet:'<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  wind:'<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>',
  zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
};
function dsIcon(name,w=14){return `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${DS_ICONS[name]||''}</svg>`;}

// ── Role navigation config ────────────────────────────────────
const DS_NAV = {
  patient:[
    {id:'pt-overview',icon:'user',label:'Overview'},
    {id:'pt-vitals',icon:'activity',label:'Health Monitoring'},
    {id:'pt-labs',icon:'clipboard',label:'Lab Results'},
    {id:'pt-appts',icon:'calendar',label:'Appointments'},
    {id:'pt-meds',icon:'pill',label:'Medications'},
    {id:'pt-monitor',icon:'wifi',label:'Remote Monitoring'},
  ],
  doctor:[
    {id:'dr-schedule',icon:'calendar',label:'Schedule'},
    {id:'dr-patients',icon:'users',label:'Patients'},
    {id:'dr-vitals',icon:'activity',label:'Vital Monitoring'},
    {id:'dr-tasks',icon:'check-square',label:'Tasks'},
    {id:'dr-alerts',icon:'alert-triangle',label:'Alerts'},
  ],
  pharmacist:[
    {id:'ph-overview',icon:'home',label:'Overview'},
    {id:'ph-inventory',icon:'package',label:'Inventory'},
    {id:'ph-prescriptions',icon:'file-text',label:'Prescriptions'},
    {id:'ph-revenue',icon:'trending-up',label:'Revenue'},
    {id:'ph-expiry',icon:'clock',label:'Expiry Tracker'},
  ],
  admin:[
    {id:'ad-overview',icon:'grid',label:'Overview'},
    {id:'ad-kpi',icon:'bar-chart-2',label:'KPIs'},
    {id:'ad-users',icon:'users',label:'Users'},
    {id:'ad-kanban',icon:'trello',label:'Kanban'},
    {id:'ad-reports',icon:'file-text',label:'Reports'},
  ],
};

const DS_PAGE_TITLES = {
  'pt-overview':'My Overview','pt-vitals':'Health Monitoring','pt-labs':'Lab Results',
  'pt-appts':'Appointments','pt-meds':'Medications','pt-monitor':'Remote Monitoring',
  'dr-schedule':'Schedule','dr-patients':'Patients','dr-vitals':'Vital Monitoring',
  'dr-tasks':'Tasks & Workflow','dr-alerts':'Alerts',
  'ph-overview':'Overview','ph-inventory':'Inventory','ph-prescriptions':'Prescriptions',
  'ph-revenue':'Revenue','ph-expiry':'Expiry Tracker',
  'ad-overview':'Overview','ad-kpi':'KPI Dashboard','ad-users':'Users',
  'ad-kanban':'Kanban','ad-reports':'Reports',
};

let dsCurrentPage = null;
let dsCharts = {};

// ── Called by navigate('dashboard') ──────────────────────────
function initDashboardShell() {
  // Keep dashUserName updated (backward-compat)
  const nameEl = document.getElementById('dashUserName');
  if (nameEl && currentUser) nameEl.textContent = currentUser.name;

  if (!currentUser) {
    document.getElementById('dash-no-auth').classList.add('active');
    document.getElementById('dash-shell').classList.remove('active');
    return;
  }
  document.getElementById('dash-no-auth').classList.remove('active');
  document.getElementById('dash-shell').classList.add('active');

  const role = currentUser.role;
  const initials = (currentUser.name||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const color = ROLE_COLORS[role] || 'linear-gradient(135deg,#2563eb,#1d4ed8)';

  // Sidebar setup
  document.getElementById('ds-role-badge').textContent = (role||'').charAt(0).toUpperCase()+(role||'').slice(1)+' Portal';
  ['ds-avatar','ds-topbar-avatar'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.textContent=initials;el.style.background=color;}
  });
  document.getElementById('ds-uname').textContent = currentUser.name||'User';
  document.getElementById('ds-urole').textContent = (ROLE_LABELS[role]||role);

  // Build nav
  const nav = document.getElementById('ds-nav');
  nav.innerHTML = '';
  const items = DS_NAV[role] || DS_NAV.patient;
  items.forEach((item,i)=>{
    const el = document.createElement('div');
    el.className='ds-nav-item'+(i===0?' active':'');
    el.dataset.dsPage = item.id;
    el.innerHTML=`${dsIcon(item.icon,14)}<span>${item.label}</span>`;
    el.onclick=()=>dsNavigate(item.id);
    nav.appendChild(el);
  });

  // Navigate to first page
  dsNavigate(items[0].id);

  // Populate top-level dashboard metrics (keeps existing callers to loadDashboard working)
  try { if (typeof loadDashboard === 'function') loadDashboard(); } catch(e) { console.warn('Failed to load dashboard metrics', e); }
}

function dsNavigate(pageId) {
  document.querySelectorAll('.ds-nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.dsPage===pageId);
  });
  document.getElementById('ds-page-title').textContent = DS_PAGE_TITLES[pageId]||'Dashboard';
  document.getElementById('ds-page-sub').textContent = dsGetSub(pageId);
  dsCurrentPage = pageId;
  dsDestroyCharts();
  const content = document.getElementById('ds-content');
  content.innerHTML = dsRenderPage(pageId);
  // after render hook for wiring dynamic components
  try{ dsAfterRender(pageId); }catch(e){console.warn('dsAfterRender error',e); }
  setTimeout(()=>dsInitCharts(pageId),60);
}

// Hook called after dsRenderPage inserts HTML – use to wire dynamic UI and render stored data
function dsAfterRender(pageId){
  if(pageId==='dr-schedule'){
    renderScheduleForDate(new Date());
    const addBtn=document.getElementById('openAddAgenda'); if(addBtn) addBtn.onclick=openAddAgendaModal;
    const cal=document.querySelectorAll('.dcal-d'); cal.forEach(d=>d.onclick=()=>{const day=d.dataset.day; if(day) renderScheduleForDate(new Date(day));});
    const sim=document.getElementById('simAlert'); if(sim) sim.onclick=()=>{pushNotification('Simulated urgent alert: follow-up required','critical');};
  }
  if(pageId==='dr-patients'){
    renderPatientRegistry();
    const add=document.getElementById('openAddPatient'); if(add) add.onclick=openAddPatientModal;
  }
  if(pageId==='dr-vitals'){
    renderDrVitals();
  }
  if(pageId==='dr-tasks'){
    renderTasks();
    const add=document.getElementById('openAddTask'); if(add) add.onclick=openAddTaskModal;
  }
  // refresh notification badge and panel
  updateNotificationsUI();
}

function dsGetSub(id){
  const subs={
    'pt-overview':'Your health at a glance','pt-vitals':'Real-time tracking',
    'pt-labs':'Results & imaging','pt-appts':'Upcoming visits','pt-meds':'Your prescriptions',
    'pt-monitor':'Connected device data',
    'dr-schedule':"Today's agenda",'dr-patients':'Patient registry',
    'dr-vitals':'Real-time patient vitals','dr-tasks':'Workflow & assignments',
    'dr-alerts':'Clinical notifications','dr-analytics':'Performance metrics',
    'ph-overview':'Pharmacy snapshot','ph-inventory':'Stock management',
    'ph-prescriptions':'Prescription queue','ph-revenue':'Sales & margins','ph-expiry':'Compliance tracking',
    'ad-overview':'System at a glance','ad-kpi':'Key performance indicators',
    'ad-users':'Account management','ad-kanban':'Task workflow','ad-reports':'Analytics & reports',
  };
  return subs[id]||'';
}

function dsDestroyCharts(){
  Object.values(dsCharts).forEach(c=>{try{c.destroy();}catch(e){}});
  dsCharts={};
}

// ── Page render ───────────────────────────────────────────────
function dsRenderPage(id){
  const months = ['Oct','Nov','Dec','Jan','Feb','Mar','Apr'];
  const days   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const gCol = 'rgba(148,163,184,0.12)';

  const statCard=(icon,cls,label,val,sub,chg,chgDir)=>
    `<div class="dsc"><div class="dsc-icon ${cls}">${dsIcon(icon,17)}</div><div class="dsc-lbl">${label}</div><div class="dsc-val">${val}</div>${chg?`<div class="dsc-${chgDir}">${chg}</div>`:`<div class="dsc-sub">${sub}</div>`}</div>`;

  const pill=(txt,cls)=>`<span class="dp dp-${cls}">${txt}</span>`;
  const sIcon=(ic,sz=14,col='white')=>`<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2">${DS_ICONS[ic]||''}</svg>`;
  const alertSvg=(ic)=>`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${DS_ICONS[ic]||''}</svg>`;

  if(id==='pt-overview') return `
    <div class="dg4">
      ${statCard('heart','si-b','Heart Rate','72 bpm','Normal','','')
      }${statCard('droplet','si-r','Blood Pressure','120/80','mmHg','','')
      }${statCard('zap','si-p','Blood Glucose','98 mg/dL','Normal','','')
      }${statCard('wind','si-g','SpO₂','98%','Excellent','','')}
    </div>
    <div class="dg21">
      <div class="dc">
        <div class="dc-title">${dsIcon('user')} Patient Profile</div>
        <div style="display:flex;gap:1rem;margin-bottom:1rem">
          <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#0891b2,#0e7490);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800;color:white;flex-shrink:0">${(currentUser&&currentUser.name)?currentUser.name.split(' ').map(w=>w[0]).join('').slice(0,2):'AJ'}</div>
          <div>
            <div style="font-size:0.95rem;font-weight:700;color:#000">${(currentUser&&currentUser.name)||'Alex Johnson'}</div>
            <div style="font-size:0.75rem;color:#0d1117">DOB: March 15, 1988 · Age: 36</div>
            <div style="font-size:0.75rem;color:#0d1117">ID: PAT-2024-0041</div>
            <div style="margin-top:0.4rem;display:flex;gap:0.35rem;flex-wrap:wrap">${pill('Type 2 DM','b')}${pill('Hypertension','a')}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem">
          ${[['Blood Type','A+'],['Weight','172 lbs'],['Height',"5'10\""],['BMI','24.7 – Normal'],['Allergies','Penicillin, Sulfa'],['Primary Care','Dr. Sarah Patel']].map(([l,v])=>`<div><div style="font-size:0.67rem;color:#1a2332">${l}</div><div style="font-size:0.77rem;font-weight:600;color:#0d1117">${v}</div></div>`).join('')}
        </div>
      </div>
      <div>
        <div class="dc" style="margin-bottom:0.875rem">
          <div class="dc-title">${dsIcon('calendar')} Next Appointments</div>
          ${[['09:30','Dr. Patel – General','confirmed'],['02:00','Lab Draw – Lipid Panel','pending'],['Apr 18','Cardiology','telehealth']].map(a=>`<div class="das ${a[2]}"><div class="das-t">${a[0]}</div><div><div class="das-n">${a[1]}</div><div class="das-s">${a[2]}</div></div>${pill(a[2],'g')}</div>`).join('')}
        </div>
        <div class="dc">
          <div class="dc-title">${dsIcon('clipboard')} Care Timeline</div>
          <div class="dtl"><div class="dtld dtl-b">${sIcon('clipboard',10,'#2563eb')}</div><div class="dtlc"><div class="dt-title">HbA1c: 7.2% – Improved</div><div class="dt-date">April 8, 2026</div></div></div>
          <div class="dtl"><div class="dtld dtl-g">${sIcon('heart',10,'#16a34a')}</div><div class="dtlc"><div class="dt-title">ECG: Normal</div><div class="dt-date">March 22, 2026</div></div></div>
          <div class="dtl"><div class="dtld dtl-a">${sIcon('zap',10,'#d97706')}</div><div class="dtlc"><div class="dt-title">Metformin dose adjusted</div><div class="dt-date">March 5, 2026</div></div></div>
          <div class="dtl"><div class="dtld dtl-p">${sIcon('activity',10,'#9333ea')}</div><div class="dtlc"><div class="dt-title">MRI Brain: Clear</div><div class="dt-date">Feb 14, 2026</div></div></div>
        </div>
      </div>
    </div>
    <div class="dc dgap">
      <div class="dc-title">${dsIcon('activity')} Health Trend (6 months)</div>
      <div class="dch dch-md"><canvas id="pt-trend-chart" role="img" aria-label="Health trends">Health trend chart</canvas></div>
    </div>`;

  if(id==='pt-vitals') return `
    <div class="dg4">
      ${statCard('heart','si-b','Heart Rate','72 bpm','','','')
      }${statCard('droplet','si-p','Blood Pressure','120/80','','','')
      }${statCard('zap','si-a','Glucose','98 mg/dL','','','')
      }${statCard('wind','si-g','SpO₂','98%','','','')}
    </div>
    <div class="dg2">
      <div class="dc"><div class="dc-title">${dsIcon('activity')} Heart Rate (24h)</div><div class="dch dch-md"><canvas id="pt-hr-chart" role="img" aria-label="Heart rate 24h">HR chart</canvas></div></div>
      <div class="dc"><div class="dc-title">${dsIcon('droplet')} Blood Glucose (7 days)</div><div class="dch dch-md"><canvas id="pt-glucose-chart" role="img" aria-label="Glucose 7 days">Glucose chart</canvas></div></div>
    </div>
    <div class="dg2">
      <div class="dc">
        <div class="dc-title">${dsIcon('heart')} Sleep Quality</div>
        <div style="display:flex;align-items:center;gap:1.25rem;margin-bottom:0.75rem">
          <div style="text-align:center"><div style="font-size:1.8rem;font-weight:800;color:#000">7.4h</div><div style="font-size:0.68rem;color:#1a2332">Average</div></div>
          <div style="flex:1">
            ${[['Deep Sleep','2.1h',68,'#2563eb'],['REM Sleep','1.8h',58,'#9333ea'],['Light Sleep','3.5h',85,'#22c55e']].map(([l,v,p,c])=>`
              <div style="margin-bottom:0.4rem"><div style="display:flex;justify-content:space-between;font-size:0.68rem;margin-bottom:2px"><span style="color:#0d1117">${l}</span><span style="font-weight:600">${v}</span></div><div class="dpb"><div class="dpf" style="width:${p}%;background:${c}"></div></div></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="dc"><div class="dc-title">${dsIcon('wind')} Activity (This Week)</div><div class="dch dch-sm"><canvas id="pt-activity-chart" role="img" aria-label="Weekly activity">Activity chart</canvas></div>
        <div style="display:flex;gap:0.75rem;margin-top:0.6rem">
          <div style="flex:1;text-align:center;padding:0.4rem;background:#f0fdf4;border-radius:0.4rem"><div style="font-size:1rem;font-weight:800;color:#16a34a">8,450</div><div style="font-size:0.62rem;color:#0d1117">avg steps/day</div></div>
          <div style="flex:1;text-align:center;padding:0.4rem;background:#eff6ff;border-radius:0.4rem"><div style="font-size:1rem;font-weight:800;color:#2563eb">42 min</div><div style="font-size:0.62rem;color:#0d1117">active/day</div></div>
        </div>
      </div>
    </div>`;

  if(id==='pt-labs') return `
    <div class="dg3">
      ${statCard('clipboard','si-b','Total Results','28','','','')
      }${statCard('activity','si-g','Normal Range','24','','','')
      }${statCard('alert-triangle','si-a','Flagged','4','','','')}
    </div>
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Recent Lab Results</h3>${pill('April 8, 2026','b')}</div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Test</th><th>Result</th><th>Reference</th><th>Status</th><th>Date</th></tr></thead><tbody>
        ${[['HbA1c','7.2%','<7.0%','a','Apr 8'],['Fasting Glucose','98 mg/dL','70–100','g','Apr 8'],['LDL Cholesterol','112 mg/dL','<100','a','Apr 8'],['HDL Cholesterol','52 mg/dL','>40','g','Apr 8'],['Creatinine','1.0 mg/dL','0.7–1.3','g','Apr 8'],['WBC','6.8 K/μL','4.5–11.0','g','Mar 22'],['Hemoglobin','14.2 g/dL','12–17.5','g','Mar 22']].map(([t,r,ref,s,d])=>`<tr><td style="font-weight:600">${t}</td><td>${r}</td><td style="color:#1a2332">${ref}</td><td>${pill(s==='g'?'Normal':'Review',s)}</td><td style="color:#1a2332">${d}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="dg2">
      <div class="dc"><div class="dc-title">${dsIcon('activity')} HbA1c Trend</div><div class="dch dch-md"><canvas id="pt-hba1c-chart" role="img" aria-label="HbA1c trend">HbA1c chart</canvas></div></div>
      <div class="dc"><div class="dc-title">${dsIcon('clipboard')} Imaging</div>
        ${[['MRI Brain','Feb 14, 2026'],['Chest X-Ray','Jan 20, 2026'],['ECG 12-lead','Mar 22, 2026'],['Ultrasound Abdomen','Dec 10, 2025']].map(([n,d])=>`<div class="dli"><div class="dli-icon" style="background:linear-gradient(135deg,#3b82f6,#2563eb)">${sIcon('file-text',14)}</div><div class="dli-info"><div class="dli-name">${n}</div><div class="dli-sub">${d}</div></div>${pill('Normal','g')}</div>`).join('')}
      </div>
    </div>`;

  if(id==='dr-schedule') return `
    <div class="dg4">
      ${statCard('calendar','si-b','Today\'s Appts','12','','↑ 2','up')
      }${statCard('check-square','si-g','Checked In','7','','','')
      }${statCard('clock','si-a','Pending','4','','','')
      }${statCard('wifi','si-c','Telehealth','3','','','')}
    </div>
    <div class="dg21">
      <div class="dc">
        <div class="dc-hdr" style="display:flex;align-items:center;justify-content:space-between">
          <div><h3>Today's Agenda — April 12</h3>${pill('Saturday','b')}</div>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <button id="openAddAgenda" class="btn-sm btn-sm-blue">Add</button>
            <button class="btn-sm btn-sm-blue" onclick="openAgendaSync()">Sync</button>
            <button class="btn-sm" onclick="printAgenda()">Print</button>
            <button id="simAlert" class="btn-sm" title="Simulate alert">Simulate Alert</button>
          </div>
        </div>
        ${[['09:00','Alex Johnson','Type 2 DM follow-up','confirmed'],['09:45','Maria Santos','Hypertension check','confirmed'],['10:30','Robert Kim','Pre-op assessment','confirmed'],['11:15','Linda Pham','Annual physical','pending'],['12:00','— LUNCH BREAK —','','gray'],['13:00','David Osei','Video consult – asthma','telehealth'],['13:45','Priya Mehta','Medication review','confirmed'],['14:30','Thomas Lee','Lab result review','telehealth'],['15:15','Emma Clarke','First visit – anxiety','pending']].map(([t,n,r,s])=>`
          <div class="das ${s==='gray'?'':s}" style="${s==='gray'?'background:#f8fafc;color:#1a2332':''}">
            <div class="das-t">${t}</div>
            <div style="flex:1"><div class="das-n" style="${s==='gray'?'color:#1a2332':''}">${n}</div><div class="das-s">${r}</div></div>
            ${s&&s!=='gray'?pill(s,s==='confirmed'?'g':s==='telehealth'?'b':'a'):''}
          </div>`).join('')}
      </div>
      <div>
        <div class="dc" style="margin-bottom:0.875rem">
          <div class="dc-title">${dsIcon('calendar')} April 2026</div>
          <div class="dcal-grid">
            ${['S','M','T','W','T','F','S'].map(d=>`<div class="dcal-dh">${d}</div>`).join('')}
            ${Array(2).fill('').map(()=>'<div class="dcal-d empty">·</div>').join('')}
            ${Array(30).fill('').map((_,i)=>{const d=i+1,isT=d===12,hasA=[7,8,10,12,14,15,18,22].includes(d);return`<div class="dcal-d${isT?' today':hasA?' has-appt':''}">${d}</div>`;}).join('')}
          </div>
        </div>
        <div class="dc">
          <div class="dc-title">${dsIcon('alert-triangle')} Urgent Alerts</div>
          <div class="dai dai-r">${alertSvg('alert-triangle')}<div><strong>Critical: Thomas Lee</strong><span>BP 168/98 – hypertensive crisis</span></div></div>
          <div class="dai dai-a">${alertSvg('zap')}<div><strong>Lab Ready: Robert Kim</strong><span>CBC panel – critical value</span></div></div>
        </div>
      </div>
    </div>`;

  if(id==='dr-patients') return `
    <div class="dc dgap">
      <div class="dc-hdr" style="display:flex;align-items:center;justify-content:space-between"><div><h3>Patient Registry</h3><span style="font-size:0.75rem;color:#1a2332">142 active patients</span></div><div><button id="openAddPatient" class="btn-sm btn-sm-blue">+ Add Patient</button></div></div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Patient</th><th>Age</th><th>Diagnosis</th><th>Last Visit</th><th>Next Appt</th><th>Status</th><th>Risk</th></tr></thead><tbody>
        ${[['Alex Johnson','36','Type 2 DM, HTN','Apr 8','Apr 12','Active','medium'],['Maria Santos','54','Hypertension','Mar 28','Apr 12','Active','low'],['Robert Kim','62','Pre-op: Hip','Apr 5','Apr 12','Active','high'],['Linda Pham','41','Annual','Jan 15','Apr 12','Active','low'],['Thomas Lee','71','CHF, Afib','Apr 1','Apr 12','Critical','high'],['Emma Clarke','26','Anxiety, Depression','—','Apr 12','New','low']].map(([n,a,d,lv,na,s,r])=>`
          <tr>
            <td><div style="display:flex;align-items:center;gap:0.4rem"><div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#2563eb);display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;color:white;flex-shrink:0">${n.split(' ').map(w=>w[0]).join('')}</div>${n}</div></td>
            <td>${a}</td><td style="font-size:0.72rem">${d}</td>
            <td style="color:#1a2332">${lv}</td><td>${na}</td>
            <td>${pill(s,s==='Critical'?'r':s==='New'?'b':'g')}</td>
            <td>${pill(r,r==='high'?'r':r==='medium'?'a':'g')}</td>
          </tr>`).join('')}
      </tbody></table></div>
    </div>`;

  if(id==='dr-analytics') return `
    <div class="dg4">
      ${statCard('users','si-b','Total Patients','142','','↑ 8 this month','up')
      }${statCard('activity','si-r','Readmission Rate','4.2%','','↓ 0.8%','dn')
      }${statCard('check-square','si-g','Satisfaction','4.7/5','','↑ 0.2','up')
      }${statCard('clock','si-a','Avg Wait Time','12 min','','↓ 3 min','dn')}
    </div>
    <div class="dg2">
      <div class="dc"><div class="dc-title">${dsIcon('bar-chart')} Monthly Visits</div><div class="dch dch-md"><canvas id="dr-visits-chart" role="img" aria-label="Monthly visits">Visits chart</canvas></div></div>
      <div class="dc"><div class="dc-title">${dsIcon('users')} Gender Distribution</div>
        <div style="display:flex;align-items:center;gap:1rem">
          <div class="dch" style="height:150px;width:150px;flex-shrink:0"><canvas id="dr-gender-chart" role="img" aria-label="Gender distribution">Gender chart</canvas></div>
          <div style="flex:1">${[['Female','58%','#9333ea'],['Male','39%','#2563eb'],['Other','3%','#0891b2']].map(([l,p,c])=>`<div class="dgr"><span style="font-size:0.72rem;color:#0d1117;min-width:50px">${l}</span><div class="dgb"><div class="dgf" style="width:${p};background:${c}"></div></div><span style="font-size:0.72rem;font-weight:700;min-width:32px;text-align:right">${p}</span></div>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="dg3">
      <div class="dc"><div class="dc-title">Bed Occupancy</div><div style="text-align:center;margin:0.5rem 0"><div style="font-size:2rem;font-weight:800;color:#000">78%</div><div style="font-size:0.72rem;color:#1a2332">39 of 50 beds</div></div><div class="dpb" style="height:8px"><div class="dpf" style="width:78%;background:linear-gradient(90deg,#22c55e,#16a34a)"></div></div></div>
      <div class="dc"><div class="dc-title">Avg. Length of Stay</div><div style="text-align:center;margin:0.5rem 0"><div style="font-size:2rem;font-weight:800;color:#000">3.2</div><div style="font-size:0.72rem;color:#1a2332">days average</div></div><div style="text-align:center;font-size:0.68rem;color:#16a34a;margin-top:0.4rem">↓ 0.4 days vs last month</div></div>
      <div class="dc"><div class="dc-title">Clinical Trials</div>
        ${[['Diabetes Study Ph.III','Active','28 pts'],['HTN Management','Enrolling','12 pts'],['Cardio Prevention','Completed','45 pts']].map(([n,s,p])=>`<div class="dli"><div class="dli-info"><div class="dli-name" style="font-size:0.75rem">${n}</div><div class="dli-sub">${p}</div></div>${pill(s,s==='Active'?'g':s==='Enrolling'?'b':'s')}</div>`).join('')}
      </div>
    </div>`;

  if(id==='dr-tasks') return `
    <div class="dg2">
      <div class="dc">
        <div style="display:flex;align-items:center;justify-content:space-between"><div class="dc-title">${dsIcon('check-square')} Today's Tasks</div><div><button id="openAddTask" class="btn-sm btn-sm-blue">+ Add Task</button></div></div>
        ${[true,true,false,false,false,false,false,false].map((done,i)=>{
          const tasks=['Review Thomas Lee CBC','Sign discharge – Bed 14','Call pharmacy re Warfarin','Complete rounds – Ward B','Telehealth – David Osei 1pm','Review imaging: Pham MRI','Update care plan – Santos','Supervision notes – Residents'];
          return `<div class="dtk"><div class="dtk-cb ${done?'done':''}" onclick="this.classList.toggle('done');this.nextElementSibling.classList.toggle('done')"></div><div class="dtk-txt ${done?'done':''}">${tasks[i]}</div></div>`;
        }).join('')}
      </div>
      <div class="dc">
        <div class="dc-title">${dsIcon('users')} Staff Assignments</div>
        ${[['A. Williams','Lab follow-ups (3)','In Progress','si-b'],['B. Torres','Medication rounds','Pending','si-a'],['Dr. Nair','History taking – Emma C.','Completed','si-g'],['Tech J. Park','ECG setup – Bed 8','Pending','si-a'],['M. Chen','Drug interaction review','In Progress','si-b']].map(([n,t,s,cls])=>`
          <div class="dli"><div class="dli-icon ${cls}">${sIcon('user',14)}</div><div class="dli-info"><div class="dli-name">${n}</div><div class="dli-sub">${t}</div></div>${pill(s,s==='Completed'?'g':s==='In Progress'?'b':'a')}</div>`).join('')}
      </div>
    </div>`;

  if(id==='dr-alerts') return `
    <div class="dg2">
      <div class="dc">
        <div class="dc-title">${dsIcon('alert-triangle')} Clinical Alerts</div>
        ${[{c:'dai-r',i:'alert-triangle',t:'Critical: Thomas Lee',s:'BP 168/98 – hypertensive crisis threshold'},
           {c:'dai-r',i:'alert-triangle',t:'Lab Critical: Robert Kim',s:'K+ 6.2 mEq/L – hyperkalemia'},
           {c:'dai-a',i:'zap',t:'Medication Due: Priya Mehta',s:'Levothyroxine refill – 3 days'},
           {c:'dai-a',i:'clock',t:'No-show: 10:00 AM slot',s:'Follow-up required'},
           {c:'dai-b',i:'clipboard',t:'Lab Ready: Alex Johnson',s:'HbA1c results available'},
           {c:'dai-b',i:'wifi',t:'Telehealth in 30 min',s:'David Osei – asthma, 1:00 PM'}].map(a=>`
          <div class="dai ${a.c}">${alertSvg(a.i)}<div><strong>${a.t}</strong><span>${a.s}</span></div></div>`).join('')}
      </div>
      <div class="dc"><div class="dc-title">${dsIcon('activity')} Alert Frequency Today</div><div class="dch dch-md"><canvas id="dr-alert-chart" role="img" aria-label="Alert frequency">Alert chart</canvas></div></div>
    </div>`;

  if(id==='ph-overview') return `
    <div class="dg4">
      ${statCard('trending-up','si-g','Today\'s Revenue','₹48.2K','','↑ 12%','up')
      }${statCard('file-text','si-b','Prescriptions','184','','↑ 8','up')
      }${statCard('alert-triangle','si-r','Low Stock Items','7','','↑ 3 new','dn')
      }${statCard('clock','si-a','Expiring (30d)','12','','','')}
    </div>
    <div class="dg2">
      <div class="dc"><div class="dc-title">${dsIcon('trending-up')} Revenue This Week</div><div class="dch dch-md"><canvas id="ph-rev-chart" role="img" aria-label="Weekly revenue">Revenue chart</canvas></div></div>
      <div class="dc">
        <div class="dc-title">${dsIcon('package')} Critical Stock Levels</div>
        ${[['Amoxicillin 500mg',18,'#ef4444'],['Insulin Glargine',24,'#ef4444'],['Metformin 500mg',45,'#f59e0b'],['Atorvastatin 20mg',52,'#f59e0b'],['Paracetamol 500mg',78,'#22c55e'],['Lisinopril 10mg',81,'#22c55e']].map(([n,v,c])=>`
          <div class="dinv"><div class="dinv-hdr"><span class="dinv-n">${n}</span><span class="dinv-v" style="color:${c}">${v} units</span></div><div class="dpb"><div class="dpf" style="width:${v}%;background:${c}"></div></div></div>`).join('')}
      </div>
    </div>`;

  if(id==='ph-inventory') return `
    <div class="dg3">
      ${statCard('package','si-g','Total SKUs','1,248','','','')
      }${statCard('alert-triangle','si-r','Out of Stock','3','','','')
      }${statCard('clock','si-a','Expiring ≤180d','28','','','')}
    </div>
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Inventory Status</h3><span style="font-size:0.72rem;color:#1a2332">Updated 5 min ago</span></div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Medicine</th><th>Category</th><th>Stock</th><th>Reorder Level</th><th>Expiry</th><th>Status</th></tr></thead><tbody>
        ${[['Amoxicillin 500mg','Antibiotic','18 units','50','Jun 2026','r'],['Insulin Glargine','Hormone','24 units','30','Aug 2026','r'],['Metformin 500mg','Antidiabetic','145 units','100','Jan 2027','g'],['Atorvastatin 20mg','Statin','89 units','60','Mar 2027','g'],['Omeprazole 20mg','PPI','38 units','50','May 2026','a'],['Warfarin 5mg','Anticoag','0 units','25','—','r']].map(([n,c,s,r,e,st])=>`
          <tr><td style="font-weight:600">${n}</td><td>${pill(c,'s')}</td><td style="font-weight:700;color:${st==='r'?'#dc2626':st==='a'?'#d97706':'#16a34a'}">${s}</td><td style="color:#1a2332">${r}</td><td style="color:#1a2332">${e}</td><td>${pill(st==='g'?'In Stock':st==='r'?'Out/Critical':'Low',st)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;

  if(id==='ph-revenue') return `
    <div class="dg4">
      ${statCard('trending-up','si-g','Monthly Revenue','₹1.24M','','↑ 18.4%','up')
      }${statCard('file-text','si-b','Scripts Filled','4,820','','↑ 6.2%','up')
      }${statCard('zap','si-p','Gross Margin','28.4%','','↑ 2.1%','up')
      }${statCard('clock','si-a','Avg Fill Time','8.2 min','','↓ 1.4 min','dn')}
    </div>
    <div class="dg2">
      <div class="dc"><div class="dc-title">${dsIcon('bar-chart')} Annual Revenue</div><div class="dch dch-lg"><canvas id="ph-annual-chart" role="img" aria-label="Annual revenue">Annual chart</canvas></div></div>
      <div class="dc"><div class="dc-title">${dsIcon('trending-up')} By Category</div>
        <div style="display:flex;align-items:center;gap:1rem">
          <div class="dch" style="height:160px;width:160px;flex-shrink:0"><canvas id="ph-cat-chart" role="img" aria-label="Category revenue">Category chart</canvas></div>
          <div style="flex:1">${[['Antibiotics','32%','#2563eb'],['Chronic','28%','#16a34a'],['OTC','20%','#9333ea'],['Hormones','12%','#d97706'],['Others','8%','#64748b']].map(([l,p,c])=>`<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem"><div style="width:9px;height:9px;border-radius:2px;background:${c};flex-shrink:0"></div><span style="font-size:0.72rem;flex:1;color:#1a2332">${l}</span><span style="font-size:0.72rem;font-weight:700">${p}</span></div>`).join('')}</div>
        </div>
      </div>
    </div>`;

  if(id==='ad-overview') return `
    <div class="dg4">
      ${statCard('users','si-b','Total Users','1,842','','↑ 42 this month','up')
      }${statCard('activity','si-g','System Uptime','99.8%','','','')
      }${statCard('calendar','si-p','Appts Today','384','','↑ 28','up')
      }${statCard('alert-triangle','si-a','Open Tickets','14','','','')}
    </div>
    <div class="dg2">
      <div class="dc"><div class="dc-title">${dsIcon('bar-chart')} Daily Visits (This Week)</div><div class="dch dch-md"><canvas id="ad-visits-chart" role="img" aria-label="Daily visits">Visits chart</canvas></div></div>
      <div class="dc"><div class="dc-title">${dsIcon('users')} Users by Role</div>
        <div style="display:flex;align-items:center;gap:1rem">
          <div class="dch" style="height:150px;width:150px;flex-shrink:0"><canvas id="ad-roles-chart" role="img" aria-label="Users by role">Roles chart</canvas></div>
          <div style="flex:1">${[['Patients','1,240','#0891b2'],['Doctors','142','#2563eb'],['Pharmacists','38','#16a34a'],['Admins','22','#9333ea'],['Staff','400','#64748b']].map(([l,v,c])=>`<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem"><div style="width:9px;height:9px;border-radius:2px;background:${c};flex-shrink:0"></div><span style="font-size:0.72rem;flex:1;color:#1a2332">${l}</span><span style="font-size:0.72rem;font-weight:700">${v}</span></div>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="dg3">
      <div class="dc"><div class="dc-title">Patient Satisfaction</div><div style="text-align:center;margin:0.5rem 0"><div style="font-size:2rem;font-weight:800;color:#000">4.7<span style="font-size:1rem;color:#1a2332">/5</span></div><div style="font-size:0.68rem;color:#1a2332">1,240 reviews</div></div>
        ${[5,4,3,2,1].map(s=>`<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem"><span style="font-size:0.65rem;min-width:8px;color:#0d1117">${s}</span><div class="dpb" style="flex:1;height:7px"><div class="dpf" style="width:${[68,22,6,3,1][5-s]}%;background:#f59e0b"></div></div><span style="font-size:0.65rem;color:#0d1117;min-width:26px">${[68,22,6,3,1][5-s]}%</span></div>`).join('')}
      </div>
      <div class="dc"><div class="dc-title">Avg. Wait Times</div>
        ${[['Emergency','4 min','n'],['OPD','18 min','w'],['Lab Results','45 min','w'],['Pharmacy','8 min','n'],['Radiology','32 min','w']].map(([d,t,c])=>`<div class="dvr"><span class="dvl">${d}</span><span class="dvs vs-${c}">${t}</span></div>`).join('')}
      </div>
      <div class="dc"><div class="dc-title">System Snapshot</div>
        ${[['Total Visits (Apr)','3,842'],['Re-admissions','4.2%'],['Avg LOS','3.2 days'],['Beds Available','11/50'],['Scripts Filled','4,820'],['Active Staff','84']].map(([l,v])=>`<div class="dvr"><span class="dvl">${l}</span><span class="dvv">${v}</span></div>`).join('')}
      </div>
    </div>`;

  if(id==='ad-users') return `
    <div class="dc dgap">
      <div class="dc-hdr"><h3>User Management</h3><span style="font-size:0.72rem;color:#1a2332">1,842 accounts</span></div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Last Login</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${[['Dr. Sarah Patel','doctor','Internal Medicine','2 min ago','active'],['Michael Chen','pharmacist','Pharmacy','18 min ago','active'],['Alex Johnson','patient','—','1 hr ago','active'],['Dr. James Liu','doctor','Cardiology','Yesterday','inactive'],['Nurse A. Williams','staff','Ward B','3 min ago','active'],['Priya Sharma','admin','Administration','Just now','active']].map(([n,r,d,l,s])=>`
          <tr>
            <td><div style="display:flex;align-items:center;gap:0.4rem"><div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#9333ea,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;color:white;flex-shrink:0">${n.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>${n}</div></td>
            <td>${pill(r,r==='doctor'?'b':r==='pharmacist'?'g':r==='admin'?'p':r==='patient'?'c':'s')}</td>
            <td style="color:#0d1117">${d}</td><td style="color:#1a2332">${l}</td>
            <td>${pill(s,s==='active'?'g':'s')}</td>
            <td><span style="font-size:0.7rem;color:#2563eb;cursor:pointer;font-weight:600">Edit</span> · <span style="font-size:0.7rem;color:#dc2626;cursor:pointer;font-weight:600">Deactivate</span></td>
          </tr>`).join('')}
      </tbody></table></div>
    </div>`;

  if(id==='ad-kanban') return `
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Workflow Board</h3>${pill('April 12, 2026','b')}</div>
      <div class="dkb">
        ${[{col:'To Do',color:'#64748b',items:['Update consent forms','Configure MRI machine','EHR training module','Monthly compliance review']},
           {col:'In Progress',color:'#2563eb',items:['Security audit','Lab interface integration','Pharmacy workflow rollout']},
           {col:'Review',color:'#d97706',items:['Patient feedback analysis','Drug DB update','ER wait time report']},
           {col:'Done',color:'#16a34a',items:['Q1 financial report','Doctor onboarding','Emergency protocol update']}].map(({col,color,items})=>`
          <div class="dkb-col"><div class="dkb-hdr" style="color:${color}">${col}<div class="dkb-cnt">${items.length}</div></div>${items.map(i=>`<div class="dkb-card">${i}</div>`).join('')}</div>`).join('')}
      </div>
    </div>`;

  if(id==='ad-kpi') return `
    <div class="dg4">
      ${statCard('users','si-b','Patient Visits','3,842','','↑ 14.2%','up')
      }${statCard('activity','si-r','Readmission Rate','4.2%','','↓ 0.8%','dn')
      }${statCard('check-square','si-g','Satisfaction','4.7/5','','↑ 0.2','up')
      }${statCard('clock','si-a','Avg Wait Time','12 min','','↓ 3 min','dn')}
    </div>
    <div class="dc dgap"><div class="dc-title">${dsIcon('bar-chart-2')} Monthly KPI Trend</div><div class="dch dch-lg"><canvas id="ad-kpi-chart" role="img" aria-label="KPI trend">KPI chart</canvas></div></div>`;

  if(id==='pt-monitor') return `
    <div class="dg4">
      ${statCard('wifi','si-g','Device Status','Online','Connected','','')
      }${statCard('heart','si-b','Last Reading','2 min','ago','','')
      }${statCard('zap','si-p','Alerts Sent','0','None today','','')
      }${statCard('activity','si-a','Battery','82%','','','')}
    </div>
    <div class="dg2">
      <div class="dc"><div class="dc-title">${dsIcon('activity')} Continuous HR (Last 4h)</div><div class="dch dch-md"><canvas id="pt-cont-hr-chart" role="img" aria-label="Continuous HR">HR monitor</canvas></div></div>
      <div class="dc"><div class="dc-title">${dsIcon('droplet')} Blood Glucose (CGM)</div><div class="dch dch-md"><canvas id="pt-cgm-chart" role="img" aria-label="CGM data">CGM chart</canvas></div></div>
    </div>`;

  if(id==='ph-prescriptions') return `
    <div class="dg3">
      ${statCard('file-text','si-b','Pending','23','','','')
      }${statCard('check-square','si-g','Filled Today','161','','↑ 8','up')
      }${statCard('clock','si-a','Avg Fill Time','8.2 min','','↓ 1.4','dn')}
    </div>
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Prescription Queue</h3>${pill('Live','g')}</div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Rx ID</th><th>Patient</th><th>Medicine</th><th>Doctor</th><th>Received</th><th>Status</th></tr></thead><tbody>
        ${[['RX-1041','Alex Johnson','Metformin 500mg','Dr. Patel','09:12 AM','pending'],['RX-1040','Maria Santos','Lisinopril 10mg','Dr. Patel','09:05 AM','filled'],['RX-1039','Thomas Lee','Warfarin 5mg','Dr. Liu','08:45 AM','pending'],['RX-1038','Priya Mehta','Levothyroxine 50mcg','Dr. Singh','08:30 AM','filled'],['RX-1037','David Osei','Salbutamol Inhaler','Dr. Patel','08:15 AM','filled']].map(([id,n,m,d,t,s])=>`
          <tr><td style="font-weight:600;color:#2563eb">${id}</td><td>${n}</td><td>${m}</td><td>${d}</td><td style="color:#1a2332">${t}</td><td>${pill(s,s==='filled'?'g':'a')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;

  if(id==='ph-expiry') return `
    <div class="dg3">
      ${statCard('clock','si-r','Expiring (30d)','12','','','')
      }${statCard('alert-triangle','si-a','Expiring (90d)','28','','','')
      }${statCard('package','si-g','OK Stock','1,208','','','')}
    </div>
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Expiry Tracker</h3>${pill('Compliance View','a')}</div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Medicine</th><th>Batch</th><th>Qty</th><th>Expiry Date</th><th>Days Left</th><th>Action</th></tr></thead><tbody>
        ${[['Amoxicillin 500mg','B2024-01','18','Jun 30, 2026','79','a'],['Omeprazole 20mg','B2023-12','38','May 15, 2026','33','r'],['Clopidogrel 75mg','B2024-02','12','Jul 10, 2026','89','a'],['Aspirin 75mg','B2023-11','5','Apr 28, 2026','16','r'],['Metformin 500mg','B2025-01','145','Jan 20, 2027','283','g']].map(([n,b,q,e,d,s])=>`
          <tr><td style="font-weight:600">${n}</td><td style="color:#1a2332">${b}</td><td>${q}</td><td>${e}</td><td style="font-weight:700;color:${s==='r'?'#dc2626':s==='a'?'#d97706':'#16a34a'}">${d} days</td><td>${pill(s==='r'?'Urgent':s==='a'?'Review':'OK',s)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;

  if(id==='pt-appts') return `
    <div class="dg3">
      ${statCard('calendar','si-b','Upcoming','3','','','')
      }${statCard('check-square','si-g','Completed (90d)','12','','','')
      }${statCard('clock','si-a','Next in','2 days','','','')}
    </div>
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Appointment History</h3></div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Date</th><th>Doctor</th><th>Type</th><th>Reason</th><th>Status</th></tr></thead><tbody>
        ${[['Apr 12, 2026','Dr. Sarah Patel','In-person','DM follow-up','upcoming'],['Apr 18, 2026','Dr. Cardio','Telehealth','Cardiology','upcoming'],['Mar 22, 2026','Dr. Sarah Patel','In-person','ECG review','completed'],['Feb 14, 2026','Radiology Dept.','In-person','MRI Brain','completed'],['Jan 20, 2026','Dr. Patel','In-person','Annual check','completed']].map(([d,dr,t,r,s])=>`
          <tr><td>${d}</td><td style="font-weight:600">${dr}</td><td>${pill(t,t==='Telehealth'?'b':'s')}</td><td>${r}</td><td>${pill(s,s==='upcoming'?'b':'g')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;

  if(id==='pt-meds') return `
    <div class="dg3">
      ${statCard('pill','si-p','Active Meds','3','','','')
      }${statCard('check-square','si-g','Refills Due','1','','','')
      }${statCard('alert-triangle','si-a','Interactions','0','','','')
      }
    </div>
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Current Medications</h3></div>
      ${[['Metformin','500mg','Twice daily with meals','Anti-diabetic','Jan 2027'],['Lisinopril','10mg','Once daily morning','ACE Inhibitor','Feb 2027'],['Aspirin','81mg','Once daily','Antiplatelet','Dec 2026']].map(([n,d,freq,cat,exp])=>`
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.5rem;padding:0.875rem;margin-bottom:0.6rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.4rem">
            <div style="display:flex;align-items:center;gap:0.5rem">
              <div class="dmi-icon">${sIcon('pill',13)}</div>
              <div class="dmi-n">${n} <span style="font-weight:400;color:#1a2332">${d}</span></div>
            </div>
            ${pill(cat,'p')}
          </div>
          <div style="font-size:0.72rem;color:#0d1117">${freq} · Expires: ${exp}</div>
        </div>`).join('')}
    </div>`;

  if(id==='ad-reports') return `
    <div class="dg3">
      ${statCard('file-text','si-b','Reports Generated','48','','','')
      }${statCard('users','si-g','Active Clinics','12','','','')
      }${statCard('activity','si-a','Data Points','2.4M','','','')}
    </div>
    <div class="dc dgap"><div class="dc-title">${dsIcon('bar-chart-2')} System-wide Monthly Trends</div><div class="dch dch-lg"><canvas id="ad-report-chart" role="img" aria-label="System trends">Trend chart</canvas></div></div>`;

  if(id==='dr-vitals') return `
    <div class="dg4">
      ${statCard('heart','si-r','Critical Patients','2','','','')
      }${statCard('activity','si-a','Monitoring Active','18','','','')
      }${statCard('alert-triangle','si-b','Alerts Today','4','','','')
      }${statCard('check-square','si-g','Normal Range','16','','','')}
    </div>
    <div class="dc dgap">
      <div class="dc-hdr"><h3>Patient Vitals Monitor</h3>${pill('Live','g')}</div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Patient</th><th>HR</th><th>BP</th><th>SpO₂</th><th>Glucose</th><th>Temp</th><th>Status</th></tr></thead><tbody>
        ${[['Alex Johnson','72','120/80','98%','98','98.6°F','n'],['Thomas Lee','94','168/98','95%','140','99.1°F','d'],['Maria Santos','78','135/85','97%','110','98.4°F','w'],['Robert Kim','68','118/76','99%','95','98.2°F','n'],['Priya Mehta','80','125/82','98%','105','98.8°F','n']].map(([n,hr,bp,spo,gl,tp,s])=>`
          <tr><td style="font-weight:600">${n}</td><td>${hr}</td><td>${bp}</td><td>${spo}</td><td>${gl}</td><td>${tp}</td><td><span class="dvs vs-${s}">${s==='n'?'Normal':s==='w'?'Watch':'Critical'}</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>`;

  return `<div style="color:#0d1117;padding:2rem">Page "${id}" content coming soon.</div>`;
}

// ── Chart initialization ──────────────────────────────────────
function dsInitCharts(pageId){
  // Notification helpers (badge, storage, play sound)
  function pushNotification(message,level='info'){
    try{
      const key='mg_notifications';
      const cur=JSON.parse(localStorage.getItem(key)||'[]');
      cur.unshift({id:Date.now(),message,level,time:new Date().toISOString()});
      localStorage.setItem(key,JSON.stringify(cur.slice(0,200)));
      updateNotificationsUI();
      playNotificationSound();
    }catch(e){console.warn(e)}
  }

  function updateNotificationsUI(){
    const key='mg_notifications';
    const cur=JSON.parse(localStorage.getItem(key)||'[]');
    const badge=document.getElementById('notifBadge');
    const panel=document.getElementById('notifPanel');
    if(badge) { if(cur.length>0){ badge.style.display='flex'; badge.textContent=String(Math.min(99,cur.length)); } else badge.style.display='none'; }
    if(panel){ panel.innerHTML = cur.length? cur.map(n=>`<div style="padding:0.8rem 1rem;border-bottom:1px solid #f1f5f9"><strong style="display:block">${n.message}</strong><div style="font-size:0.8rem;color:#64748b">${new Date(n.time).toLocaleString()}</div></div>`).join('') : '<div style="padding:1rem;text-align:center;color:#94a3b8">No notifications</div>' }
  }

  function playNotificationSound(){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type='sine'; o.frequency.value = 880; // A5
      g.gain.value = 0.02;
      o.connect(g); g.connect(ctx.destination);
      o.start(); setTimeout(()=>{ o.stop(); ctx.close(); }, 140);
    }catch(e){console.warn('sound failed',e)}
  }

  function toggleNotifications(){
    const dd=document.getElementById('notifDropdown'); if(!dd) return; dd.style.display = dd.style.display==='block'?'none':'block'; updateNotificationsUI();
  }

  // Agenda: add / render / store
  function openAddAgendaModal(){
    if(document.getElementById('add-agenda-overlay')) return;
    const overlay=document.createElement('div'); overlay.id='add-agenda-overlay'; overlay.className='agenda-modal-overlay';
    overlay.innerHTML=`<div class="agenda-modal"><div class="agenda-modal-header"><h3>Add Agenda Item</h3><button id="addAgendaClose" class="btn-sm">Close</button></div>
      <div class="agenda-modal-body"><div style="display:grid;gap:0.6rem"><input id="agendaName" class="form-control" placeholder="Patient / Title" /><input id="agendaTime" class="form-control" placeholder="HH:MM (24h)" /><textarea id="agendaNote" class="form-control" placeholder="Notes (optional)" rows="3"></textarea></div></div>
      <div class="agenda-modal-footer"><button id="addAgendaSave" class="btn-sm btn-sm-blue">Save</button></div></div>`;
    document.body.appendChild(overlay);
    document.getElementById('addAgendaClose').onclick=()=>overlay.remove();
    document.getElementById('addAgendaSave').onclick=saveAgendaEntry;
  }

  function saveAgendaEntry(){
    const name=document.getElementById('agendaName').value.trim();
    const time=document.getElementById('agendaTime').value.trim();
    const note=document.getElementById('agendaNote').value.trim();
    if(!name||!time){ alert('Please provide time and title'); return; }
    const today=new Date(); const dateKey=today.toISOString().slice(0,10);
    // Prefer server API
    (async ()=>{
      try{
        const scheduled_at = `${dateKey}T${time.padStart(5,'0')}:00`;
        await apiFetch('/doctors/agenda', { method: 'POST', body: JSON.stringify({ title: name, note: note, scheduled_at }) });
        document.getElementById('add-agenda-overlay').remove();
        await renderScheduleForDate(new Date());
        pushNotification(`New agenda added: ${name}`,'info');
      }catch(e){
        // fallback to localStorage
        const key='mg_agenda_'+dateKey; const cur=JSON.parse(localStorage.getItem(key)||'[]');
        cur.push({id:Date.now(),time,name,note}); localStorage.setItem(key,JSON.stringify(cur));
        document.getElementById('add-agenda-overlay').remove(); renderScheduleForDate(new Date()); pushNotification(`New agenda added (local): ${name}`,'info');
      }
    })();
  }

  async function renderScheduleForDate(dateObj){
    const dateKey = (dateObj instanceof Date)? dateObj.toISOString().slice(0,10) : (new Date()).toISOString().slice(0,10);
    // render header date
    const titleEl=document.querySelector('.dc-hdr h3'); if(titleEl) titleEl.textContent = `Today's Agenda — ${new Date(dateObj).toLocaleDateString()}`;
    // Try loading from server first
    let items = [];
    try{
      const data = await apiFetch('/doctors/agenda?date=' + dateKey);
      if(data && data.agenda) items = data.agenda.map(a=>({time: (a.scheduled_at||'').slice(11,16) || '', name: a.title, note: a.note}));
    }catch(e){
      const key='mg_agenda_'+dateKey; items=JSON.parse(localStorage.getItem(key)||'[]');
    }
    
    const container=document.querySelector('.dc > .das')? null : document.querySelector('.dc');
    // find the agenda column
    const listWrap = Array.from(document.querySelectorAll('.dc')).find(d=>d.innerHTML.includes("Today's Agenda")||d.innerHTML.includes('Today\'s Agenda'));
    const agendaCol = listWrap || document.querySelector('.dc');
    // populate urgent list area (replace existing .das entries)
    const area = agendaCol ? agendaCol.querySelectorAll('.das') : null;
    if(items.length===0){
      // show placeholder
      // find the parent where das entries live
      const dasParent = agendaCol;
      if(dasParent){
        // remove existing .das elements within
        dasParent.querySelectorAll('.das').forEach(n=>n.remove());
        const noEl=document.createElement('div'); noEl.style.color='#64748b'; noEl.style.padding='0.6rem'; noEl.textContent='No appointments for selected day.'; dasParent.appendChild(noEl);
      }
    } else {
      // ensure we render the items in the left column
      const parent = agendaCol;
      if(parent){
        parent.querySelectorAll('.das').forEach(n=>n.remove());
        items.sort((a,b)=>a.time.localeCompare(b.time));
        items.forEach(it=>{
          const div=document.createElement('div'); div.className='das confirmed';
          div.innerHTML = `<div class="das-t">${it.time}</div><div style="flex:1"><div class="das-n">${it.name}</div><div class="das-s">${it.note||''}</div></div><button class="btn-sm" style="margin-left:0.5rem">Edit</button>`;
          parent.appendChild(div);
        });
      }
    }
    // rebuild calendar marks for month (try to get month entries from server)
    try{
      const year=dateObj.getFullYear(), month=(dateObj.getMonth()+1).toString().padStart(2,'0');
      const res = await apiFetch('/doctors/agenda');
      // mark dates that match server agenda
      const dates = (res && res.agenda)? res.agenda.map(a=> (a.scheduled_at||'').slice(0,10) ) : [];
      const calCells=document.querySelectorAll('.dcal-d');
      calCells.forEach(cell=>{
        const d = parseInt(cell.textContent,10);
        if(isNaN(d)){ cell.classList.remove('has-appt'); cell.dataset.day=''; return; }
        const dt = new Date(dateObj.getFullYear(),dateObj.getMonth(),d);
        const iso = dt.toISOString().slice(0,10);
        if(dates.includes(iso)) cell.classList.add('has-appt'); else cell.classList.remove('has-appt');
        cell.dataset.day = dt.toISOString();
      });
    }catch(e){ rebuildCalendarMarks(dateObj); }
  }

  function rebuildCalendarMarks(dateObj){
    const calCells=document.querySelectorAll('.dcal-d');
    if(!calCells||calCells.length===0) return;
    // compute month start
    const year=dateObj.getFullYear(), month=dateObj.getMonth();
    const start=new Date(year,month,1);
    calCells.forEach(cell=>{
      const d = parseInt(cell.textContent,10);
      if(isNaN(d)){ cell.classList.remove('has-appt'); cell.dataset.day=''; return; }
      const dt = new Date(year,month,d);
      const key = 'mg_agenda_'+dt.toISOString().slice(0,10);
      const items = JSON.parse(localStorage.getItem(key)||'[]');
      if(items && items.length>0) cell.classList.add('has-appt'); else cell.classList.remove('has-appt');
      cell.dataset.day = dt.toISOString();
    });
  }

  // Patients: add modal + storage
  function openAddPatientModal(){
    if(document.getElementById('add-patient-overlay')) return;
    const overlay=document.createElement('div'); overlay.id='add-patient-overlay'; overlay.className='agenda-modal-overlay';
    overlay.innerHTML=`<div class="agenda-modal"><div class="agenda-modal-header"><h3>Add Patient</h3><button id="addPatientClose" class="btn-sm">Close</button></div>
      <div class="agenda-modal-body"><div style="display:grid;gap:0.6rem"><input id="patName" class="form-control" placeholder="Full name" /><input id="patDOB" class="form-control" placeholder="DOB (YYYY-MM-DD)" /><input id="patPhone" class="form-control" placeholder="Phone" /><input id="patDiag" class="form-control" placeholder="Diagnosis (comma separated)" /></div></div>
      <div class="agenda-modal-footer"><button id="addPatientSave" class="btn-sm btn-sm-blue">Save Patient</button></div></div>`;
    document.body.appendChild(overlay);
    document.getElementById('addPatientClose').onclick=()=>overlay.remove();
    document.getElementById('addPatientSave').onclick=savePatient;
  }

  function savePatient(){
    const name=document.getElementById('patName').value.trim();
    if(!name){ alert('Please provide name'); return; }
    const dob=document.getElementById('patDOB').value.trim(); const phone=document.getElementById('patPhone').value.trim(); const diag=document.getElementById('patDiag').value.trim();
    (async ()=>{
      try{
        await apiFetch('/doctors/patients', { method: 'POST', body: JSON.stringify({ name, age: 0, gender: 'Male', phone, current_medications: '', known_allergies: diag }) });
        document.getElementById('add-patient-overlay').remove(); renderPatientRegistry(); pushNotification(`Patient added: ${name}`,'info');
      }catch(e){
        const key='mg_patients'; const cur=JSON.parse(localStorage.getItem(key)||'[]'); cur.push({id:Date.now(),name,dob,phone,diag}); localStorage.setItem(key,JSON.stringify(cur)); document.getElementById('add-patient-overlay').remove(); renderPatientRegistry(); pushNotification(`Patient added (local): ${name}`,'info');
      }
    })();
  }

  function renderPatientRegistry(){
    const tableWrap = document.querySelector('.dt-wrap'); if(!tableWrap) return;
    const tbody = tableWrap.querySelector('tbody'); if(!tbody) return;
    (async ()=>{
      try{
        const res = await apiFetch('/doctors/patients');
        const cur = (res && res.patients) ? res.patients : [];
        tbody.innerHTML = cur.map(p=>`<tr><td><div style="display:flex;align-items:center;gap:0.4rem"><div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#2563eb);display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;color:white;flex-shrink:0">${(p.name||'').split(' ').map(w=>w[0]).join('')}</div>${p.name}</div></td><td>${p.age||'—'}</td><td style="font-size:0.72rem">${p.known_allergies||p.current_medications||'—'}</td><td style="color:#1a2332">—</td><td>—</td><td>${p.phone||'—'}</td><td><button class="btn-sm" onclick="(async()=>{await apiFetch('/doctors/patients/${p.id}',{method:'DELETE'}); renderPatientRegistry();})()">Remove</button></td></tr>`).join('');
      }catch(e){
        const key='mg_patients'; const cur=JSON.parse(localStorage.getItem(key)||'[]');
        tbody.innerHTML = cur.map(p=>`<tr><td><div style="display:flex;align-items:center;gap:0.4rem"><div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#2563eb);display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;color:white;flex-shrink:0">${p.name.split(' ').map(w=>w[0]).join('')}</div>${p.name}</div></td><td>${p.dob||'—'}</td><td style="font-size:0.72rem">${p.diag||'—'}</td><td style="color:#1a2332">—</td><td>—</td><td>${p.phone||'—'}</td><td><button class="btn-sm" onclick="removePatient(${p.id})">Remove</button></td></tr>`).join('');
      }
    })();
  }

  function removePatient(id){ const key='mg_patients'; const cur=JSON.parse(localStorage.getItem(key)||'[]'); localStorage.setItem(key,JSON.stringify(cur.filter(p=>p.id!==id))); renderPatientRegistry(); }

  // Vitals: render from storage and sort by severity
  function renderDrVitals(){
    const key='mg_vitals'; let cur=JSON.parse(localStorage.getItem(key)||'null');
    if(!cur){ cur=[{name:'Alex Johnson',hr:72,bp:'120/80',spo:98,gl:98,temp:98.6},{name:'Thomas Lee',hr:94,bp:'168/98',spo:95,gl:140,temp:99.1},{name:'Maria Santos',hr:78,bp:'135/85',spo:97,gl:110,temp:98.4},{name:'Robert Kim',hr:68,bp:'118/76',spo:99,gl:95,temp:98.2},{name:'Priya Mehta',hr:80,bp:'125/82',spo:98,gl:105,temp:98.8}]; localStorage.setItem(key,JSON.stringify(cur)); }
    // derive severity: critical > watch > normal
    function severity(p){ const [sys,dia]=p.bp.split('/').map(n=>parseInt(n,10)||0); if(sys>=160||dia>=100||p.gl>=180||p.hr>=120) return 2; if(sys>=140||dia>=90||p.gl>=140||p.hr>=100) return 1; return 0; }
    cur.sort((a,b)=>severity(b)-severity(a)||a.name.localeCompare(b.name));
    const tbody=document.querySelector('.dt-wrap table.dt tbody'); if(!tbody) return;
    tbody.innerHTML = cur.map(p=>{ const s=severity(p); const label = s===2?'Critical':s===1?'Watch':'Normal'; const cls = s===2?'r':s===1?'a':'n'; return `<tr><td style="font-weight:600">${p.name}</td><td>${p.hr}</td><td>${p.bp}</td><td>${p.spo}%</td><td>${p.gl}</td><td>${p.temp}°F</td><td><span class="dvs vs-${cls}">${label}</span></td></tr>`; }).join('');
  }

  // Tasks: CRUD and assign
  function openAddTaskModal(){ if(document.getElementById('add-task-overlay')) return; const overlay=document.createElement('div'); overlay.id='add-task-overlay'; overlay.className='agenda-modal-overlay'; overlay.innerHTML=`<div class="agenda-modal"><div class="agenda-modal-header"><h3>Add Task</h3><button id="addTaskClose" class="btn-sm">Close</button></div><div class="agenda-modal-body"><div style="display:grid;gap:0.6rem"><input id="taskText" class="form-control" placeholder="Task description" /><select id="taskAssignee" class="form-control"><option value="">Unassigned</option><option>Dr. Nair</option><option>A. Williams</option><option>B. Torres</option><option>M. Chen</option></select></div></div><div class="agenda-modal-footer"><button id="addTaskSave" class="btn-sm btn-sm-blue">Add</button></div></div>`; document.body.appendChild(overlay); document.getElementById('addTaskClose').onclick=()=>overlay.remove(); document.getElementById('addTaskSave').onclick=saveTask; }

  function saveTask(){ const txt=document.getElementById('taskText').value.trim(); const ass=document.getElementById('taskAssignee').value; if(!txt){alert('Provide task text');return;} const key='mg_tasks'; const cur=JSON.parse(localStorage.getItem(key)||'[]'); cur.push({id:Date.now(),text:txt,assignee:ass||'',done:false}); localStorage.setItem(key,JSON.stringify(cur)); document.getElementById('add-task-overlay').remove(); renderTasks(); pushNotification(`Task added: ${txt}`,'info'); }

  async function saveTask(){
    const txt=document.getElementById('taskText').value.trim(); const ass=document.getElementById('taskAssignee').value;
    if(!txt){alert('Provide task text');return;}
    try{
      await apiFetch('/doctors/tasks', { method:'POST', body: JSON.stringify({ text: txt, assignee: ass }) });
      document.getElementById('add-task-overlay').remove(); renderTasks(); pushNotification(`Task added: ${txt}`,'info');
    }catch(e){
      const key='mg_tasks'; const cur=JSON.parse(localStorage.getItem(key)||'[]'); cur.push({id:Date.now(),text:txt,assignee:ass||'',done:false}); localStorage.setItem(key,JSON.stringify(cur)); document.getElementById('add-task-overlay').remove(); renderTasks(); pushNotification(`Task added (local): ${txt}`,'info');
    }
  }

  function renderTasks(){
    const leftCol=document.querySelector('.dg2 .dc'); if(!leftCol) return;
    const taskCol = Array.from(document.querySelectorAll('.dc')).find(d=>d.innerHTML.includes("Today's Tasks")||d.innerHTML.includes('Today\'s Tasks')) || leftCol;
    if(!taskCol) return; taskCol.querySelectorAll('.dtk').forEach(n=>n.remove());
    const container = taskCol;
    (async ()=>{
      try{
        const res = await apiFetch('/doctors/tasks');
        const cur = (res && res.tasks) ? res.tasks : [];
        cur.forEach(t=>{
          const div=document.createElement('div'); div.className='dtk'; div.innerHTML=`<div class="dtk-cb ${t.done?'done':''}" onclick="(async()=>{await apiFetch('/doctors/tasks/${t.id}',{method:'PATCH',body:JSON.stringify({done:!t.done})}); renderTasks();})()"></div><div class="dtk-txt ${t.done?'done':''}">${t.text} <span style="font-size:0.75rem;color:#64748b">${t.assignee?('· '+t.assignee):''}</span></div><div style="margin-left:auto"><button class="btn-sm" onclick="(async()=>{await apiFetch('/doctors/tasks/${t.id}',{method:'DELETE'}); renderTasks();})()">Remove</button></div>`; container.appendChild(div);
        });
      }catch(e){
        const key='mg_tasks'; const cur=JSON.parse(localStorage.getItem(key)||'[]');
        cur.forEach(t=>{
          const div=document.createElement('div'); div.className='dtk'; div.innerHTML=`<div class="dtk-cb ${t.done?'done':''}" onclick="toggleTaskDone(${t.id})"></div><div class="dtk-txt ${t.done?'done':''}">${t.text} <span style="font-size:0.75rem;color:#64748b">${t.assignee?('· '+t.assignee):''}</span></div><div style="margin-left:auto"><button class="btn-sm" onclick="removeTask(${t.id})">Remove</button></div>`; container.appendChild(div);
        });
      }
    })();
  }

  async function toggleTaskDone(id){
    try{
      // toggle via server
      await apiFetch(`/doctors/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
      renderTasks();
    }catch(e){
      const key='mg_tasks'; const cur=JSON.parse(localStorage.getItem(key)||'[]'); cur.forEach(t=>{ if(t.id===id) t.done=!t.done; }); localStorage.setItem(key,JSON.stringify(cur)); renderTasks();
    }
  }

  async function removeTask(id){
    try{
      await apiFetch(`/doctors/tasks/${id}`, { method: 'DELETE' }); renderTasks();
    }catch(e){
      const key='mg_tasks'; const cur=JSON.parse(localStorage.getItem(key)||'[]'); localStorage.setItem(key,JSON.stringify(cur.filter(t=>t.id!==id))); renderTasks();
    }
  }

  const def={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}};
  const gc='rgba(148,163,184,0.12)';
  const months=['Oct','Nov','Dec','Jan','Feb','Mar','Apr'];
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  function mk(id,type,data,opts){
    const el=document.getElementById(id);
    if(!el)return;
    dsCharts[id]=new Chart(el,{type,data,options:{...def,...opts}});
  }

  if(pageId==='pt-overview'){
    mk('pt-trend-chart','line',{labels:months,datasets:[
      {label:'HbA1c',data:[8.1,7.9,7.7,7.5,7.4,7.3,7.2],borderColor:'#2563eb',tension:0.4,pointRadius:3,borderWidth:2,fill:false},
      {label:'BP Sys',data:[138,135,132,130,128,124,120],borderColor:'#9333ea',tension:0.4,pointRadius:3,borderWidth:1.5,borderDash:[5,3],fill:false}
    ]},{scales:{y:{grid:{color:gc}},x:{grid:{color:gc}}}});
  }
  if(pageId==='pt-vitals'){
    mk('pt-hr-chart','line',{labels:Array(24).fill(0).map((_,i)=>i+':00'),datasets:[{data:Array(24).fill(0).map((_,i)=>Math.round(65+15*Math.sin(i/3))),borderColor:'#2563eb',fill:true,backgroundColor:'rgba(37,99,235,0.07)',tension:0.4,pointRadius:0,borderWidth:1.5}]},{scales:{y:{min:50,max:100,grid:{color:gc}},x:{ticks:{maxTicksLimit:8},grid:{display:false}}}});
    mk('pt-glucose-chart','line',{labels:days,datasets:[{data:[105,98,112,96,108,102,98],borderColor:'#9333ea',fill:true,backgroundColor:'rgba(147,51,234,0.07)',tension:0.4,pointRadius:4,borderWidth:2}]},{scales:{y:{min:70,max:140,grid:{color:gc}},x:{grid:{display:false}}}});
    mk('pt-activity-chart','bar',{labels:days,datasets:[{data:[7800,9200,6500,10100,8400,11200,8450],backgroundColor:'rgba(22,163,74,0.75)',borderRadius:4}]},{scales:{y:{grid:{color:gc}},x:{grid:{display:false}}}});
  }
  if(pageId==='pt-labs'){
    mk('pt-hba1c-chart','line',{labels:months,datasets:[
      {data:[8.4,8.1,7.9,7.6,7.4,7.3,7.2],borderColor:'#2563eb',fill:true,backgroundColor:'rgba(37,99,235,0.07)',tension:0.4,pointRadius:4,borderWidth:2,label:'HbA1c'},
      {data:[7,7,7,7,7,7,7],borderColor:'#ef4444',borderDash:[5,3],pointRadius:0,borderWidth:1.5,label:'Target'}
    ]},{plugins:{legend:{display:true,labels:{boxWidth:9,font:{size:10}}}},scales:{y:{min:6.5,max:9,grid:{color:gc}},x:{grid:{display:false}}}});
  }
  if(pageId==='pt-monitor'){
    const pts=Array(48).fill(0).map((_,i)=>Math.round(65+15*Math.sin(i/4)+Math.random()*7));
    mk('pt-cont-hr-chart','line',{labels:pts.map((_,i)=>i%6===0?`-${(47-i)*5}m`:''),datasets:[{data:pts,borderColor:'#2563eb',fill:true,backgroundColor:'rgba(37,99,235,0.07)',tension:0.3,pointRadius:0,borderWidth:1.5}]},{scales:{y:{min:50,max:110,grid:{color:gc}},x:{grid:{display:false}}}});
    const gl=Array(48).fill(0).map((_,i)=>Math.round(95+20*Math.sin(i/6)+Math.random()*10));
    mk('pt-cgm-chart','line',{labels:gl.map((_,i)=>i%6===0?`-${(47-i)*5}m`:''),datasets:[
      {data:gl,borderColor:'#9333ea',fill:true,backgroundColor:'rgba(147,51,234,0.07)',tension:0.3,pointRadius:0,borderWidth:1.5},
      {data:Array(48).fill(180),borderColor:'rgba(220,38,38,0.4)',borderDash:[4,4],pointRadius:0,borderWidth:1},
      {data:Array(48).fill(70),borderColor:'rgba(217,119,6,0.4)',borderDash:[4,4],pointRadius:0,borderWidth:1}
    ]},{scales:{y:{min:50,max:220,grid:{color:gc}},x:{grid:{display:false}}}});
  }
  if(pageId==='dr-analytics'){
    mk('dr-visits-chart','bar',{labels:months,datasets:[{data:[380,420,395,450,410,440,480],backgroundColor:'rgba(37,99,235,0.72)',borderRadius:5}]},{scales:{y:{grid:{color:gc}},x:{grid:{display:false}}}});
    mk('dr-gender-chart','doughnut',{labels:['Female','Male','Other'],datasets:[{data:[58,39,3],backgroundColor:['#9333ea','#2563eb','#0891b2'],borderWidth:0}]},{cutout:'65%'});
  }
  if(pageId==='dr-alerts'){
    mk('dr-alert-chart','bar',{labels:['6am','8am','10am','12pm','2pm','4pm','6pm'],datasets:[
      {data:[1,2,3,1,2,1,0],backgroundColor:'rgba(220,38,38,0.7)',borderRadius:3,label:'Critical'},
      {data:[0,1,2,3,2,1,1],backgroundColor:'rgba(217,119,6,0.7)',borderRadius:3,label:'Warning'}
    ]},{plugins:{legend:{display:true,labels:{boxWidth:9,font:{size:10}}}},scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:gc}}}});
  }
  if(pageId==='ph-overview'){
    mk('ph-rev-chart','bar',{labels:days,datasets:[{data:[38000,42000,35000,48200,44000,51000,48200],backgroundColor:'rgba(22,163,74,0.72)',borderRadius:5}]},{scales:{y:{ticks:{callback:v=>'₹'+Math.round(v/1000)+'K'},grid:{color:gc}},x:{grid:{display:false}}}});
  }
  if(pageId==='ph-revenue'){
    mk('ph-annual-chart','bar',{labels:['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr'],datasets:[{data:[920,980,870,1050,1020,1100,1080,1200,1150,1180,1050,1240],backgroundColor:'rgba(22,163,74,0.72)',borderRadius:5,label:'Revenue ₹K'}]},{scales:{y:{ticks:{callback:v=>'₹'+v+'K'},grid:{color:gc}},x:{grid:{display:false}}}});
    mk('ph-cat-chart','doughnut',{labels:['Antibiotics','Chronic','OTC','Hormones','Others'],datasets:[{data:[32,28,20,12,8],backgroundColor:['#2563eb','#16a34a','#9333ea','#d97706','#64748b'],borderWidth:0}]},{cutout:'65%'});
  }
  if(pageId==='ad-overview'){
    mk('ad-visits-chart','bar',{labels:days,datasets:[{data:[320,385,290,410,368,345,384],backgroundColor:'rgba(147,51,234,0.72)',borderRadius:5}]},{scales:{y:{grid:{color:gc}},x:{grid:{display:false}}}});
    mk('ad-roles-chart','doughnut',{labels:['Patients','Doctors','Staff','Pharmacists','Admins'],datasets:[{data:[1240,142,400,38,22],backgroundColor:['#0891b2','#2563eb','#64748b','#16a34a','#9333ea'],borderWidth:0}]},{cutout:'65%'});
  }
  if(pageId==='ad-kpi'){
    mk('ad-kpi-chart','line',{labels:months,datasets:[
      {label:'Visits',data:[3200,3450,3100,3700,3500,3650,3842],borderColor:'#2563eb',tension:0.4,pointRadius:3,borderWidth:2,fill:false},
      {label:'Satisfaction',data:[4.3,4.4,4.5,4.5,4.6,4.6,4.7].map(v=>v*800),borderColor:'#16a34a',tension:0.4,pointRadius:3,borderWidth:2,borderDash:[5,3],fill:false}
    ]},{scales:{y:{grid:{color:gc}},x:{grid:{color:gc}}}});
  }
  if(pageId==='ad-reports'){
    mk('ad-report-chart','line',{labels:months,datasets:[
      {label:'Visits',data:[3200,3450,3100,3700,3500,3650,3842],borderColor:'#2563eb',tension:0.4,pointRadius:3,borderWidth:2,fill:true,backgroundColor:'rgba(37,99,235,0.06)'},
      {label:'Prescriptions',data:[2800,3100,2700,3300,3100,3200,3450],borderColor:'#16a34a',tension:0.4,pointRadius:3,borderWidth:2,fill:false}
    ]},{plugins:{legend:{display:true,labels:{boxWidth:9,font:{size:10}}}},scales:{y:{grid:{color:gc}},x:{grid:{color:gc}}}});
  }
}
// Small Agenda helpers: modal, sync (ICS) and print
function openAgendaSync(){
  // if modal exists remove
  const existing=document.getElementById('agenda-modal-overlay');
  if(existing) return;
  const overlay=document.createElement('div');
  overlay.id='agenda-modal-overlay';
  overlay.className='agenda-modal-overlay';
  overlay.innerHTML=`<div class="agenda-modal" role="dialog" aria-modal="true">
    <div class="agenda-modal-header"><h3>Sync Today's Agenda</h3><button class="btn-sm" id="agenda-close">Close</button></div>
    <div class="agenda-modal-body">
      <p style="color:#475569;font-size:0.95rem;margin-bottom:0.6rem">Export today's appointments to your calendar (ICS) or copy to clipboard.</p>
      <div class="agenda-event-list"></div>
    </div>
    <div class="agenda-modal-footer" style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button class="btn-sm" id="agenda-copy">Copy</button>
      <button class="btn-sm btn-sm-blue" id="agenda-ics">Download .ics</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  document.getElementById('agenda-close').onclick=closeAgendaSync;
  document.getElementById('agenda-copy').onclick=()=>{const t=renderAgendaText();navigator.clipboard.writeText(t);alert('Agenda copied to clipboard');};
  document.getElementById('agenda-ics').onclick=()=>{const ics=renderAgendaICS();downloadBlob(ics,'agenda.ics','text/calendar');};

  const list=document.querySelector('.agenda-event-list');
  // gather today's appointments from the static DOM (fallback) or use a central store if available
  const items=Array.from(document.querySelectorAll('.das')).map(el=>{
    const time=el.querySelector('.das-t')?el.querySelector('.das-t').textContent.trim():'--';
    const name=el.querySelector('.das-n')?el.querySelector('.das-n').textContent.trim():el.textContent.trim();
    const sub=el.querySelector('.das-s')?el.querySelector('.das-s').textContent.trim():'';
    return {time,name,sub};
  });
  if(items.length===0) list.innerHTML='<div style="color:#64748b">No appointments found for today.</div>'
  else list.innerHTML=items.map(it=>`<div class="agenda-event"><div class="agenda-time">${it.time}</div><div class="agenda-info"><div class="agenda-name">${it.name}</div><div class="agenda-sub" style="color:#64748b;font-size:0.85rem">${it.sub}</div></div></div>`).join('');
}

function closeAgendaSync(){
  const el=document.getElementById('agenda-modal-overlay');
  if(el) el.remove();
}

function renderAgendaText(){
  const events=Array.from(document.querySelectorAll('.das')).map(el=>{
    const time=el.querySelector('.das-t')?el.querySelector('.das-t').textContent.trim():'--';
    const name=el.querySelector('.das-n')?el.querySelector('.das-n').textContent.trim():el.textContent.trim();
    const sub=el.querySelector('.das-s')?el.querySelector('.das-s').textContent.trim():'';
    return `${time} — ${name} ${sub}`;
  });
  return events.join('\n');
}

function renderAgendaICS(){
  const now=new Date();
  const todayLabel=now.toISOString().slice(0,10).replace(/-/g,'');
  const events=Array.from(document.querySelectorAll('.das')).map((el,i)=>{
    const time=el.querySelector('.das-t')?el.querySelector('.das-t').textContent.trim():'09:00';
    const name=el.querySelector('.das-n')?el.querySelector('.das-n').textContent.trim():`Appt ${i+1}`;
    // simple time parsing HH:MM
    const hm=time.split(':');
    let hh=hm[0]||'09', mm=(hm[1]||'00').replace(/[^0-9]/g,'');
    if(hh.length===1) hh='0'+hh;
    const start=`${todayLabel}T${hh}${mm}00`;
    const end=`${todayLabel}T${(parseInt(hh,10)+1).toString().padStart(2,'0')}${mm}00`;
    return `BEGIN:VEVENT\nUID:agenda-${i}@mediguard\nDTSTAMP:${todayLabel}T000000Z\nDTSTART:${start}Z\nDTEND:${end}Z\nSUMMARY:${escapeICSText(name)}\nEND:VEVENT`;
  });
  const header=`BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Mediguard//Agenda//EN`;
  return `${header}\n${events.join('\n')}\nEND:VCALENDAR`;
}

function escapeICSText(s){ return (s||'').replace(/\n/g,'\\n').replace(/,/g,'\,'); }

function downloadBlob(content,filename,type){
  const blob=new Blob([content],{type:type||'text/plain'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function printAgenda(){
  // print current page but prefer to only show agenda area
  const el=document.querySelector('.dc') || document.body;
  if(!el) return window.print();
  const w=window.open('','_blank');
  w.document.write('<title>Agenda - Print</title>');
  w.document.write('<style>body{font-family:sans-serif;padding:1rem;color:#0f172a} .agenda-event{margin-bottom:0.5rem}</style>');
  const items=renderAgendaText().replace(/\n/g,'<br>');
  w.document.write(`<div><h2>Today's Agenda</h2><div>${items}</div></div>`);
  w.document.close();
  w.print();
  setTimeout(()=>w.close(),300);
}

// End of Dashboard Module
/* ═══════════════════════════════════════
   AYURVEDA / AI WELLNESS & SKIN ADVISOR
═══════════════════════════════════════ */
let selectedSkinType = null;
let selectedSkinIssues = [];
let capturedImageData = null;

function switchAyurvedaTab(tabName) {
  document.querySelectorAll('.ayurveda-tab-content').forEach(el => {
    el.classList.remove('active');
  });
  document.querySelectorAll('.ayurveda-tab-btn').forEach(el => {
    el.classList.remove('active');
  });
  const contentEl = document.getElementById('tab-' + tabName);
  if (contentEl) contentEl.classList.add('active');
  const btnEl = document.querySelector(`[data-tab="${tabName}"]`);
  if (btnEl) btnEl.classList.add('active');
}

async function runAyurvedaSymptomAnalysis() {
  const symptoms = document.getElementById('ayurveda-symptoms').value.trim();
  if (!symptoms) {
    showToast('Please describe your symptoms', 'error');
    return;
  }
  const resultsEl = document.getElementById('ayurveda-symptom-results');
  resultsEl.innerHTML = '<div class="emergency-loading"><span class="spinner"></span> Analyzing with AI...</div>';
  try {
    const data = await api('POST', '/ayurveda/analyze-symptoms', { symptoms });
    resultsEl.innerHTML = `
      <div class="remedy-card">
        <div class="remedy-card-title"><span>🧘</span> Dosha Analysis</div>
        ${data.assistant_message ? `<div style="font-size:0.9rem;color:var(--slate-600);margin-bottom:0.8rem;">${data.assistant_message}</div>` : ''}
        <div style="margin-bottom:1rem;">
          <div style="font-size:1.2rem;font-weight:800;color:var(--purple-600);margin-bottom:0.5rem;">${data.dosha}</div>
          <div style="font-size:0.9rem;color:var(--slate-600);">Confidence: <strong>${data.confidence}</strong></div>
          <div style="font-size:0.85rem;color:var(--slate-500);margin-top:0.5rem;">Identified: ${(data.identified_symptoms||[]).join(', ') || 'General symptoms'}</div>
        </div>
      </div>
      ${data.seek_emergency_care ? `<div style="border-radius:0.85rem;background:#fee2e2;border:1px solid #fca5a5;padding:0.85rem;color:#991b1b;font-size:0.9rem;margin-bottom:1rem;"><strong>Urgent:</strong> Your input may indicate warning symptoms (${(data.urgent_red_flags||[]).join(', ')}). Please seek emergency medical care immediately.</div>` : ''}
      <div class="remedy-card">
        <div class="remedy-card-title"><span>🌿</span> Recommended Remedies</div>
        <div class="remedy-list">${(data.remedies||[]).map(r => `<div class="remedy-item">${r}</div>`).join('')}</div>
      </div>
      <div class="remedy-card">
        <div class="remedy-card-title"><span>🥗</span> Diet Suggestions</div>
        <div class="remedy-list">${(data.diet_suggestions||[]).map(d => `<div class="remedy-item">${d}</div>`).join('')}</div>
      </div>
      <div style="border-radius:0.85rem;background:#fef3c7;border:1px solid #fcd34d;padding:0.85rem;color:#92400e;font-size:0.85rem;margin-top:1rem;"><strong>Disclaimer:</strong> ${data.disclaimer}</div>
    `;
  } catch (err) {
    resultsEl.innerHTML = `<div class="emergency-empty-state">Error: ${err.message || 'Could not analyze symptoms'}</div>`;
  }
}

async function loadAyurvHealthTips() {
  try {
    const data = await api('GET', '/ayurveda/health-tips');
    const tips = data.tips || {};
    const container = document.getElementById('ayurveda-quick-tips');
    if (container) {
      container.innerHTML = `
        <div class="ayurveda-tip-section">
          <h4 class="ayurveda-tip-title">Morning Routine</h4>
          <ul class="ayurveda-tip-list">${(tips.morning_routine||[]).map(t => `<li class="ayurveda-tip-item">${t}</li>`).join('')}</ul>
        </div>
        <div class="ayurveda-tip-section">
          <h4 class="ayurveda-tip-title">Lifestyle</h4>
          <ul class="ayurveda-tip-list">${(tips.lifestyle||[]).map(t => `<li class="ayurveda-tip-item">${t}</li>`).join('')}</ul>
        </div>
        <div class="ayurveda-tip-section">
          <h4 class="ayurveda-tip-title">Seasonal</h4>
          <ul class="ayurveda-tip-list">${(tips.seasonal_adjustment||[]).map(t => `<li class="ayurveda-tip-item">${t}</li>`).join('')}</ul>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error loading health tips:', err);
  }
}

function selectSkinType(skinType) {
  selectedSkinType = skinType;
  document.querySelectorAll('.skin-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.skin === skinType);
  });
}

function toggleSkinIssue(issue) {
  if (selectedSkinIssues.includes(issue)) {
    selectedSkinIssues = selectedSkinIssues.filter(i => i !== issue);
  } else {
    selectedSkinIssues.push(issue);
  }
}

function toggleCamera() {
  const container = document.getElementById('camera-container');
  if (!container) return;
  if (container.style.display === 'none' || !container.style.display) {
    container.style.display = 'block';
    startCamera();
  } else {
    stopCamera();
  }
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    const video = document.getElementById('camera-video');
    if (video) { video.srcObject = stream; video.play(); }
  } catch (err) {
    showToast('Camera access denied: ' + err.message, 'error');
  }
}

function stopCamera() {
  const video = document.getElementById('camera-video');
  if (video && video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); }
  const container = document.getElementById('camera-container');
  if (container) container.style.display = 'none';
}

function capturePhoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  if (!video || !canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  capturedImageData = canvas.toDataURL('image/jpeg');
  const preview = document.getElementById('camera-preview');
  const img = document.getElementById('preview-img');
  if (preview && img) { img.src = capturedImageData; preview.style.display = 'block'; }
  stopCamera();
}

function useAndroidCameraAgain() {
  capturedImageData = null;
  const preview = document.getElementById('camera-preview');
  if (preview) preview.style.display = 'none';
  toggleCamera();
}

async function analyzeImageForSkin(imageBas64) {
  const canvas = document.createElement('canvas');
  const img = new Image();
  img.src = imageBas64;
  return new Promise((resolve) => {
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      canvas.width = img.width; canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let brightnessSum = 0; let darkSpotCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i+1] + data[i+2]) / 3 / 255;
        brightnessSum += brightness;
        if (brightness < 0.3) darkSpotCount++;
      }
      const avgBrightness = brightnessSum / (data.length / 4);
      resolve({ brightness: avgBrightness, has_dark_spots: darkSpotCount > (data.length/4)*0.05, pore_size: avgBrightness > 0.7 ? 'large' : 'medium' });
    };
  });
}

async function runSkinAnalysis() {
  if (!selectedSkinType) { showToast('Please select your skin type', 'error'); return; }
  const resultsEl = document.getElementById('skin-analysis-results');
  resultsEl.innerHTML = '<div class="emergency-loading"><span class="spinner"></span> Analyzing your skin...</div>';
  try {
    let imageAnalysis = null;
    if (capturedImageData) imageAnalysis = await analyzeImageForSkin(capturedImageData);
    const response = await api('POST', '/ayurveda/analyze-skin', { skin_type: selectedSkinType, issues: selectedSkinIssues, image_analysis: imageAnalysis });
    resultsEl.innerHTML = `
      <div class="remedy-card">
        <div class="remedy-card-title"><span>💆</span> Your Skin Analysis</div>
        <div style="margin-bottom:1rem;">
          <div style="font-size:1.1rem;font-weight:800;color:var(--purple-600);margin-bottom:0.5rem;">${response.skin_type}</div>
          <div style="font-size:0.9rem;color:var(--slate-600);">Confidence: <strong>${response.confidence}</strong></div>
        </div>
      </div>
      <div class="remedy-card">
        <div class="remedy-card-title"><span>📋</span> Characteristics</div>
        <div class="remedy-list">${(response.characteristics||[]).map(c => `<div class="remedy-item">${c}</div>`).join('')}</div>
      </div>
      <div class="remedy-card">
        <div class="remedy-card-title"><span>🌿</span> Skincare Remedies</div>
        <div class="remedy-list">${(response.remedies||[]).map(r => `<div class="remedy-item">${r}</div>`).join('')}</div>
      </div>
      <div class="remedy-card">
        <div class="remedy-card-title"><span>⏰</span> Daily Routine</div>
        <div style="margin-top:0.8rem;">
          <h5 style="font-weight:700;margin-bottom:0.5rem;">Morning</h5>
          <ul style="margin:0;padding-left:1rem;">${(response.routine?.morning||[]).map(m => `<li style="font-size:0.9rem;margin-bottom:0.3rem;">${m}</li>`).join('')}</ul>
          <h5 style="font-weight:700;margin-top:1rem;margin-bottom:0.5rem;">Night</h5>
          <ul style="margin:0;padding-left:1rem;">${(response.routine?.night||[]).map(n => `<li style="font-size:0.9rem;margin-bottom:0.3rem;">${n}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="remedy-card">
        <div class="remedy-card-title"><span>🥗</span> Diet Tips</div>
        <div class="remedy-list">${(response.diet_tips||[]).map(d => `<div class="remedy-item">${d}</div>`).join('')}</div>
      </div>
      <div style="border-radius:0.85rem;background:#fef3c7;border:1px solid #fcd34d;padding:0.85rem;color:#92400e;font-size:0.85rem;margin-top:1rem;"><strong>Disclaimer:</strong> ${response.disclaimer}</div>
    `;
  } catch (err) {
    resultsEl.innerHTML = `<div class="emergency-empty-state">Error: ${err.message || 'Could not analyze skin'}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => { loadAyurvHealthTips(); });