/**
 * SecurCity Web Application
 * OpenStreetMap Engine (Zero API Key) & Responsive Mobile/Desktop UX
 * Categories: Mappa, Notifiche Pericoli, Notifiche Comune, Istruzioni, Legenda
 */

const state = {
  currentUser: null,
  token: localStorage.getItem('safemobility_token') || null,
  reports: [],
  municipalityAlerts: JSON.parse(localStorage.getItem('securcity_comune_alerts') || '[]'),
  activeTab: 'mappa',
  map: null,
  mapMarkers: {},
  proximityCircle: null,
  citizenMarker: null,
  safeRoutePolyline: null,
  isDesktopCardCollapsed: false,
  userLocation: { lat: 40.1740, lng: 18.1710, name: "Galatina Centro (Puglia)" },
  realGpsLocation: { lat: 40.1740, lng: 18.1710 },
  selectedRadius: 100, // Raggio fissato a 100m
  currentCategory: 'incidente',
  uploadedPhotoBase64: null,
  activeTestScenario: null,
  banTimerInterval: null
};

let visionModel = null;

// Durata in secondi per livello di gravità: Giallo = 3h, Arancione = 12h, Rosso = 24h
function getDurationBySeverity(severity) {
  const sev = (severity || '').toUpperCase();
  if (sev === 'ROSSO') return 24 * 3600;     // 24 ore (86400s)
  if (sev === 'ARANCIONE') return 12 * 3600; // 12 ore (43200s)
  return 3 * 3600;                           // 3 ore (10800s) - GIALLO
}

function formatRemainingTime(secondsLeft) {
  if (secondsLeft <= 0) return 'Scaduto';
  const totalMins = Math.ceil(secondsLeft / 60);
  if (totalMins < 60) return `${totalMins} min`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Identifica correttamente il Comune dando priorità assoluta all'indirizzo testuale inserito
function resolveMunicipalityName(lat, lng, indirizzo = '') {
  const addrLower = (indirizzo || '').toLowerCase();

  // 1. Controllo esplicito nel testo dell'indirizzo
  if (addrLower.includes('galatina') || addrLower.includes('noha') || addrLower.includes('collemeto') || addrLower.includes('ostante')) {
    return 'Galatina';
  }
  if (addrLower.includes('brindisi')) {
    return 'Brindisi';
  }
  if (addrLower.includes('san donaci')) {
    return 'San Donaci';
  }
  if (addrLower.includes('lecce')) {
    return 'Lecce';
  }

  // 2. Fallback sulle coordinate geografiche se l'indirizzo è generico
  if (lat >= 40.12 && lat <= 40.23 && lng >= 18.10 && lng <= 18.25) {
    return 'Galatina';
  }
  if (lat >= 40.55 && lat <= 40.70 && lng >= 17.85 && lng <= 18.05) {
    return 'Brindisi';
  }
  if (lat >= 40.42 && lat <= 40.48 && lng >= 17.88 && lng <= 17.96) {
    return 'San Donaci';
  }
  if (lat >= 40.31 && lat <= 40.40 && lng >= 18.12 && lng <= 18.23) {
    return 'Lecce';
  }

  const cleanPart = (indirizzo || '')
    .split(',')
    .map(p => p.trim())
    .find(p => p.length > 2 && !p.startsWith('Posizione'));

  if (cleanPart) return cleanPart;

  return 'Galatina'; // Default di zona
}

// Pre-carica il modello di Computer Vision in background all'avvio
(async function loadVisionAI() {
  if (window.cocoSsd) {
    try {
      visionModel = await cocoSsd.load();
      console.log("SecurCity Vision AI pronta.");
    } catch (e) {
      console.warn("Vision AI fallback attivo.");
    }
  }
})();

document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  initMap();
  renderMunicipalityAlerts();
  await checkAuthSession();
  await fetchReports();

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

  window.addEventListener('resize', () => {
    if (state.map) state.map.invalidateSize();
  });

  // Rimuove automaticamente i pericoli scaduti e aggiorna la lista ogni 10 secondi
  setInterval(() => {
    pruneExpiredReports();
    fetchReports();
  }, 10000);
});

function pruneExpiredReports() {
  const now = Date.now();
  const initialLen = state.reports.length;
  state.reports = state.reports.filter(r => {
    if (!r.expires_at) return true;
    const rem = Math.floor((r.expires_at - now) / 1000);
    r.seconds_left = Math.max(0, rem);
    return rem > 0;
  });

  if (state.reports.length !== initialLen) {
    renderMapMarkers();
    renderHazardsList();
  }
}

// ------------------- OPENSTREETMAP (ZERO API KEY) ------------------- //

function initMap() {
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([state.userLocation.lat, state.userLocation.lng], 15);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    subdomains: ['a', 'b', 'c']
  }).addTo(state.map);

  updateUserLocationMarker();

  setTimeout(() => {
    state.map.invalidateSize();
  }, 300);

  // Rileva posizione GPS reale del dispositivo (se autorizzata)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.realGpsLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.userLocation.lat = pos.coords.latitude;
        state.userLocation.lng = pos.coords.longitude;
        updateUserLocationMarker();
        state.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      () => {
        state.realGpsLocation = { lat: state.userLocation.lat, lng: state.userLocation.lng };
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }

  // Click sulla mappa: consente di affinare il punto SOLO entro 100m dalla propria posizione reale
  state.map.on('click', (e) => {
    const dist = getDistanceMeters(
      state.realGpsLocation.lat,
      state.realGpsLocation.lng,
      e.latlng.lat,
      e.latlng.lng
    );

    if (dist > 100) {
      alert(`⛔ Blocco Geografico (Max 100m): il punto selezionato dista ${Math.round(dist)}m dalla tua posizione reale. Puoi segnalare solo entro 100m da dove ti trovi!`);
      return;
    }

    state.userLocation.lat = e.latlng.lat;
    state.userLocation.lng = e.latlng.lng;
    updateUserLocationMarker();

    const addrInput = document.getElementById('reportIndirizzo');
    if (addrInput) {
      addrInput.value = `Posizione verificata (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`;
    }
  });
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // raggio terrestre in metri
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateUserLocationMarker() {
  if (state.proximityCircle) {
    state.map.removeLayer(state.proximityCircle);
  }

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
          ${state.currentUser ? state.currentUser.nome : "La mia posizione"}
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
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      state.realGpsLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.userLocation.lat = pos.coords.latitude;
      state.userLocation.lng = pos.coords.longitude;
      updateUserLocationMarker();
      state.map.flyTo([pos.coords.latitude, pos.coords.longitude], 15, { duration: 0.8 });
    }, () => {
      state.userLocation.lat = state.realGpsLocation.lat;
      state.userLocation.lng = state.realGpsLocation.lng;
      updateUserLocationMarker();
      state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 15, { duration: 0.8 });
    });
  } else {
    state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 15, { duration: 0.8 });
  }
}

