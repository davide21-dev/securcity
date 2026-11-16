/**
 * CityFix · Safe Mobility Web Application
 * Frontend Logic with The F-Layout & Neutral Aesthetic
 * Categories: Mappa, Notifiche Pericoli, Notifiche Comune, Legenda, Istruzioni
 */

// Application State
const state = {
  currentUser: null,
  token: localStorage.getItem('safemobility_token') || null,
  reports: [],
  filteredReports: [],
  selectedCategoryFilter: 'tutte',
  map: null,
  mapMarkers: {},
  proximityCircle: null,
  citizenMarker: null,
  userLocation: { lat: 41.1171, lng: 16.8719, name: "Chiostro Innovazione (Bari)" },
  selectedRadius: 200, // 200m as in PDF Slide 9: 'Giulia torna in bici a 200m'
  currentCategory: 'incidente',
  uploadedPhotoBase64: null,
  activeTestScenario: null,
  banTimerInterval: null
};

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  
  initMap();
  await checkAuthSession();
  await fetchReports();
  await fetchNotificheComune();

  // Polling every 12 seconds for real-time updates
  setInterval(fetchReports, 12000);
});

// ------------------- MAP ENGINE (LEAFLET) ------------------- //

function initMap() {
  state.map = L.map('map', {
    zoomControl: false
  }).setView([state.userLocation.lat, state.userLocation.lng], 16);

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  // CartoDB Voyager tiles (clean, neutral, readable)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(state.map);

  updateUserLocationMarker();

  // Click on map to pick coordinates
  state.map.on('click', (e) => {
    state.userLocation.lat = e.latlng.lat;
    state.userLocation.lng = e.latlng.lng;
    updateUserLocationMarker();
    
    const addrInput = document.getElementById('reportIndirizzo');
    if (addrInput) {
      addrInput.value = `Posizione: ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)} (Bari)`;
    }
  });
}

function updateUserLocationMarker() {
  if (state.proximityCircle) {
    state.map.removeLayer(state.proximityCircle);
  }

  // Draw neutral proximity circle
  state.proximityCircle = L.circle([state.userLocation.lat, state.userLocation.lng], {
    color: '#0F172A',
    fillColor: '#334155',
    fillOpacity: 0.1,
    radius: state.selectedRadius,
    weight: 1.5,
    dashArray: '4, 6'
  }).addTo(state.map);

  const citizenIcon = L.divIcon({
    className: 'custom-citizen-icon',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="w-8 h-8 rounded-full bg-neutral-900 border-2 border-white shadow-md flex items-center justify-center text-white text-xs font-bold">
          🚲
        </div>
        <div class="absolute -bottom-5 whitespace-nowrap bg-neutral-900 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
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
        btn.className = "px-2.5 py-1 rounded bg-white text-neutral-900 shadow-xs font-bold transition";
      } else {
        btn.className = "px-2.5 py-1 rounded text-neutral-500 hover:text-neutral-900 transition";
      }
    }
  });

  updateUserLocationMarker();
  renderHazardsFeed();
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
      <button onclick="showAuthModal()" class="bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-xs">
        Accedi / Registrati
      </button>
    `;
    return;
  }

  const u = state.currentUser;
  const strikes = u.false_reports_count || 0;

  container.innerHTML = `
    <div class="flex items-center gap-2">
      <div class="hidden sm:flex items-center gap-1 bg-neutral-100 px-2 py-1 rounded-lg border border-neutral-200 text-xs" title="Strike per foto non conformi (max 3 prima del ban 24h)">
        <span class="text-[10px] text-neutral-500">Strike:</span>
        <span class="font-bold ${strikes >= 2 ? 'text-amber-600' : 'text-neutral-800'}">${strikes}/3</span>
      </div>

      <div class="flex items-center gap-2 bg-neutral-100 hover:bg-neutral-200 px-2.5 py-1 rounded-lg border border-neutral-200 text-xs">
        <div class="w-5 h-5 rounded-full bg-neutral-800 text-white flex items-center justify-center font-bold text-[10px]">
          ${u.nome.charAt(0)}
        </div>
        <span class="font-bold text-neutral-800 text-xs">${u.nome}</span>
        <button onclick="logout()" class="text-neutral-400 hover:text-neutral-700 ml-1 p-0.5" title="Esci">
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
      alert("Ban azzerato con successo! Ora puoi effettuare nuove segnalazioni.");
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
      showAuthError(data.error || "Login non riuscito.");
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
      showAuthSuccess("Password reimpostata! Ora accedi con le nuove credenziali.");
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
      renderHazardsFeed();
    }
  } catch (err) {
    console.error("Failed fetching reports:", err);
  }
}

function filterCategory(cat) {
  state.selectedCategoryFilter = cat;
  renderHazardsFeed();
}

