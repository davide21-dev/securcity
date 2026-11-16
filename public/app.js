/**
 * SecurCity Web Application
 * OpenStreetMap Engine (Zero API Key) & Responsive Mobile/Desktop UX
 * Categories: Mappa, Notifiche Pericoli, Istruzioni, Legenda
 */

const state = {
  currentUser: null,
  token: localStorage.getItem('safemobility_token') || null,
  reports: [],
  activeTab: 'mappa',
  map: null,
  mapMarkers: {},
  proximityCircle: null,
  citizenMarker: null,
  safeRoutePolyline: null,
  isDesktopCardCollapsed: false,
  // Centered in Galatina (Puglia / Salento) as shown in user screenshots
  userLocation: { lat: 40.1740, lng: 18.1710, name: "Galatina Centro (Puglia)" },
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

  // Close desktop dropdowns when clicking outside
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

  // Re-check map sizing on window resize / orientation change
  window.addEventListener('resize', () => {
    if (state.map) state.map.invalidateSize();
  });

  setInterval(fetchReports, 10000);
});

// ------------------- OPENSTREETMAP (ZERO API KEY) ------------------- //

function initMap() {
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([state.userLocation.lat, state.userLocation.lng], 14);

  // 100% Free OpenStreetMap tile server - ZERO API KEY REQUIRED
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    subdomains: ['a', 'b', 'c']
  }).addTo(state.map);

  updateUserLocationMarker();

  setTimeout(() => {
    state.map.invalidateSize();
  }, 300);

  // Click on map to pick coordinates
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

  // Draw 200m proximity radar circle
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
        <div class="w-8 h-8 rounded-full bg-[#0099FF] border-2 border-white shadow-xl flex items-center justify-center text-white text-xs font-bold animate-pulse">
          🚲
        </div>
        <div class="absolute -bottom-4 whitespace-nowrap bg-neutral-900 text-white text-[8px] font-bold px-1 rounded shadow">
          ${state.currentUser ? state.currentUser.nome : "Giulia"}
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  if (state.citizenMarker) {
    state.citizenMarker.setLatLng([state.userLocation.lat, state.userLocation.lng]);
  } else {
    state.citizenMarker = L.marker([state.userLocation.lat, state.userLocation.lng], { icon: citizenIcon }).addTo(state.map);
  }
}

function centerUserLocation() {
  state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 15, { duration: 0.8 });
}

function setRadius(meters) {
  state.selectedRadius = meters;
  ['200', '500', '1500'].forEach(r => {
    const btn = document.getElementById(`radBtn${r}`);
    if (btn) {
      if (parseInt(r) === meters) {
        btn.className = "px-2 py-1 rounded bg-neutral-900 text-white font-bold text-[10px] transition";
      } else {
        btn.className = "px-2 py-1 rounded text-neutral-600 hover:bg-neutral-100 text-[10px] transition";
      }
    }
  });

  updateUserLocationMarker();
  renderHazardsList();
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
  if (state.safeRoutePolyline) {
    state.map.removeLayer(state.safeRoutePolyline);
  }

  const lat = state.userLocation.lat;
  const lng = state.userLocation.lng;
  const routePoints = [
    [lat, lng],
    [lat + 0.003, lng + 0.003],
    [lat + 0.006, lng + 0.002],
    [lat + 0.010, lng - 0.001]
  ];

  state.safeRoutePolyline = L.polyline(routePoints, {
    color: '#0099FF',
    weight: 5,
    opacity: 0.9,
    lineCap: 'round'
  }).addTo(state.map);

  state.map.fitBounds(state.safeRoutePolyline.getBounds(), { padding: [40, 40] });

  alert("Percorso Sicuro Calcolato: Deviazione attiva per evitare l'incidente!");
}

// ------------------- MOBILE NAVIGATION & BOTTOM SHEET ------------------- //