function setRadius(meters) {
  state.selectedRadius = 100;
  const btn = document.getElementById('radBtn100');
  if (btn) {
    btn.className = "px-2.5 py-1 rounded bg-neutral-900 text-white font-bold text-[10px] transition";
  }

  updateUserLocationMarker();
  renderHazardsList();
}

function checkRouteInputs() {
  const startVal = (document.getElementById('routeStart')?.value || '').trim();
  const endVal = (document.getElementById('routeEnd')?.value || '').trim();
  const actionBox = document.getElementById('safeRouteActionContainer');

  if (!actionBox) return;

  if (startVal.length > 0 && endVal.length > 0) {
    actionBox.classList.remove('hidden');
  } else {
    actionBox.classList.add('hidden');
  }
}

function swapRouteEndpoints() {
  const start = document.getElementById('routeStart');
  const end = document.getElementById('routeEnd');
  if (start && end) {
    const tmp = start.value;
    start.value = end.value;
    end.value = tmp;
    checkRouteInputs();
  }
}

function clearSafeRoute() {
  if (state.safeRoutePolyline) {
    state.map.removeLayer(state.safeRoutePolyline);
    state.safeRoutePolyline = null;
  }
  const summary = document.getElementById('safeRouteSummaryBox');
  if (summary) summary.classList.add('hidden');
}

async function resolvePlaceCoords(queryText) {
  const q = queryText.toLowerCase().trim();
  if (q === 'la mia posizione' || q === 'posizione attuale' || q === 'gps') {
    return { lat: state.userLocation.lat, lng: state.userLocation.lng, label: 'La mia posizione' };
  }

  const minLng = state.userLocation.lng - 0.3;
  const maxLat = state.userLocation.lat + 0.3;
  const maxLng = state.userLocation.lng + 0.3;
  const minLat = state.userLocation.lat - 0.3;
  const viewbox = `${minLng},${maxLat},${maxLng},${minLat}`;

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&viewbox=${viewbox}&q=${encodeURIComponent(queryText)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data && data.length > 0) {
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      label: data[0].display_name.split(',')[0]
    };
  }
  return null;
}

