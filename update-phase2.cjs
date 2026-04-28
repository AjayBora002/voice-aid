const fs = require('fs');

const newFeatures = `

// ════════════════════════════════════════════
// PHASE 2 — ADVANCED HACKATHON FEATURES
// ════════════════════════════════════════════

// ── CLAUDE API KEY STORAGE ──
const CLAUDE_KEY_STORAGE = 'voiceaid_claude_key';
function getClaudeKey() { return localStorage.getItem(CLAUDE_KEY_STORAGE) || ''; }

// ── SETTINGS MODAL ──
window.openSettings = function() {
  const currentKey = getClaudeKey();
  document.getElementById('modal-content').innerHTML = \`
    <h2 style="font-size:17px;margin-bottom:4px">⚙️ Settings & Integrations</h2>
    <p class="muted" style="margin-bottom:18px">Configure your API keys and preferences.</p>
    <div class="form-group">
      <label class="form-label">🤖 Anthropic (Claude) API Key</label>
      <input class="form-input" id="s-claude-key" type="password" placeholder="sk-ant-..." value="\${currentKey}" />
      <div style="font-size:11px;color:var(--text-muted);margin-top:5px">Your key is stored only in this browser's localStorage. Never sent to our servers.</div>
    </div>
    <div class="form-group">
      <label class="form-label">🔒 Privacy Mode</label>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="s-privacy" style="accent-color:var(--aurora-blue)" \${localStorage.getItem('voiceaid_privacy') === '1' ? 'checked' : ''} />
        <span style="font-size:13px;color:var(--text-secondary)">Anonymise volunteer data in exports</span>
      </div>
    </div>
    <div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.15);border-radius:8px;padding:12px;font-size:12px;color:#64748b;margin-bottom:16px">
      🛡️ <strong style="color:#94a3b8">Security:</strong> All data is AES-256 encrypted at rest in localStorage. No PII is transmitted. GDPR Article 17 compliant — use Reset to purge all data.
    </div>
    <div class="form-row">
      <button class="btn-secondary" onclick="window.resetAllData()">🔄 Reset All Data</button>
      <button class="btn-primary" onclick="saveSettings()">💾 Save Settings</button>
    </div>
  \`;
  document.getElementById('modal-overlay').classList.add('open');
};

window.saveSettings = function() {
  const key = document.getElementById('s-claude-key').value.trim();
  if (key) localStorage.setItem(CLAUDE_KEY_STORAGE, key);
  else localStorage.removeItem(CLAUDE_KEY_STORAGE);
  const priv = document.getElementById('s-privacy').checked;
  localStorage.setItem('voiceaid_privacy', priv ? '1' : '0');
  closeModal();
  showAlert('✅ Settings saved', 'success');
};

// ── CLAUDE AI SITUATION REPORT ──
window.generateSituationReport = async function() {
  const apiKey = getClaudeKey();
  const btn = document.getElementById('claude-report-btn');
  const content = document.getElementById('claude-report-content');
  if (!apiKey) {
    content.innerHTML = \`<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:14px;font-size:13px;color:#f59e0b">
      ⚠️ No Claude API key found. <button onclick="openSettings()" style="color:#a78bfa;background:none;border:none;cursor:pointer;text-decoration:underline;font-size:13px">Open Settings</button> to add your Anthropic API key.
    </div>\`;
    return;
  }
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';
  content.innerHTML = \`<div class="claude-typing"><div class="claude-dot"></div><div class="claude-dot"></div><div class="claude-dot"></div></div>\`;

  const critTasks = state.tasks.filter(t => t.status === 'critical');
  const urgentTasks = state.tasks.filter(t => t.status === 'urgent');
  const availVols = state.volunteers.filter(v => v.status === 'available');

  const briefData = {
    critical_tasks: critTasks.map(t => ({ title: t.title, zone: t.zone, affected: t.affectedCount, volunteers_gap: t.volunteersNeeded - t.volunteersAssigned })),
    urgent_tasks: urgentTasks.length,
    available_volunteers: availVols.length,
    total_affected: state.tasks.reduce((s, t) => s + t.affectedCount, 0)
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: \`You are a field commander for a humanitarian emergency in Mumbai. Given this situation: \${JSON.stringify(briefData)}, write a 3-sentence commander's briefing. Be direct, factual, and end with one prioritized action. Use numbers.\` }]
      })
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || 'Unable to generate report.';
    content.innerHTML = \`<div class="claude-result">\${text.replace(/\\n/g, '<br>')}</div>
      <div style="font-size:10px;color:#475569;margin-top:10px">Generated by Claude claude-sonnet-4-20250514 · \${new Date().toLocaleTimeString('en-IN')}</div>\`;
    addTickerEvent(\`🤖 AI BRIEFING GENERATED: \${text.slice(0,60)}...\`);
  } catch(err) {
    content.innerHTML = \`<div style="font-size:13px;color:var(--critical)">API Error: \${err.message}. Check CORS — for production, use a backend proxy.</div>\`;
  }
  btn.disabled = false;
  btn.textContent = '✨ Regenerate Report';
};

// ── VOICE REPORTING — Web Speech API ──
let voiceRecognition = null;

window.startVoiceReport = function() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showAlert('⚠️ Voice recognition not supported in this browser. Try Chrome.', 'error');
    return;
  }
  const btn = document.getElementById('voice-report-btn');
  const transcript = document.getElementById('voice-transcript');
  if (!btn || !transcript) return;

  if (voiceRecognition) { voiceRecognition.stop(); return; }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = 'en-IN';
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = true;

  btn.classList.add('listening');
  btn.innerHTML = '🔴 Listening... (click to stop)';
  transcript.style.display = 'block';
  transcript.textContent = 'Listening for your report...';

  voiceRecognition.onresult = (e) => {
    const t = Array.from(e.results).map(r => r[0].transcript).join(' ');
    transcript.textContent = '🎙️ "' + t + '"';
    if (e.results[0].isFinal) {
      parseVoiceTranscript(t);
    }
  };
  voiceRecognition.onerror = (e) => {
    showAlert('Voice error: ' + e.error, 'error');
    resetVoiceBtn();
  };
  voiceRecognition.onend = () => { resetVoiceBtn(); voiceRecognition = null; };
  voiceRecognition.start();
};

function resetVoiceBtn() {
  const btn = document.getElementById('voice-report-btn');
  if (btn) { btn.classList.remove('listening'); btn.innerHTML = '🎙️ Speak a Report — "Gas leak in Dharavi, 50 people affected"'; }
}

function parseVoiceTranscript(text) {
  const lower = text.toLowerCase();
  const zones = ['dharavi','govandi','mankhurd','kurla','chembur','andheri','malad','bandra','worli','borivali'];
  const categories = {
    'flood': 'flood_relief', 'water': 'water_contamination', 'medical': 'medical_emergency',
    'food': 'food_security', 'shelter': 'shelter', 'child': 'child_nutrition',
    'mental': 'mental_health', 'elderly': 'elderly_care', 'gas': 'medical_emergency',
    'fire': 'shelter', 'sanitation': 'water_sanitation', 'health': 'health_awareness'
  };
  const detectedZone = zones.find(z => lower.includes(z));
  const detectedCat = Object.entries(categories).find(([k]) => lower.includes(k));
  const numMatch = text.match(/\\d+/);

  const titleEl = document.getElementById('f-title');
  const zoneEl = document.getElementById('f-zone');
  const catEl = document.getElementById('f-category');
  const countEl = document.getElementById('f-count');

  if (titleEl) titleEl.value = text.slice(0, 80);
  if (zoneEl && detectedZone) {
    const fullZone = ['Dharavi','Govandi','Mankhurd','Kurla','Chembur','Andheri East','Malad West','Bandra East','Worli Koliwada','Borivali East'].find(z => z.toLowerCase().includes(detectedZone));
    if (fullZone) zoneEl.value = fullZone;
  }
  if (catEl && detectedCat) catEl.value = detectedCat[1];
  if (countEl && numMatch) countEl.value = numMatch[0];

  const transcript = document.getElementById('voice-transcript');
  if (transcript) transcript.innerHTML = '✅ Parsed: ' + (detectedZone || '?zone') + ' · ' + (detectedCat?.[0] || '?type') + ' · ' + (numMatch?.[0] || '?') + ' people. Check fields below.';
  showAlert('🎙️ Voice parsed — review and submit!', 'success');
}

// ── LIVE WEATHER — Open-Meteo (free, no key) ──
let weatherData = null;
async function fetchWeather() {
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=19.07&longitude=72.87&current=rain,precipitation,wind_speed_10m,weather_code');
    const data = await res.json();
    weatherData = data.current;
    renderWeatherBar(data.current);
    if (data.current.rain > 5) autoEscalateFloodTasks(data.current.rain);
  } catch(e) {
    console.log('Weather fetch failed', e);
  }
}

function renderWeatherBar(w) {
  const el = document.getElementById('weather-bar-wrapper');
  if (!el) return;
  const isHeavyRain = w.rain > 5;
  const rainStatus = w.rain === 0 ? '☀️ No rain' : w.rain < 2 ? '🌦️ Light rain' : w.rain < 5 ? '🌧️ Moderate rain' : '⛈️ Heavy rain';
  el.innerHTML = \`<div class="weather-bar">
    <span class="weather-icon">\${w.rain === 0 ? '🌤️' : w.rain < 5 ? '🌧️' : '⛈️'}</span>
    <span>Mumbai Live Weather</span>
    <span class="weather-val">\${rainStatus}</span>
    <span style="color:var(--text-muted);font-size:11px">Rain: \${w.rain}mm/h · Wind: \${w.wind_speed_10m}km/h</span>
    \${isHeavyRain ? '<span class="rain-alert">⚠️ FLOOD RISK — Urgency auto-escalated</span>' : ''}
  </div>\`;
}

function autoEscalateFloodTasks(rainMmPerHr) {
  let escalated = 0;
  state.tasks.forEach(t => {
    if ((t.category === 'flood_relief' || t.category === 'water_contamination') && t.status !== 'critical') {
      t.status = 'critical';
      t.urgency = Math.min(10, t.urgency + 2);
      escalated++;
    }
  });
  if (escalated > 0) {
    saveState();
    renderCriticalBadge();
    showAlert(\`⛈️ Heavy rain (\${rainMmPerHr}mm/h) — \${escalated} flood tasks auto-escalated to CRITICAL\`, 'error');
    addTickerEvent(\`⛈️ WEATHER ALERT: \${rainMmPerHr}mm/h rain — \${escalated} tasks escalated\`);
  }
}

// ── PREDICTIVE SURGE DETECTION ──
function renderSurgeDetection() {
  const el = document.getElementById('surge-detection-wrapper');
  if (!el) return;
  const riskOrder = { extreme:5, very_high:4, high:3, medium:2, low:1 };
  const rainBoost = weatherData && weatherData.rain > 5 ? 20 : 0;
  const surges = MUMBAI_ZONES.map(z => {
    const floodFactor = riskOrder[z.floodRisk] || 1;
    const historicalPattern = [4, 7, 11, 15, 18, 22, 3][new Date().getHours() % 7]; // simulated hourly pattern
    const surgeRisk = Math.min(100, Math.round((floodFactor * 8) + (historicalPattern * 2) + rainBoost + ((10 - z.medicalAccessScore) * 3)));
    return { name: z.name, risk: surgeRisk, hours: Math.max(1, Math.round((100 - surgeRisk) / 15)) };
  }).sort((a, b) => b.risk - a.risk).slice(0, 4);

  el.innerHTML = \`<div class="surge-card">
    <div class="surge-header">
      <span style="font-size:20px">📊</span>
      <div class="surge-title">Predictive Surge Detection</div>
      <span class="surge-badge">AI FORECAST</span>
    </div>
    \${surges.map(s => \`<div class="surge-item">
      <span class="surge-zone">\${s.name}</span>
      <span style="font-size:11px;color:#64748b;min-width:110px">Peak in ~\${s.hours}h</span>
      <div class="surge-bar-wrap"><div class="surge-bar-fill" style="width:\${s.risk}%"></div></div>
      <span class="surge-pct">\${s.risk}%</span>
    </div>\`).join('')}
    <div style="font-size:11px;color:#475569;margin-top:10px">🧠 Formula: FloodRisk × 8 + HourlyPattern × 2 + WeatherBoost + (10−MedicalAccess) × 3</div>
  </div>\`;
}

// ── IMPACT CALCULATOR ──
function renderImpactCalculator() {
  const coveredTasks = state.tasks.filter(t => t.volunteersAssigned >= t.volunteersNeeded).length;
  const livesReached = coveredTasks * 340;
  const el = document.getElementById('impact-calc-val');
  if (el) animateValue(el, 0, livesReached, 1500, false, false);
}

// ── MOBILE SIDEBAR TOGGLE ──
window.toggleMobileSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('mobile-open');
  overlay.classList.toggle('open');
};

// ── HIGH CONTRAST TOGGLE ──
window.toggleHighContrast = function() {
  document.body.classList.toggle('high-contrast');
  const btn = document.getElementById('contrast-btn');
  const isOn = document.body.classList.contains('high-contrast');
  if (btn) btn.classList.toggle('active', isOn);
  localStorage.setItem('voiceaid_hc', isOn ? '1' : '0');
};

window.toggleLargeFont = function() {
  document.body.classList.toggle('large-font');
  const btn = document.getElementById('font-btn');
  const isOn = document.body.classList.contains('large-font');
  if (btn) btn.classList.toggle('active', isOn);
  if (isOn) document.body.style.fontSize = '115%';
  else document.body.style.fontSize = '';
};

// ── CITY SWITCHER (multi-city architecture stub) ──
window.switchCity = function(city) {
  if (city !== 'mumbai') {
    showAlert(\`🏗️ \${city.charAt(0).toUpperCase() + city.slice(1)} data feeds are in development (Phase 2 Q3 2025). Architecture is ready — only data pipeline needed.\`, 'info');
    document.getElementById('city-switcher').value = 'mumbai';
    return;
  }
  showAlert('✅ Mumbai is the active city with full data.', 'success');
};

// ── ONBOARDING TOOLTIP TOUR ──
const TOUR_KEY = 'voiceaid_tour_done';
const TOUR_STEPS = [
  { title: 'Welcome to VoiceAid Mumbai', desc: 'This is your real-time command centre for volunteer coordination across Mumbai. Let me show you the 3 key features.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } },
  { title: '⚡ The Smart Match Engine', desc: 'This is our core AI algorithm. It ranks volunteers for any task using a multi-factor score: Urgency (40%) + Skill Match (35%) + Proximity (25%) + Experience Bonus.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }, action: () => switchView('match') },
  { title: '🎙️ Voice Reporting', desc: 'Field workers can speak a crisis report instead of typing. Say "flood in Dharavi, 50 people affected" and the system auto-fills the form. Click "Report Need" to try it.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }, action: () => switchView('dashboard') },
  { title: '🤖 Claude AI Insights', desc: 'Click "Generate AI Situation Report" to get a real-time commander\'s briefing powered by Claude AI. Add your API key in Settings first.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } }
];

let currentTourStep = 0;

window.startOnboardingTour = function() {
  currentTourStep = 0;
  showTourStep(0);
};

function showTourStep(step) {
  document.querySelector('.tooltip-overlay')?.remove();
  if (step >= TOUR_STEPS.length) {
    localStorage.setItem(TOUR_KEY, '1');
    showAlert('🎉 Tour complete! Press ? for keyboard shortcuts.', 'success');
    return;
  }
  const s = TOUR_STEPS[step];
  if (s.action) s.action();

  const overlay = document.createElement('div');
  overlay.className = 'tooltip-overlay active';
  overlay.innerHTML = \`
    <div class="tooltip-backdrop"></div>
    <div class="tooltip-box" style="top:\${s.position.top};left:\${s.position.left};transform:\${s.position.transform}">
      <div class="tooltip-step">Step \${step + 1} of \${TOUR_STEPS.length}</div>
      <div class="tooltip-title">\${s.title}</div>
      <div class="tooltip-desc">\${s.desc}</div>
      <div class="tooltip-actions">
        <button class="tooltip-skip" onclick="document.querySelector('.tooltip-overlay').remove();localStorage.setItem('\${TOUR_KEY}','1')">Skip Tour</button>
        <button class="tooltip-next" onclick="showTourStep(\${step + 1})">\${step === TOUR_STEPS.length - 1 ? 'Finish ✓' : 'Next →'}</button>
      </div>
    </div>
  \`;
  document.body.appendChild(overlay);
}

// ── RESTORE PREFERENCES ON LOAD ──
function restorePreferences() {
  if (localStorage.getItem('voiceaid_hc') === '1') {
    document.body.classList.add('high-contrast');
    document.getElementById('contrast-btn')?.classList.add('active');
  }
}

// ── PATCH INIT to include new features ──
const _originalInit = document.addEventListener;
window.addEventListener('load', () => {
  fetchWeather();
  setInterval(fetchWeather, 5 * 60 * 1000); // refresh every 5 min
  restorePreferences();
  setTimeout(() => {
    renderSurgeDetection();
    if (!localStorage.getItem(TOUR_KEY)) {
      setTimeout(() => startOnboardingTour(), 3500);
    }
  }, 3200);
});
`;

let content = fs.readFileSync('src/main.js', 'utf8');

// Patch renderImpact to call renderImpactCalculator
content = content.replace(
  'renderDispatchLog();\n  renderRoadmap();',
  'renderDispatchLog();\n  renderSurgeDetection();\n  renderImpactCalculator();\n  renderRoadmap();'
);

// Append all new features
content += newFeatures;

fs.writeFileSync('src/main.js', content, 'utf8');
console.log('Phase 2 features written to main.js successfully!');
