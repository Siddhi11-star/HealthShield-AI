'use strict';

/* ═══════════════════════════════════════════════════════════
   EMERGENCY QUICK ACCESS PANEL
   Public, no-login emergency helper drawer available on every page.
═══════════════════════════════════════════════════════════ */

const EMERGENCY_FIRST_AID_FALLBACK = [
  {
    key: 'burns',
    title: 'Burns',
    tips: [
      'Cool the burn under running water for 20 minutes.',
      'Do not apply ice, butter, toothpaste, or oils.',
      'Cover with a clean non-stick dressing.'
    ]
  },
  {
    key: 'heart attack',
    title: 'Heart Attack',
    tips: [
      'Call emergency services immediately.',
      'Keep the person seated and calm.',
      'Start CPR if the person becomes unresponsive.'
    ]
  },
  {
    key: 'fainting',
    title: 'Fainting',
    tips: [
      'Lay the person flat and raise the legs if safe.',
      'Loosen tight clothing and improve airflow.',
      'Do not give food or drink until fully awake.'
    ]
  },
  {
    key: 'poisoning',
    title: 'Poisoning',
    tips: [
      'Call poison control or emergency services immediately.',
      'Do not induce vomiting unless instructed.',
      'Bring the container or label to the hospital.'
    ]
  }
];

let emergencyQuickPanelOpen = false;
let emergencyFirstAidLoading = false;
let emergencyNearestHospital = null;
let emergencyDispatchOverrideCoords = null;
let emergencySosCaseId = null;
let emergencySosMap = null;
let emergencySosTrackTimer = null;
let emergencySosArrivedStreak = 0;
let emergencySosVisualAmbulance = null;
const emergencySosMarkers = { patient: null, ambulance: null };
let emergencySosRouteLine = null;

function ensureEmergencyQuickAccessPanel() {
  if (document.getElementById('emergencyQuickAccessPanel')) return;

  const markup = `
    <button id="emergencyQuickTab" class="emergency-quick-tab" type="button" aria-controls="emergencyQuickAccessPanel" aria-expanded="false" aria-label="Open emergency quick access" onclick="toggleEmergencyQuickAccess()">
      <span>EMERGENCY</span>
    </button>
    <div id="emergencyQuickOverlay" class="emergency-quick-overlay" hidden onclick="closeEmergencyQuickAccess()"></div>
    <aside id="emergencyQuickAccessPanel" class="emergency-quick-panel" aria-hidden="true" aria-label="Emergency quick access panel">
      <div class="emergency-quick-shell">
        <div class="emergency-quick-header">
          <div>
            <div class="emergency-quick-kicker">Emergency Quick Access</div>
            <h2>Fast help without login</h2>
          </div>
          <button type="button" class="emergency-quick-close" aria-label="Close emergency panel" onclick="closeEmergencyQuickAccess()">&times;</button>
        </div>

        <div class="emergency-quick-note">Critical tools only. Login for full features at the bottom.</div>

        <section class="emergency-card">
          <div class="emergency-card-head">
            <div>
              <h3>SOS Ambulance Dispatch</h3>
              <p>Trigger SOS and auto-assign the nearest ambulance, same as SEAS.</p>
            </div>
          </div>
          <div class="emergency-form-grid emergency-form-grid--single">
            <input id="eqaHelpLocation" class="emergency-input" type="text" placeholder="Enter city, area, or landmark" />
          </div>
          <div class="emergency-inline-actions">
            <button type="button" class="emergency-ghost-btn" onclick="fillEmergencyCurrentLocation()">Use Current Location</button>
          </div>
          <button type="button" class="emergency-primary-btn" onclick="runEmergencySosDispatch()">Trigger SOS Ambulance</button>
          <div id="eqaNearbyResults" class="emergency-results"></div>
        </section>

        <section class="emergency-card">
          <div class="emergency-card-head">
            <div>
              <h3>AI Safety Check</h3>
              <p>Quick risk scan for symptoms or medicine combinations.</p>
            </div>
          </div>
          <textarea id="eqaAiInput" class="emergency-textarea" rows="3" placeholder="Example: chest pain, fainting, aspirin + ibuprofen"></textarea>
          <button type="button" class="emergency-primary-btn" onclick="runEmergencyAiCheck()">Check Risk</button>
          <div id="eqaAiResults" class="emergency-results"></div>
        </section>

        <section class="emergency-card">
          <div class="emergency-card-head">
            <div>
              <h3>Emergency Contacts</h3>
              <p>One tap calling for urgent help.</p>
            </div>
          </div>
          <div id="eqaContactsResults" class="emergency-contact-grid"></div>
          <button id="eqaNearestHospitalBtn" type="button" class="emergency-secondary-btn" disabled>Find nearest hospital first</button>
        </section>

        <section class="emergency-card emergency-card--last">
          <div class="emergency-card-head">
            <div>
              <h3>First Aid Guide</h3>
              <p>Static emergency tips for the most common situations.</p>
            </div>
          </div>
          <div id="eqaFirstAidResults" class="emergency-first-aid-grid"></div>
        </section>

        <div class="emergency-quick-footer">
          <button type="button" class="emergency-login-cta" onclick="openModal('loginModal')">Login for full features</button>
        </div>
      </div>
    </aside>
  `;

  document.body.insertAdjacentHTML('beforeend', markup);
  document.addEventListener('keydown', emergencyQuickAccessKeyHandler);
  renderEmergencyContacts();
  renderEmergencyFirstAidFallback();
  if (window.lucide) lucide.createIcons();
}

