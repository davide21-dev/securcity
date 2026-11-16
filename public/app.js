/**
 * CityFix · Safe Mobility Web Application
 * Live Map Interface (Waze style)
 * Categories: Mappa, Notifiche Pericoli, Istruzioni, Legenda
 */

const state = {
  currentUser: null,
  token: localStorage.getItem('safemobility_token') || null,
  reports: [],
  map: null,
  mapMarkers: {},
  proximityCircle: null,
  citizenMarker: null,
  safeRoutePolyline: null,
  // Centered in Galatina (Puglia / Salento) as shown in user screenshot
  userLocation: { lat: 40.1650, lng: 18.1710, name: "Galatina Centro (Puglia)" },
  selectedRadius: 200, // 200m as in PDF Slide 9: 'Giulia torna in bici a 200m'
  currentCategory: 'incidente',
  uploadedPhotoBase64: null,
  activeTestScenario: null,
  banTimerInterval: null
};

document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  initMap();
  await checkAuthSession();
  await fetchReports();

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    const btnApp = document.getElementById('btnAppMenu');
    const menuApp = document.getElementById('appDropdownMenu');
    const btnMore = document.getElementById('btnMoreMenu');
    const menuMore = document.getElementById('moreDropdownMenu');

    if (btnApp && menuApp && !btnApp.contains(e.target) && !menuApp.contains(e.target)) {
      menuApp.classList.add('hidden');
    }
    if (btnMore && menuMore && !btnMore.contains(e.target) && !menuMore.contains(e.target)) {
      menuMore.classList.add('hidden');
    }
  });

  setInterval(fetchReports, 10000);
});

// ------------------- LEAFLET MAP ENGINE ------------------- //

function initMap() {
  state.map = L.map('map', {
    zoomControl: false
  }).setView([state.userLocation.lat, state.userLocation.lng], 14);

  // Clean, high-readability vector basemap
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(state.map);

  updateUserLocationMarker();

  // Click on map to set report coordinates
  state.map.on('click', (e) => {
    state.userLocation.lat = e.latlng.lat;
    state.userLocation.lng = e.latlng.lng;
    updateUserLocationMarker();

    const addrInput = document.getElementById('reportIndirizzo');
    if (addrInput) {
      addrInput.value = `Posizione: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)} (Puglia)`;
    }
  });
}

