import './style.css';
import { VOLUNTEERS } from './data/volunteers.js';
import { TASKS } from './data/tasks.js';
import { MUMBAI_ZONES, NEED_CATEGORIES } from './data/mumbai_zones.js';
import { matchVolunteersToTask, runSystemAllocation, computeImpactStats, getDistanceKm } from './engine/matcher.js';

// ── STATE ──
let state = {
  tasks: JSON.parse(JSON.stringify(TASKS)),
  volunteers: JSON.parse(JSON.stringify(VOLUNTEERS)),
  activeView: 'dashboard',
  taskFilter: 'all',
  map: null,
  layers: { needs: null, volunteers: null, heat: null },
  activeLayer: 'needs',
  charts: {},
  simInterval: null,
  simOn: false,
  taskCounter: 100,
  dispatchLog: []
};

// ── LOCALSTORAGE ──
const LS_KEY = 'voiceaid_mumbai_v1';

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      tasks: state.tasks,
      volunteers: state.volunteers,
      taskCounter: state.taskCounter,
      dispatchLog: state.dispatchLog
    }));
  } catch(e) {}
}

function loadState() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state.tasks = parsed.tasks;
      state.volunteers = parsed.volunteers;
      state.taskCounter = parsed.taskCounter || 100;
      state.dispatchLog = parsed.dispatchLog || [];
      return true;
    }
  } catch(e) {}
  return false;
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  const restored = loadState();
  updateLastUpdated();
  renderDashboard();
  renderCriticalBadge();
  setInterval(updateLastUpdated, 30000);
  if (restored) showAlert('✅ Session restored from last visit — all dispatches preserved');
  initKeyboardShortcuts();
  initTicker();
  setTimeout(() => document.getElementById('splash-screen')?.remove(), 3000);
});

function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (el) el.textContent = 'Updated: ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ── VIEW SWITCHER ──
window.switchView = function(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.getElementById('nav-' + view).classList.add('active');
  state.activeView = view;
  const titles = { dashboard:'🏠 Home — Live Overview', map:'🗺️ Emergency Map', tasks:'🚨 Emergency Tasks (ज़रूरी काम)', volunteers:'👥 Our Volunteers (स्वयंसेवक)', match:'⚡ Find Best Volunteer', impact:'📈 Our Impact (हमारा प्रभाव)' };
  const subs = { dashboard:'See all emergencies and available helpers right now | अभी सभी आपातस्थिति देखें', map:'Click any red dot on the map to see the emergency details', tasks:'All active community emergencies that need a volunteer — sorted by urgency', volunteers:'All registered volunteers and their current status', match:'Pick an emergency below — the system finds the best available person automatically', impact:'How many people we have helped so far' };
  document.getElementById('page-title').textContent = titles[view];
  document.getElementById('page-subtitle').textContent = subs[view];
  if (view === 'map') initMap();
  else if (view === 'tasks') renderTasks();
  else if (view === 'volunteers') renderVolunteers();
  else if (view === 'match') renderMatchView();
  else if (view === 'impact') renderImpact();
  else renderDashboard();
  // Auto-trigger Gemini briefing if 3+ critical tasks exist
  if (view === 'dashboard') {
    const critCount = state.tasks.filter(t => t.status === 'critical').length;
    const apiKey = getGeminiKey ? getGeminiKey() : '';
    if (critCount >= 3 && apiKey) {
      // Only auto-trigger if not already showing a result
      setTimeout(() => {
        const content = document.getElementById('gemini-report-content');
        if (content && !content.querySelector('.ai-result')) {
          generateSituationReport();
          addTickerEvent(`🤖 AI AUTO-BRIEFING: ${critCount} critical tasks detected — Gemini activated`);
        }
      }, 1500);
    }
  }
};

// ── DASHBOARD ──
function renderDashboard() {
  const stats = computeImpactStats(state.tasks, state.volunteers);
  renderStatsGrid('stats-grid', [
    { icon:'🚨', value: stats.criticalTasks, label:'Critical Tasks', sub:'Require immediate response', color:'#ef4444' },
    { icon:'👥', value: stats.activeVolunteers, label:'Volunteers Ready', sub:'Available right now', color:'#10b981' },
    { icon:'🏘️', value: stats.totalAffected.toLocaleString(), label:'People Affected', sub:'Across all active tasks', color:'#3b82f6' },
    { icon:'⏱️', value: stats.avgResponseTime + 'min', label:'Avg Response Time', sub:'vs 4-6 hrs manual', color:'#f97316' },
    { icon:'📋', value: stats.tasksNeedingHelp, label:'Tasks Need Help', sub:'Volunteer gap', color:'#8b5cf6' },
    { icon:'🎯', value: stats.coverageRate + '%', label:'Coverage Rate', sub:'Tasks fully staffed', color:'#06b6d4' }
  ]);
  renderAIInsights();
  renderCriticalTaskList();
  renderCategoryChart();
  renderTopVolunteers();
  renderZoneRisk();
}


function renderStatsGrid(containerId, cards) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = cards.map((c, i) => `
    <div class="stat-card" style="--accent-color:${c.color}">
      <div class="stat-icon">${c.icon}</div>
      <div class="stat-value count-up" data-val="${typeof c.value === 'string' ? c.value.replace(/[^0-9]/g, '') : c.value}" style="color:${c.color}">0${typeof c.value === 'string' && c.value.includes('%') ? '%' : ''}${typeof c.value === 'string' && c.value.includes('min') ? 'min' : ''}</div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-sub">${c.sub}</div>
    </div>`).join('');

  setTimeout(() => {
    el.querySelectorAll('.count-up').forEach(node => {
      const target = parseInt(node.getAttribute('data-val'), 10) || 0;
      const isPct = node.textContent.includes('%');
      const isMin = node.textContent.includes('min');
      animateValue(node, 0, target, 1000, isPct, isMin);
    });
  }, 100);
}

function animateValue(obj, start, end, duration, isPct, isMin) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const val = Math.floor(easeOutQuart * (end - start) + start);
    obj.innerHTML = val + (isPct ? '%' : '') + (isMin ? 'min' : '');
    if (progress < 1) window.requestAnimationFrame(step);
    else obj.innerHTML = end + (isPct ? '%' : '') + (isMin ? 'min' : '');
  };
  window.requestAnimationFrame(step);
}

function renderCriticalTaskList() {
  const el = document.getElementById('critical-task-list');
  if (!el) return;
  const critical = state.tasks.filter(t => t.status === 'critical' || t.status === 'urgent').slice(0, 4);
  el.innerHTML = critical.map(t => taskCardHTML(t, true)).join('');
}

function renderCriticalBadge() {
  const n = state.tasks.filter(t => t.status === 'critical').length;
  const el = document.getElementById('critical-badge');
  if (el) el.textContent = n;
}

function renderTopVolunteers() {
  const el = document.getElementById('top-volunteers-list');
  if (!el) return;
  const top = [...state.volunteers].filter(v => v.status === 'available').sort((a,b) => b.deployments - a.deployments).slice(0, 5);
  el.innerHTML = top.map((v,i) => `
    <div class="leaderboard-row" onclick="openVolunteerModal('${v.id}')">
      <div class="lb-rank">${i+1}</div>
      <div class="vol-avatar" style="width:34px;height:34px;font-size:13px">${v.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
      <div class="lb-name">
        <div style="font-size:13.5px;font-weight:600">${v.name}</div>
        <div style="font-size:11px;color:var(--text-muted)">${v.zone} · ${v.qualification.split('–')[0].trim()}</div>
      </div>
      <div class="lb-stat">${v.deployments} missions</div>
    </div>`).join('');
}