async function calculateSafeRoute() {
  const startText = (document.getElementById('routeStart')?.value || '').trim();
  const endText = (document.getElementById('routeEnd')?.value || '').trim();

  if (!startText || !endText) {
    alert("Inserisci sia la partenza che la destinazione!");
    return;
  }

  clearSafeRoute();

  try {
    const startCoords = await resolvePlaceCoords(startText);
    const endCoords = await resolvePlaceCoords(endText);

    if (!startCoords || !endCoords) {
      alert("Indirizzo non trovato sulla mappa. Prova a specificare meglio la via o il comune.");
      return;
    }

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}?overview=full&geometries=geojson`;
    const routeRes = await fetch(osrmUrl);
    const routeData = await routeRes.json();

    let latLngs = [];
    let distanceKm = 0;
    let durationMin = 0;

    if (routeData.routes && routeData.routes.length > 0) {
      const r = routeData.routes[0];
      latLngs = r.geometry.coordinates.map(coord => [coord[1], coord[0]]);
      distanceKm = (r.distance / 1000).toFixed(1);
      durationMin = Math.max(1, Math.round(r.duration / 60));
    } else {
      latLngs = [
        [startCoords.lat, startCoords.lng],
        [endCoords.lat, endCoords.lng]
      ];
    }

    state.safeRoutePolyline = L.polyline(latLngs, {
      color: '#0099FF',
      weight: 6,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(state.map);

    state.map.fitBounds(state.safeRoutePolyline.getBounds(), { padding: [50, 50] });

    const nearbyHazards = state.reports.filter(rep =>
      latLngs.some(pt => getDistanceMeters(pt[0], pt[1], rep.lat, rep.lng) <= 100)
    );

    const summaryBox = document.getElementById('safeRouteSummaryBox');
    const summaryText = document.getElementById('safeRouteSummaryText');
    if (summaryBox && summaryText) {
      summaryBox.classList.remove('hidden');
      summaryText.innerHTML = nearbyHazards.length > 0
        ? `<b>${startCoords.label} → ${endCoords.label}</b> (${distanceKm} km · ~${durationMin} min). ⚠️ Rilevati <b>${nearbyHazards.length} pericoli</b> nel raggio di 100m lungo la tratta.`
        : `<b>${startCoords.label} → ${endCoords.label}</b> (${distanceKm} km · ~${durationMin} min). ✅ Tratta libera da pericoli segnalati.`;
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    alert("Errore nel calcolo del percorso sicuro. Riprova tra un attimo.");
  }
}

// ------------------- MOBILE NAVIGATION & BOTTOM SHEET ------------------- //

function mobileSwitchTab(tab) {
  state.activeTab = tab;

  const tabs = ['mappa', 'notifiche-pericoli', 'notifiche-comune', 'istruzioni', 'legenda'];
  const mNavMap = {
    'mappa': document.getElementById('mNavMappa'),
    'notifiche-pericoli': document.getElementById('mNavPericoli'),
    'notifiche-comune': document.getElementById('mNavComune'),
    'istruzioni': document.getElementById('mNavIstruzioni'),
    'legenda': document.getElementById('mNavLegenda')
  };

  tabs.forEach(t => {
    const btn = mNavMap[t];
    if (btn) {
      btn.className = "flex flex-col items-center py-1 px-2 text-neutral-400 font-medium transition relative";
    }
  });

  const activeBtn = mNavMap[tab];
  if (activeBtn) {
    activeBtn.className = "flex flex-col items-center py-1 px-2 text-neutral-900 font-bold transition relative";
  }

  const sheet = document.getElementById('mobileBottomSheet');
  const sheetTitle = document.getElementById('mobileSheetTitle');
  const sheetContent = document.getElementById('mobileSheetContent');

  if (tab === 'mappa') {
    closeMobileBottomSheet();
    centerUserLocation();
  } else if (tab === 'notifiche-pericoli') {
    sheetTitle.textContent = "Pericoli Attivi in Zona";
    sheetContent.innerHTML = generateHazardsListHtml();
    sheet.classList.remove('hidden');
  } else if (tab === 'notifiche-comune') {
    sheetTitle.textContent = "Notifiche Inoltrate al Comune";
    sheetContent.innerHTML = generateMunicipalityListHtml();
    sheet.classList.remove('hidden');
  } else if (tab === 'istruzioni') {
    sheetTitle.textContent = "Guida dell'App · Come Funziona";
    sheetContent.innerHTML = `
      <div class="space-y-2.5 text-xs text-neutral-600">
        <div class="p-3 bg-neutral-50 rounded-xl border border-neutral-200">
          <ul class="space-y-2 text-[11px] list-disc pl-4">
            <li><strong class="text-neutral-900">Navigazione:</strong> Inserisci la tua destinazione per calcolare il percorso migliore.</li>
            <li><strong class="text-neutral-900">Segnala un pericolo:</strong> Tocca il pulsante di segnalazione per avvisare gli utenti.</li>
            <li><strong class="text-neutral-900">Parametri dell'evento:</strong> Scegli il raggio, la gravità e scatta una foto live.</li>
            <li><strong class="text-neutral-900">Controllo Anti-IA:</strong> Un sistema di riconoscimento verifica l'autenticità dell'immagine.</li>
          </ul>
        </div>
      </div>
    `;
    sheet.classList.remove('hidden');
  } else if (tab === 'legenda') {
    sheetTitle.textContent = "Legenda Livelli di Gravità";
    sheetContent.innerHTML = `
      <div class="space-y-2.5 text-xs">
        <div class="p-2.5 rounded-xl border border-yellow-200 bg-yellow-50/80 flex items-start gap-2.5">
          <span class="w-4 h-4 rounded-full bg-severity-yellow shrink-0 mt-0.5"></span>
          <div>
            <h5 class="font-bold text-yellow-900 text-xs">Gravità Bassa (Giallo · Scade dopo 3h)</h5>
            <p class="text-[11px] text-yellow-800 leading-tight mt-0.5">Ostacoli minori o disagi temporanei.</p>
          </div>
        </div>
        <div class="p-2.5 rounded-xl border border-amber-200 bg-amber-50/80 flex items-start gap-2.5">
          <span class="w-4 h-4 rounded-full bg-severity-orange shrink-0 mt-0.5"></span>
          <div>
            <h5 class="font-bold text-amber-900 text-xs">Gravità Media (Arancione · Scade dopo 12h)</h5>
            <p class="text-[11px] text-amber-800 leading-tight mt-0.5">Situazioni di pericolo moderato.</p>
          </div>
        </div>
        <div class="p-2.5 rounded-xl border border-red-200 bg-red-50/80 flex items-start gap-2.5">
          <span class="w-4 h-4 rounded-full bg-severity-red shrink-0 mt-0.5"></span>
          <div>
            <h5 class="font-bold text-red-900 text-xs">Gravità Alta (Rosso · Scade dopo 24h)</h5>
            <p class="text-[11px] text-red-700 leading-tight mt-0.5">Emergenze gravi e ad alto rischio.</p>
          </div>
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

  const tabs = ['mappa', 'notifiche-pericoli', 'notifiche-comune', 'istruzioni', 'legenda'];
  const tabBtnMap = {
    'mappa': document.getElementById('tabBtnMappa'),
    'notifiche-pericoli': document.getElementById('tabBtnPericoli'),
    'notifiche-comune': document.getElementById('tabBtnComune'),
    'istruzioni': document.getElementById('tabBtnIstruzioni'),
    'legenda': document.getElementById('tabBtnLegenda')
  };
  const contentMap = {
    'mappa': document.getElementById('desktopContentMappa'),
    'notifiche-pericoli': document.getElementById('desktopContentPericoli'),
    'notifiche-comune': document.getElementById('desktopContentComune'),
    'istruzioni': document.getElementById('desktopContentIstruzioni'),
    'legenda': document.getElementById('desktopContentLegenda')
  };

  tabs.forEach(t => {
    const btn = tabBtnMap[t];
    const content = contentMap[t];
    if (btn) {
      btn.className = "flex-1 py-1.5 px-1 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition text-center flex items-center justify-center gap-1 text-[10px] font-bold";
    }
    if (content) {
      content.classList.add('hidden');
    }
  });

  const activeBtn = tabBtnMap[tab];
  const activeContent = contentMap[tab];

  if (activeBtn) {
    activeBtn.className = "flex-1 py-1.5 px-1 rounded-lg bg-neutral-900 text-white shadow-xs transition text-center flex items-center justify-center gap-1 text-[10px] font-bold";
  }
  if (activeContent) {
    activeContent.classList.remove('hidden');
  }

  if (tab === 'mappa') {
    if (state.map) state.map.invalidateSize();
  } else if (tab === 'notifiche-pericoli') {
    renderHazardsList();
  } else if (tab === 'notifiche-comune') {
    renderMunicipalityAlerts();
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
      const now = Date.now();
      const serverReports = (data.reports || []).map(r => {
        const expectedMaxSeconds = getDurationBySeverity(r.severity);
        const existing = state.reports.find(old => String(old.id) === String(r.id));
        const expiresAt = existing?.expires_at || (now + (r.seconds_left && r.seconds_left <= expectedMaxSeconds ? r.seconds_left : expectedMaxSeconds) * 1000);
        const secondsLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
        return {
          ...r,
          expires_at: expiresAt,
          seconds_left: secondsLeft
        };
      }).filter(r => r.seconds_left > 0);

      state.reports = serverReports;
      renderMapMarkers();
      renderHazardsList();
      syncMunicipalityAlerts(state.reports);
    }
  } catch (err) {
    console.error("Failed fetching reports:", err);
  }
}

