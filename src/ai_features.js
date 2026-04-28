// ── AI INSIGHTS ENGINE ──
function renderAIInsights() {
  const el = document.getElementById('ai-insights-content');
  if (!el) return;

  const riskOrder = { extreme: 5, very_high: 4, high: 3, medium: 2, low: 1 };
  const zoneScores = MUMBAI_ZONES.map(z => {
    const activeTasks = state.tasks.filter(t => t.zoneId === z.id);
    const avgUrgency = activeTasks.length ? activeTasks.reduce((s, t) => s + t.urgency, 0) / activeTasks.length : 0;
    const uncoveredTasks = activeTasks.filter(t => t.volunteersAssigned < t.volunteersNeeded).length;
    const volCount = state.volunteers.filter(v => v.zone === z.name && v.status === 'available').length;
    const floodScore = riskOrder[z.floodRisk] || 1;
    // Composite AI risk score (0-100)
    const riskScore = Math.min(100, Math.round(
      ((10 - z.medicalAccessScore) * 4) +
      (floodScore * 6) +
      (avgUrgency * 4) +
      (uncoveredTasks * 8) +
      (volCount === 0 ? 20 : 0)
    ));
    return { zone: z, riskScore, activeTasks: activeTasks.length, uncoveredTasks, volCount, avgUrgency: Math.round(avgUrgency * 10) / 10 };
  }).sort((a, b) => b.riskScore - a.riskScore);

  const topRisk = zoneScores[0];
  const secondRisk = zoneScores[1];
  const lowestRisk = zoneScores[zoneScores.length - 1];
  const totalUnmapped = state.tasks.filter(t => t.volunteersAssigned < t.volunteersNeeded).length;
  const criticalCount = state.tasks.filter(t => t.status === 'critical').length;
  const trend = criticalCount >= 3 ? '↗️ Escalating' : criticalCount >= 1 ? '→ Active' : '↘️ Stable';
  const trendClass = criticalCount >= 3 ? 'trend-up' : criticalCount >= 1 ? 'trend-stable' : 'trend-down';

  el.innerHTML = `
    <div class="ai-insights-grid">
      <div class="ai-insight-item">
        <div class="ai-insight-label">🚨 Predicted Next Hotspot</div>
        <div class="ai-insight-value">${topRisk.zone.name}</div>
        <div class="ai-insight-sub">Risk Score: ${topRisk.riskScore}/100 · ${topRisk.uncoveredTasks} uncovered tasks · Medical Access: ${topRisk.zone.medicalAccessScore}/10</div>
      </div>
      <div class="ai-insight-item">
        <div class="ai-insight-label">📈 Crisis Trend</div>
        <div class="ai-insight-value ${trendClass}">${trend}</div>
        <div class="ai-insight-sub">${criticalCount} critical tasks active · ${totalUnmapped} need volunteers</div>
      </div>
      <div class="ai-insight-item">
        <div class="ai-insight-label">⚠️ Secondary Hotspot</div>
        <div class="ai-insight-value">${secondRisk.zone.name}</div>
        <div class="ai-insight-sub">Risk Score: ${secondRisk.riskScore}/100 · Flood Risk: ${secondRisk.zone.floodRisk.replace('_', ' ')}</div>
      </div>
      <div class="ai-insight-item">
        <div class="ai-insight-label">✅ Safest Zone</div>
        <div class="ai-insight-value trend-down">${lowestRisk.zone.name}</div>
        <div class="ai-insight-sub">Risk Score: ${lowestRisk.riskScore}/100 · ${lowestRisk.volCount} volunteers available</div>
      </div>
    </div>
    <div class="ai-explanation">
      🧠 <strong>How this works:</strong> The Predictive Risk Engine scores each zone using a weighted composite:
      <code>RiskScore = (InverseAccess × 4) + (FloodRisk × 6) + (AvgUrgency × 4) + (UncoveredTasks × 8) + VolunteerGapBonus</code>
      — updated live as tasks are dispatched and new reports arrive. ${topRisk.zone.name} is flagged because it has the highest combination of flood vulnerability, lowest medical access (${topRisk.zone.medicalAccessScore}/10), and ${topRisk.uncoveredTasks} unfilled task(s) right now.
    </div>`;
}

// ── ROADMAP ──
function renderRoadmap() {
  const el = document.getElementById('roadmap-content');
  if (!el) return;
  const items = [
    { phase: 'now', label: '✅ Live Now', title: 'Real-time Volunteer Command Center', desc: 'Multi-factor matching engine, live Mumbai need map, simulation mode, persistent state, and instant dispatch.' },
    { phase: 'next', label: '🚧 Phase 2 — Q3 2025', title: 'NGO API Integration', desc: 'Connect directly to Apnalaya, SNEHA, and CRY data feeds. Pull live field reports automatically instead of manual entry.' },
    { phase: 'next', label: '🚧 Phase 2 — Q3 2025', title: 'WhatsApp Bot for Field Workers', desc: 'ASHA workers and RWA coordinators submit reports via WhatsApp. Zero friction data collection from the ground.' },
    { phase: 'next', label: '🚧 Phase 2 — Q3 2025', title: 'Volunteer Mobile App', desc: 'PWA app for volunteers to accept tasks, get directions, and update completion status from the field.' },
    { phase: 'future', label: '🚀 Phase 3 — Q1 2026', title: 'ML-Powered Demand Forecasting', desc: 'Train on 2+ years of Mumbai crisis data to predict which zones will need flood relief before the monsoon hits.' },
    { phase: 'future', label: '🚀 Phase 3 — Q1 2026', title: 'Multi-City Rollout', desc: 'Extend to Chennai, Kolkata, and Delhi with city-specific zone profiles, NGO networks, and local language support.' },
    { phase: 'future', label: '🚀 Phase 3 — 2026', title: 'Government Integration', desc: 'MCGM and BMC data pipelines. Official disaster response coordination with ward officers and emergency services.' },
  ];
  el.innerHTML = `<div class="roadmap-grid">${items.map(i => `
    <div class="roadmap-item">
      <div class="roadmap-phase phase-${i.phase}">${i.label}</div>
      <div class="roadmap-title">${i.title}</div>
      <div class="roadmap-desc">${i.desc}</div>
    </div>`).join('')}</div>`;
}