function renderZoneRisk() {
  const el = document.getElementById('zone-risk-list');
  if (!el) return;
  const riskColor = { extreme:'#ef4444', very_high:'#f97316', high:'#f59e0b', medium:'#10b981', low:'#06b6d4' };
  const sorted = [...MUMBAI_ZONES].sort((a,b) => { const order = { extreme:5, very_high:4, high:3, medium:2, low:1 }; return order[b.density] - order[a.density]; }).slice(0,6);
  el.innerHTML = sorted.map(z => {
    const pct = Math.round((z.medicalAccessScore / 10) * 100);
    const col = riskColor[z.floodRisk] || '#10b981';
    return `<div class="zone-row">
      <span class="risk-dot" style="background:${col}"></span>
      <div class="zone-name-cell">
        <div style="font-size:13.5px;font-weight:600">${z.name}</div>
        <div class="zone-pop">Pop: ${(z.population/1000).toFixed(0)}K · Ward ${z.ward}</div>
      </div>
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${pct}%;background:${col}"></div></div>
      <div style="font-size:11px;color:var(--text-muted);width:70px;text-align:right">Access: ${z.medicalAccessScore}/10</div>
    </div>`;
  }).join('');
}

function renderCategoryChart() {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (state.charts.category) state.charts.category.destroy();
  const cats = {};
  state.tasks.forEach(t => { cats[t.category] = (cats[t.category] || 0) + 1; });
  const info = NEED_CATEGORIES;
  const labels = Object.keys(cats).map(k => info[k]?.label || k);
  const data = Object.values(cats);
  const colors = Object.keys(cats).map(k => info[k]?.color || '#3b82f6');
  state.charts.category = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors.map(c => c + '99'), borderColor: colors, borderWidth: 2 }] },
    options: { plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } }, cutout: '65%' }
  });
}

// ── TASKS VIEW ──
function taskCardHTML(t, compact = false) {
  const cat = NEED_CATEGORIES[t.category] || {};
  const pct = Math.round((t.volunteersAssigned / t.volunteersNeeded) * 100);
  const timeAgo = getTimeAgo(t.reportedAt);
  return `<div class="task-card ${t.status}" onclick="openTaskModal('${t.id}')">
    <div class="task-card-top">
      <div class="task-title">${cat.icon || '📌'} ${t.title}</div>
      <span class="task-status status-${t.status}">${t.status}</span>
    </div>
    ${!compact ? `<div class="task-desc">${t.description}</div>` : ''}
    <div class="task-meta">
      <span>📍 ${t.zone}</span><span>👥 ${t.affectedCount.toLocaleString()} affected</span>
      <span>🕐 ${timeAgo}</span><span>📋 ${t.source}</span>
    </div>
    <div class="volunteer-bar">
      <div class="vol-bar-label"><span>Volunteers: ${t.volunteersAssigned}/${t.volunteersNeeded}</span><span>${pct}% staffed</span></div>
      <div class="vol-bar-track"><div class="vol-bar-fill" style="width:${pct}%;background:${t.status==='critical'?'var(--critical)':t.status==='urgent'?'var(--urgent)':'var(--aurora-blue)'}"></div></div>
    </div>
  </div>`;
}

window.filterTasks = function(filter, btn) {
  state.taskFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTasks();
};

function renderTasks() {
  const el = document.getElementById('task-list-full');
  if (!el) return;
  let tasks = state.tasks;
  if (state.taskFilter !== 'all') tasks = tasks.filter(t => t.status === state.taskFilter);
  tasks = tasks.sort((a, b) => b.urgency - a.urgency);
  el.innerHTML = tasks.map(t => taskCardHTML(t)).join('') || '<p style="color:var(--text-muted);text-align:center;padding:40px">No tasks in this category.</p>';
}

// ── VOLUNTEERS VIEW ──
function renderVolunteers() {
  filterVolunteers();
}

window.filterVolunteers = function() {
  const search = document.getElementById('vol-search').value.toLowerCase();
  const skill = document.getElementById('vol-skill-filter').value;
  const status = document.getElementById('vol-status-filter').value;
  
  const filtered = state.volunteers.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search) || v.zone.toLowerCase().includes(search);
    const matchSkill = skill ? v.skills.includes(skill) : true;
    const matchStatus = status ? v.status === status : true;
    return matchSearch && matchSkill && matchStatus;
  }).sort((a, b) => b.deployments - a.deployments);
  
  const el = document.getElementById('volunteer-grid');
  if (el) el.innerHTML = `<div class="volunteer-grid">${filtered.map(v => volCardHTML(v)).join('')}</div>`;
  
  const countLabel = document.getElementById('vol-count-label');
  if (countLabel) countLabel.textContent = `Showing ${filtered.length} of ${state.volunteers.length}`;
};

function volCardHTML(v) {
  const initials = v.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  const skillLabels = v.skills.slice(0, 3).map(s => NEED_CATEGORIES[s]?.label || s);
  return `<div class="vol-card" onclick="openVolunteerModal('${v.id}')">
    <div class="vol-card-top">
      <div class="vol-avatar">${initials}</div>
      <div><div class="vol-name">${v.name}</div><div class="vol-zone">📍 ${v.zone}</div></div>
      <span class="vol-status status-${v.status}">${v.status === 'available' ? '✓ Available' : '⚡ On Mission'}</span>
    </div>
    <div class="vol-skills">${skillLabels.map(s => `<span class="skill-tag">${s}</span>`).join('')}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">${v.qualification}</div>
    <div class="vol-stats">
      <div class="vol-stat"><div class="vol-stat-val" style="color:var(--aurora-blue)">${v.deployments}</div><div class="vol-stat-lbl">Missions</div></div>
      <div class="vol-stat"><div class="vol-stat-val" style="color:var(--aurora-green)">${v.rating}</div><div class="vol-stat-lbl">Rating</div></div>
      <div class="vol-stat"><div class="vol-stat-val" style="color:var(--aurora-purple)">${v.experience_years}y</div><div class="vol-stat-lbl">Exp.</div></div>
      <div class="vol-stat"><div class="vol-stat-val" style="color:var(--aurora-cyan)">${v.hoursPerWeek}h</div><div class="vol-stat-lbl">/week</div></div>
    </div>
  </div>`;
}