function getCategoryIconUrl(cat) {
  const c = cat.toLowerCase();
  if (c.includes('incidente')) return '/icons/incidente.png';
  if (c.includes('allag')) return '/icons/allagamento.png';
  if (c.includes('palo')) return '/icons/palo.png';
  if (c.includes('rissa')) return '/icons/rissa.png';
  if (c.includes('molest')) return '/icons/gente che disturba.png';
  if (c.includes('manifest')) return '/icons/fastidio.png';
  return '/icons/ostacolo.png';
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
    let pinColor = '#EAB308';
    let pulseClass = '';
    if (r.severity === 'ROSSO') {
      pinColor = '#EF4444';
      pulseClass = 'custom-pulse-red';
    } else if (r.severity === 'ARANCIONE') {
      pinColor = '#F59E0B';
    }

    const iconUrl = getCategoryIconUrl(r.categoria);
    const timeFormatted = formatRemainingTime(r.seconds_left);

    const icon = L.divIcon({
      className: 'custom-hazard-pin',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-11 h-11 rounded-full overflow-hidden border-2 border-white shadow-xl bg-white ${pulseClass}" style="box-shadow: 0 0 0 2px ${pinColor};">
            <img src="${iconUrl}" alt="${r.categoria}" class="w-full h-full object-cover" />
          </div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    const marker = L.marker([r.lat, r.lng], { icon }).addTo(state.map);
    
    const popupContent = `
      <div class="p-2 max-w-xs font-sans text-xs">
        <div class="flex items-center justify-between mb-1">
          <span class="px-2 py-0.5 rounded text-[10px] font-black text-white" style="background-color: ${pinColor}">
            CODICE ${r.severity}
          </span>
          <span class="text-[10px] text-neutral-400 font-bold">Scade in ${timeFormatted}</span>
        </div>
        <div class="flex items-center gap-2 my-1">
          <img src="${iconUrl}" class="w-7 h-7 rounded-full object-cover border border-neutral-200 shrink-0" />
          <h4 class="font-extrabold text-xs text-neutral-900 uppercase">${r.categoria}</h4>
        </div>
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
    const timeFormatted = formatRemainingTime(r.seconds_left);

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
          <span class="text-[10px] text-neutral-400">Rimozione tra ${timeFormatted}</span>
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

// ------------------- MOTORE NOTIFICHE COMUNE (> 3 SEGNALAZIONI IDENTICHE NELLO STESSO COMUNE) ------------------- //

function syncMunicipalityAlerts(currentReports) {
  let history = JSON.parse(localStorage.getItem('securcity_reports_history') || '[]');

  currentReports.forEach(rep => {
    if (!history.some(h => String(h.id) === String(rep.id))) {
      const comuneName = resolveMunicipalityName(rep.lat, rep.lng, rep.indirizzo);
      history.push({
        id: rep.id,
        categoria: rep.categoria.toLowerCase().trim(),
        comune: comuneName,
        lat: rep.lat,
        lng: rep.lng,
        indirizzo: rep.indirizzo || `Zona ${comuneName}`,
        descrizione: rep.descrizione,
        severity: rep.severity,
        timestamp: rep.timestamp || new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  localStorage.setItem('securcity_reports_history', JSON.stringify(history));

  const clusters = [];

  history.forEach(item => {
    const itemComune = item.comune || resolveMunicipalityName(item.lat, item.lng, item.indirizzo);

    // Raggruppa SOLO segnalazioni della stessa categoria, nello STESSO COMUNE e entro 150m
    const existingCluster = clusters.find(c =>
      c.categoria === item.categoria &&
      c.comune.toLowerCase() === itemComune.toLowerCase() &&
      getDistanceMeters(c.lat, c.lng, item.lat, item.lng) <= 150
    );

    if (existingCluster) {
      existingCluster.count += 1;
      existingCluster.lastUpdate = item.timestamp || new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      existingCluster.latestDesc = item.descrizione;
      if (item.severity === 'ROSSO') existingCluster.severity = 'ROSSO';
    } else {
      clusters.push({
        id: `comune_${itemComune.toLowerCase()}_${item.categoria}_${item.lat.toFixed(4)}_${item.lng.toFixed(4)}`,
        categoria: item.categoria,
        comune: itemComune,
        lat: item.lat,
        lng: item.lng,
        indirizzo: item.indirizzo,
        latestDesc: item.descrizione,
        severity: item.severity,
        count: 1,
        lastUpdate: item.timestamp || new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // Filtra SOLO i pericoli con PIÙ DI 3 segnalazioni identiche nello stesso comune (> 3, quindi da 4 in poi)
  const escalated = clusters.filter(c => c.count > 3);

  const prevAlerts = state.municipalityAlerts || [];
  escalated.forEach(alertItem => {
    const old = prevAlerts.find(p => p.id === alertItem.id);
    if (!old) {
      showProximityAlert(
        `🏛️ Segnalazione Inviata al Comune di ${alertItem.comune}!`,
        `Superate 3 segnalazioni identiche per "${alertItem.categoria.toUpperCase()}" a ${alertItem.comune} (${alertItem.count} totali).`
      );
    } else if (alertItem.count > old.count) {
      showProximityAlert(
        `🏛️ Aggiornamento Comune di ${alertItem.comune}`,
        `Nuova ricorrenza per "${alertItem.categoria.toUpperCase()}" a ${alertItem.comune} (aggiornato a ${alertItem.count} segnalazioni).`
      );
    }
  });

  state.municipalityAlerts = escalated;
  localStorage.setItem('securcity_comune_alerts', JSON.stringify(escalated));
  renderMunicipalityAlerts();
}

function generateMunicipalityListHtml() {
  const alerts = state.municipalityAlerts || [];
  if (alerts.length === 0) {
    return `
      <div class="text-center py-6 text-neutral-400 text-xs bg-neutral-50 rounded-2xl border border-neutral-200/70 p-4">
        <p class="font-bold text-neutral-700 mb-1">Nessuna criticità ricorrente</p>
        <p class="text-[11px] leading-relaxed">Quando un pericolo viene segnalato <b>più di 3 volte</b> nello stesso Comune, compare qui ed è inoltrato all'Ufficio Tecnico competente.</p>
      </div>
    `;
  }

  return alerts.map(a => {
    const iconUrl = getCategoryIconUrl(a.categoria);
    const comuneLabel = a.comune || resolveMunicipalityName(a.lat, a.lng, a.indirizzo);
    return `
      <div class="p-3 rounded-2xl border-2 border-blue-200 bg-blue-50/40 hover:bg-blue-50 transition shadow-xs cursor-pointer" onclick="panToHazard(${a.lat}, ${a.lng}, '')">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-600 text-white flex items-center gap-1">
            🏛️ Comune di ${comuneLabel}
          </span>
          <span class="text-[10px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
            ${a.count} segnalazioni
          </span>
        </div>

        <div class="flex items-center gap-2 my-1">
          <img src="${iconUrl}" class="w-7 h-7 rounded-full object-cover border border-blue-200 shrink-0" />
          <div>
            <h4 class="font-extrabold text-xs text-neutral-900 uppercase">${a.categoria}</h4>
            <span class="text-[10px] text-neutral-500 block">${a.indirizzo}</span>
          </div>
        </div>

        <p class="text-[11px] text-neutral-700 mt-1 mb-2 leading-snug">${a.latestDesc}</p>

        <div class="pt-1.5 border-t border-blue-200/60 flex items-center justify-between text-[10px] text-blue-900 font-semibold">
          <span>Stato: Presa in carico (${comuneLabel})</span>
          <span>Agg. ${a.lastUpdate}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderMunicipalityAlerts() {
  const count = (state.municipalityAlerts || []).length;

  const badgeDesk = document.getElementById('badgeComuneCount');
  if (badgeDesk) badgeDesk.textContent = count;

  const badgeMob = document.getElementById('mBadgeComune');
  if (badgeMob) badgeMob.textContent = count;

  const label = document.getElementById('comuneCountLabel');
  if (label) label.textContent = `${count} criticità`;

  const container = document.getElementById('comuneListContainer');
  if (container) container.innerHTML = generateMunicipalityListHtml();

  const sheetContent = document.getElementById('mobileSheetContent');
  if (sheetContent && state.activeTab === 'notifiche-comune') {
    sheetContent.innerHTML = generateMunicipalityListHtml();
  }
}

function panToHazard(lat, lng, id) {
  closeMobileBottomSheet();
  state.map.flyTo([lat, lng], 17, { duration: 1 });
  if (id && state.mapMarkers[id]) {
    setTimeout(() => state.mapMarkers[id].openPopup(), 1100);
  }
}

// ------------------- VERIFICA FOTOCAMERA PER VOTI (C'È / NON C'È PIÙ) ------------------- //

let pendingVote = { id: null, type: null };
let voteMediaStream = null;

function confirmHazard(id) {
  openVoteVerifyModal(id, 'confirm');
}

function resolveHazard(id) {
  openVoteVerifyModal(id, 'resolve');
}

async function openVoteVerifyModal(id, type) {
  if (!state.currentUser) {
    alert("Accedi o registrati per votare una segnalazione!");
    showAuthModal();
    return;
  }
  if (state.currentUser.is_banned) {
    alert("Il tuo account è sospeso per 24 ore!");
    return;
  }

  pendingVote = { id, type };
  const modal = document.getElementById('voteVerifyModal');
  const header = document.getElementById('voteModalHeader');
  const title = document.getElementById('voteModalTitle');
  const desc = document.getElementById('voteModalDesc');
  const feedback = document.getElementById('voteAiFeedback');
  const video = document.getElementById('voteCameraStream');
  const preview = document.getElementById('votePhotoPreview');
  const btn = document.getElementById('btnCaptureVotePhoto');

  feedback.classList.add('hidden');
  preview.classList.add('hidden');
  video.classList.remove('hidden');
  btn.disabled = false;
  btn.innerHTML = `<i data-lucide="aperture" class="w-4 h-4"></i> <span>Scatta Foto e Conferma Voto</span>`;

  if (type === 'confirm') {
    header.className = "p-3.5 bg-neutral-900 text-white flex items-center justify-between";
    title.textContent = "Conferma «👍 C'è ancora»";
    desc.textContent = "Inquadra il pericolo sul posto per confermare che è ancora presente.";
  } else {
    header.className = "p-3.5 bg-red-600 text-white flex items-center justify-between";
    title.textContent = "Conferma «❌ Non c'è più»";
    desc.textContent = "Inquadra la strada libera per dimostrare che il pericolo è stato rimosso.";
  }

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();

  try {
    voteMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    video.srcObject = voteMediaStream;
  } catch (err) {
    feedback.classList.remove('hidden');
    feedback.className = "p-2.5 rounded-xl border text-xs bg-amber-50 border-amber-300 text-amber-800";
    feedback.textContent = "Fotocamera non rilevata: usa i pulsanti Test qui sotto per la demo.";
  }
}

function closeVoteVerifyModal() {
  if (voteMediaStream) {
    voteMediaStream.getTracks().forEach(t => t.stop());
    voteMediaStream = null;
  }
  document.getElementById('voteVerifyModal').classList.add('hidden');
}

async function captureAndVerifyVote() {
  const video = document.getElementById('voteCameraStream');
  const canvas = document.getElementById('voteCameraCanvas');
  const preview = document.getElementById('votePhotoPreview');
  const feedback = document.getElementById('voteAiFeedback');
  const btn = document.getElementById('btnCaptureVotePhoto');

  if (!video || !video.videoWidth) {
    alert("Attendi l'avvio della fotocamera o usa i tasti Test per la demo.");
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const photoData = canvas.toDataURL('image/jpeg', 0.85);

  if (voteMediaStream) {
    voteMediaStream.getTracks().forEach(t => t.stop());
    voteMediaStream = null;
  }

  video.classList.add('hidden');
  preview.src = photoData;
  preview.classList.remove('hidden');

  btn.disabled = true;
  btn.innerHTML = `<span>Verifica Bot AI in corso...</span>`;
  feedback.classList.remove('hidden');
  feedback.className = "p-2.5 rounded-xl border text-xs bg-neutral-100 border-neutral-300 text-neutral-800 animate-pulse";
  feedback.innerHTML = `<b>Bot AI Vision:</b> Verifica corrispondenza con la segnalazione...`;

  const targetReport = state.reports.find(r => String(r.id) === String(pendingVote.id));
  const reportCategory = targetReport ? targetReport.categoria : 'incidente';
  const reportDesc = targetReport ? targetReport.descrizione : 'Verifica strada sul posto';

  let check = { valid: false, reason: "" };

  if (pendingVote.type === 'confirm') {
    check = await analyzeImageStrict(photoData, reportCategory, reportDesc);
    if (!check.valid) {
      check.reason = `La foto non corrisponde al pericolo segnalato (${reportCategory.toUpperCase()}): ${check.reason}`;
    }
  } else {
    check = await analyzeImageStrict(photoData, 'ostacolo', 'Verifica strada libera da pericoli');
    if (!check.valid && check.reason.includes("contesto stradale riconoscibile")) {
      check = { valid: true, reason: "Carreggiata libera verificata in tempo reale." };
    }
  }

  setTimeout(() => {
    executeVoteResult(check.valid, check.reason);
  }, 800);
}

function simulateVoteVerification(isValid) {
  const feedback = document.getElementById('voteAiFeedback');
  feedback.classList.remove('hidden');
  feedback.className = "p-2.5 rounded-xl border text-xs bg-neutral-100 border-neutral-300 text-neutral-800 animate-pulse";
  feedback.innerHTML = `<b>Bot AI Vision:</b> Controllo autenticità scena sul posto...`;

  setTimeout(() => {
    if (isValid) {
      executeVoteResult(true, "Scena stradale verificata in tempo reale.");
    } else {
      executeVoteResult(false, "Foto non valida o non pertinente alla carreggiata (possibile abuso).");
    }
  }, 800);
}

async function executeVoteResult(isValid, reason) {
  const feedback = document.getElementById('voteAiFeedback');
  const btn = document.getElementById('btnCaptureVotePhoto');

  if (!isValid) {
    feedback.className = "p-2.5 rounded-xl border text-xs bg-red-50 border-red-300 text-red-900";
    feedback.innerHTML = `
      <div class="font-bold text-red-700 mb-0.5">⚠️ VOTO RESPINTO DAL BOT AI</div>
      <p>${reason}</p>
    `;
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="refresh-cw" class="w-4 h-4"></i> <span>Riprova Scatto</span>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  feedback.className = "p-2.5 rounded-xl border text-xs bg-emerald-50 border-emerald-300 text-emerald-800";
  feedback.innerHTML = `
    <div class="font-bold mb-0.5">✓ VERIFICA LIVE SUPERATA</div>
    <p>${reason} Registrazione voto in corso...</p>
  `;

  const endpoint = pendingVote.type === 'confirm'
    ? `/api/reports/${pendingVote.id}/confirm`
    : `/api/reports/${pendingVote.id}/resolve`;

  try {
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();

    setTimeout(async () => {
      closeVoteVerifyModal();
      await fetchReports();
      if (res.ok && data.message) {
        alert(data.message);
      }
    }, 1000);
  } catch (err) {
    closeVoteVerifyModal();
  }
}

// ------------------- REPORT MODAL & BOT AI ------------------- //

function selectCategory(cat, btnElement) {
  state.currentCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.className = "cat-btn p-2 border border-neutral-200 hover:bg-neutral-50 rounded-xl text-center text-xs font-semibold transition";
  });
  if (btnElement) {
    btnElement.className = "cat-btn active p-2 border-2 border-red-600 bg-red-50 text-red-700 rounded-xl text-center text-xs font-bold transition";
  }
}

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

let mediaStream = null;

function closeReportModal() {
  stopLiveCamera();
  document.getElementById('reportModal').classList.add('hidden');
}

async function startLiveCamera() {
  const video = document.getElementById('cameraStream');
  const btnStart = document.getElementById('btnStartCamera');
  const btnCapture = document.getElementById('btnCapturePhoto');

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    video.srcObject = mediaStream;
    video.classList.remove('hidden');
    btnStart.classList.add('hidden');
    btnCapture.classList.remove('hidden');
  } catch (err) {
    alert("Impossibile accedere alla fotocamera. Verifica i permessi del browser!");
  }
}

function stopLiveCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  const video = document.getElementById('cameraStream');
  const btnStart = document.getElementById('btnStartCamera');
  const btnCapture = document.getElementById('btnCapturePhoto');
  if (video) video.classList.add('hidden');
  if (btnStart) btnStart.classList.remove('hidden');
  if (btnCapture) btnCapture.classList.add('hidden');
}

function captureLivePhoto() {
  const video = document.getElementById('cameraStream');
  const canvas = document.getElementById('cameraCanvas');
  if (!video || !video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  state.uploadedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);
  state.activeTestScenario = 'live_camera';

  document.getElementById('photoPreviewImg').src = state.uploadedPhotoBase64;
  document.getElementById('photoPreviewContainer').classList.remove('hidden');
  document.getElementById('photoUploadControls').classList.add('hidden');

  stopLiveCamera();
}

function clearPhoto() {
  stopLiveCamera();
  state.uploadedPhotoBase64 = null;
  state.activeTestScenario = null;
  document.getElementById('photoPreviewContainer').classList.add('hidden');
  document.getElementById('photoUploadControls').classList.remove('hidden');
}

function loadDemoPhoto(type) {
  stopLiveCamera();
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

async function analyzeImageStrict(base64Img, category, description) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 100;
      canvas.height = 100;
      ctx.drawImage(img, 0, 0, 100, 100);
      const data = ctx.getImageData(0, 0, 100, 100).data;

      let totalBrightness = 0;
      let flatColorCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        totalBrightness += (r + g + b) / 3;
        if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) flatColorCount++;
      }

      if ((totalBrightness / 10000) < 30 || (totalBrightness / 10000) > 235 || (flatColorCount / 10000) > 0.85) {
        resolve({ valid: false, reason: "Immagine ostruita, troppo buia o priva di dettagli (muro o obiettivo coperto)." });
        return;
      }

      if (!visionModel && window.cocoSsd) {
        try { visionModel = await cocoSsd.load(); } catch (e) {}
      }

      if (visionModel) {
        const predictions = await visionModel.detect(img);
        const detectedClasses = predictions.map(p => p.class);

        const hasPerson = predictions.some(p => p.class === 'person' && p.score > 0.45);
        const hasVehicle = predictions.some(p => ['car', 'truck', 'bus', 'motorcycle', 'bicycle'].includes(p.class) && p.score > 0.40);
        const hasStreetElement = predictions.some(p => ['traffic light', 'stop sign', 'fire hydrant', 'bench'].includes(p.class));
        const hasIndoorObject = predictions.some(p => ['chair', 'laptop', 'tv', 'keyboard', 'mouse', 'cell phone', 'book', 'bottle', 'cup', 'bed', 'couch'].includes(p.class) && p.score > 0.45);

        if (hasIndoorObject) {
          resolve({
            valid: false,
            reason: `Rilevato ambiente interno/oggetto personale (${detectedClasses.join(', ')}). Non è una strada!`
          });
          return;
        }

        if (hasPerson && !hasVehicle && category !== 'rissa' && category !== 'molestie') {
          resolve({
            valid: false,
            reason: "Rilevata foto personale / selfie: nessuna corrispondenza con il pericolo '" + category.toUpperCase() + "'."
          });
          return;
        }

        if (category === 'incidente' && !hasVehicle) {
          resolve({
            valid: false,
            reason: "Per segnalare un INCIDENTE è necessario inquadrare almeno un veicolo coinvolto sulla carreggiata."
          });
          return;
        }

        if ((category === 'rissa' || category === 'molestie') && !hasPerson) {
          resolve({
            valid: false,
            reason: "Nessuna persona rilevata nella scena per la categoria '" + category.toUpperCase() + "'."
          });
          return;
        }

        if ((category === 'strada allagata' || category === 'palo pericolante' || category === 'ostacolo') && !hasVehicle && !hasStreetElement) {
          resolve({
            valid: false,
            reason: `La foto non mostra un contesto stradale riconoscibile per '${category.toUpperCase()}'.`
          });
          return;
        }

        resolve({
          valid: true,
          reason: `Vision AI: verificati elementi coerenti (${detectedClasses.length > 0 ? detectedClasses.join(', ') : 'contesto stradale'}).`
        });
        return;
      }

      resolve({ valid: false, reason: "Impossibile verificare la corrispondenza con il pericolo selezionato." });
    };
    img.src = base64Img;
  });
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
    alert("Devi scattare una foto in diretta con la fotocamera!");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span>Verifica posizione (Max 100m)...</span>`;

  let targetLat = state.userLocation.lat;
  let targetLng = state.userLocation.lng;

  if (indirizzo && !indirizzo.startsWith("Posizione verificata") && !indirizzo.startsWith("Posizione GPS")) {
    try {
      const cleanQuery = indirizzo.replace(/·/g, ',').replace(/\//g, ',');
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(cleanQuery)}`);
      const geoData = await geoRes.json();

      if (geoData && geoData.length > 0) {
        targetLat = parseFloat(geoData[0].lat);
        targetLng = parseFloat(geoData[0].lon);
      } else {
        const fallbackCity = cleanQuery.split(',')[0].replace(/\(.*?\)/g, '').trim();
        const fallbackRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(fallbackCity)}`);
        const fallbackData = await fallbackRes.json();
        if (fallbackData && fallbackData.length > 0) {
          targetLat = parseFloat(fallbackData[0].lat);
          targetLng = parseFloat(fallbackData[0].lon);
        }
      }
    } catch (e) {
      console.warn("Errore geocoding:", e);
    }
  }

  const distFromReal = getDistanceMeters(
    state.realGpsLocation.lat,
    state.realGpsLocation.lng,
    targetLat,
    targetLng
  );

  if (distFromReal > 100) {
    const distLabel = distFromReal >= 1000
      ? `${(distFromReal / 1000).toFixed(1)} km`
      : `${Math.round(distFromReal)} metri`;

    alert(`⛔ Segnalazione Impedita: il punto indicato ("${indirizzo || 'punto selezionato'}") si trova a ${distLabel} dalla tua posizione reale.\n\nPuoi inviare segnalazioni SOLO entro 100 metri da dove ti trovi!`);

    state.userLocation.lat = state.realGpsLocation.lat;
    state.userLocation.lng = state.realGpsLocation.lng;
    updateUserLocationMarker();

    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Invia Segnalazione</span>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  box.classList.remove('hidden');
  box.className = "p-2.5 rounded-xl border text-xs bg-neutral-100 border-neutral-300 text-neutral-800 animate-pulse";
  box.innerHTML = `<b>Bot AI Vision:</b> Scansione oggetti, verifica live e coerenza con il pericolo...`;

  let scenarioToSend = state.activeTestScenario;
  let localRejectReason = "";

  if (state.activeTestScenario === 'live_camera') {
    const check = await analyzeImageStrict(state.uploadedPhotoBase64, state.currentCategory, desc);
    if (!check.valid) {
      scenarioToSend = 'fake_meme';
      localRejectReason = check.reason;
    } else {
      scenarioToSend = state.currentCategory === 'incidente' || state.currentCategory === 'rissa' ? 'valid_red' : 'valid_orange';
    }
  }

  const sentLat = targetLat + (Math.random() - 0.5) * 0.00015;
  const sentLng = targetLng + (Math.random() - 0.5) * 0.00015;
  const resolvedComune = resolveMunicipalityName(sentLat, sentLng, indirizzo);

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
        lat: sentLat,
        lng: sentLng,
        indirizzo: indirizzo || `Posizione verificata (${resolvedComune})`,
        test_scenario: scenarioToSend
      })
    });

    const data = await res.json();

    if (res.ok && scenarioToSend !== 'fake_meme') {
      const assignedSeverity = (data.codice_gravita || 'GIALLO').toUpperCase();
      const durationSec = getDurationBySeverity(assignedSeverity);

      box.className = "p-2.5 rounded-xl border text-xs bg-emerald-50 border-emerald-300 text-emerald-800";
      box.innerHTML = `
        <div class="font-bold mb-0.5">✓ FOTO LIVE AUTENTICA APPROVATA</div>
        <p><b>Codice:</b> ${assignedSeverity} (Durata: ${formatRemainingTime(durationSec)}) · <b>Comune:</b> ${resolvedComune} — ${data.dettagli}</p>
      `;

      const nuovaSegnalazione = {
        id: data.report_id || Date.now().toString(),
        categoria: state.currentCategory,
        descrizione: desc,
        severity: assignedSeverity,
        lat: sentLat,
        lng: sentLng,
        indirizzo: indirizzo || `Sul posto (${resolvedComune})`,
        foto_url: state.uploadedPhotoBase64,
        ai_reason: data.dettagli || 'Convalidata da Bot AI Vision',
        expires_at: Date.now() + durationSec * 1000,
        seconds_left: durationSec,
        confirm_count: 1,
        resolved_count: 0,
        distance_meters: Math.round(distFromReal)
      };

      setTimeout(async () => {
        closeReportModal();
        clearPhoto();
        document.getElementById('reportDesc').value = '';
        box.classList.add('hidden');
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Invia Segnalazione</span>`;

        state.userLocation.lat = state.realGpsLocation.lat;
        state.userLocation.lng = state.realGpsLocation.lng;
        updateUserLocationMarker();

        await fetchReports();
        if (!state.reports.some(r => String(r.id) === String(nuovaSegnalazione.id))) {
          state.reports.unshift(nuovaSegnalazione);
          renderMapMarkers();
          renderHazardsList();
          syncMunicipalityAlerts(state.reports);
        }

        checkAuthSession();
      }, 1500);

    } else {
      const rejectMsg = localRejectReason || data.message || "Immagine non conforme ai criteri di sicurezza stradale.";
      if (data.status === 'BANNED') {
        box.className = "p-2.5 rounded-xl border text-xs bg-red-50 border-red-300 text-red-900";
        box.innerHTML = `
          <div class="font-bold text-red-700 mb-0.5">⛔ 3° STRIKE: ACCOUNT SOSPESO PER 24 ORE</div>
          <p>${rejectMsg}</p>
        `;
      } else {
        box.className = "p-2.5 rounded-xl border text-xs bg-amber-50 border-amber-300 text-amber-900";
        box.innerHTML = `
          <div class="font-bold text-amber-800 mb-0.5">⚠️ SEGNALAZIONE RESPINTA (${data.strike_count || 1}/3 STRIKE)</div>
          <p>${rejectMsg}</p>
        `;
      }

      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Invia Segnalazione</span>`;
      checkAuthSession();
    }
  } catch (err) {
    alert("Errore di connessione con il server.");
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Invia Segnalazione</span>`;
  }
}

// ------------------- SIMULATORE GIULIA A 100M ------------------- //

function simulateGiuliaApproach() {
  const targetHazard = state.reports.find(r => r.severity === 'ROSSO') || state.reports[0];
  if (!targetHazard) return;

  state.userLocation.lat = targetHazard.lat - 0.00075;
  state.userLocation.lng = targetHazard.lng;
  updateUserLocationMarker();
  state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 17, { duration: 1 });

  setTimeout(() => {
    showProximityAlert(
      "Allerta Prossimità (A 85m)",
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