function emergencyQuickAccessKeyHandler(event) {
  if ((event.ctrlKey || event.metaKey) && (event.key === 'e' || event.key === 'E')) {
    const targetTag = (event.target && event.target.tagName) ? event.target.tagName.toLowerCase() : '';
    const isTypingTarget = targetTag === 'input' || targetTag === 'textarea' || (event.target && event.target.isContentEditable);
    if (!isTypingTarget) {
      event.preventDefault();
      toggleEmergencyQuickAccess();
      return;
    }
  }

  if (event.key === 'Escape' && emergencyQuickPanelOpen) {
    closeEmergencyQuickAccess();
  }
}

function toggleEmergencyQuickAccess(forceOpen) {
  const nextState = typeof forceOpen === 'boolean' ? forceOpen : !emergencyQuickPanelOpen;
  emergencyQuickPanelOpen = nextState;

  const panel = document.getElementById('emergencyQuickAccessPanel');
  const overlay = document.getElementById('emergencyQuickOverlay');
  const tab = document.getElementById('emergencyQuickTab');
  if (panel) {
    panel.classList.toggle('is-open', nextState);
    panel.setAttribute('aria-hidden', String(!nextState));
  }
  if (overlay) overlay.hidden = !nextState;
  if (tab) tab.setAttribute('aria-expanded', String(nextState));

  if (nextState) {
    loadEmergencyContacts();
    loadEmergencyFirstAid();
    if (window.lucide) lucide.createIcons();
    fillEmergencyCurrentLocation();
    setTimeout(() => {
      const input = document.getElementById('eqaHelpLocation');
      if (input) input.focus();
    }, 50);
  }
}

function openEmergencyQuickAccess() {
  toggleEmergencyQuickAccess(true);
}

function closeEmergencyQuickAccess() {
  toggleEmergencyQuickAccess(false);
  if (emergencySosTrackTimer) {
    clearInterval(emergencySosTrackTimer);
    emergencySosTrackTimer = null;
  }
}

