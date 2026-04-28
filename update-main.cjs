const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// 1. Add dispatchLog to state
content = content.replace(
  "taskCounter: 100",
  "taskCounter: 100,\n  dispatchLog: []"
);

// 2. Add dispatch log to saveState & loadState
content = content.replace(
  "taskCounter: state.taskCounter",
  "taskCounter: state.taskCounter,\n      dispatchLog: state.dispatchLog"
);
content = content.replace(
  "state.taskCounter = parsed.taskCounter || 100;",
  "state.taskCounter = parsed.taskCounter || 100;\n      state.dispatchLog = parsed.dispatchLog || [];"
);

// 3. Add keyboard shortcuts, ticker logic, and animations to DOMContentLoaded
content = content.replace(
  "if (restored) showAlert('✅ Session restored from last visit — all dispatches preserved');",
  `if (restored) showAlert('✅ Session restored from last visit — all dispatches preserved');
  initKeyboardShortcuts();
  initTicker();
  setTimeout(() => document.getElementById('splash-screen')?.remove(), 3000);`
);

// 4. Overwrite renderStatsGrid for animated counters
const animatedStatsGrid = `
function renderStatsGrid(containerId, cards) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = cards.map((c, i) => \`
    <div class="stat-card" style="--accent-color:\${c.color}">
      <div class="stat-icon">\${c.icon}</div>
      <div class="stat-value count-up" data-val="\${typeof c.value === 'string' ? c.value.replace(/[^0-9]/g, '') : c.value}" style="color:\${c.color}">0\${typeof c.value === 'string' && c.value.includes('%') ? '%' : ''}\${typeof c.value === 'string' && c.value.includes('min') ? 'min' : ''}</div>
      <div class="stat-label">\${c.label}</div>
      <div class="stat-sub">\${c.sub}</div>
    </div>\`).join('');

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
`;
content = content.replace(/function renderStatsGrid[\s\S]*?\}\n/, animatedStatsGrid);

// 5. Replace showAlert with toast system
const toastSystem = `
window.showAlert = function(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icon = type === 'success' ? '✅' : type === 'error' ? '🚨' : 'ℹ️';
  const toast = document.createElement('div');
  toast.className = \`toast \${type}\`;
  toast.innerHTML = \`<span style="font-size:16px">\${icon}</span> <span>\${msg}</span>\`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
};
`;
content = content.replace(/function showAlert[\s\S]*?\}\n/, toastSystem);

// 6. Replace matchCardHTML to add SVG rings and "Explain this match"
const newMatchCardHTML = `
function matchCardHTML(result, rank, task) {
  const { volunteer: v, score, breakdown: b } = result;
  
  // SVG Ring calculation
  const circleCircumference = 2 * Math.PI * 26; // r=26
  const strokeDashoffset = circleCircumference - (score / 100) * circleCircumference;
  
  const skillLabels = b.matchedSkills.map(s => NEED_CATEGORIES[s]?.label || s);
  
  return \`<div class="match-card rank-\${rank}">
    <div class="rank-badge">#\${rank}</div>
    
    <svg class="score-ring-svg" width="70" height="70" viewBox="0 0 60 60">
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f59e0b" />
          <stop offset="100%" stop-color="#ef4444" />
        </linearGradient>
      </defs>
      <circle class="score-ring-bg" cx="30" cy="30" r="26"></circle>
      <circle class="score-ring-fill" cx="30" cy="30" r="26" style="stroke-dashoffset:\${strokeDashoffset};"></circle>
      <text class="score-ring-text" x="30" y="32">\${score}</text>
    </svg>
    
    <div style="text-align:center;margin-bottom:14px">
      <div style="font-size:15px;font-weight:700">\${v.name}</div>
      <div style="font-size:11px;color:var(--text-muted)">\${v.zone} · \${b.distanceKm}km away</div>
    </div>
    
    <div class="breakdown-row"><span class="breakdown-label">⚡ Urgency (\${Math.round(task.urgency/10*40)} max)</span><span class="breakdown-val">+\${b.urgencyContribution}pts</span></div>
    <div class="breakdown-row"><span class="breakdown-label">🎯 Skill Match (35 max)</span><span class="breakdown-val">+\${b.skillContribution}pts</span></div>
    <div class="breakdown-row"><span class="breakdown-label">📍 Proximity (25 max)</span><span class="breakdown-val">+\${b.proximityContribution}pts</span></div>
    
    <div class="explain-box">
      <strong>🤖 Why \${v.name.split(' ')[0]}?</strong>
      \${v.name.split(' ')[0]} is \${b.distanceKm <= 5 ? 'very close' : 'nearby'} at \${b.distanceKm}km. 
      \${b.matchedSkills.length === task.requiredSkills.length ? \`Has all required skills (\${skillLabels.join(', ')}).\` : \`Has \${b.matchedSkills.length} of \${task.requiredSkills.length} skills.\`}
      \${b.availabilityToday ? 'Available to deploy today.' : 'Not usually available today (-50% penalty).'}
    </div>
    
    <button class="dispatch-btn" onclick="dispatchVolunteer('\${v.id}','\${task.id}')">⚡ Dispatch \${v.name.split(' ')[0]}</button>
  </div>\`;
}
`;
content = content.replace(/function matchCardHTML[\s\S]*?\}\n/, newMatchCardHTML);