function updateUserLocationMarker() {
  if (state.proximityCircle) {
    state.map.removeLayer(state.proximityCircle);
  }

  // Draw proximity circle (200m default)
  state.proximityCircle = L.circle([state.userLocation.lat, state.userLocation.lng], {
    color: '#0099FF',
    fillColor: '#0099FF',
    fillOpacity: 0.12,
    radius: state.selectedRadius,
    weight: 2,
    dashArray: '5, 5'
  }).addTo(state.map);

  const citizenIcon = L.divIcon({
    className: 'custom-citizen-icon',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="w-9 h-9 rounded-full bg-[#0099FF] border-2 border-white shadow-xl flex items-center justify-center text-white text-sm font-bold animate-pulse">
          🚲
        </div>
        <div class="absolute -bottom-5 whitespace-nowrap bg-neutral-900 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow">
          ${state.currentUser ? state.currentUser.nome : "Giulia (Bici)"}
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  if (state.citizenMarker) {
    state.citizenMarker.setLatLng([state.userLocation.lat, state.userLocation.lng]);
  } else {
    state.citizenMarker = L.marker([state.userLocation.lat, state.userLocation.lng], { icon: citizenIcon }).addTo(state.map);
  }
}

function centerUserLocation() {
  state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 15, { duration: 1 });
}

function setRadius(meters) {
  state.selectedRadius = meters;
  const radiusText = document.getElementById('radiusTextDisplay');
  if (radiusText) {
    radiusText.textContent = `Raggio: ${meters}m (${meters === 200 ? 'Bici' : (meters === 500 ? 'Quartiere' : 'Auto')})`;
  }
  updateUserLocationMarker();
  renderDrawerHazards();
}

function toggleRadiusPopup() {
  const current = state.selectedRadius;
  const next = current === 200 ? 500 : (current === 500 ? 1500 : 200);
  setRadius(next);
}

function swapRouteEndpoints() {
  const start = document.getElementById('routeStart');
  const end = document.getElementById('routeEnd');
  if (start && end) {
    const tmp = start.value;
    start.value = end.value;
    end.value = tmp;
  }
}

function calculateSafeRoute() {
  // Traces a safe simulated route avoiding active hazards
  if (state.safeRoutePolyline) {
    state.map.removeLayer(state.safeRoutePolyline);
  }

  // Draw clean blue route with detour around hazard
  const lat = state.userLocation.lat;
  const lng = state.userLocation.lng;
  const routePoints = [
    [lat, lng],
    [lat + 0.003, lng + 0.002],
    [lat + 0.006, lng + 0.001], // Deviazione sicura
    [lat + 0.009, lng - 0.001]
  ];

  state.safeRoutePolyline = L.polyline(routePoints, {
    color: '#0099FF',
    weight: 5,
    opacity: 0.9,
    lineCap: 'round'
  }).addTo(state.map);

  state.map.fitBounds(state.safeRoutePolyline.getBounds(), { padding: [50, 50] });

  alert("Percorso Sicuro Calcolato: Deviazione attiva per evitare l'incidente su SP362!");
}

// ------------------- TOP MENUS & CATEGORY SWITCHER ------------------- //

function toggleAppMenu() {
  const menu = document.getElementById('appDropdownMenu');
  const more = document.getElementById('moreDropdownMenu');
  if (more) more.classList.add('hidden');
  if (menu) menu.classList.toggle('hidden');
  if (window.lucide) lucide.createIcons();
}

function toggleMoreMenu() {
  const menu = document.getElementById('moreDropdownMenu');
  const app = document.getElementById('appDropdownMenu');
  if (app) app.classList.add('hidden');
  if (menu) menu.classList.toggle('hidden');
}

function toggleSideDrawer() {
  const drawer = document.getElementById('sideDrawer');
  if (drawer) drawer.classList.toggle('hidden');
  if (window.lucide) lucide.createIcons();
}

function activateCategory(cat) {
  // Close popups
  const appMenu = document.getElementById('appDropdownMenu');
  if (appMenu) appMenu.classList.add('hidden');

  // Update card title and pills
  const cardTitle = document.getElementById('floatingCardTitle');
  const pillM = document.getElementById('pillMappa');
  const pillP = document.getElementById('pillPericoli');
  const pillL = document.getElementById('pillLegenda');

  [pillM, pillP, pillL].forEach(p => {
    if (p) p.className = "px-2 py-0.5 rounded hover:bg-neutral-100 text-neutral-600 transition";
  });

  if (cat === 'mappa') {
    if (cardTitle) cardTitle.textContent = "Istruzioni di guida";
    if (pillM) pillM.className = "px-2 py-0.5 rounded bg-neutral-900 text-white font-bold transition";
    const drawer = document.getElementById('sideDrawer');
    if (drawer) drawer.classList.add('hidden');
    centerUserLocation();
  } else if (cat === 'notifiche-pericoli') {
    if (cardTitle) cardTitle.textContent = "Notifiche Pericoli";
    if (pillP) pillP.className = "px-2 py-0.5 rounded bg-red-600 text-white font-bold transition";
    openDrawerTab('notifiche-pericoli');
  } else if (cat === 'istruzioni') {
    if (cardTitle) cardTitle.textContent = "Istruzioni";
    openDrawerTab('istruzioni');
  } else if (cat === 'legenda') {
    if (cardTitle) cardTitle.textContent = "Legenda";
    if (pillL) pillL.className = "px-2 py-0.5 rounded bg-amber-500 text-white font-bold transition";
    openDrawerTab('legenda');
  }
}

function openDrawerTab(tab) {
  const drawer = document.getElementById('sideDrawer');
  if (drawer) drawer.classList.remove('hidden');
  setDrawerTab(tab);
}

function setDrawerTab(tab) {
  const tabP = document.getElementById('tabDrawerPericoli');
  const tabI = document.getElementById('tabDrawerIstruzioni');
  const tabL = document.getElementById('tabDrawerLegenda');

  const contentP = document.getElementById('drawerTabContentPericoli');
  const contentI = document.getElementById('drawerTabContentIstruzioni');
  const contentL = document.getElementById('drawerTabContentLegenda');

  [tabP, tabI, tabL].forEach(t => {
    if (t) t.className = "flex-1 py-3 text-center text-neutral-400 hover:text-neutral-700 transition";
  });
  [contentP, contentI, contentL].forEach(c => {
    if (c) c.classList.add('hidden');
  });

  if (tab === 'notifiche-pericoli') {
    if (tabP) tabP.className = "flex-1 py-3 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold";
    if (contentP) contentP.classList.remove('hidden');
  } else if (tab === 'istruzioni') {
    if (tabI) tabI.className = "flex-1 py-3 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold";
    if (contentI) contentI.classList.remove('hidden');
  } else if (tab === 'legenda') {
    if (tabL) tabL.className = "flex-1 py-3 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold";
    if (contentL) contentL.classList.remove('hidden');
  }
  if (window.lucide) lucide.createIcons();
}

function openTechSupport() {
  alert("Supporto Didap Hackathon 2026: Team Didap disponibile per chiarimenti tecnici su CityFix Safe Mobility.");
}

// ------------------- AUTHENTICATION LOGIC ------------------- //

async function checkAuthSession() {
  if (!state.token) {
    renderUserHeader();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.currentUser = data.user;
      renderUserHeader();
      checkBanStatus(data.user);
    } else {
      localStorage.removeItem('safemobility_token');
      state.token = null;
      state.currentUser = null;
      renderUserHeader();
    }
  } catch (err) {
    console.error("Auth check failed:", err);
  }
}