function mobileSwitchTab(tab) {
  state.activeTab = tab;

  const tabs = ['mappa', 'notifiche-pericoli', 'istruzioni', 'legenda'];
  const mNavMap = {
    'mappa': document.getElementById('mNavMappa'),
    'notifiche-pericoli': document.getElementById('mNavPericoli'),
    'istruzioni': document.getElementById('mNavIstruzioni'),
    'legenda': document.getElementById('mNavLegenda')
  };

  tabs.forEach(t => {
    const btn = mNavMap[t];
    if (btn) {
      btn.className = "flex flex-col items-center py-1 px-3 text-neutral-400 font-medium transition relative";
    }
  });

  const activeBtn = mNavMap[tab];
  if (activeBtn) {
    activeBtn.className = "flex flex-col items-center py-1 px-3 text-neutral-900 font-bold transition relative";
  }

  const sheet = document.getElementById('mobileBottomSheet');
  const sheetTitle = document.getElementById('mobileSheetTitle');
  const sheetContent = document.getElementById('mobileSheetContent');

  if (tab === 'mappa') {
    closeMobileBottomSheet();
    centerUserLocation();
  } else if (tab === 'notifiche-pericoli') {
    sheetTitle.textContent = "Notifiche Pericoli";
    sheetContent.innerHTML = generateHazardsListHtml();
    sheet.classList.remove('hidden');
  } else if (tab === 'istruzioni') {
    sheetTitle.textContent = "Istruzioni di guida e sicurezza";
    sheetContent.innerHTML = `
      <div class="space-y-2.5 text-xs text-neutral-600">
        <div class="p-3 bg-neutral-50 rounded-xl border border-neutral-200">
          <h4 class="font-bold text-neutral-900 mb-0.5">01. Segnala in 3 secondi</h4>
          <p class="text-[11px]">Tocca il tasto rosso della matita. Carica una foto reale e invia: il Bot AI esegue la convalida istantanea.</p>
        </div>
        <div class="p-3 bg-neutral-50 rounded-xl border border-neutral-200">
          <h4 class="font-bold text-neutral-900 mb-0.5">02. Allerte di prossimità a 200m</h4>
          <p class="text-[11px]">Avviso acustico e visivo per chi è in bici o a piedi in avvicinamento entro 200 metri.</p>
        </div>
        <div class="p-3 bg-neutral-50 rounded-xl border border-neutral-200">
          <h4 class="font-bold text-neutral-900 mb-0.5">03. Rimozione collaborativa</h4>
          <p class="text-[11px]">Due voti su «Non c'è più» rimuovono subito il pericolo dalla mappa.</p>
        </div>
        <div class="p-3 bg-red-50 rounded-xl border border-red-200 text-red-800">
          <h4 class="font-bold text-red-900 mb-0.5">Emergenze gravi: chiama il 112</h4>
          <p class="text-[11px]">Contatta sempre il 112 per pericoli critici o feriti.</p>
        </div>
      </div>
    `;
    sheet.classList.remove('hidden');
  } else if (tab === 'legenda') {
    sheetTitle.textContent = "Legenda Codici & Ban";
    sheetContent.innerHTML = `
      <div class="space-y-2.5 text-xs">
        <div class="p-2.5 rounded-xl border border-red-200 bg-red-50/80">
          <div class="flex items-center gap-2 mb-1">
            <span class="w-3 h-3 rounded-full bg-severity-red"></span>
            <span class="font-bold text-red-900 text-xs">CODICE ROSSO (Grave)</span>
          </div>
          <p class="text-[11px] text-red-700 leading-tight">Pericolo immediato per la vita. Notifica prioritari e 112.</p>
        </div>
        <div class="p-2.5 rounded-xl border border-amber-200 bg-amber-50/80">
          <div class="flex items-center gap-2 mb-1">
            <span class="w-3 h-3 rounded-full bg-severity-orange"></span>
            <span class="font-bold text-amber-900 text-xs">CODICE ARANCIONE (Medio)</span>
          </div>
          <p class="text-[11px] text-amber-800 leading-tight">Rischio moderato (allagamenti, ostacoli carreggiata). Richiede cautela.</p>
        </div>
        <div class="p-2.5 rounded-xl border border-yellow-200 bg-yellow-50/80">
          <div class="flex items-center gap-2 mb-1">
            <span class="w-3 h-3 rounded-full bg-severity-yellow"></span>
            <span class="font-bold text-yellow-900 text-xs">CODICE GIALLO (Basso)</span>
          </div>
          <p class="text-[11px] text-yellow-800 leading-tight">Disagio lieve (buche, rami caduti).</p>
        </div>
        <div class="p-2.5 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-700">
          <span class="font-bold text-neutral-900 block mb-0.5 text-xs">Regola Anti-Abuso Bot AI:</span>
          <p class="text-[11px] leading-tight">3 foto false = Ban 24h automatico.</p>
        </div>
      </div>
    `;
    sheet.classList.remove('hidden');
  }

  if (window.lucide) lucide.createIcons();
}