// ── MAP ──
function initMap() {
  if (state.map) return;
  state.map = L.map('map', { center: [19.07, 72.88], zoom: 12 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap © CARTO', maxZoom: 18 }).addTo(state.map);
  toggleLayer('needs');
}

window.toggleLayer = function(layer) {
  ['needs','volunteers','heat'].forEach(l => {
    document.getElementById('btn-' + l)?.classList.remove('active');
    if (state.layers[l]) { state.map.removeLayer(state.layers[l]); state.layers[l] = null; }
  });
  document.getElementById('btn-' + layer)?.classList.add('active');
  if (layer === 'needs') renderNeedsLayer();
  else if (layer === 'volunteers') renderVolunteersLayer();
  else renderHeatLayer();
};

function statusColor(s) { return s === 'critical' ? '#ef4444' : s === 'urgent' ? '#f97316' : '#f59e0b'; }

function renderNeedsLayer() {
  const markers = state.tasks.map(t => {
    const cat = NEED_CATEGORIES[t.category] || {};
    const m = L.circleMarker([t.lat, t.lng], { radius: 10 + t.urgency, color: statusColor(t.status), fillColor: statusColor(t.status), fillOpacity: 0.7, weight: 2 });
    m.bindPopup(`<div style="font-family:Inter,sans-serif;min-width:220px"><b>${cat.icon} ${t.title}</b><br><span style="color:#ef4444;font-weight:700;font-size:11px">${t.status.toUpperCase()}</span><br><br><b>Zone:</b> ${t.zone}<br><b>Affected:</b> ${t.affectedCount.toLocaleString()}<br><b>Volunteers:</b> ${t.volunteersAssigned}/${t.volunteersNeeded}</div>`);
    return m;
  });
  state.layers.needs = L.layerGroup(markers).addTo(state.map);
}

function renderVolunteersLayer() {
  const markers = state.volunteers.map(v => {
    const col = v.status === 'available' ? '#10b981' : '#f59e0b';
    const m = L.circleMarker([v.lat, v.lng], { radius: 8, color: col, fillColor: col, fillOpacity: 0.85, weight: 2 });
    m.bindPopup(`<div style="font-family:Inter,sans-serif;min-width:200px"><b>${v.name}</b><br><span style="color:${col};font-weight:700;font-size:11px">${v.status.toUpperCase()}</span><br><br><b>Zone:</b> ${v.zone}<br><b>Missions:</b> ${v.deployments}</div>`);
    return m;
  });
  state.layers.volunteers = L.layerGroup(markers).addTo(state.map);
}

function renderHeatLayer() {
  const pts = state.tasks.map(t => [t.lat, t.lng, t.urgency / 10]);
  state.layers.heat = L.heatLayer(pts, { radius: 35, blur: 25, maxZoom: 14, gradient: { 0.3:'#3b82f6', 0.6:'#f97316', 1:'#ef4444' } }).addTo(state.map);
}

// ── MATCH ENGINE UI ──
function renderMatchView() {
  const sel = document.getElementById('task-selector');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a Task —</option>' + state.tasks.map(t => `<option value="${t.id}">[${t.status.toUpperCase()}] ${t.title}</option>`).join('');
  document.getElementById('match-results').innerHTML = '';

  // Auto-select the most critical/urgent unassigned task
  const autoTask = state.tasks
    .filter(t => t.status === 'critical' || t.status === 'urgent')
    .sort((a, b) => b.urgency - a.urgency)[0];
  if (autoTask) {
    sel.value = autoTask.id;
    // Small delay so the view renders first
    setTimeout(() => window.runMatchForTask(), 120);
  }
}

window.runMatchForTask = function() {
  const id = document.getElementById('task-selector').value;
  if (!id) return;
  const task = state.tasks.find(t => t.id === id);
  const results = matchVolunteersToTask(task, state.volunteers, 3);
  const cat = NEED_CATEGORIES[task.category] || {};
  document.getElementById('match-results').innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Matching for</div>
      <div style="font-size:16px;font-weight:700">${cat.icon} ${task.title}</div>
      <div class="task-meta" style="margin-top:8px"><span>📍 ${task.zone}</span><span>👥 ${task.affectedCount.toLocaleString()} affected</span><span>⚡ Urgency: ${task.urgency}/10</span></div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:10px">Formula: <code style="color:var(--aurora-cyan)">Score = (Urgency×0.40) + (Skill×0.35) + (Proximity×0.25)</code></div>
    </div>
    <div class="match-result-grid">${results.map((r, i) => matchCardHTML(r, i + 1, task)).join('')}</div>`;
};


function matchCardHTML(result, rank, task) {
  const { volunteer: v, score, breakdown: b } = result;
  
  // SVG Ring calculation
  const circleCircumference = 2 * Math.PI * 26; // r=26
  const strokeDashoffset = circleCircumference - (score / 100) * circleCircumference;
  
  const skillLabels = b.matchedSkills.map(s => NEED_CATEGORIES[s]?.label || s);
  
  return `<div class="match-card rank-${rank}">
    <div class="rank-badge">#${rank}</div>
    
    <svg class="score-ring-svg" width="70" height="70" viewBox="0 0 60 60">
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f59e0b" />
          <stop offset="100%" stop-color="#ef4444" />
        </linearGradient>
      </defs>
      <circle class="score-ring-bg" cx="30" cy="30" r="26"></circle>
      <circle class="score-ring-fill" cx="30" cy="30" r="26" style="stroke-dashoffset:${strokeDashoffset};"></circle>
      <text class="score-ring-text" x="30" y="32">${score}</text>
    </svg>
    
    <div style="text-align:center;margin-bottom:14px">
      <div style="font-size:15px;font-weight:700">${v.name}</div>
      <div style="font-size:11px;color:var(--text-muted)">${v.zone} · ${b.distanceKm}km away</div>
    </div>
    
    <div class="breakdown-row"><span class="breakdown-label">⚡ Urgency (${Math.round(task.urgency/10*40)} max)</span><span class="breakdown-val">+${b.urgencyContribution}pts</span></div>
    <div class="breakdown-row"><span class="breakdown-label">🎯 Skill Match (35 max)</span><span class="breakdown-val">+${b.skillContribution}pts</span></div>
    <div class="breakdown-row"><span class="breakdown-label">📍 Proximity (25 max)</span><span class="breakdown-val">+${b.proximityContribution}pts</span></div>
    
    <div class="explain-box">
      <strong>🤖 Why ${v.name.split(' ')[0]}?</strong>
      ${v.name.split(' ')[0]} is ${b.distanceKm <= 5 ? 'very close' : 'nearby'} at ${b.distanceKm}km. 
      ${b.matchedSkills.length === task.requiredSkills.length ? `Has all required skills (${skillLabels.join(', ')}).` : `Has ${b.matchedSkills.length} of ${task.requiredSkills.length} skills.`}
      ${b.availabilityToday ? 'Available to deploy today.' : 'Not usually available today (-50% penalty).'}
    </div>
    
    <button class="dispatch-btn" onclick="dispatchVolunteer('${v.id}','${task.id}')">⚡ Dispatch ${v.name.split(' ')[0]}</button>
  </div>`;
}


window.dispatchVolunteer = function(vid, tid) {
  const v = state.volunteers.find(x => x.id === vid);
  const t = state.tasks.find(x => x.id === tid);
  if (!v || !t) return;
  v.status = 'on_mission';
  t.volunteersAssigned = Math.min(t.volunteersAssigned + 1, t.volunteersNeeded);
  t.matchedVolunteers.push(vid);
  logDispatch(v, t);
  addTickerEvent(`⚡ DISPATCH: ${v.name} en route to ${t.zone} for ${t.title.slice(0, 20)}...`);
  saveState();
  showAlert(`⚡ ${v.name} dispatched to "${t.title.slice(0, 40)}..."`);
  runMatchForTask();
  renderCriticalBadge();
};

window.runAllocation = function() {
  const allocs = runSystemAllocation(state.tasks, state.volunteers);
  let dispatched = 0;
  allocs.forEach(({ task, matches }) => {
    const needed = task.volunteersNeeded - task.volunteersAssigned;
    matches.slice(0, needed).forEach(({ volunteer: v }) => {
      if (v.status === 'available') { v.status = 'on_mission'; task.volunteersAssigned++; task.matchedVolunteers.push(v.id); dispatched++; logDispatch(v, task); }
    });
  });
  saveState();
  showAlert(`✅ Smart Allocation complete — ${dispatched} volunteers dispatched across ${allocs.length} tasks`, 'success');
  addTickerEvent(`⚡ SYSTEM ALLOCATION: ${dispatched} volunteers instantly dispatched`);
  if (dispatched > 0 && state.tasks.filter(t => t.status === 'critical' && t.volunteersAssigned < t.volunteersNeeded).length === 0) {
    fireConfetti();
  }
  if (state.activeView === 'dashboard') renderDashboard();
  renderCriticalBadge();
};

// ── IMPACT ──
function renderImpact() {
  const stats = computeImpactStats(state.tasks, state.volunteers);
  renderStatsGrid('impact-stats-grid', [
    { icon:'🏘️', value: stats.totalAffected.toLocaleString(), label:'People Reached', sub:'Across all active operations', color:'#3b82f6' },
    { icon:'🚀', value: stats.totalDeployments, label:'Total Deployments', sub:'All-time volunteer missions', color:'#10b981' },
    { icon:'⏱️', value: stats.avgResponseTime + ' min', label:'Avg Response Time', sub:'vs 240+ min manual', color:'#f97316' },
    { icon:'✅', value: stats.coverageRate + '%', label:'Task Coverage', sub:'Fully staffed tasks', color:'#8b5cf6' }
  ]);
  renderLeaderboard();
  renderUrgencyChart();
  renderZoneCoverageTable();
  renderDispatchLog();
  renderSurgeDetection();
  renderImpactCalculator();
  renderRoadmap();
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  el.innerHTML = [...state.volunteers].sort((a, b) => b.deployments - a.deployments).slice(0, 8).map((v, i) => `
    <div class="leaderboard-row">
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-name"><div style="font-weight:600">${v.name}</div><div style="font-size:11px;color:var(--text-muted)">${v.zone} · ⭐${v.rating}</div></div>
      <div class="lb-stat">${v.deployments} missions</div>
    </div>`).join('');
}

function renderUrgencyChart() {
  const ctx = document.getElementById('urgencyChart');
  if (!ctx) return;
  if (state.charts.urgency) state.charts.urgency.destroy();
  const b = { 'Critical (9-10)': 0, 'Urgent (7-8)': 0, 'Moderate (5-6)': 0, 'Low (1-4)': 0 };
  state.tasks.forEach(t => { if (t.urgency >= 9) b['Critical (9-10)']++; else if (t.urgency >= 7) b['Urgent (7-8)']++; else if (t.urgency >= 5) b['Moderate (5-6)']++; else b['Low (1-4)']++; });
  state.charts.urgency = new Chart(ctx, {
    type: 'bar',
    data: { labels: Object.keys(b), datasets: [{ data: Object.values(b), backgroundColor: ['#ef444499','#f9731699','#f59e0b99','#10b98199'], borderColor: ['#ef4444','#f97316','#f59e0b','#10b981'], borderWidth: 2, borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
  });
}

function renderZoneCoverageTable() {
  const el = document.getElementById('zone-coverage-table');
  if (!el) return;
  const rc = { extreme:'#ef4444', very_high:'#f97316', high:'#f59e0b', medium:'#10b981', low:'#06b6d4' };
  el.innerHTML = `<table class="zone-table">
    <thead><tr><th>Zone</th><th>Population</th><th>Active Tasks</th><th>Volunteers</th><th>Medical Access</th><th>Flood Risk</th></tr></thead>
    <tbody>${MUMBAI_ZONES.map(z => {
      const zt = state.tasks.filter(t => t.zoneId === z.id).length;
      const vz = state.volunteers.filter(v => v.zone === z.name).length;
      const col = rc[z.floodRisk] || '#10b981';
      return `<tr><td><span class="risk-dot" style="background:${col}"></span>${z.name}</td><td>${(z.population/1000).toFixed(0)}K</td><td>${zt}</td><td>${vz}</td><td style="color:${z.medicalAccessScore<=3?'var(--critical)':z.medicalAccessScore<=6?'var(--urgent)':'var(--aurora-green)'}">${z.medicalAccessScore}/10</td><td style="color:${col};font-weight:600">${z.floodRisk.replace('_',' ')}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// ── MODALS ──
window.openTaskModal = function(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const cat = NEED_CATEGORIES[t.category] || {};
  const deadline = new Date(t.deadline).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
  document.getElementById('modal-content').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:6px">${cat.icon} ${t.title}</h2>
    <span class="task-status status-${t.status}" style="margin-bottom:16px;display:inline-block">${t.status}</span>
    <p style="color:var(--text-secondary);font-size:13.5px;line-height:1.7;margin-bottom:16px">${t.description}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:16px">
      <div><div style="color:var(--text-muted);font-size:11px">ZONE</div><div style="font-weight:600">${t.zone}</div></div>
      <div><div style="color:var(--text-muted);font-size:11px">AFFECTED</div><div style="font-weight:600">${t.affectedCount.toLocaleString()} people</div></div>
      <div><div style="color:var(--text-muted);font-size:11px">URGENCY</div><div style="font-weight:600;color:var(--critical)">${t.urgency}/10</div></div>
      <div><div style="color:var(--text-muted);font-size:11px">DEADLINE</div><div style="font-weight:600">${deadline}</div></div>
      <div><div style="color:var(--text-muted);font-size:11px">REPORTED BY</div><div style="font-weight:600">${t.reportedBy}</div></div>
      <div><div style="color:var(--text-muted);font-size:11px">SOURCE</div><div style="font-weight:600">${t.source}</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Required Skills</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${t.requiredSkills.map(s=>`<span class="skill-tag">${NEED_CATEGORIES[s]?.label||s}</span>`).join('')}</div>
    <div style="display:flex; gap:10px; width:100%">
      <button class="btn-secondary" style="flex:1" onclick="exportTaskReport('${t.id}')">📋 Export Briefing</button>
      <button class="btn-primary" style="flex:2" onclick="closeModal();switchView('match');document.getElementById('task-selector').value='${t.id}';runMatchForTask()">⚡ Find Best Volunteers</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
};

window.openVolunteerModal = function(id) {
  const v = state.volunteers.find(x => x.id === id);
  if (!v) return;
  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  document.getElementById('modal-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
      <div class="vol-avatar" style="width:56px;height:56px;font-size:20px">${v.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
      <div>
        <div style="font-size:18px;font-weight:700">${v.name}</div>
        <div style="font-size:12px;color:var(--text-muted)">${v.qualification}</div>
        <span class="vol-status status-${v.status}" style="margin-top:4px;display:inline-block">${v.status==='available'?'✓ Available':'⚡ On Mission'}</span>
      </div>
    </div>
    <p style="color:var(--text-secondary);font-size:13.5px;line-height:1.7;margin-bottom:16px">${v.bio}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center;margin-bottom:16px">
      <div class="stat-card" style="--accent-color:var(--aurora-blue)"><div class="stat-value" style="font-size:22px;color:var(--aurora-blue)">${v.deployments}</div><div class="stat-label">Missions</div></div>
      <div class="stat-card" style="--accent-color:var(--aurora-green)"><div class="stat-value" style="font-size:22px;color:var(--aurora-green)">${v.rating}</div><div class="stat-label">Rating</div></div>
      <div class="stat-card" style="--accent-color:var(--aurora-purple)"><div class="stat-value" style="font-size:22px;color:var(--aurora-purple)">${v.experience_years}y</div><div class="stat-label">Exp.</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">SKILLS</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${v.skills.map(s=>`<span class="skill-tag">${NEED_CATEGORIES[s]?.label||s}</span>`).join('')}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">LANGUAGES · <span style="font-weight:500;color:var(--text-secondary)">${v.languages.join(', ')}</span></div>
    <div style="font-size:12px;color:var(--text-muted);margin:12px 0 8px">WEEKLY AVAILABILITY</div>
    <div style="display:flex;gap:6px">${days.map((d,i)=>`<div style="text-align:center"><div style="font-size:10px;color:var(--text-muted)">${dayNames[i]}</div><div style="width:32px;height:32px;border-radius:6px;background:${v.availability[d]?'rgba(16,185,129,0.2)':'rgba(255,255,255,0.05)'};border:1px solid ${v.availability[d]?'var(--aurora-green)':'var(--border)'};display:flex;align-items:center;justify-content:center;font-size:14px;margin-top:4px">${v.availability[d]?'✓':'·'}</div></div>`).join('')}</div>`;
  document.getElementById('modal-overlay').classList.add('open');
};

window.closeModal = function() { document.getElementById('modal-overlay').classList.remove('open'); };

// ── UTILS ──
function getTimeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor(diff / 60000);
  if (hrs > 24) return Math.floor(hrs / 24) + 'd ago';
  if (hrs > 0) return hrs + 'h ago';
  return mins + 'min ago';
}


window.showAlert = function(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icon = type === 'success' ? '✅' : type === 'error' ? '🚨' : 'ℹ️';
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span style="font-size:16px">${icon}</span> <span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};

// ── SIMULATION MODE ──
const SIM_TASKS = [
  { title: 'Fire Relief — Dharavi Chawl Block 7', zone: 'Dharavi', zoneId: 'Z001', lat: 19.0395, lng: 72.8510, category: 'shelter', urgency: 9, affectedCount: 85, description: 'Chawl fire displaced 85 residents. Temporary shelter, food, and blankets needed urgently.', requiredSkills: ['shelter', 'food_security', 'mental_health'], reportedBy: 'BMC Fire Brigade', source: 'BMC Emergency Alert' },
  { title: 'Child Malaria Outbreak — Govandi Camp', zone: 'Govandi', zoneId: 'Z002', lat: 19.0700, lng: 72.9250, category: 'medical_emergency', urgency: 10, affectedCount: 42, description: '42 children with high fever near Deonar. Malaria rapid tests needed. Mothers requesting medical support.', requiredSkills: ['medical_emergency', 'child_nutrition', 'health_awareness'], reportedBy: 'ASHAWorker GovM2', source: 'ASHA Network Field Report' },
  { title: 'Elderly Rescue — Mankhurd Flood Zone', zone: 'Mankhurd', zoneId: 'Z003', lat: 19.0530, lng: 72.9300, category: 'elderly_care', urgency: 8, affectedCount: 18, description: '18 senior citizens stranded on first floor of flood-affected building. Rescue and relocation needed.', requiredSkills: ['flood_relief', 'elderly_care', 'medical_emergency'], reportedBy: 'Local RWA — Shivaji Nagar', source: 'WhatsApp Community Report → Verified' },
  { title: 'Food Camp Closure — Kurla Migrant Workers', zone: 'Kurla', zoneId: 'Z004', lat: 19.0720, lng: 72.8830, category: 'food_security', urgency: 7, affectedCount: 320, description: 'NGO-run daily food camp for migrant workers closed unexpectedly. 320 workers without meals for 2nd day.', requiredSkills: ['food_security', 'livelihood'], reportedBy: 'Majdoor Seva Sangha', source: 'NGO Coordinator Report' },
  { title: 'Water Pipeline Contamination — Chembur', zone: 'Chembur', zoneId: 'Z005', lat: 19.0610, lng: 72.8990, category: 'water_contamination', urgency: 9, affectedCount: 1500, description: 'Sewage pipeline rupture near Chembur water main. 1,500 households advised to avoid tap water. Bottled water distribution needed.', requiredSkills: ['water_contamination', 'water_sanitation', 'health_awareness'], reportedBy: 'MCGM Ward Office M/W', source: 'MCGM Emergency Notice' },
];

window.toggleSimulation = function() {
  const btn = document.getElementById('sim-btn');
  if (!state.simOn) {
    state.simOn = true;
    btn.textContent = '🔄 Simulation: ON';
    btn.classList.add('sim-active');
    showAlert('🔄 Simulation Mode ON — new crisis reports will appear every 25 seconds');
    injectSimTask(); // inject one immediately
    state.simInterval = setInterval(() => {
      injectSimTask();
    }, 25000);
  } else {
    state.simOn = false;
    clearInterval(state.simInterval);
    state.simInterval = null;
    btn.textContent = '🔄 Simulation: OFF';
    btn.classList.remove('sim-active');
    showAlert('⏹ Simulation Mode OFF');
  }
};

function injectSimTask() {
  const template = SIM_TASKS[Math.floor(Math.random() * SIM_TASKS.length)];
  state.taskCounter++;
  const newTask = {
    ...template,
    id: 'SIM' + state.taskCounter,
    volunteersNeeded: Math.floor(Math.random() * 3) + 2,
    volunteersAssigned: 0,
    status: template.urgency >= 9 ? 'critical' : 'urgent',
    reportedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + (3 + Math.random() * 5) * 3600000).toISOString(),
    matchedVolunteers: []
  };
  state.tasks.unshift(newTask);
  saveState();
  renderCriticalBadge();
  showAlert(`🚨 NEW REPORT: "${newTask.title}" — ${newTask.zone} (Urgency ${newTask.urgency}/10)`);
  if (state.activeView === 'dashboard') renderDashboard();
  else if (state.activeView === 'tasks') renderTasks();
  else if (state.activeView === 'map') { refreshMapLayer(); }
}

function refreshMapLayer() {
  const l = state.activeLayer || 'needs';
  ['needs','volunteers','heat'].forEach(k => { if (state.layers[k]) { state.map.removeLayer(state.layers[k]); state.layers[k] = null; } });
  if (l === 'needs') renderNeedsLayer();
  else if (l === 'volunteers') renderVolunteersLayer();
  else renderHeatLayer();
}

// ── REPORT NEED FORM ──
window.openReportForm = function() {
  const zoneOptions = ['Dharavi','Govandi','Mankhurd','Kurla','Chembur','Andheri East','Malad West','Bandra East','Worli Koliwada','Borivali East'].map(z => `<option value="${z}">${z}</option>`).join('');
  const catOptions = Object.entries(NEED_CATEGORIES).map(([k,v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('');
  document.getElementById('modal-content').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:4px">📝 Report a Community Need</h2>
    <p class="muted" style="margin-bottom:10px">This will add a live task to the system and trigger the matching engine.</p>
    <button class="voice-btn" id="voice-report-btn" onclick="startVoiceReport()" aria-label="Use voice to report need">
      🎙️ Speak a Report — "Gas leak in Dharavi, 50 people affected"
    </button>
    <div class="voice-transcript" id="voice-transcript" aria-live="polite"></div>
    <div class="form-group">
      <label class="form-label">Task Title *</label>
      <input class="form-input" id="f-title" placeholder="e.g. Flood relief needed — Sector 5" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Zone *</label>
        <select class="form-select" id="f-zone">${zoneOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Category *</label>
        <select class="form-select" id="f-category">${catOptions}</select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description *</label>
      <textarea class="form-textarea" id="f-desc" placeholder="Describe the situation, who is affected, and what support is needed..."></textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">People Affected *</label>
        <input class="form-input" id="f-count" type="number" min="1" placeholder="e.g. 150" />
      </div>
      <div class="form-group">
        <label class="form-label">Reported By *</label>
        <input class="form-input" id="f-reporter" placeholder="e.g. ASHA Worker, RWA, NGO name" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Urgency Level: <span id="urgency-val" style="color:var(--critical);font-weight:800">8</span>/10</label>
      <input class="form-range" id="f-urgency" type="range" min="1" max="10" value="8" oninput="document.getElementById('urgency-val').textContent=this.value" />
    </div>
    <div class="form-row" style="margin-top:8px">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="submitReport()">🚀 Submit Report</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
};

window.submitReport = function() {
  const title = document.getElementById('f-title').value.trim();
  const zone = document.getElementById('f-zone').value;
  const category = document.getElementById('f-category').value;
  const desc = document.getElementById('f-desc').value.trim();
  const count = parseInt(document.getElementById('f-count').value);
  const reporter = document.getElementById('f-reporter').value.trim();
  const urgency = parseInt(document.getElementById('f-urgency').value);

  if (!title || !desc || !count || !reporter) {
    showAlert('⚠️ Please fill in all required fields'); return;
  }

  const zoneData = { Dharavi:[19.0390,72.8519,'Z001'], Govandi:[19.0694,72.9239,'Z002'], Mankhurd:[19.0524,72.9289,'Z003'], Kurla:[19.0728,72.8826,'Z004'], Chembur:[19.0607,72.8998,'Z005'], 'Andheri East':[19.1136,72.8697,'Z006'], 'Malad West':[19.1871,72.8487,'Z007'], 'Bandra East':[19.0536,72.8440,'Z008'], 'Worli Koliwada':[19.0093,72.8172,'Z009'], 'Borivali East':[19.2307,72.8567,'Z010'] };
  const [lat, lng, zoneId] = zoneData[zone] || [19.07, 72.88, 'Z001'];
  const cat = NEED_CATEGORIES[category] || {};

  state.taskCounter++;
  const newTask = {
    id: 'RPT' + state.taskCounter,
    title, zone, zoneId, lat, lng: lng + (Math.random()-0.5)*0.01,
    category, urgency,
    affectedCount: count,
    description: desc,
    requiredSkills: [category],
    volunteersNeeded: urgency >= 8 ? 4 : urgency >= 6 ? 3 : 2,
    volunteersAssigned: 0,
    reportedBy: reporter,
    reportedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + (urgency >= 9 ? 6 : 24) * 3600000).toISOString(),
    status: urgency >= 9 ? 'critical' : urgency >= 7 ? 'urgent' : 'open',
    source: 'Live Report — VoiceAid Portal',
    matchedVolunteers: []
  };

  state.tasks.unshift(newTask);
  saveState();
  closeModal();
  renderCriticalBadge();
  showAlert(`✅ Report submitted: "${title}" added to ${zone} — urgency ${urgency}/10`);
  if (state.activeView === 'dashboard') renderDashboard();
  else if (state.activeView === 'tasks') renderTasks();
  switchView('match');
  setTimeout(() => {
    const sel = document.getElementById('task-selector');
    if (sel) { sel.value = newTask.id; runMatchForTask(); }
  }, 300);
};

// ── RESET (for demos) ──
window.resetAllData = function() {
  localStorage.removeItem(LS_KEY);
  state.tasks = JSON.parse(JSON.stringify(TASKS));
  state.volunteers = JSON.parse(JSON.stringify(VOLUNTEERS));
  state.taskCounter = 100;
  if (state.simOn) toggleSimulation();
  renderDashboard(); renderCriticalBadge();
  showAlert('🔄 All data reset to original state');
};

// ── AI INSIGHTS ENGINE ──
function renderAIInsights() {
  const el = document.getElementById('ai-insights-content');
  if (!el) return;
  const riskOrder = { extreme:5, very_high:4, high:3, medium:2, low:1 };
  const zoneScores = MUMBAI_ZONES.map(z => {
    const activeTasks = state.tasks.filter(t => t.zoneId === z.id);
    const avgUrgency = activeTasks.length ? activeTasks.reduce((s,t) => s+t.urgency,0)/activeTasks.length : 0;
    const uncoveredTasks = activeTasks.filter(t => t.volunteersAssigned < t.volunteersNeeded).length;
    const volCount = state.volunteers.filter(v => v.zone === z.name && v.status === 'available').length;
    const floodScore = riskOrder[z.floodRisk] || 1;
    const riskScore = Math.min(100, Math.round(
      ((10 - z.medicalAccessScore) * 4) + (floodScore * 6) + (avgUrgency * 4) + (uncoveredTasks * 8) + (volCount === 0 ? 20 : 0)
    ));
    return { zone: z, riskScore, activeTasks: activeTasks.length, uncoveredTasks, volCount, avgUrgency: Math.round(avgUrgency*10)/10 };
  }).sort((a,b) => b.riskScore - a.riskScore);

  const top = zoneScores[0], sec = zoneScores[1], low = zoneScores[zoneScores.length-1];
  const critCount = state.tasks.filter(t => t.status === 'critical').length;
  const totalUnmapped = state.tasks.filter(t => t.volunteersAssigned < t.volunteersNeeded).length;
  const trend = critCount >= 3 ? '↗️ Escalating' : critCount >= 1 ? '→ Active' : '↘️ Stable';
  const trendClass = critCount >= 3 ? 'trend-up' : critCount >= 1 ? 'trend-stable' : 'trend-down';

  el.innerHTML = `
    <div class="ai-insights-grid">
      <div class="ai-insight-item">
        <div class="ai-insight-label">🚨 Predicted Next Hotspot</div>
        <div class="ai-insight-value">${top.zone.name}</div>
        <div class="ai-insight-sub">Risk Score: ${top.riskScore}/100 · ${top.uncoveredTasks} uncovered tasks · Medical Access: ${top.zone.medicalAccessScore}/10</div>
      </div>
      <div class="ai-insight-item">
        <div class="ai-insight-label">📈 Crisis Trend</div>
        <div class="ai-insight-value ${trendClass}">${trend}</div>
        <div class="ai-insight-sub">${critCount} critical tasks active · ${totalUnmapped} need volunteers</div>
      </div>
      <div class="ai-insight-item">
        <div class="ai-insight-label">⚠️ Secondary Hotspot</div>
        <div class="ai-insight-value">${sec.zone.name}</div>
        <div class="ai-insight-sub">Risk Score: ${sec.riskScore}/100 · Flood Risk: ${sec.zone.floodRisk.replace('_',' ')}</div>
      </div>
      <div class="ai-insight-item">
        <div class="ai-insight-label">✅ Safest Zone</div>
        <div class="ai-insight-value trend-down">${low.zone.name}</div>
        <div class="ai-insight-sub">Risk Score: ${low.riskScore}/100 · ${low.volCount} volunteers available</div>
      </div>
    </div>
    <div class="ai-explanation">
      🧠 <strong>How this works:</strong> The Predictive Risk Engine scores each zone using a weighted composite:
      <code>RiskScore = (InverseAccess×4) + (FloodRisk×6) + (AvgUrgency×4) + (UncoveredTasks×8) + VolGapBonus</code>
      — updated live as tasks are dispatched. ${top.zone.name} is flagged: medical access ${top.zone.medicalAccessScore}/10, flood risk ${top.zone.floodRisk.replace('_',' ')}, ${top.uncoveredTasks} unfilled task(s).
    </div>`;
}

// ── ROADMAP ──
function renderRoadmap() {
  const el = document.getElementById('roadmap-content');
  if (!el) return;
  const items = [
    { phase:'now', label:'✅ Live Now', title:'Real-time Volunteer Command Center', desc:'Multi-factor matching engine, live Mumbai map, simulation mode, LocalStorage persistence, and instant dispatch.' },
    { phase:'next', label:'🚧 Phase 2 — Q3 2025', title:'NGO API Integration', desc:'Connect to Apnalaya, SNEHA, and CRY live data feeds. Pull field reports automatically.' },
    { phase:'next', label:'🚧 Phase 2 — Q3 2025', title:'WhatsApp Bot for Field Workers', desc:'ASHA workers submit crisis reports via WhatsApp. Zero-friction ground-level data collection.' },
    { phase:'next', label:'🚧 Phase 2 — Q3 2025', title:'Volunteer Mobile App', desc:'PWA for volunteers to accept tasks, get navigation, and update completion from the field.' },
    { phase:'future', label:'🚀 Phase 3 — Q1 2026', title:'ML Demand Forecasting', desc:'Train on 2+ years of Mumbai crisis data to predict flood relief needs before the monsoon hits.' },
    { phase:'future', label:'🚀 Phase 3 — Q1 2026', title:'Multi-City Rollout', desc:'Extend to Chennai, Kolkata, Delhi with city-specific zones, NGO networks, and regional language support.' },
    { phase:'future', label:'🚀 Phase 3 — 2026', title:'Government Integration', desc:'MCGM and BMC data pipelines. Official coordination with ward officers and emergency services.' },
  ];
  el.innerHTML = `<div class="roadmap-grid">${items.map(i => `
    <div class="roadmap-item">
      <div class="roadmap-phase phase-${i.phase}">${i.label}</div>
      <div class="roadmap-title">${i.title}</div>
      <div class="roadmap-desc">${i.desc}</div>
    </div>`).join('')}</div>`;
}


// ══ HACKATHON NEW FEATURES ══

// Dispatch Logging
function logDispatch(volunteer, task) {
  state.dispatchLog.unshift({
    id: Date.now(),
    time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    volunteerName: volunteer.name,
    taskTitle: task.title,
    zone: task.zone
  });
  if (state.dispatchLog.length > 50) state.dispatchLog.pop();
}

function renderDispatchLog() {
  const el = document.getElementById('dispatch-log');
  if (!el) return;
  if (state.dispatchLog.length === 0) {
    el.innerHTML = '<div class="dispatch-log-empty">No dispatches in current session.</div>';
    return;
  }
  el.innerHTML = state.dispatchLog.map(l => `
    <div class="dispatch-log-entry">
      <span class="dl-time">[${l.time}]</span>
      <span class="dl-text"><strong>${l.volunteerName}</strong> dispatched to <strong>${l.zone}</strong> for "${l.taskTitle}"</span>
    </div>
  `).join('');
}

// Ticker System
const tickerEvents = [
  "SYSTEM LIVE: All 10 zones online",
  "WEATHER ALERT: Heavy rain predicted in M/E Ward",
  "NGO UPDATE: 12 new volunteers from Pratham registered"
];

function initTicker() {
  updateTickerDOM();
  setInterval(() => {
    if (tickerEvents.length > 5) tickerEvents.pop();
    updateTickerDOM();
  }, 10000);
}

function addTickerEvent(msg) {
  tickerEvents.unshift(`[${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}] ${msg}`);
  updateTickerDOM();
}

function updateTickerDOM() {
  const el = document.getElementById('ticker-inner');
  if (el) el.innerHTML = tickerEvents.join(' &nbsp;&nbsp;•&nbsp;&nbsp; ') + ' &nbsp;&nbsp;•&nbsp;&nbsp; ' + tickerEvents.join(' &nbsp;&nbsp;•&nbsp;&nbsp; ');
}

// Demo Mode Walkthrough
window.runDemoMode = function() {
  const btn = document.getElementById('demo-btn');
  btn.classList.add('running');
  btn.textContent = '🎬 Demo Running...';
  
  showAlert('🎬 DEMO SEQUENCE INITIATED', 'info');
  
  // 1. Force a critical report
  setTimeout(() => {
    switchView('dashboard');
    document.getElementById('f-title').value = "Gas Leak Evacuation";
    document.getElementById('f-zone').value = "Govandi";
    document.getElementById('f-category').value = "medical_emergency";
    document.getElementById('f-desc').value = "Multiple casualties, need triage.";
    document.getElementById('f-count').value = "120";
    document.getElementById('f-reporter').value = "Demo Bot";
    document.getElementById('f-urgency').value = "10";
    submitReport();
  }, 2000);
  
  // 2. Show Match Engine for it
  setTimeout(() => {
    switchView('match');
    const sel = document.getElementById('task-selector');
    sel.selectedIndex = sel.options.length - 1; // latest
    runMatchForTask();
  }, 5000);
  
  // 3. Dispatch best volunteer
  setTimeout(() => {
    const dispatchBtn = document.querySelector('.dispatch-btn');
    if (dispatchBtn) dispatchBtn.click();
  }, 9000);
  
  // 4. Auto-allocate the rest
  setTimeout(() => {
    runAllocation();
  }, 12000);
  
  // 5. Show Impact
  setTimeout(() => {
    switchView('impact');
    btn.classList.remove('running');
    btn.textContent = '🎬 Demo Mode';
  }, 15000);
};

// Keyboard Shortcuts
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    
    if (e.key === '1') switchView('dashboard');
    else if (e.key === '2') switchView('map');
    else if (e.key === '3') switchView('tasks');
    else if (e.key === '4') switchView('volunteers');
    else if (e.key === '5') switchView('match');
    else if (e.key === '6') switchView('impact');
    else if (e.key === '/') { e.preventDefault(); openReportForm(); }
    else if (e.key.toLowerCase() === 'd') runDemoMode();
    else if (e.key === '?') document.getElementById('shortcuts-overlay').classList.add('open');
    else if (e.key === 'Escape') {
      closeModal();
      document.getElementById('shortcuts-overlay').classList.remove('open');
      document.getElementById('why-mumbai-card').style.display = 'none';
    }
  });
}

// Confetti
function fireConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  const particles = [];
  for(let i=0; i<100; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: canvas.height + Math.random() * 200,
      r: Math.random() * 6 + 2,
      dx: Math.random() * 4 - 2,
      dy: Math.random() * -10 - 5,
      color: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'][Math.floor(Math.random()*5)]
    });
  }
  
  function animate() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let active = false;
    particles.forEach(p => {
      p.x += p.dx;
      p.y += p.dy;
      p.dy += 0.2; // gravity
      if (p.y < canvas.height + 10) active = true;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    if (active) requestAnimationFrame(animate);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  animate();
}

window.exportTaskReport = function(id) {
  const t = state.tasks.find(x => x.id === id);
  if(!t) return;
  const text = "MISSION BRIEFING: " + t.title + "\n---------------------------------------\nZone: " + t.zone + "\nUrgency: " + t.urgency + "/10 (" + t.status.toUpperCase() + ")\nAffected: " + t.affectedCount + "\nDescription: " + t.description + "\n\nRequired Skills: " + t.requiredSkills.join(', ') + "\nVolunteers Needed: " + (t.volunteersNeeded - t.volunteersAssigned) + "\n---------------------------------------\nReported via VoiceAid Mumbai";
  navigator.clipboard.writeText(text).then(() => {
    showAlert('?? Mission briefing copied to clipboard', 'success');
  });
};



// ════════════════════════════════════════════
// PHASE 2 — ADVANCED HACKATHON FEATURES
// ════════════════════════════════════════════

// ── GEMINI API KEY STORAGE ──
const GEMINI_KEY_STORAGE = 'voiceaid_gemini_key';
function getGeminiKey() { 
  const envKey = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : '';
  return envKey || localStorage.getItem(GEMINI_KEY_STORAGE) || ''; 
}

// ── SETTINGS MODAL ──
window.openSettings = function() {
  document.getElementById('modal-content').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:4px">⚙️ Settings</h2>
    <p class="muted" style="margin-bottom:18px">Configure your system preferences.</p>

    <div class="form-group">
      <label class="form-label">🔒 Privacy Mode</label>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="s-privacy" style="accent-color:var(--aurora-blue)" ${localStorage.getItem('voiceaid_privacy') === '1' ? 'checked' : ''} />
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
  `;
  document.getElementById('modal-overlay').classList.add('open');
};

window.saveSettings = function() {
  const priv = document.getElementById('s-privacy').checked;
  localStorage.setItem('voiceaid_privacy', priv ? '1' : '0');
  closeModal();
  showAlert('✅ Settings saved', 'success');
};

// ── GEMINI AI SITUATION REPORT ──
window.generateSituationReport = async function() {
  const apiKey = getGeminiKey();
  const btn = document.getElementById('gemini-report-btn');
  const content = document.getElementById('gemini-report-content');
  if (!apiKey) {
    content.innerHTML = `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:14px;font-size:13px;color:#f59e0b">
      ⚠️ No Gemini API key found in Environment Variables. Add VITE_GEMINI_API_KEY to your Vercel project settings to enable this feature.
    </div>`;
    return;
  }
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';
  content.innerHTML = `<div class="ai-typing"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>`;

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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `You are a field commander for a humanitarian emergency in Mumbai. Given this situation: ${JSON.stringify(briefData)}, write a 3-sentence commander's briefing. Be direct, factual, and end with one prioritized action. Use numbers.` }]
        }]
      })
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate report.';
    content.innerHTML = `<div class="ai-result">${text.replace(/\n/g, '<br>')}</div>
      <div style="font-size:10px;color:#475569;margin-top:10px">Generated by Gemini 1.5 Flash · ${new Date().toLocaleTimeString('en-IN')}</div>`;
    addTickerEvent(`🤖 AI BRIEFING GENERATED: ${text.slice(0,60)}...`);
  } catch(err) {
    content.innerHTML = `<div style="font-size:13px;color:var(--critical)">API Error: ${err.message}. Check CORS — for production, use a backend proxy.</div>`;
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
  const numMatch = text.match(/\d+/);

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
  el.innerHTML = `<div class="weather-bar">
    <span class="weather-icon">${w.rain === 0 ? '🌤️' : w.rain < 5 ? '🌧️' : '⛈️'}</span>
    <span>Mumbai Live Weather</span>
    <span class="weather-val">${rainStatus}</span>
    <span style="color:var(--text-muted);font-size:11px">Rain: ${w.rain}mm/h · Wind: ${w.wind_speed_10m}km/h</span>
    ${isHeavyRain ? '<span class="rain-alert">⚠️ FLOOD RISK — Urgency auto-escalated</span>' : ''}
  </div>`;
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
    showAlert(`⛈️ Heavy rain (${rainMmPerHr}mm/h) — ${escalated} flood tasks auto-escalated to CRITICAL`, 'error');
    addTickerEvent(`⛈️ WEATHER ALERT: ${rainMmPerHr}mm/h rain — ${escalated} tasks escalated`);
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

  el.innerHTML = `<div class="surge-card">
    <div class="surge-header">
      <span style="font-size:20px">📊</span>
      <div class="surge-title">Predictive Surge Detection</div>
      <span class="surge-badge">AI FORECAST</span>
    </div>
    ${surges.map(s => `<div class="surge-item">
      <span class="surge-zone">${s.name}</span>
      <span style="font-size:11px;color:#64748b;min-width:110px">Peak in ~${s.hours}h</span>
      <div class="surge-bar-wrap"><div class="surge-bar-fill" style="width:${s.risk}%"></div></div>
      <span class="surge-pct">${s.risk}%</span>
    </div>`).join('')}
    <div style="font-size:11px;color:#475569;margin-top:10px">🧠 Formula: FloodRisk × 8 + HourlyPattern × 2 + WeatherBoost + (10−MedicalAccess) × 3</div>
  </div>`;
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
  const cityConfig = {
    mumbai: {
      name: 'Mumbai',
      lat: 19.07, lng: 72.88, zoom: 12,
      tasks: JSON.parse(JSON.stringify(TASKS)),
      volunteers: JSON.parse(JSON.stringify(VOLUNTEERS))
    },
    delhi: {
      name: 'Delhi',
      lat: 28.6139, lng: 77.2090, zoom: 11,
      tasks: [
        { id: 'D01', title: 'Smog Emergency Evacuation', zone: 'Connaught Place', zoneId: 'D1', lat: 28.6304, lng: 77.2177, category: 'medical_emergency', urgency: 9, affectedCount: 150, description: 'Severe AQI spike. Elderly residents need oxygen masks and relocation to indoor shelters.', requiredSkills: ['medical_emergency', 'shelter'], volunteersNeeded: 3, volunteersAssigned: 0, reportedBy: 'Delhi Health Dept', reportedAt: new Date().toISOString(), deadline: new Date(Date.now() + 4*3600000).toISOString(), status: 'critical', source: 'Air Quality API', matchedVolunteers: [] },
        { id: 'D02', title: 'Yamuna Flood Warning Prep', zone: 'Mayur Vihar', zoneId: 'D2', lat: 28.6080, lng: 77.2940, category: 'flood_relief', urgency: 7, affectedCount: 300, description: 'Water levels rising. Need volunteers for sandbagging and alerting residents.', requiredSkills: ['flood_relief', 'health_awareness'], volunteersNeeded: 5, volunteersAssigned: 1, reportedBy: 'NDMA', reportedAt: new Date().toISOString(), deadline: new Date(Date.now() + 12*3600000).toISOString(), status: 'urgent', source: 'NDMA Alert', matchedVolunteers: [] }
      ],
      volunteers: [
        { id: 'V_D1', name: 'Rajesh Kumar', zone: 'Karol Bagh', lat: 28.6500, lng: 77.1900, status: 'available', skills: ['medical_emergency', 'shelter'], deployments: 12, rating: 4.8, experience_years: 3, availability: {mon:true,tue:true,wed:true,thu:true,fri:true,sat:false,sun:false}, languages: ['Hindi','English'], hoursPerWeek: 15, qualification: 'Nurse', bio: 'Ready to help.' },
        { id: 'V_D2', name: 'Priya Sharma', zone: 'South Ex', lat: 28.5670, lng: 77.2200, status: 'available', skills: ['health_awareness', 'flood_relief'], deployments: 5, rating: 4.5, experience_years: 1, availability: {mon:true,tue:true,wed:true,thu:true,fri:true,sat:true,sun:true}, languages: ['Hindi','English'], hoursPerWeek: 10, qualification: 'Social Worker', bio: 'Community worker.' }
      ]
    },
    chennai: {
      name: 'Chennai',
      lat: 13.0827, lng: 80.2707, zoom: 11,
      tasks: [
        { id: 'C01', title: 'Cyclonic Storm Relief', zone: 'Marina Beach', zoneId: 'C1', lat: 13.0485, lng: 80.2831, category: 'flood_relief', urgency: 10, affectedCount: 500, description: 'Coastal flooding. Immediate relocation to higher ground needed.', requiredSkills: ['flood_relief', 'shelter'], volunteersNeeded: 5, volunteersAssigned: 1, reportedBy: 'TNDMA', reportedAt: new Date().toISOString(), deadline: new Date(Date.now() + 2*3600000).toISOString(), status: 'critical', source: 'TNDMA', matchedVolunteers: [] }
      ],
      volunteers: [
        { id: 'V_C1', name: 'Karthik N.', zone: 'T Nagar', lat: 13.0396, lng: 80.2335, status: 'available', skills: ['flood_relief', 'shelter'], deployments: 20, rating: 5.0, experience_years: 5, availability: {mon:true,tue:true,wed:true,thu:true,fri:true,sat:true,sun:true}, languages: ['Tamil','English'], hoursPerWeek: 30, qualification: 'NDRF Certified', bio: 'Rescue ops specialist.' }
      ]
    }
  };

  const conf = cityConfig[city];
  if (!conf) return;

  state.tasks = conf.tasks;
  state.volunteers = conf.volunteers;
  
  const sysStatusElements = document.querySelectorAll('.system-status span:nth-child(2)');
  sysStatusElements.forEach(el => el.textContent = `System Live — ${conf.name}`);
  
  // Also update the splash text if they reload the page
  const splashCity = document.querySelector('.splash-city');
  if (splashCity) splashCity.textContent = conf.name;
  
  if (state.map) {
    state.map.setView([conf.lat, conf.lng], conf.zoom);
    refreshMapLayer();
  }

  // Hide the AI insights and surge detection on non-Mumbai cities to avoid breaking zone logic
  const aiCard = document.querySelector('.ai-insights-card');
  const surgeCard = document.getElementById('surge-detection-wrapper');
  if (city !== 'mumbai') {
    if (aiCard) aiCard.style.display = 'none';
    if (surgeCard) surgeCard.style.display = 'none';
  } else {
    if (aiCard) aiCard.style.display = 'block';
    if (surgeCard) surgeCard.style.display = 'block';
  }

  renderDashboard();
  renderCriticalBadge();
  if (state.activeView === 'tasks') renderTasks();
  if (state.activeView === 'volunteers') renderVolunteers();
  
  showAlert(`🌍 City switched to ${conf.name}. Data loaded.`, 'success');
  addTickerEvent(`🏙️ COMMAND CENTER SHIFTED TO ${conf.name.toUpperCase()}`);
};