function renderUserHeader() {
  const container = document.getElementById('userHeaderArea');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = `
      <button onclick="showAuthModal()" class="bg-[#0099FF] hover:bg-[#0088EE] text-white text-xs font-bold px-4 py-2 rounded-full transition shadow-md">
        Accedi
      </button>
    `;
    return;
  }

  const u = state.currentUser;
  const strikes = u.false_reports_count || 0;

  container.innerHTML = `
    <div class="flex items-center gap-1.5 bg-white/95 px-3 py-1.5 rounded-full border border-neutral-200/80 shadow-md text-xs">
      <div class="w-6 h-6 rounded-full bg-[#0099FF] text-white flex items-center justify-center font-bold text-[11px]">
        ${u.nome.charAt(0)}
      </div>
      <span class="font-bold text-neutral-800">${u.nome}</span>
      <span class="text-[10px] text-neutral-400 font-semibold">(${strikes}/3)</span>
      <button onclick="logout()" class="text-neutral-400 hover:text-neutral-700 ml-1 p-0.5" title="Esci">
        <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function checkBanStatus(user) {
  const banner = document.getElementById('userBanBanner');
  const countSpan = document.getElementById('banCountdownText');
  if (!banner || !countSpan) return;

  if (state.banTimerInterval) {
    clearInterval(state.banTimerInterval);
  }

  if (user && user.is_banned && user.remaining_ban_seconds > 0) {
    banner.classList.remove('hidden');
    let rem = user.remaining_ban_seconds;
    
    const updateCountdown = () => {
      const h = Math.floor(rem / 3600);
      const m = Math.floor((rem % 3600) / 60);
      const s = rem % 60;
      countSpan.textContent = `Sblocco in: ${h}h ${m}m ${s}s`;
      if (rem <= 0) {
        clearInterval(state.banTimerInterval);
        banner.classList.add('hidden');
        user.is_banned = false;
      }
      rem--;
    };
    updateCountdown();
    state.banTimerInterval = setInterval(updateCountdown, 1000);
  } else {
    banner.classList.add('hidden');
  }
}

async function resetBanDemo() {
  if (!state.token) return;
  try {
    const res = await fetch('/api/auth/reset-demo-ban', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      alert("Ban azzerato con successo! Ora puoi inviare segnalazioni.");
      await checkAuthSession();
    }
  } catch (err) {}
}

function showAuthModal() {
  document.getElementById('authModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function hideAuthModal() {
  document.getElementById('authModal').classList.add('hidden');
}

function setAuthTab(tab) {
  const formLogin = document.getElementById('formLogin');
  const formRegister = document.getElementById('formRegister');
  const formForgot = document.getElementById('formForgot');
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');
  const tabForgot = document.getElementById('authTabForgot');

  [formLogin, formRegister, formForgot].forEach(f => f.classList.add('hidden'));
  [tabLogin, tabRegister, tabForgot].forEach(t => {
    t.className = "flex-1 py-3 text-center text-neutral-400 hover:text-neutral-700 transition";
  });

  document.getElementById('authError').classList.add('hidden');
  document.getElementById('authSuccess').classList.add('hidden');

  if (tab === 'login') {
    formLogin.classList.remove('hidden');
    tabLogin.className = "flex-1 py-3 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold transition";
  } else if (tab === 'register') {
    formRegister.classList.remove('hidden');
    tabRegister.className = "flex-1 py-3 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold transition";
  } else if (tab === 'forgot') {
    formForgot.classList.remove('hidden');
    tabForgot.className = "flex-1 py-3 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold transition";
  }
  if (window.lucide) lucide.createIcons();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  document.getElementById('authErrorMsg').textContent = msg;
  el.classList.remove('hidden');
  document.getElementById('authSuccess').classList.add('hidden');
}

function showAuthSuccess(msg) {
  const el = document.getElementById('authSuccess');
  document.getElementById('authSuccessMsg').textContent = msg;
  el.classList.remove('hidden');
  document.getElementById('authError').classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('safemobility_token', data.token);
      state.token = data.token;
      state.currentUser = data.user;
      renderUserHeader();
      checkBanStatus(data.user);
      hideAuthModal();
      await fetchReports();
    } else {
      showAuthError(data.error || "Credenziali non valide.");
    }
  } catch (err) {
    showAuthError("Errore di connessione.");
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const nome = document.getElementById('regNome').value.trim();
  const cognome = document.getElementById('regCognome').value.trim();
  const data_nascita = document.getElementById('regDataNascita').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const telefono = document.getElementById('regTelefono').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, cognome, data_nascita, email, telefono, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('safemobility_token', data.token);
      state.token = data.token;
      state.currentUser = data.user;
      renderUserHeader();
      hideAuthModal();
      await fetchReports();
      alert("Registrazione completata con successo!");
    } else {
      showAuthError(data.error || "Errore nella registrazione.");
    }
  } catch (err) {
    showAuthError("Errore di connessione.");
  }
}

function quickFillLogin(ident, pass) {
  document.getElementById('loginIdentifier').value = ident;
  document.getElementById('loginPassword').value = pass;
  document.getElementById('formLogin').dispatchEvent(new Event('submit'));
}

async function requestResetCode() {
  const identifier = document.getElementById('forgotIdentifier').value.trim();
  if (!identifier) {
    showAuthError("Inserisci email o telefono.");
    return;
  }
  try {
    const res = await fetch('/api/auth/forgot-password/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('forgotStep1').classList.add('hidden');
      document.getElementById('forgotStep2').classList.remove('hidden');
      document.getElementById('demoOtpDisplay').textContent = data.demo_code;
      document.getElementById('forgotCode').value = data.demo_code;
      showAuthSuccess(data.message);
    } else {
      showAuthError(data.error || "Errore nella richiesta del codice.");
    }
  } catch (err) {
    showAuthError("Errore di connessione.");
  }
}

async function submitResetPassword() {
  const identifier = document.getElementById('forgotIdentifier').value.trim();
  const code = document.getElementById('forgotCode').value.trim();
  const new_password = document.getElementById('forgotNewPassword').value.trim();

  try {
    const res = await fetch('/api/auth/forgot-password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, code, new_password })
    });
    const data = await res.json();
    if (res.ok) {
      showAuthSuccess("Password reimpostata! Ora effettua l'accesso.");
      setTimeout(() => {
        setAuthTab('login');
        document.getElementById('loginIdentifier').value = identifier;
      }, 1500);
    } else {
      showAuthError(data.error || "Errore durante il reset.");
    }
  } catch (err) {
    showAuthError("Errore di connessione.");
  }
}

function logout() {
  localStorage.removeItem('safemobility_token');
  state.token = null;
  state.currentUser = null;
  renderUserHeader();
}

// ------------------- REPORTS & NOTIFICHE PERICOLI ------------------- //

async function fetchReports() {
  try {
    const res = await fetch(`/api/reports?lat=${state.userLocation.lat}&lng=${state.userLocation.lng}`);
    const data = await res.json();
    if (res.ok) {
      state.reports = data.reports || [];
      renderMapMarkers();
      renderDrawerHazards();
    }
  } catch (err) {
    console.error("Failed fetching reports:", err);
  }
}

function renderMapMarkers() {
  Object.values(state.mapMarkers).forEach(m => state.map.removeLayer(m));
  state.mapMarkers = {};

  const menuCount = document.getElementById('menuDangerCount');
  if (menuCount) menuCount.textContent = state.reports.length;

  state.reports.forEach(r => {
    let pinColor = '#EAB308'; // Giallo
    let pulseClass = '';
    if (r.severity === 'ROSSO') {
      pinColor = '#EF4444';
      pulseClass = 'custom-pulse-red';
    } else if (r.severity === 'ARANCIONE') {
      pinColor = '#F59E0B';
    }

    const icon = L.divIcon({
      className: 'custom-hazard-pin',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-xl ${pulseClass}" style="background-color: ${pinColor}">
            ${getCategoryIcon(r.categoria)}
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);
    
    const popupContent = `
      <div class="p-2.5 max-w-xs font-sans text-xs">
        <div class="flex items-center justify-between mb-1">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-black text-white" style="background-color: ${pinColor}">
            CODICE ${r.severity}
          </span>
          <span class="text-[10px] text-neutral-400 font-bold">${Math.round(r.seconds_left / 60)} min</span>
        </div>
        <h4 class="font-extrabold text-xs text-neutral-900 mb-0.5 uppercase">${r.categoria}</h4>
        <p class="text-neutral-600 mb-2 leading-relaxed text-[11px]">${r.descrizione}</p>
        
        ${r.foto_url ? `<img src="${r.foto_url}" class="w-full h-24 object-cover rounded-xl mb-2 shadow-xs">` : ''}

        <div class="p-1.5 rounded-lg bg-neutral-100 text-[10px] text-neutral-600 mb-2">
          <b>Bot AI:</b> ${r.ai_reason}
        </div>

        <div class="pt-2 border-t border-neutral-100 flex items-center gap-1.5">
          <button onclick="confirmHazard('${r.id}')" class="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold py-1.5 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1">
            👍 C'è (${r.confirm_count})
          </button>
          <button onclick="resolveHazard('${r.id}')" class="flex-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold py-1.5 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1">
            ❌ Non c'è più (${r.resolved_count}/2)
          </button>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    state.mapMarkers[r.id] = marker;
  });
}

