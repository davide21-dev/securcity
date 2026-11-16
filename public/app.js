/**
 * CityFix · Safe Mobility Web Application
 * Complete Frontend Logic & Real-time Integration
 * Didap Hackathon 2026
 */

// Application State
const state = {
  currentUser: null,
  token: localStorage.getItem('safemobility_token') || null,
  reports: [],
  map: null,
  mapMarkers: {},
  proximityCircle: null,
  userLocation: { lat: 41.1171, lng: 16.8719, name: "Chiostro Innovazione (Bari)" },
  selectedRadius: 200, // Default 200m as in PDF Slide 9: 'Giulia torna in bici a 200m'
  currentCategory: 'incidente',
  uploadedPhotoBase64: null,
  activeTestScenario: null,
  banTimerInterval: null
};

// Initialize Application on load
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  
  initMap();
  await checkAuthSession();
  await fetchReports();
  await fetchStatsAndAudit();

  // Polling every 10 seconds for real-time updates
  setInterval(fetchReports, 10000);
});

// ------------------- MAP ENGINE (LEAFLET) ------------------- //

function initMap() {
  state.map = L.map('map', {
    zoomControl: false
  }).setView([state.userLocation.lat, state.userLocation.lng], 16);

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  // CartoDB Voyager / OSM tiles for a clean, professional aesthetic
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(state.map);

  // Draw user position marker (Giulia/Citizen)
  updateUserLocationMarker();

  // Click on map to pick report coordinates
  state.map.on('click', (e) => {
    state.userLocation.lat = e.latlng.lat;
    state.userLocation.lng = e.latlng.lng;
    updateUserLocationMarker();
    
    // Reverse geocode preview
    document.getElementById('reportIndirizzo').value = `Coord: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)} (Bari Centro)`;
  });
}