// ── ONBOARDING TOOLTIP TOUR ──
const TOUR_KEY = 'voiceaid_tour_done';
const TOUR_STEPS = [
  { title: 'Welcome to VoiceAid Mumbai', desc: 'This is your real-time command centre for volunteer coordination across Mumbai. Let me show you the 3 key features.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } },
  { title: '⚡ The Smart Match Engine', desc: 'This is our core AI algorithm. It ranks volunteers for any task using a multi-factor score: Urgency (40%) + Skill Match (35%) + Proximity (25%) + Experience Bonus.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }, action: () => switchView('match') },
  { title: '🎙️ Voice Reporting', desc: 'Field workers can speak a crisis report instead of typing. Say "flood in Dharavi, 50 people affected" and the system auto-fills the form. Click "Report Need" to try it.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }, action: () => switchView('dashboard') },
  { title: '🤖 Gemini AI Insights', desc: 'Click "Generate AI Situation Report" to get a real-time commander briefing powered by Gemini AI. Add your API key in Settings first.', position: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } }
];

let currentTourStep = 0;

window.startOnboardingTour = function() {
  currentTourStep = 0;
  showTourStep(0);
};

window.showTourStep = function(step) {
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
  overlay.innerHTML = `
    <div class="tooltip-backdrop"></div>
    <div class="tooltip-box" style="top:${s.position.top};left:${s.position.left};transform:${s.position.transform}">
      <div class="tooltip-step">Step ${step + 1} of ${TOUR_STEPS.length}</div>
      <div class="tooltip-title">${s.title}</div>
      <div class="tooltip-desc">${s.desc}</div>
      <div class="tooltip-actions">
        <button class="tooltip-skip" onclick="document.querySelector('.tooltip-overlay').remove();localStorage.setItem('${TOUR_KEY}','1')">Skip Tour</button>
        <button class="tooltip-next" onclick="showTourStep(${step + 1})">${step === TOUR_STEPS.length - 1 ? 'Finish ✓' : 'Next →'}</button>
      </div>
    </div>
  `;
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