function getCategoryIcon(cat) {
  const c = cat.toLowerCase();
  if (c.includes('incidente')) return '🚗';
  if (c.includes('allag')) return '🌊';
  if (c.includes('palo')) return '⚡';
  if (c.includes('rissa')) return '🥊';
  if (c.includes('molest')) return '⚠️';
  return '🚧';
}

function renderDrawerHazards() {
  const container = document.getElementById('drawerHazardsList');
  const countBadge = document.getElementById('drawerActiveHazardsCount');
  if (!container) return;

  if (countBadge) countBadge.textContent = state.reports.length;

  if (state.reports.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-neutral-400 text-xs">
        <p class="font-bold text-neutral-600">Nessun pericolo attivo</p>
        <p class="text-[11px]">La mobilità è regolare.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.reports.map(r => {
    let badgeColor = 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (r.severity === 'ROSSO') {
      badgeColor = 'bg-red-100 text-red-800 border-red-200';
    } else if (r.severity === 'ARANCIONE') {
      badgeColor = 'bg-amber-100 text-amber-800 border-amber-200';
    }

    const isNearby = r.distance_meters !== null && r.distance_meters <= state.selectedRadius;

    return `
      <div class="p-3 rounded-2xl border border-neutral-200 hover:border-neutral-300 bg-white transition shadow-xs cursor-pointer" onclick="panToHazard(${r.lat}, ${r.lng}, '${r.id}')">
        
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${badgeColor}">
            ${r.severity}
          </span>
          <span class="text-[10px] font-bold ${isNearby ? 'text-red-600 animate-pulse' : 'text-neutral-400'}">
            ${r.distance_meters !== null ? `A ${Math.round(r.distance_meters)}m` : 'In zona'}
          </span>
        </div>

        <h4 class="font-bold text-xs text-neutral-900 mb-0.5 uppercase">${r.categoria}</h4>
        <p class="text-[11px] text-neutral-600 line-clamp-2 mb-2 leading-relaxed">${r.descrizione}</p>

        <div class="flex items-center justify-between pt-2 border-t border-neutral-100 text-xs">
          <span class="text-[10px] text-neutral-400">${Math.round(r.seconds_left / 60)} min rimasti</span>
          <div class="flex items-center gap-1.5">
            <button onclick="event.stopPropagation(); confirmHazard('${r.id}')" class="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-[10px]">
              👍 C'è (${r.confirm_count})
            </button>
            <button onclick="event.stopPropagation(); resolveHazard('${r.id}')" class="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 font-bold text-[10px]">
              ❌ Non c'è più
            </button>
          </div>
        </div>

      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function panToHazard(lat, lng, id) {
  state.map.flyTo([lat, lng], 17, { duration: 1.2 });
  if (state.mapMarkers[id]) {
    setTimeout(() => state.mapMarkers[id].openPopup(), 1300);
  }
}

async function confirmHazard(id) {
  try {
    const res = await fetch(`/api/reports/${id}/confirm`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      await fetchReports();
    }
  } catch (err) {}
}

async function resolveHazard(id) {
  try {
    const res = await fetch(`/api/reports/${id}/resolve`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      await fetchReports();
    }
  } catch (err) {}
}

// ------------------- REPORT MODAL & BOT AI ------------------- //

function openReportModal() {
  if (!state.currentUser) {
    alert("Accedi o registrati per segnalare un pericolo!");
    showAuthModal();
    return;
  }
  if (state.currentUser.is_banned) {
    alert("Il tuo account è temporaneamente sospeso per 24 ore!");
    return;
  }
  document.getElementById('reportModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeReportModal() {
  document.getElementById('reportModal').classList.add('hidden');
}

function selectCategory(cat, btn) {
  state.currentCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.className = "cat-btn p-2 border border-neutral-200 bg-white text-neutral-600 rounded-xl text-center text-xs";
  });
  btn.className = "cat-btn active p-2 border-2 border-red-600 bg-red-50 text-red-700 rounded-xl text-center text-xs font-bold";
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    state.uploadedPhotoBase64 = event.target.result;
    document.getElementById('photoPreviewImg').src = state.uploadedPhotoBase64;
    document.getElementById('photoPreviewContainer').classList.remove('hidden');
    document.getElementById('photoUploadControls').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  state.uploadedPhotoBase64 = null;
  state.activeTestScenario = null;
  document.getElementById('photoFileInput').value = '';
  document.getElementById('photoPreviewContainer').classList.add('hidden');
  document.getElementById('photoUploadControls').classList.remove('hidden');
}

function loadDemoPhoto(type) {
  const demoImages = {
    red: "https://images.unsplash.com/photo-1543393470-b2c64b6e8d2e?w=800&auto=format&fit=crop&q=60",
    orange: "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=800&auto=format&fit=crop&q=60",
    yellow: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=60",
    meme: "https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop&q=60"
  };

  state.uploadedPhotoBase64 = demoImages[type];
  document.getElementById('photoPreviewImg').src = demoImages[type];
  document.getElementById('photoPreviewContainer').classList.remove('hidden');
  document.getElementById('photoUploadControls').classList.add('hidden');

  if (type === 'red') {
    state.activeTestScenario = 'valid_red';
    selectCategory('incidente', document.querySelectorAll('.cat-btn')[0]);
    document.getElementById('reportDesc').value = "Grave scontro tra autovetture con ostruzione carreggiata.";
  } else if (type === 'orange') {
    state.activeTestScenario = 'valid_orange';
    selectCategory('strada allagata', document.querySelectorAll('.cat-btn')[1]);
    document.getElementById('reportDesc').value = "Strada allagata per rottura tubatura con rischio acquaplaning.";
  } else if (type === 'yellow') {
    state.activeTestScenario = 'valid_yellow';
    selectCategory('palo pericolante', document.querySelectorAll('.cat-btn')[2]);
    document.getElementById('reportDesc').value = "Palo divelto piegato verso il marciapiede.";
  } else if (type === 'meme') {
    state.activeTestScenario = 'fake_meme';
    document.getElementById('reportDesc').value = "Meme divertente non attinente per testare lo strike.";
  }
}

async function submitReport() {
  const desc = document.getElementById('reportDesc').value.trim();
  const indirizzo = document.getElementById('reportIndirizzo').value.trim();
  const box = document.getElementById('aiEvaluationBox');
  const btn = document.getElementById('btnSubmitReport');

  if (!desc) {
    alert("Descrivi brevemente il pericolo!");
    return;
  }
  if (!state.uploadedPhotoBase64) {
    alert("Inserisci o scatta una foto del pericolo!");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span>Analisi Bot AI in corso...</span>`;

  box.classList.remove('hidden');
  box.className = "p-3 rounded-xl border text-xs bg-neutral-100 border-neutral-300 text-neutral-800 animate-pulse";
  box.innerHTML = `<b>Bot AI:</b> Verifica autenticità e assegnazione codice in corso...`;

  try {
    const res = await fetch('/api/reports/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        categoria: state.currentCategory,
        descrizione: desc,
        foto: state.uploadedPhotoBase64,
        lat: state.userLocation.lat + (Math.random() - 0.5) * 0.003,
        lng: state.userLocation.lng + (Math.random() - 0.5) * 0.003,
        indirizzo: indirizzo,
        test_scenario: state.activeTestScenario
      })
    });

    const data = await res.json();

    if (res.ok) {
      box.className = "p-3 rounded-xl border text-xs bg-emerald-50 border-emerald-300 text-emerald-800";
      box.innerHTML = `
        <div class="font-bold mb-0.5">FOTO AUTENTICA APPROVATA</div>
        <p><b>Codice:</b> ${data.codice_gravita} - ${data.dettagli}</p>
      `;

      setTimeout(() => {
        closeReportModal();
        clearPhoto();
        document.getElementById('reportDesc').value = '';
        box.classList.add('hidden');
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Invia Segnalazione</span>`;
        fetchReports();
        checkAuthSession();
      }, 1800);

    } else {
      if (data.status === 'BANNED') {
        box.className = "p-3 rounded-xl border text-xs bg-red-50 border-red-300 text-red-900";
        box.innerHTML = `
          <div class="font-bold text-red-700 mb-0.5">3° STRIKE: ACCOUNT SOSPESO PER 24 ORE</div>
          <p>${data.message}</p>
        `;
      } else {
        box.className = "p-3 rounded-xl border text-xs bg-amber-50 border-amber-300 text-amber-900";
        box.innerHTML = `
          <div class="font-bold text-amber-800 mb-0.5">SEGNALAZIONE NON VALIDA (${data.strike_count}/3 STRIKE)</div>
          <p>${data.message}</p>
        `;
      }

      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Invia Segnalazione</span>`;
      checkAuthSession();
    }
  } catch (err) {
    alert("Errore nell'invio.");
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Invia Segnalazione</span>`;
  }
}

// ------------------- SIMULATORE GIULIA A 200M ------------------- //

function simulateGiuliaApproach() {
  const targetHazard = state.reports.find(r => r.severity === 'ROSSO') || state.reports[0];
  if (!targetHazard) return;

  state.userLocation.lat = targetHazard.lat - 0.0016;
  state.userLocation.lng = targetHazard.lng;
  updateUserLocationMarker();
  state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 16, { duration: 1.2 });

  setTimeout(() => {
    showProximityAlert(
      "Allerta Prossimità (A 180m in bici)",
      `Rilevato ${targetHazard.categoria.toUpperCase()} in ${targetHazard.indirizzo}. Consigliata deviazione sul percorso sicuro!`
    );
  }, 1400);
}

function showProximityAlert(title, message) {
  const toast = document.getElementById('alertToast');
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastMessage').textContent = message;
  toast.classList.remove('hidden');

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 750;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    osc.start();
    setTimeout(() => {
      osc.frequency.value = 950;
      setTimeout(() => osc.stop(), 180);
    }, 180);
  } catch (e) {}

  setTimeout(dismissToast, 7000);
}

function dismissToast() {
  document.getElementById('alertToast').classList.add('hidden');
}