function renderMapMarkers() {
  Object.values(state.mapMarkers).forEach(m => state.map.removeLayer(m));
  state.mapMarkers = {};

  state.reports.forEach(r => {
    let pinColor = '#EAB308'; // Yellow
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
          <div class="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-md ${pulseClass}" style="background-color: ${pinColor}">
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
          <span class="px-2 py-0.5 rounded text-[10px] font-bold text-white" style="background-color: ${pinColor}">
            CODICE ${r.severity}
          </span>
          <span class="text-[10px] text-neutral-400 font-bold">${Math.round(r.seconds_left / 60)}m rimasti</span>
        </div>
        <h4 class="font-bold text-xs text-neutral-900 mb-0.5">${r.categoria.toUpperCase()}</h4>
        <p class="text-neutral-600 mb-2 leading-tight">${r.descrizione}</p>
        
        ${r.foto_url ? `<img src="${r.foto_url}" class="w-full h-20 object-cover rounded mb-2">` : ''}

        <div class="pt-1.5 border-t border-neutral-100 flex items-center gap-1.5">
          <button onclick="confirmHazard('${r.id}')" class="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold py-1 px-1.5 rounded text-[10px]">
            👍 C'è (${r.confirm_count})
          </button>
          <button onclick="resolveHazard('${r.id}')" class="flex-1 bg-neutral-100 hover:bg-neutral-200 text-red-600 font-bold py-1 px-1.5 rounded text-[10px]">
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

function renderHazardsFeed() {
  const container = document.getElementById('hazardsFeedContainer');
  const countBadge = document.getElementById('activeCountBadge');
  if (!container) return;

  let list = state.reports;
  if (state.selectedCategoryFilter !== 'tutte') {
    list = list.filter(r => r.categoria.toLowerCase().includes(state.selectedCategoryFilter.toLowerCase()));
  }

  if (countBadge) {
    countBadge.textContent = `${list.length} attive`;
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-neutral-400 text-xs">
        <p class="font-bold text-neutral-600">Nessuna segnalazione attiva in questa categoria</p>
        <p class="text-[11px]">La mobilità in zona è regolare.</p>
      </div>
    `;
    return;
  }

  // Exact F-Layout format: thumbnail on left, text/details on right
  container.innerHTML = list.map(r => {
    let badgeColor = 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (r.severity === 'ROSSO') {
      badgeColor = 'bg-red-100 text-red-800 border-red-200';
    } else if (r.severity === 'ARANCIONE') {
      badgeColor = 'bg-amber-100 text-amber-800 border-amber-200';
    }

    const isNearby = r.distance_meters !== null && r.distance_meters <= state.selectedRadius;

    return `
      <div class="flex flex-col sm:flex-row items-start gap-4 p-4 rounded-xl border border-neutral-200 bg-white hover:border-neutral-300 transition cursor-pointer" onclick="panToHazard(${r.lat}, ${r.lng}, '${r.id}')">
        
        <!-- Left Thumbnail / Icon -->
        <div class="w-full sm:w-28 sm:h-24 h-36 rounded-lg bg-neutral-100 overflow-hidden shrink-0 border border-neutral-200 relative">
          ${r.foto_url 
            ? `<img src="${r.foto_url}" class="w-full h-full object-cover" alt="Foto">`
            : `<div class="w-full h-full flex items-center justify-center text-2xl">${getCategoryIcon(r.categoria)}</div>`
          }
          <div class="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white">
            ${Math.round(r.seconds_left / 60)}m
          </div>
        </div>

        <!-- Right Content & Metadata -->
        <div class="flex-1 w-full space-y-1.5">
          <div class="flex flex-wrap items-center justify-between gap-1.5">
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded border ${badgeColor}">
                ${r.severity}
              </span>
              <span class="font-bold text-xs text-neutral-900 uppercase">${r.categoria}</span>
            </div>
            <span class="text-[11px] font-bold ${isNearby ? 'text-red-600 animate-pulse' : 'text-neutral-400'}">
              ${r.distance_meters !== null ? `A ${Math.round(r.distance_meters)}m da te` : 'In città'}
            </span>
          </div>

          <p class="text-xs text-neutral-700 leading-relaxed font-normal">${r.descrizione}</p>

          <div class="text-[11px] text-neutral-400 flex items-center gap-1">
            <i data-lucide="map-pin" class="w-3 h-3 text-neutral-400"></i>
            <span>${r.indirizzo}</span>
          </div>

          <div class="pt-2 border-t border-neutral-100 flex items-center justify-between text-xs">
            <span class="text-[11px] text-neutral-500">
              <b>Verifica Bot AI:</b> ${r.ai_reason.slice(0, 60)}...
            </span>

            <div class="flex items-center gap-2">
              <button onclick="event.stopPropagation(); confirmHazard('${r.id}')" class="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-[10px]">
                👍 Confermo (${r.confirm_count})
              </button>
              <button onclick="event.stopPropagation(); resolveHazard('${r.id}')" class="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 hover:text-red-600 font-bold text-[10px]">
                ❌ Non c'è più (${r.resolved_count}/2)
              </button>
            </div>
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

// ------------------- NOTIFICHE COMUNE ------------------- //

async function fetchNotificheComune() {
  const container = document.getElementById('notificheComuneContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/notifiche-comune');
    const data = await res.json();
    if (res.ok && data.notifiche) {
      container.innerHTML = data.notifiche.map(n => `
        <div class="p-3 rounded-lg border border-neutral-200 bg-neutral-50 space-y-1">
          <div class="flex items-center justify-between text-[10px] text-neutral-400">
            <span class="font-bold text-neutral-600">${n.ente}</span>
            <span>Ufficiale</span>
          </div>
          <h4 class="font-bold text-neutral-900 text-xs">${n.titolo}</h4>
          <p class="text-neutral-600 text-[11px] leading-relaxed">${n.messaggio}</p>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error("Failed fetching notifiche comune:", err);
  }
}

// ------------------- REPORT CREATION & BOT AI ------------------- //

function openReportModal() {
  if (!state.currentUser) {
    alert("Accedi o registrati per segnalare un pericolo!");
    showAuthModal();
    return;
  }
  if (state.currentUser.is_banned) {
    alert("Il tuo account è temporaneamente sospeso per 24 ore a causa di segnalazioni non valide!");
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
    b.className = "cat-btn p-2 border border-neutral-200 bg-white text-neutral-600 rounded-lg text-center text-xs";
  });
  btn.className = "cat-btn active p-2 border-2 border-neutral-900 bg-neutral-50 text-neutral-900 rounded-lg text-center text-xs font-bold";
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
    document.getElementById('reportDesc').value = "Incidente serio tra auto con detriti e corsia ostruita.";
  } else if (type === 'orange') {
    state.activeTestScenario = 'valid_orange';
    selectCategory('strada allagata', document.querySelectorAll('.cat-btn')[1]);
    document.getElementById('reportDesc').value = "Tombino straripato, carreggiata allagata.";
  } else if (type === 'yellow') {
    state.activeTestScenario = 'valid_yellow';
    selectCategory('palo pericolante', document.querySelectorAll('.cat-btn')[2]);
    document.getElementById('reportDesc').value = "Palo inclinato sul marciapiede.";
  } else if (type === 'meme') {
    state.activeTestScenario = 'fake_meme';
    document.getElementById('reportDesc').value = "Immagine satirica / meme non pertinente per testare lo strike.";
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
  box.className = "p-3 rounded-lg border text-xs bg-neutral-100 border-neutral-300 text-neutral-800 animate-pulse";
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
        lat: state.userLocation.lat + (Math.random() - 0.5) * 0.002,
        lng: state.userLocation.lng + (Math.random() - 0.5) * 0.002,
        indirizzo: indirizzo,
        test_scenario: state.activeTestScenario
      })
    });

    const data = await res.json();

    if (res.ok) {
      box.className = "p-3 rounded-lg border text-xs bg-emerald-50 border-emerald-300 text-emerald-800";
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
        box.className = "p-3 rounded-lg border text-xs bg-red-50 border-red-300 text-red-900";
        box.innerHTML = `
          <div class="font-bold text-red-700 mb-0.5">3° STRIKE: ACCOUNT SOSPESO PER 24 ORE</div>
          <p>${data.message}</p>
        `;
      } else {
        box.className = "p-3 rounded-lg border text-xs bg-amber-50 border-amber-300 text-amber-900";
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

// ------------------- SIMULAZIONE ALLERTA GIULIA ------------------- //

function simulateGiuliaApproach() {
  const targetHazard = state.reports.find(r => r.severity === 'ROSSO') || state.reports[0];
  if (!targetHazard) return;

  state.userLocation.lat = targetHazard.lat - 0.0015;
  state.userLocation.lng = targetHazard.lng;
  updateUserLocationMarker();
  state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 17, { duration: 1.2 });

  setTimeout(() => {
    showProximityAlert(
      "Allerta Prossimità (A 180m)",
      `Rilevato ${targetHazard.categoria.toUpperCase()} in ${targetHazard.indirizzo}. Consigliata deviazione!`
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
    osc.frequency.value = 700;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    osc.start();
    setTimeout(() => {
      osc.frequency.value = 900;
      setTimeout(() => osc.stop(), 180);
    }, 180);
  } catch (e) {}

  setTimeout(dismissToast, 7000);
}

function dismissToast() {
  document.getElementById('alertToast').classList.add('hidden');
}

function testBotPreset(scenario) {
  openReportModal();
  if (scenario === 'fake_meme') {
    loadDemoPhoto('meme');
  } else if (scenario === 'valid_red') {
    loadDemoPhoto('red');
  } else if (scenario === 'valid_yellow') {
    loadDemoPhoto('yellow');
  } else if (scenario === 'valid_orange') {
    loadDemoPhoto('orange');
  }
}