// 7. Update dispatchVolunteer and runAllocation to log and tick
content = content.replace(
  "saveState();",
  "logDispatch(v, t);\n  addTickerEvent(`⚡ DISPATCH: ${v.name} en route to ${t.zone} for ${t.title.slice(0, 20)}...`);\n  saveState();"
);

content = content.replace(
  "showAlert(`✅ Smart Allocation complete — ${dispatched} volunteers dispatched across ${allocs.length} tasks`);",
  `showAlert(\`✅ Smart Allocation complete — \${dispatched} volunteers dispatched across \${allocs.length} tasks\`, 'success');
  addTickerEvent(\`⚡ SYSTEM ALLOCATION: \${dispatched} volunteers instantly dispatched\`);
  if (dispatched > 0 && state.tasks.filter(t => t.status === 'critical' && t.volunteersAssigned < t.volunteersNeeded).length === 0) {
    fireConfetti();
  }`
);
content = content.replace(
  "task.matchedVolunteers.push(v.id); dispatched++;",
  "task.matchedVolunteers.push(v.id); dispatched++; logDispatch(v, task);"
);


// 8. Add Volunteer filtering
const volFilterLogic = `
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
  if (el) el.innerHTML = \`<div class="volunteer-grid">\${filtered.map(v => volCardHTML(v)).join('')}</div>\`;
  
  const countLabel = document.getElementById('vol-count-label');
  if (countLabel) countLabel.textContent = \`Showing \${filtered.length} of \${state.volunteers.length}\`;
};
`;

content = content.replace(/function renderVolunteers\(\) \{[\s\S]*?\}\n/, `function renderVolunteers() {
  filterVolunteers();
}\n` + volFilterLogic);


// 9. Update renderImpact to include renderDispatchLog
content = content.replace("renderZoneCoverageTable();", "renderZoneCoverageTable();\n  renderDispatchLog();");

// 10. Append new features at the end of the file
const appendedFeatures = `

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
  el.innerHTML = state.dispatchLog.map(l => \`
    <div class="dispatch-log-entry">
      <span class="dl-time">[\${l.time}]</span>
      <span class="dl-text"><strong>\${l.volunteerName}</strong> dispatched to <strong>\${l.zone}</strong> for "\${l.taskTitle}"</span>
    </div>
  \`).join('');
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
  tickerEvents.unshift(\`[\${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}] \${msg}\`);
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
`;
content += appendedFeatures;

fs.writeFileSync('src/main.js', content, 'utf8');
console.log('Successfully updated main.js');