function closeMobileBottomSheet() {
  const sheet = document.getElementById('mobileBottomSheet');
  if (sheet) sheet.classList.add('hidden');
}

function openMobileRoutePlanner() {
  document.getElementById('mobileRouteModal').classList.remove('hidden');
}

function closeMobileRoutePlanner() {
  document.getElementById('mobileRouteModal').classList.add('hidden');
}

// ------------------- DESKTOP CARD TABS ------------------- //

function toggleDesktopCardCollapse() {
  const card = document.getElementById('desktopFloatingCard');
  const pill = document.getElementById('desktopMinimizedPill');

  state.isDesktopCardCollapsed = !state.isDesktopCardCollapsed;

  if (state.isDesktopCardCollapsed) {
    card.classList.add('hidden');
    pill.classList.remove('hidden');
  } else {
    card.classList.remove('hidden');
    pill.classList.add('hidden');
  }
  if (window.lucide) lucide.createIcons();
}

function switchTab(tab) {
  state.activeTab = tab;

  if (state.isDesktopCardCollapsed) {
    toggleDesktopCardCollapse();
  }

  const tabs = ['mappa', 'notifiche-pericoli', 'istruzioni', 'legenda'];
  const tabBtnMap = {
    'mappa': document.getElementById('tabBtnMappa'),
    'notifiche-pericoli': document.getElementById('tabBtnPericoli'),
    'istruzioni': document.getElementById('tabBtnIstruzioni'),
    'legenda': document.getElementById('tabBtnLegenda')
  };
  const contentMap = {
    'mappa': document.getElementById('desktopContentMappa'),
    'notifiche-pericoli': document.getElementById('desktopContentPericoli'),
    'istruzioni': document.getElementById('desktopContentIstruzioni'),
    'legenda': document.getElementById('desktopContentLegenda')
  };

  tabs.forEach(t => {
    const btn = tabBtnMap[t];
    const content = contentMap[t];
    if (btn) {
      btn.className = "flex-1 py-1.5 px-2 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition text-center flex items-center justify-center gap-1 text-[11px] font-bold";
    }
    if (content) {
      content.classList.add('hidden');
    }
  });

  const activeBtn = tabBtnMap[tab];
  const activeContent = contentMap[tab];

  if (activeBtn) {
    activeBtn.className = "flex-1 py-1.5 px-2 rounded-lg bg-neutral-900 text-white shadow-xs transition text-center flex items-center justify-center gap-1 text-[11px] font-bold";
  }
  if (activeContent) {
    activeContent.classList.remove('hidden');
  }

  if (tab === 'mappa') {
    state.map.invalidateSize();
  } else if (tab === 'notifiche-pericoli') {
    renderHazardsList();
  }

  if (window.lucide) lucide.createIcons();
}

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
  const deskContainer = document.getElementById('desktopUserHeaderArea');
  const mobContainer = document.getElementById('mobileUserHeaderArea');

  const htmlNotLogged = `
    <button onclick="showAuthModal()" class="bg-[#0099FF] hover:bg-[#0088EE] text-white text-[11px] font-bold px-3 py-1.5 rounded-full transition shadow-xs">
      Accedi
    </button>
  `;

  if (!state.currentUser) {
    if (deskContainer) deskContainer.innerHTML = htmlNotLogged;
    if (mobContainer) mobContainer.innerHTML = htmlNotLogged;
    return;
  }

  const u = state.currentUser;
  const strikes = u.false_reports_count || 0;

  const htmlLogged = `
    <div class="flex items-center gap-1.5 bg-neutral-100 px-2.5 py-1 rounded-full text-xs font-bold text-neutral-800">
      <div class="w-5 h-5 rounded-full bg-[#0099FF] text-white flex items-center justify-center text-[10px]">
        ${u.nome.charAt(0)}
      </div>
      <span class="text-[11px]">${u.nome}</span>
      <span class="text-[9px] text-neutral-400 font-semibold">(${strikes}/3)</span>
      <button onclick="logout()" class="text-neutral-400 hover:text-neutral-700 ml-0.5 p-0.5" title="Esci">
        <i data-lucide="log-out" class="w-3 h-3"></i>
      </button>
    </div>
  `;

  if (deskContainer) deskContainer.innerHTML = htmlLogged;
  if (mobContainer) mobContainer.innerHTML = htmlLogged;
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
      alert("Ban azzerato con successo! Ora puoi inviare nuove segnalazioni.");
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
    t.className = "flex-1 py-2.5 text-center text-neutral-400 hover:text-neutral-700 transition";
  });

  document.getElementById('authError').classList.add('hidden');
  document.getElementById('authSuccess').classList.add('hidden');

  if (tab === 'login') {
    formLogin.classList.remove('hidden');
    tabLogin.className = "flex-1 py-2.5 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold transition";
  } else if (tab === 'register') {
    formRegister.classList.remove('hidden');
    tabRegister.className = "flex-1 py-2.5 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold transition";
  } else if (tab === 'forgot') {
    formForgot.classList.remove('hidden');
    tabForgot.className = "flex-1 py-2.5 text-center text-neutral-900 border-b-2 border-neutral-900 font-bold transition";
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
      showAuthError(data.error || "Errore nella richiesta.");
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
      showAuthSuccess("Password reimpostata! Ora accedi.");
      setTimeout(() => {
        setAuthTab('login');
        document.getElementById('loginIdentifier').value = identifier;
      }, 1500);
    } else {
      showAuthError(data.error || "Errore reset.");
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

// ------------------- REPORTS ENGINE & NOTIFICHE LIST ------------------- //

async function fetchReports() {
  try {
    const res = await fetch(`/api/reports?lat=${state.userLocation.lat}&lng=${state.userLocation.lng}`);
    const data = await res.json();
    if (res.ok) {
      state.reports = data.reports || [];
      renderMapMarkers();
      renderHazardsList();
    }
  } catch (err) {
    console.error("Failed fetching reports:", err);
  }
}

function renderMapMarkers() {
  Object.values(state.mapMarkers).forEach(m => state.map.removeLayer(m));
  state.mapMarkers = {};

  const badgeCount = document.getElementById('badgePericoliCount');
  if (badgeCount) badgeCount.textContent = state.reports.length;
  const mBadge = document.getElementById('mBadgePericoli');
  if (mBadge) mBadge.textContent = state.reports.length;
  const labelCount = document.getElementById('pericoliCountLabel');
  if (labelCount) labelCount.textContent = `${state.reports.length} segnalazioni`;

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
          <div class="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-xl ${pulseClass}" style="background-color: ${pinColor}">
            ${getCategoryIcon(r.categoria)}
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);
    
    const popupContent = `
      <div class="p-2 max-w-xs font-sans text-xs">
        <div class="flex items-center justify-between mb-1">
          <span class="px-2 py-0.5 rounded text-[10px] font-black text-white" style="background-color: ${pinColor}">
            CODICE ${r.severity}
          </span>
          <span class="text-[10px] text-neutral-400 font-bold">${Math.round(r.seconds_left / 60)} min</span>
        </div>
        <h4 class="font-extrabold text-xs text-neutral-900 mb-0.5 uppercase">${r.categoria}</h4>
        <p class="text-neutral-600 mb-2 leading-tight text-[11px]">${r.descrizione}</p>
        
        ${r.foto_url ? `<img src="${r.foto_url}" class="w-full h-20 object-cover rounded-xl mb-2">` : ''}

        <div class="p-1 rounded-lg bg-neutral-100 text-[10px] text-neutral-600 mb-2">
          <b>Bot AI:</b> ${r.ai_reason}
        </div>

        <div class="pt-1.5 border-t border-neutral-100 flex items-center gap-1.5">
          <button onclick="confirmHazard('${r.id}')" class="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold py-1 px-1.5 rounded-lg text-[10px] flex items-center justify-center gap-1">
            👍 C'è (${r.confirm_count})
          </button>
          <button onclick="resolveHazard('${r.id}')" class="flex-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold py-1 px-1.5 rounded-lg text-[10px] flex items-center justify-center gap-1">
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

function generateHazardsListHtml() {
  if (state.reports.length === 0) {
    return `
      <div class="text-center py-6 text-neutral-400 text-xs">
        <p class="font-bold text-neutral-600">Nessun pericolo attivo</p>
        <p class="text-[11px]">La mobilità in zona è regolare.</p>
      </div>
    `;
  }

  return state.reports.map(r => {
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
            <button onclick="event.stopPropagation(); confirmHazard('${r.id}')" class="px-2 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-[10px]">
              👍 C'è (${r.confirm_count})
            </button>
            <button onclick="event.stopPropagation(); resolveHazard('${r.id}')" class="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-bold text-[10px]">
              ❌ Non c'è più
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderHazardsList() {
  const container = document.getElementById('hazardsListContainer');
  if (container) {
    container.innerHTML = generateHazardsListHtml();
  }
  const sheetContent = document.getElementById('mobileSheetContent');
  if (sheetContent && state.activeTab === 'notifiche-pericoli') {
    sheetContent.innerHTML = generateHazardsListHtml();
  }
  if (window.lucide) lucide.createIcons();
}

function panToHazard(lat, lng, id) {
  closeMobileBottomSheet();
  state.map.flyTo([lat, lng], 17, { duration: 1 });
  if (state.mapMarkers[id]) {
    setTimeout(() => state.mapMarkers[id].openPopup(), 1100);
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
    document.getElementById('reportDesc').value = "Grave scontro tra autovetture all'incrocio.";
  } else if (type === 'orange') {
    state.activeTestScenario = 'valid_orange';
    selectCategory('strada allagata', document.querySelectorAll('.cat-btn')[1]);
    document.getElementById('reportDesc').value = "Strada allagata con rischio acquaplaning.";
  } else if (type === 'yellow') {
    state.activeTestScenario = 'valid_yellow';
    selectCategory('palo pericolante', document.querySelectorAll('.cat-btn')[2]);
    document.getElementById('reportDesc').value = "Palo divelto piegato verso il marciapiede.";
  } else if (type === 'meme') {
    state.activeTestScenario = 'fake_meme';
    document.getElementById('reportDesc').value = "Meme divertente per testare lo strike.";
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
    alert("Carica o scatta una foto del pericolo!");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span>Analisi Bot AI in corso...</span>`;

  box.classList.remove('hidden');
  box.className = "p-2.5 rounded-xl border text-xs bg-neutral-100 border-neutral-300 text-neutral-800 animate-pulse";
  box.innerHTML = `<b>Bot AI:</b> Verifica autenticità foto e gravità in corso...`;

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
      box.className = "p-2.5 rounded-xl border text-xs bg-emerald-50 border-emerald-300 text-emerald-800";
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
      }, 1500);

    } else {
      if (data.status === 'BANNED') {
        box.className = "p-2.5 rounded-xl border text-xs bg-red-50 border-red-300 text-red-900";
        box.innerHTML = `
          <div class="font-bold text-red-700 mb-0.5">3° STRIKE: ACCOUNT SOSPESO PER 24 ORE</div>
          <p>${data.message}</p>
        `;
      } else {
        box.className = "p-2.5 rounded-xl border text-xs bg-amber-50 border-amber-300 text-amber-900";
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
  state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 16, { duration: 1 });

  setTimeout(() => {
    showProximityAlert(
      "Allerta Prossimità (A 180m)",
      `Rilevato ${targetHazard.categoria.toUpperCase()} in ${targetHazard.indirizzo}. Consigliata deviazione!`
    );
  }, 1200);
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