function emergencySosMapIcon(color, label) {
  const glyph = label === 'A'
    ? '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 14v4h2a2 2 0 0 0 4 0h6a2 2 0 0 0 4 0h2v-5a2 2 0 0 0-2-2h-1.3l-1.5-3A2 2 0 0 0 14.4 7H8a2 2 0 0 0-2 2v2H5a2 2 0 0 0-2 2Zm5-5h6.4l1 2H8V9Zm2 8a1 1 0 1 1-2 0a1 1 0 0 1 2 0Zm8 0a1 1 0 1 1-2 0a1 1 0 0 1 2 0ZM9 5h2V3h2v2h2v2h-2v2h-2V7H9V5Z"/></svg>'
    : label;

  return window.L.divIcon({
    className: 'eqa-map-pin',
    html: '<div style="width:22px;height:22px;border-radius:999px;background:' + color + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,0.35);">' + glyph + '</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function ensureEmergencySosMap(center) {
  if (!window.L) return null;
  const mapDiv = document.getElementById('eqaSosMap');
  if (!mapDiv) return null;

  const target = center || [18.5204, 73.8567];
  if (!emergencySosMap) {
    emergencySosMap = L.map(mapDiv, {
      zoomControl: true,
      attributionControl: true,
    }).setView(target, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(emergencySosMap);
  } else {
    emergencySosMap.setView(target, Math.max(12, emergencySosMap.getZoom() || 12));
  }

  setTimeout(() => {
    if (emergencySosMap) emergencySosMap.invalidateSize();
  }, 120);

  return emergencySosMap;
}

function emergencySosUpsertMarker(key, lat, lng, color, label, popupText) {
  if (!window.L || !emergencySosMap || typeof lat !== 'number' || typeof lng !== 'number') return;
  const icon = emergencySosMapIcon(color, label);
  if (emergencySosMarkers[key]) {
    emergencySosMarkers[key].setLatLng([lat, lng]);
    emergencySosMarkers[key].setIcon(icon);
  } else {
    emergencySosMarkers[key] = L.marker([lat, lng], { icon }).addTo(emergencySosMap);
  }
  if (popupText) emergencySosMarkers[key].bindPopup(popupText);
}

function updateEmergencySosMap(trackData, coords) {
  if (!window.L) {
    const host = document.getElementById('eqaSosMapFallback');
    if (host) host.textContent = 'Map is unavailable on this device, but live ambulance tracking is active.';
    return;
  }

  const patient = trackData?.user_location || {
    latitude: coords?.latitude,
    longitude: coords?.longitude,
  };
  let ambulance = trackData?.ambulance_location || null;
  if (!patient?.latitude || !patient?.longitude) return;

  if (ambulance && trackData?.arrived) {
    const pLat = Number(patient.latitude);
    const pLng = Number(patient.longitude);
    if (!emergencySosVisualAmbulance) {
      emergencySosVisualAmbulance = {
        latitude: Number(ambulance.latitude),
        longitude: Number(ambulance.longitude),
      };
    }

    emergencySosVisualAmbulance.latitude += (pLat - emergencySosVisualAmbulance.latitude) * 0.42;
    emergencySosVisualAmbulance.longitude += (pLng - emergencySosVisualAmbulance.longitude) * 0.42;

    if (
      Math.abs(emergencySosVisualAmbulance.latitude - pLat) < 0.00005 &&
      Math.abs(emergencySosVisualAmbulance.longitude - pLng) < 0.00005
    ) {
      emergencySosVisualAmbulance = { latitude: pLat, longitude: pLng };
    }

    ambulance = emergencySosVisualAmbulance;
  } else if (ambulance) {
    emergencySosVisualAmbulance = {
      latitude: Number(ambulance.latitude),
      longitude: Number(ambulance.longitude),
    };
  }

  const map = ensureEmergencySosMap([Number(patient.latitude), Number(patient.longitude)]);
  if (!map) return;

  emergencySosUpsertMarker('patient', Number(patient.latitude), Number(patient.longitude), '#dc2626', 'P', 'Patient location');
  if (ambulance) {
    emergencySosUpsertMarker('ambulance', Number(ambulance.latitude), Number(ambulance.longitude), '#2563eb', 'A', 'Ambulance location');
  }

  if (emergencySosRouteLine) {
    emergencySosRouteLine.remove();
    emergencySosRouteLine = null;
  }

  if (ambulance) {
    emergencySosRouteLine = L.polyline([
      [Number(ambulance.latitude), Number(ambulance.longitude)],
      [Number(patient.latitude), Number(patient.longitude)],
    ], {
      color: '#2563eb',
      weight: 4,
      opacity: 0.85,
      dashArray: '8 8',
    }).addTo(map);

    map.fitBounds(emergencySosRouteLine.getBounds(), { padding: [24, 24] });
  }
}

function setEmergencyNearestHospital(place) {
  emergencyNearestHospital = place || null;
  const button = document.getElementById('eqaNearestHospitalBtn');
  if (!button) return;

  if (!place || !place.phone) {
    button.disabled = true;
    button.textContent = 'Find nearest hospital first';
    button.setAttribute('data-hospital-phone', '');
    button.setAttribute('data-hospital-name', '');
    button.onclick = null;
    return;
  }

  button.disabled = false;
  button.textContent = 'Call ' + (place.name || 'nearest hospital');
  button.setAttribute('data-hospital-phone', place.phone || '');
  button.setAttribute('data-hospital-name', place.name || 'Nearest hospital');
  button.onclick = () => {
    const phone = button.getAttribute('data-hospital-phone') || '';
    if (phone) window.location.href = 'tel:' + phone.replace(/[^0-9+]/g, '');
  };
}

function renderEmergencyContacts(nearestHospital) {
  const host = document.getElementById('eqaContactsResults');
  if (!host) return;

  const contacts = [
    { name: 'Ambulance', phone: '108', description: 'Immediate medical transport' },
    { name: 'Police', phone: '100', description: 'Law and rescue support' },
    { name: 'Fire', phone: '101', description: 'Fire and rescue support' },
  ];

  if (nearestHospital && nearestHospital.phone) {
    contacts.push({
      name: nearestHospital.name || 'Nearest Hospital',
      phone: nearestHospital.phone,
      description: 'Call the nearest medical facility',
    });
  }

  host.innerHTML = contacts.map(contact => {
    const phone = String(contact.phone || '').replace(/[^0-9+]/g, '');
    return `
      <a class="emergency-contact-card" href="tel:${phone || '108'}">
        <strong>${esc(contact.name)}</strong>
        <span>${esc(contact.description || '')}</span>
        <em>Call ${esc(contact.phone || '')}</em>
      </a>
    `;
  }).join('');
}

function renderEmergencyFirstAidFallback() {
  const host = document.getElementById('eqaFirstAidResults');
  if (!host) return;
  host.innerHTML = EMERGENCY_FIRST_AID_FALLBACK.map(guide => `
    <div class="emergency-first-aid-card">
      <strong>${esc(guide.title)}</strong>
      <ul>
        ${guide.tips.map(tip => `<li>${esc(tip)}</li>`).join('')}
      </ul>
    </div>
  `).join('');
}

async function loadEmergencyContacts() {
  try {
    const params = new URLSearchParams();
    if (emergencyNearestHospital?.name) params.set('hospital_name', emergencyNearestHospital.name);
    if (emergencyNearestHospital?.phone) params.set('hospital_phone', emergencyNearestHospital.phone);
    const data = await api('GET', '/emergency/contacts' + (params.toString() ? '?' + params.toString() : ''));
    const contacts = data.contacts || [];
    const nearest = contacts.find(item => item.priority === 4) || emergencyNearestHospital;
    renderEmergencyContacts(nearest);
    if (nearest && nearest.phone) setEmergencyNearestHospital(nearest);
  } catch (_err) {
    renderEmergencyContacts(emergencyNearestHospital);
  }
}

async function loadEmergencyFirstAid(topic = '') {
  if (emergencyFirstAidLoading) return;
  emergencyFirstAidLoading = true;
  try {
    const route = topic ? '/emergency/first-aid?topic=' + encodeURIComponent(topic) : '/emergency/first-aid';
    const data = await api('GET', route);
    const host = document.getElementById('eqaFirstAidResults');
    if (!host) return;

    if (data.guide) {
      host.innerHTML = `
        <div class="emergency-first-aid-card emergency-first-aid-card--highlight">
          <strong>${esc(data.guide.title || topic)}</strong>
          <ul>${(data.guide.tips || []).map(tip => `<li>${esc(tip)}</li>`).join('')}</ul>
        </div>
      `;
      return;
    }

    const topics = data.topics || EMERGENCY_FIRST_AID_FALLBACK;
    host.innerHTML = topics.map(guide => `
      <div class="emergency-first-aid-card">
        <strong>${esc(guide.title)}</strong>
        <ul>${(guide.tips || []).map(tip => `<li>${esc(tip)}</li>`).join('')}</ul>
      </div>
    `).join('');
  } catch (_err) {
    renderEmergencyFirstAidFallback();
  } finally {
    emergencyFirstAidLoading = false;
  }
}

function renderEmergencyMedicineResults(data) {
  const host = document.getElementById('eqaMedicineResults');
  if (!host) return;

  const availability = data.availability || [];
  const alternatives = data.alternatives || [];
  const medicine = data.medicine;

  if (!medicine && !availability.length) {
    host.innerHTML = '<div class="emergency-empty-state">No medicine results found. Try a different name.</div>';
    return;
  }

  host.innerHTML = `
    <div class="emergency-summary-line">
      <strong>${esc(medicine?.name || data.query)}</strong>
      <span>${availability.length} availability result(s)</span>
    </div>
    ${availability.length ? `<div class="emergency-stack">${availability.map(place => `
      <div class="emergency-result-card">
        <div class="emergency-result-top">
          <div>
            <strong>${esc(place.name)}</strong>
            <span>${esc(place.address || '')}</span>
          </div>
          <span class="emergency-badge emergency-badge--${place.stock_status || 'in_stock'}">${esc(place.stock_status || 'in_stock')}</span>
        </div>
        <div class="emergency-result-meta">
          <span>${place.quantity != null ? esc(String(place.quantity)) + ' units' : 'Stock unknown'}</span>
          ${place.distance_km != null ? `<span>${esc(String(place.distance_km))} km</span>` : ''}
          ${place.is_24hr ? '<span>24/7</span>' : ''}
        </div>
        <div class="emergency-result-actions">
          ${place.phone ? `<a href="tel:${String(place.phone).replace(/[^0-9+]/g, '')}">Call</a>` : ''}
          ${place.directions_url ? `<a href="${esc(place.directions_url)}" target="_blank" rel="noopener">Directions</a>` : ''}
        </div>
      </div>
    `).join('')}</div>` : ''}
    ${alternatives.length ? `
      <div class="emergency-alternatives">
        <strong>Alternatives</strong>
        <div class="emergency-alt-list">
          ${alternatives.map(item => `<span>${esc(item.name || item.alternative_drug || '')}${item.reason ? ' - ' + esc(item.reason) : ''}</span>`).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function renderEmergencySosDispatchResults(created, assignment, caseData, coords) {
  const host = document.getElementById('eqaNearbyResults');
  if (!host) return;
  setEmergencyNearestHospital(null);
  renderEmergencyContacts();

  const billing = assignment?.billing || {};
  const status = caseData?.status || 'AMBULANCE_ASSIGNED';
  const eta = assignment?.eta || (caseData?.eta_minutes ? String(caseData.eta_minutes) + ' min' : 'Updating');
  const locationLabel = coords?.address || 'Current location';

  host.innerHTML = `
    <div class="emergency-summary-line">
      <strong>SOS Activated</strong>
      <span>Case ${esc(created?.case_id || '')}</span>
    </div>
    <div class="emergency-stack">
      <div class="emergency-result-card">
        <div class="emergency-result-top">
          <div>
            <strong>Ambulance ${esc(assignment?.ambulance_id || 'Assigned')}</strong>
            <span>${esc(locationLabel)}</span>
          </div>
          <span class="emergency-badge emergency-badge--in_transit">${esc(status)}</span>
        </div>
        <div class="emergency-result-meta">
          <span>Driver: ${esc(assignment?.driver_name || 'Dispatch Team')}</span>
          <span>ETA: ${esc(eta)}</span>
          ${assignment?.distance_km != null ? `<span>${esc(String(assignment.distance_km))} km away</span>` : ''}
        </div>
        <div class="emergency-result-meta">
          <span>Type: ${esc(assignment?.ambulance_type || assignment?.required_type || 'Emergency')}</span>
          ${billing?.payable_amount != null ? `<span>Estimated cost: INR ${esc(String(billing.payable_amount))}</span>` : ''}
        </div>
        <div class="emergency-result-actions">
          <a href="tel:108">Call 108</a>
          <a href="tel:102">Call 102</a>
        </div>
        <div class="emergency-map-wrap">
          <div id="eqaSosMap" class="emergency-sos-map" aria-label="Live ambulance map"></div>
          <div id="eqaSosMapFallback" class="emergency-map-note"></div>
        </div>
      </div>
    </div>
  `;

  updateEmergencySosMap({
    user_location: {
      latitude: coords?.latitude,
      longitude: coords?.longitude,
    },
  }, coords);
}

function updateEmergencySosCardFromTrack(trackData) {
  const host = document.getElementById('eqaNearbyResults');
  if (!host || !trackData) return;

  const etaText = trackData.arrived ? 'Arrived' : ((trackData.eta_minutes != null) ? (String(trackData.eta_minutes) + ' min') : 'Updating');
  const statusEl = host.querySelector('.emergency-badge--in_transit');
  if (statusEl) statusEl.textContent = trackData.arrived ? 'ARRIVED' : 'IN_TRANSIT';

  const metaSpans = host.querySelectorAll('.emergency-result-meta span');
  metaSpans.forEach(span => {
    const text = String(span.textContent || '');
    if (text.startsWith('ETA:')) span.textContent = 'ETA: ' + etaText;
    if (text.includes('km away')) span.textContent = String(trackData.distance_km ?? '--') + ' km away';
  });
}

async function pollEmergencySosTrack(coords) {
  if (!emergencySosCaseId) return;
  try {
    const trackData = await api('GET', '/ambulance/track/' + encodeURIComponent(emergencySosCaseId) + '?_=' + Date.now());
    let caseData = null;
    try {
      caseData = await api('GET', '/emergency/case/' + encodeURIComponent(emergencySosCaseId) + '?_=' + Date.now());
    } catch (_err) {
      caseData = null;
    }

    updateEmergencySosCardFromTrack(trackData);
    updateEmergencySosMap(trackData, coords);

    if (trackData.arrived) {
      emergencySosArrivedStreak += 1;
    } else {
      emergencySosArrivedStreak = 0;
    }

    const settledAtPatient = !!(
      emergencySosVisualAmbulance &&
      Math.abs(Number(trackData?.user_location?.latitude || coords?.latitude || 0) - Number(emergencySosVisualAmbulance.latitude)) < 0.00005 &&
      Math.abs(Number(trackData?.user_location?.longitude || coords?.longitude || 0) - Number(emergencySosVisualAmbulance.longitude)) < 0.00005
    );

    // Match SEAS behavior: keep polling while in transit, and only stop after settled arrival.
    const flowStatus = String(caseData?.status || '').toUpperCase();
    const shouldContinue = flowStatus === 'AMBULANCE_ASSIGNED' || flowStatus === 'IN_TRANSIT' || !trackData.arrived || !settledAtPatient;
    if (!shouldContinue && trackData.arrived && emergencySosArrivedStreak >= 6 && emergencySosTrackTimer) {
      clearInterval(emergencySosTrackTimer);
      emergencySosTrackTimer = null;
    }
  } catch (_err) {
    // Keep polling; transient API failures should not drop the active map view.
  }
}

function startEmergencySosTracking(caseId, coords) {
  emergencySosCaseId = caseId;
  emergencySosArrivedStreak = 0;
  emergencySosVisualAmbulance = null;
  if (emergencySosTrackTimer) {
    clearInterval(emergencySosTrackTimer);
    emergencySosTrackTimer = null;
  }

  pollEmergencySosTrack(coords);
  emergencySosTrackTimer = setInterval(() => {
    if (!emergencyQuickPanelOpen) return;
    pollEmergencySosTrack(coords);
  }, 3000);
}

function parseLatLonFromText(text) {
  const match = String(text || '').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
}

async function fillEmergencyCurrentLocation() {
  const locationEl = document.getElementById('eqaHelpLocation');
  if (!locationEl) return;
  if (!navigator.geolocation) {
    locationEl.value = 'Current location unavailable';
    return;
  }

  locationEl.value = 'Fetching current location...';
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 30000,
      });
    });
    const lat = Number(position.coords.latitude);
    const lon = Number(position.coords.longitude);
    emergencyDispatchOverrideCoords = {
      latitude: lat,
      longitude: lon,
      address: 'Current location',
    };
    locationEl.value = `Current location (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
  } catch (_err) {
    locationEl.value = 'Could not read current location. Enter area manually.';
    emergencyDispatchOverrideCoords = null;
  }
}

function renderEmergencyAiResults(data) {
  const host = document.getElementById('eqaAiResults');
  if (!host) return;
  const riskLevel = String(data.risk_level || 'LOW').toUpperCase();
  const badgeClass = 'emergency-risk emergency-risk--' + riskLevel.toLowerCase();
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  const interactionWarnings = Array.isArray(data?.interaction?.warnings) ? data.interaction.warnings : [];
  const warnings = [];
  reasons.forEach(item => warnings.push(item));
  interactionWarnings.forEach(item => warnings.push(item));

  const summary = data.summary || (riskLevel === 'HIGH' ? 'High risk detected' : riskLevel === 'MEDIUM' ? 'Moderate risk detected' : 'Low immediate risk');
  const advice = data.advice || data.ai_hint || 'This quick check is informational only.';

  host.innerHTML = `
    <div class="${badgeClass}">
      <strong>${esc(summary)}</strong>
      <span>${esc(advice)}</span>
    </div>
    <div class="emergency-warning-list">
      ${warnings.length
        ? warnings.map(warning => `<div class="emergency-warning-item">${esc(warning)}</div>`).join('')
        : '<div class="emergency-warning-item">No critical warnings detected from the provided details.</div>'
      }
    </div>
    ${data.disclaimer ? `<div class="emergency-map-note">${esc(data.disclaimer)}</div>` : ''}
  `;
}

async function runEmergencyMedicineSearch() {
  const queryEl = document.getElementById('eqaMedicineQuery');
  const locationEl = document.getElementById('eqaLocationQuery');
  const query = queryEl ? queryEl.value.trim() : '';
  const location = locationEl ? locationEl.value.trim() : '';
  const host = document.getElementById('eqaMedicineResults');
  if (!query) {
    if (host) host.innerHTML = '<div class="emergency-empty-state">Enter a medicine name to search.</div>';
    return;
  }

  if (host) host.innerHTML = '<div class="emergency-loading">Searching medicine availability...</div>';
  try {
    const params = new URLSearchParams({ q: query });
    if (location) params.set('location', location);
    const data = await api('GET', '/emergency/medicine-search?' + params.toString());
    renderEmergencyMedicineResults(data);
  } catch (err) {
    if (host) host.innerHTML = '<div class="emergency-empty-state">' + esc(err.message || 'Search failed') + '</div>';
  }
}

async function resolveEmergencyDispatchCoords(location) {
  const typedCoords = parseLatLonFromText(location);
  if (typedCoords) {
    return {
      latitude: typedCoords.latitude,
      longitude: typedCoords.longitude,
      address: 'Manual coordinates',
    };
  }

  if (emergencyDispatchOverrideCoords) {
    return {
      latitude: emergencyDispatchOverrideCoords.latitude,
      longitude: emergencyDispatchOverrideCoords.longitude,
      address: emergencyDispatchOverrideCoords.address || 'Current location',
    };
  }

  const fallback = {
    latitude: 18.5204,
    longitude: 73.8567,
    address: location || 'Pune',
  };

  if (location) {
    try {
      const data = await api('GET', '/emergency/nearby-help?q=' + encodeURIComponent(location));
      const origin = data.origin || {};
      const lat = Number(origin.latitude);
      const lon = Number(origin.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return {
          latitude: lat,
          longitude: lon,
          address: origin.label || location,
        };
      }
    } catch (_err) {
      // Ignore geocode failure and continue with browser/fallback coordinates.
    }
  }

  if (navigator.geolocation) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 6000,
          maximumAge: 30000,
        });
      });
      return {
        latitude: Number(position.coords.latitude),
        longitude: Number(position.coords.longitude),
        address: location || 'Current location',
      };
    } catch (_err) {
      // Ignore browser geolocation errors and use fallback.
    }
  }

  return fallback;
}

async function runEmergencySosDispatch() {
  const locationEl = document.getElementById('eqaHelpLocation');
  const location = locationEl ? locationEl.value.trim() : '';
  const host = document.getElementById('eqaNearbyResults');

  if (host) host.innerHTML = '<div class="emergency-loading">Triggering SOS and assigning nearest ambulance...</div>';
  try {
    emergencySosCaseId = null;
    emergencySosVisualAmbulance = null;
    if (emergencySosTrackTimer) {
      clearInterval(emergencySosTrackTimer);
      emergencySosTrackTimer = null;
    }

    const coords = await resolveEmergencyDispatchCoords(location);
    const severity = 'critical';
    const emergencyType = 'general';

    const created = await api('POST', '/emergency/trigger', {
      latitude: coords.latitude,
      longitude: coords.longitude,
      address: coords.address || location || 'Emergency quick panel',
      emergency_type: emergencyType,
      severity,
    });

    const assignment = await api('POST', '/ambulance/assign', {
      case_id: created.case_id,
      latitude: coords.latitude,
      longitude: coords.longitude,
      emergency_type: emergencyType,
      severity,
    });

    let caseData = null;
    try {
      caseData = await api('GET', '/emergency/case/' + encodeURIComponent(created.case_id));
    } catch (_err) {
      caseData = null;
    }

    renderEmergencySosDispatchResults(created, assignment, caseData, coords);
    startEmergencySosTracking(created.case_id, coords);
  } catch (err) {
    if (host) host.innerHTML = '<div class="emergency-empty-state">' + esc(err.message || 'Could not dispatch ambulance') + '</div>';
    setEmergencyNearestHospital(null);
    renderEmergencyContacts();
  }
}

async function runEmergencyAiCheck() {
  const inputEl = document.getElementById('eqaAiInput');
  const query = inputEl ? inputEl.value.trim() : '';
  const host = document.getElementById('eqaAiResults');
  if (!query) {
    if (host) host.innerHTML = '<div class="emergency-empty-state">Enter symptoms or a medicine combination.</div>';
    return;
  }

  if (host) host.innerHTML = '<div class="emergency-loading">Checking risk level...</div>';
  try {
    const meds = query
      .split(/[,+]/)
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 5);

    const data = await api('POST', '/emergency/ai-check', {
      symptoms: query,
      medicines: meds,
    });
    renderEmergencyAiResults(data);
  } catch (err) {
    if (host) host.innerHTML = '<div class="emergency-empty-state">' + esc(err.message || 'Check failed') + '</div>';
  }
}

function attachEmergencyQuickSearchListeners() {
  const helpLocationEl = document.getElementById('eqaHelpLocation');
  const aiEl = document.getElementById('eqaAiInput');

  if (helpLocationEl) {
    helpLocationEl.addEventListener('input', () => {
      emergencyDispatchOverrideCoords = null;
    });
  }

  if (helpLocationEl) {
    helpLocationEl.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runEmergencySosDispatch();
      }
    });
  }

  if (aiEl) {
    aiEl.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        runEmergencyAiCheck();
      }
    });
  }
}

function initEmergencyQuickAccessPanel() {
  ensureEmergencyQuickAccessPanel();
  attachEmergencyQuickSearchListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEmergencyQuickAccessPanel);
} else {
  initEmergencyQuickAccessPanel();
}