function updateUserLocationMarker() {
  if (state.proximityCircle) {
    state.map.removeLayer(state.proximityCircle);
  }

  // Draw citizen location circle with radius
  state.proximityCircle = L.circle([state.userLocation.lat, state.userLocation.lng], {
    color: '#1B4332',
    fillColor: '#2D6A4F',
    fillOpacity: 0.12,
    radius: state.selectedRadius,
    weight: 2,
    dashArray: '4, 6'
  }).addTo(state.map);

  // Citizen icon
  const citizenIcon = L.divIcon({
    className: 'custom-citizen-icon',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="w-8 h-8 rounded-full bg-emerald-700 border-2 border-white shadow-xl flex items-center justify-center text-white text-xs font-bold">
          🚲
        </div>
        <div class="absolute -bottom-5 whitespace-nowrap bg-slate-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow">
          ${state.currentUser ? state.currentUser.nome : "Giulia (Bici)"}
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

function setRadius(meters) {
  state.selectedRadius = meters;
  ['200', '500', '1500'].forEach(r => {
    const btn = document.getElementById(`rad${r}`);
    if (btn) {
      if (parseInt(r) === meters) {
        btn.className = "flex-1 py-1.5 text-center rounded-lg bg-white text-slate-800 shadow-sm transition";
      } else {
        btn.className = "flex-1 py-1.5 text-center rounded-lg text-slate-600 hover:text-slate-900 transition";
      }
    }
  });

  updateUserLocationMarker();
  renderHazardsList();
}

// ------------------- AUTHENTICATION LOGIC ------------------- //

async function checkAuthSession() {
  if (!state.token) {
    showAuthModal();
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
      hideAuthModal();
    } else {
      localStorage.removeItem('safemobility_token');
      state.token = null;
      state.currentUser = null;
      showAuthModal();
      renderUserHeader();
    }
  } catch (err) {
    console.error("Auth check failed:", err);
  }
}

function renderUserHeader() {
  const container = document.getElementById('userHeaderArea');
  if (!state.currentUser) {
    container.innerHTML = `
      <button onclick="showAuthModal()" class="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-2 rounded-xl transition border border-white/20">
        Accedi / Registrati
      </button>
    `;
    return;
  }

  const u = state.currentUser;
  const isBanned = u.is_banned;
  const strikes = u.false_reports_count || 0;

  container.innerHTML = `
    <div class="flex items-center gap-2">
      <!-- Strike badge -->
      <div class="hidden sm:flex items-center gap-1 bg-white/10 px-2.5 py-1.5 rounded-xl border border-white/15 text-xs" title="Contatore strike foto false (max 3 prima del ban)">
        <span class="text-[10px] text-emerald-200">Strike:</span>
        <span class="font-extrabold ${strikes >= 2 ? 'text-amber-300' : 'text-white'}">${strikes}/3</span>
      </div>

      <!-- Profile pill -->
      <div class="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl border border-white/20 text-xs">
        <div class="w-6 h-6 rounded-full bg-emerald-300 text-slate-900 flex items-center justify-center font-bold text-[11px]">
          ${u.nome.charAt(0)}
        </div>
        <div class="text-left hidden sm:block">
          <div class="font-bold text-white leading-tight">${u.nome} ${u.cognome}</div>
          <div class="text-[9px] text-emerald-200">${u.is_admin ? "Operatore Comune" : "Cittadino Attivo"}</div>
        </div>
        <button onclick="logout()" class="ml-1 text-emerald-200 hover:text-white p-1" title="Esci">
          <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function checkBanStatus(user) {
  const banner = document.getElementById('userBanBanner');
  const countSpan = document.getElementById('banCountdownText');

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
  } catch (err) {
    console.error(err);
  }
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
    t.className = "flex-1 py-3 text-center text-slate-400 hover:text-slate-700 transition";
  });

  document.getElementById('authError').classList.add('hidden');
  document.getElementById('authSuccess').classList.add('hidden');

  if (tab === 'login') {
    formLogin.classList.remove('hidden');
    tabLogin.className = "flex-1 py-3 text-center text-didap-green border-b-2 border-didap-green font-bold transition";
  } else if (tab === 'register') {
    formRegister.classList.remove('hidden');
    tabRegister.className = "flex-1 py-3 text-center text-didap-green border-b-2 border-didap-green font-bold transition";
  } else if (tab === 'forgot') {
    formForgot.classList.remove('hidden');
    tabForgot.className = "flex-1 py-3 text-center text-didap-green border-b-2 border-didap-green font-bold transition";
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
      showAuthError(data.error || "Login fallito.");
    }
  } catch (err) {
    showAuthError("Errore di connessione con il server.");
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
      alert("Registrazione effettuata con successo! Benvenuto in Safe Mobility.");
    } else {
      showAuthError(data.error || "Errore durante la registrazione.");
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
    showAuthError("Inserisci email o numero di telefono.");
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
      showAuthSuccess("Password modificata! Ora accedi con le nuove credenziali.");
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
  showAuthModal();
}

// ------------------- REPORTS & MAP RENDERING ------------------- //

async function fetchReports() {
  try {
    const res = await fetch(`/api/reports?lat=${state.userLocation.lat}&lng=${state.userLocation.lng}`);
    const data = await res.json();
    if (res.ok) {
      state.reports = data.reports || [];
      renderMapMarkers();
      renderHazardsList();
      renderMunicipalityTable();
    }
  } catch (err) {
    console.error("Failed fetching reports:", err);
  }
}

function renderMapMarkers() {
  // Clear old markers
  Object.values(state.mapMarkers).forEach(m => state.map.removeLayer(m));
  state.mapMarkers = {};

  state.reports.forEach(r => {
    let pinColor = '#F1C40F'; // Yellow
    let pulseClass = '';
    if (r.severity === 'ROSSO') {
      pinColor = '#D9381E';
      pulseClass = 'custom-pulse-red';
    } else if (r.severity === 'ARANCIONE') {
      pinColor = '#E67E22';
    }

    const icon = L.divIcon({
      className: 'custom-hazard-pin',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-xl ${pulseClass}" style="background-color: ${pinColor}">
            ${getCategoryIcon(r.categoria)}
          </div>
          <span class="absolute -top-1 -right-1 flex h-3 w-3">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style="background-color: ${pinColor}"></span>
            <span class="relative inline-flex rounded-full h-3 w-3" style="background-color: ${pinColor}"></span>
          </span>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);
    
    // Popup with collaborative confirmation & "Non c'è più"
    const popupContent = `
      <div class="p-2 max-w-xs font-sans text-xs">
        <div class="flex items-center justify-between mb-1.5">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-black text-white" style="background-color: ${pinColor}">
            CODICE ${r.severity}
          </span>
          <span class="text-[10px] text-slate-400 font-bold">${Math.round(r.seconds_left / 60)} min rimasti</span>
        </div>
        <h4 class="font-bold text-sm text-slate-900 mb-1">${r.categoria.toUpperCase()}</h4>
        <p class="text-slate-600 mb-2 leading-relaxed">${r.descrizione}</p>
        
        ${r.foto_url ? `<img src="${r.foto_url}" class="w-full h-24 object-cover rounded-lg mb-2 shadow-sm" alt="Foto pericolo">` : ''}
        
        <div class="p-1.5 rounded-lg bg-stone-100 text-[10px] text-slate-600 mb-2">
          <b>Bot AI:</b> ${r.ai_reason}
        </div>

        <div class="pt-2 border-t border-slate-100 flex items-center gap-1.5">
          <button onclick="confirmHazard('${r.id}')" class="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold py-1 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1">
            👍 C'è ancora (${r.confirm_count})
          </button>
          <button onclick="resolveHazard('${r.id}')" class="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold py-1 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1">
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

function renderHazardsList() {
  const container = document.getElementById('hazardsListContainer');
  const badge = document.getElementById('activeHazardsBadge');
  
  badge.textContent = `${state.reports.length} pericoli attivi`;

  if (state.reports.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 px-4 text-slate-400">
        <i data-lucide="check-circle" class="w-8 h-8 mx-auto mb-2 text-emerald-500"></i>
        <p class="text-xs font-bold text-slate-600">Nessun pericolo attivo</p>
        <p class="text-[11px]">La mobilità nel raggio selezionato è regolare.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = state.reports.map(r => {
    const isNearby = r.distance_meters !== null && r.distance_meters <= state.selectedRadius;
    const severityBorder = r.severity === 'ROSSO' ? 'border-l-didap-red' : (r.severity === 'ARANCIONE' ? 'border-l-didap-orange' : 'border-l-didap-yellow');
    const badgeBg = r.severity === 'ROSSO' ? 'bg-red-100 text-didap-red' : (r.severity === 'ARANCIONE' ? 'bg-amber-100 text-amber-800' : 'bg-yellow-100 text-yellow-800');

    return `
      <div class="bg-white rounded-2xl p-3 border border-slate-200 border-l-4 ${severityBorder} shadow-sm hover:shadow-md transition cursor-pointer" onclick="panToHazard(${r.lat}, ${r.lng}, '${r.id}')">
        
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${badgeBg}">
            ${r.severity}
          </span>
          <span class="text-[10px] font-bold ${isNearby ? 'text-didap-red animate-pulse' : 'text-slate-400'}">
            ${r.distance_meters !== null ? `A ${Math.round(r.distance_meters)} metri` : 'In città'}
          </span>
        </div>

        <h4 class="font-extrabold text-xs text-slate-800 mb-0.5">${r.categoria.toUpperCase()}</h4>
        <p class="text-[11px] text-slate-600 line-clamp-2 mb-2 leading-relaxed">${r.descrizione}</p>

        <div class="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] text-slate-500">
          <span class="flex items-center gap-1 font-medium">
            <i data-lucide="clock" class="w-3 h-3"></i> ${Math.round(r.seconds_left / 60)}m rimanenti
          </span>
          <div class="flex items-center gap-2">
            <button onclick="event.stopPropagation(); confirmHazard('${r.id}')" class="text-emerald-700 hover:text-emerald-800 font-bold">
              👍 C'è (${r.confirm_count})
            </button>
            <button onclick="event.stopPropagation(); resolveHazard('${r.id}')" class="text-rose-600 hover:text-rose-700 font-bold">
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

// ------------------- COLLABORATIVE ACTIONS (PDF STEP 03) ------------------- //

async function confirmHazard(id) {
  try {
    const res = await fetch(`/api/reports/${id}/confirm`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      await fetchReports();
    }
  } catch (err) {
    console.error(err);
  }
}

async function resolveHazard(id) {
  try {
    const res = await fetch(`/api/reports/${id}/resolve`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      await fetchReports();
    }
  } catch (err) {
    console.error(err);
  }
}

// ------------------- REPORT CREATION & BOT AI EVALUATION ------------------- //

function openReportModal() {
  if (!state.currentUser) {
    alert("Devi accedere prima di inviare una segnalazione!");
    showAuthModal();
    return;
  }
  if (state.currentUser.is_banned) {
    alert("Il tuo account è temporaneamente sospeso per 24 ore a causa di precedenti segnalazioni false!");
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
    b.className = "cat-btn p-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-center text-xs font-medium flex flex-col items-center gap-1 hover:border-slate-400";
  });
  btn.className = "cat-btn active p-2.5 border-2 border-didap-red bg-red-50 text-didap-red rounded-xl text-center text-xs font-bold flex flex-col items-center gap-1";
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
    meme: "https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop&q=60" // Funny cat meme
  };

  state.uploadedPhotoBase64 = demoImages[type];
  document.getElementById('photoPreviewImg').src = demoImages[type];
  document.getElementById('photoPreviewContainer').classList.remove('hidden');
  document.getElementById('photoUploadControls').classList.add('hidden');

  if (type === 'red') {
    state.activeTestScenario = 'valid_red';
    selectCategory('incidente', document.querySelectorAll('.cat-btn')[0]);
    document.getElementById('reportDesc').value = "Grave tamponamento tra più veicoli, asfalto ricoperto di detriti, strada impraticabile!";
  } else if (type === 'orange') {
    state.activeTestScenario = 'valid_orange';
    selectCategory('strada allagata', document.querySelectorAll('.cat-btn')[1]);
    document.getElementById('reportDesc').value = "Tombino rigurgita acqua, strada completamente allagata per 100 metri.";
  } else if (type === 'yellow') {
    state.activeTestScenario = 'valid_yellow';
    selectCategory('palo pericolante', document.querySelectorAll('.cat-btn')[2]);
    document.getElementById('reportDesc').value = "Palo della segnaletica piegato sul marciapiede a rischio caduta.";
  } else if (type === 'meme') {
    state.activeTestScenario = 'fake_meme';
    document.getElementById('reportDesc').value = "Gattino divertente trovato su internet invece della foto del pericolo.";
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
    alert("Carica una foto reale del pericolo per permettere all'AI di validare la segnalazione!");
    return;
  }

  // Visual feedback: AI evaluating
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>Analisi Vision Bot AI...</span>`;
  if (window.lucide) lucide.createIcons();

  box.classList.remove('hidden');
  box.className = "p-3.5 rounded-2xl border text-xs bg-stone-50 border-stone-200 text-slate-700 animate-pulse";
  box.innerHTML = `<b>🤖 Bot AI al lavoro:</b> Ispezione autenticità foto, controllo metadati e determinazione codice di gravità...`;

  const apiKey = localStorage.getItem('safemobility_gemini_key') || "";

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
        lat: state.userLocation.lat + (Math.random() - 0.5) * 0.002, // realistic slight local jitter
        lng: state.userLocation.lng + (Math.random() - 0.5) * 0.002,
        indirizzo: indirizzo,
        test_scenario: state.activeTestScenario,
        gemini_api_key: apiKey
      })
    });

    const data = await res.json();

    if (res.ok) {
      // APPROVED REPORT
      box.className = "p-3.5 rounded-2xl border text-xs bg-emerald-50 border-emerald-300 text-emerald-800";
      box.innerHTML = `
        <div class="flex items-center gap-1.5 font-bold mb-1">
          <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i> FOTO AUTENTICA APPROVATA
        </div>
        <p><b>Codice Assegnato:</b> <span class="uppercase font-black text-white px-2 py-0.5 rounded text-[10px] ${data.codice_gravita === 'ROSSO' ? 'bg-red-600' : (data.codice_gravita === 'ARANCIONE' ? 'bg-amber-600' : 'bg-yellow-600')}">${data.codice_gravita}</span></p>
        <p class="mt-1">${data.dettagli}</p>
      `;

      setTimeout(() => {
        closeReportModal();
        clearPhoto();
        document.getElementById('reportDesc').value = '';
        box.classList.add('hidden');
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Invia & Attiva Bot AI</span>`;
        fetchReports();
        checkAuthSession();
      }, 2000);

    } else {
      // REJECTED / BANNED
      if (data.status === 'BANNED') {
        box.className = "p-3.5 rounded-2xl border text-xs bg-red-100 border-red-300 text-red-900";
        box.innerHTML = `
          <div class="flex items-center gap-1.5 font-bold text-red-700 mb-1">
            <i data-lucide="shield-alert" class="w-4 h-4 text-red-600"></i> 3° STRIKE: ACCOUNT SOSPESO PER 24 ORE
          </div>
          <p class="font-semibold mb-1">${data.message}</p>
          <p class="text-[11px] text-red-700"><b>Motivo AI:</b> ${data.motivo}</p>
        `;
      } else {
        box.className = "p-3.5 rounded-2xl border text-xs bg-amber-50 border-amber-300 text-amber-900";
        box.innerHTML = `
          <div class="flex items-center gap-1.5 font-bold text-amber-800 mb-1">
            <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-600"></i> SEGNALAZIONE NON VALIDA (${data.strike_count}/3 STRIKE)
          </div>
          <p class="font-semibold mb-1">${data.message}</p>
          <p class="text-[11px] text-amber-800"><b>Motivo AI:</b> ${data.motivo}</p>
        `;
      }

      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Invia & Attiva Bot AI</span>`;
      checkAuthSession();
    }
  } catch (err) {
    alert("Errore nell'invio della segnalazione.");
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Invia & Attiva Bot AI</span>`;
  }

  if (window.lucide) lucide.createIcons();
}

// ------------------- SIMULATION OF GIULIA (PDF SLIDE 9: 02 AVVISA) ------------------- //

function simulateGiuliaApproach() {
  // Giulia coords moving near the Red Crash on Via Sparano (rep_1)
  const targetHazard = state.reports.find(r => r.severity === 'ROSSO') || state.reports[0];
  if (!targetHazard) {
    alert("Nessun pericolo attivo da simulare!");
    return;
  }

  // Set Giulia 180m south of the hazard
  state.userLocation.lat = targetHazard.lat - 0.0015;
  state.userLocation.lng = targetHazard.lng;
  updateUserLocationMarker();
  state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 17, { duration: 1.5 });

  setTimeout(() => {
    showProximityAlert(
      "Attenzione Giulia! (A 180m in bici)",
      `Rilevato ${targetHazard.categoria.toUpperCase()} in ${targetHazard.indirizzo}. Cambia strada e devia su percorso sicuro!`
    );
  }, 1600);
}

function showProximityAlert(title, message) {
  const toast = document.getElementById('alertToast');
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastMessage').textContent = message;
  toast.classList.remove('hidden');

  // Trigger web audio beep
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 650;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    osc.start();
    setTimeout(() => {
      osc.frequency.value = 850;
      setTimeout(() => osc.stop(), 200);
    }, 200);
  } catch (e) {}

  setTimeout(dismissToast, 8000);
}

function dismissToast() {
  document.getElementById('alertToast').classList.add('hidden');
}

// ------------------- MUNICIPALITY VIEW & AUDIT LOG ------------------- //

async function fetchStatsAndAudit() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (res.ok) {
      document.getElementById('kpiActiveReports').textContent = data.active_reports;
      document.getElementById('kpiBlockedFakes').textContent = data.blocked_fakes;
      document.getElementById('kpiBannedUsers').textContent = data.banned_users;
    }
  } catch (err) {}
}

function renderMunicipalityTable() {
  const tbody = document.getElementById('municipalityTableBody');
  if (!tbody) return;

  const redCount = state.reports.filter(r => r.severity === 'ROSSO').length;
  const kpiRed = document.getElementById('kpiRedReports');
  if (kpiRed) kpiRed.textContent = redCount;

  if (state.reports.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-slate-400">Nessuna segnalazione attiva.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.reports.map(r => {
    const badgeBg = r.severity === 'ROSSO' ? 'bg-red-100 text-red-800' : (r.severity === 'ARANCIONE' ? 'bg-amber-100 text-amber-800' : 'bg-yellow-100 text-yellow-800');
    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-6 py-4">
          <span class="px-2.5 py-1 rounded-full font-black text-[10px] ${badgeBg}">
            ${r.severity}
          </span>
        </td>
        <td class="px-6 py-4 font-bold text-slate-800">
          <div>${r.categoria.toUpperCase()}</div>
          <div class="text-[11px] text-slate-400 font-normal">${r.indirizzo}</div>
        </td>
        <td class="px-6 py-4 max-w-xs truncate text-slate-600">
          ${r.descrizione}
        </td>
        <td class="px-6 py-4 text-[11px] text-slate-500">
          <span class="text-emerald-700 font-bold">100% Autentica</span><br>
          ${r.ai_reason.slice(0, 50)}...
        </td>
        <td class="px-6 py-4">
          <span class="font-bold text-slate-700">${r.confirm_count} conferme</span>
          <span class="text-slate-400">(${r.resolved_count}/2 rimozioni)</span>
        </td>
        <td class="px-6 py-4">
          <button onclick="dispatchTeam('${r.id}', '${r.severity}')" class="bg-didap-green hover:bg-didap-greenDark text-white font-bold px-3 py-1.5 rounded-lg text-[10px] transition">
            Invia Intervento
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Sample Audit terminal log
  const term = document.getElementById('auditTerminal');
  if (term) {
    term.innerHTML = `
[AUDIT] 2026-11-16T16:00:00Z - SYSTEM_INIT: Safe Mobility Moderation Model Active (Gemini Vision Multimodal)
[AUDIT] 2026-11-16T16:04:12Z - EVAL_REQUEST: report_id=rep_1 status=APPROVED severity=ROSSO confidence=0.99
[AUDIT] 2026-11-16T16:08:45Z - EVAL_REQUEST: report_id=rep_2 status=APPROVED severity=ARANCIONE confidence=0.96
[AUDIT] 2026-11-16T16:10:20Z - EVAL_REQUEST: status=REJECTED reason="Watermark stock photo detected" strike=1/3
[AUDIT] 2026-11-16T16:12:05Z - GEOFENCE_TRIGGER: Giulia (User 2) notified within 200m buffer zone (Via Sparano).
[COMPLIANCE] AI Act Annex IV logged. No automated biometric identification used. Explanations stored.
    `;
  }
}

function dispatchTeam(id, severity) {
  alert(`Pattuglia di competenza inviata per la segnalazione ${id} (Codice ${severity})!`);
}

// ------------------- VIEW SWITCHER & TEST BENCH ------------------- //

function switchView(view) {
  const views = ['viewCitizen', 'viewMunicipality', 'viewAIPlayground'];
  const btns = ['viewBtnCitizen', 'viewBtnMunicipality', 'viewBtnAI'];

  views.forEach(v => document.getElementById(v).classList.add('hidden'));
  btns.forEach(b => {
    document.getElementById(b).className = "px-3.5 py-1.5 text-xs font-medium rounded-lg text-emerald-100 hover:text-white transition";
  });

  if (view === 'citizen') {
    document.getElementById('viewCitizen').classList.remove('hidden');
    document.getElementById('viewBtnCitizen').className = "px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-white shadow-sm transition";
    setTimeout(() => state.map.invalidateSize(), 100);
  } else if (view === 'municipality') {
    document.getElementById('viewMunicipality').classList.remove('hidden');
    document.getElementById('viewBtnMunicipality').className = "px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-white shadow-sm transition";
    renderMunicipalityTable();
    fetchStatsAndAudit();
  } else if (view === 'ai-playground') {
    document.getElementById('viewAIPlayground').classList.remove('hidden');
    document.getElementById('viewBtnAI').className = "px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 text-white shadow-sm transition";
  }
  if (window.lucide) lucide.createIcons();
}

function testBotPreset(scenario) {
  openReportModal();
  if (scenario === 'fake_meme') {
    loadDemoPhoto('meme');
  } else if (scenario === 'fake_screen') {
    loadDemoPhoto('meme');
    state.activeTestScenario = 'fake_screen';
    document.getElementById('reportDesc').value = "Foto scattata allo schermo del computer!";
  } else if (scenario === 'valid_yellow') {
    loadDemoPhoto('yellow');
  } else if (scenario === 'valid_red') {
    loadDemoPhoto('red');
  }
}

function saveApiKey() {
  const key = document.getElementById('customApiKey').value.trim();
  if (key) {
    localStorage.setItem('safemobility_gemini_key', key);
    alert("Chiave Google AI Studio salvata nel browser!");
  }
}

function refreshData() {
  fetchReports();
  fetchStatsAndAudit();
  alert("Dati aggiornati!");
}

function useCurrentGps() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      state.userLocation.lat = pos.coords.latitude;
      state.userLocation.lng = pos.coords.longitude;
      updateUserLocationMarker();
      state.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
      document.getElementById('reportIndirizzo').value = `GPS Corrente (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`;
    }, () => {
      alert("Impossibile rilevare la posizione GPS del dispositivo.");
    });
  }
}
