// ============================================================
// STATE
// ============================================================
let state = {
  apiKey: '',
  campaigns: [],
  campaignDetails: {},
  campaignAnalytics: {},
  stepAnalytics: {}
};

// ============================================================
// SPAM & ANALYSIS CONFIG
// ============================================================
const SPAM_WORDS = [
  'free', 'guarantee', 'guaranteed', 'money', 'cash', 'earn', 'income',
  'profit', 'discount', 'offer', 'deal', 'promotion', 'promo',
  'exclusive', 'limited time', 'urgent', 'act now', 'hurry', 'expire',
  'click here', 'buy now', 'order now', 'sign up',
  'winner', 'congratulations', 'amazing', 'incredible', 'miracle',
  'risk-free', 'risk free', 'no obligation', 'no cost',
  'lowest price', 'best price', 'save big', 'savings', 'bonus',
  '100% satisfied', 'instant access', 'once in a lifetime',
  "don't miss", 'special offer', 'last chance', 'final notice',
  'double your', 'triple your', 'make money', 'extra income',
  'financial freedom', 'no strings attached', 'apply now', 'call now',
  'while supplies last', 'limited offer', 'exclusive deal',
  'unbelievable', 'act immediately', 'no catch', 'obligation free',
  'lowest rates', 'incredible deal', 'best deal', 'earn extra',
  'extra cash', 'fast cash', 'be your own boss', 'work from home',
  'percent off', '% off', 'clearance', 'drastically reduced',
  'for only', 'giving away', 'new customers only', 'one time',
  'order today', 'please read', 'pure profit', 'remove doubt',
  'satisfaction', 'supplies are limited', 'take action',
  'this is not spam', 'trial', 'unsolicited', 'what are you waiting for',
  'you have been selected', 'zero risk'
];

const GENERIC_CTAS = [
  'is this something you\'d be open to',
  'would you be open to exploring',
  'would you like to learn more',
  'are you interested in learning',
  'can we schedule a call',
  'can we set up a time',
  'would you be interested in',
  'let\'s hop on a call',
  'can i get 15 minutes of your time',
  'i\'d love to show you',
  'let me show you how',
  'can i send you more information'
];

const REPLY_BENCHMARKS = {
  intro: 2,
  followup: 3,
  breakup: 2
};

const WORD_LIMIT = 60;

// ============================================================
// API LAYER
// ============================================================
async function api(endpoint) {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: state.apiKey, endpoint })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `API error ${res.status}`);
  }

  return res.json();
}

// ============================================================
// ANALYSIS ENGINE
// ============================================================
function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function countWords(text) {
  const clean = stripHtml(text)
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove greeting and sign-off for word count
  const lines = clean.split(/[.\n]/).map(l => l.trim()).filter(Boolean);
  const greetings = /^(hey|hi|hello|dear|good morning|good afternoon)\b/i;
  const signoffs = /^(cheers|regards|best|warm regards|sincerely|thanks|thank you|all the best|talk soon)\b/i;

  let bodyWords = [];
  let inBody = false;

  for (const line of lines) {
    if (!inBody && greetings.test(line)) {
      inBody = true;
      continue;
    }
    if (signoffs.test(line)) break;
    if (inBody || !greetings.test(lines[0])) {
      bodyWords.push(line);
    }
  }

  const bodyText = bodyWords.join(' ').replace(/\s+/g, ' ').trim();
  return bodyText.split(/\s+/).filter(w => w.length > 0).length;
}

function findSpamWords(text) {
  const clean = stripHtml(text).toLowerCase();
  const found = [];
  for (const word of SPAM_WORDS) {
    const regex = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (regex.test(clean)) {
      found.push(word);
    }
  }
  return found;
}

function findGenericCTAs(text) {
  const clean = stripHtml(text).toLowerCase();
  const found = [];
  for (const cta of GENERIC_CTAS) {
    if (clean.includes(cta)) {
      found.push(cta);
    }
  }
  return found;
}

function hasEmDash(text) {
  const clean = stripHtml(text);
  return clean.includes('—') || clean.includes('–');
}

function leadsWithPitch(text) {
  const clean = stripHtml(text).toLowerCase();
  const lines = clean.split(/\n/).filter(l => l.trim());
  const firstContent = lines.slice(0, 3).join(' ');
  const pitchPatterns = [
    /\bwe built\b/, /\bwe help\b/, /\bwe offer\b/, /\bwe provide\b/,
    /\bwe have a\b/, /\bwe created\b/, /\bwe specialize\b/,
    /\bour (team|company|service|platform|solution)\b/,
    /\bi('m| am) reaching out (to|because)\b/,
    /\bi wanted to introduce\b/
  ];
  return pitchPatterns.some(p => p.test(firstContent));
}

function signsOffAsTeam(text) {
  const clean = stripHtml(text).toLowerCase();
  const teamPatterns = [/\bteam\s*$/m, /\bteam\b.*\n*$/];
  return teamPatterns.some(p => p.test(clean));
}

function analyzeVariant(subject, body, stepIndex, sentCount, replyCount) {
  const flags = [];
  const plainBody = stripHtml(body);
  const wordCount = countWords(body);
  const replyRate = sentCount > 0 ? (replyCount / sentCount) * 100 : null;

  // Performance flags
  if (replyRate !== null && replyRate === 0 && sentCount >= 20) {
    flags.push({
      severity: 'critical',
      message: `0% reply rate (${sentCount} sent, 0 replies)`,
      id: 'zero_replies'
    });
  } else if (replyRate !== null && stepIndex === 0 && replyRate < REPLY_BENCHMARKS.intro && sentCount >= 20) {
    flags.push({
      severity: 'warning',
      message: `Low reply rate for intro: ${replyRate.toFixed(1)}% (benchmark: ${REPLY_BENCHMARKS.intro}%+)`,
      id: 'low_reply_intro'
    });
  } else if (replyRate !== null && stepIndex > 0 && replyRate < REPLY_BENCHMARKS.followup && sentCount >= 20) {
    flags.push({
      severity: 'warning',
      message: `Low reply rate for follow-up: ${replyRate.toFixed(1)}% (benchmark: ${REPLY_BENCHMARKS.followup}%+)`,
      id: 'low_reply_followup'
    });
  }

  // Word count
  if (wordCount > WORD_LIMIT) {
    flags.push({
      severity: 'warning',
      message: `Over ${WORD_LIMIT} words (${wordCount} words)`,
      id: 'over_word_limit'
    });
  }

  // Em dashes
  if (hasEmDash(body)) {
    flags.push({
      severity: 'warning',
      message: 'Contains em/en dashes',
      id: 'em_dash'
    });
  }

  // Spammy words
  const spamFound = findSpamWords(body);
  const subjectSpam = findSpamWords(subject);
  const allSpam = [...new Set([...spamFound, ...subjectSpam])];
  if (allSpam.length > 0) {
    flags.push({
      severity: 'warning',
      message: `Spammy words detected: "${allSpam.join('", "')}"`,
      id: 'spam_words'
    });
  }

  // Generic CTAs
  const genericCTAs = findGenericCTAs(body);
  if (genericCTAs.length > 0) {
    flags.push({
      severity: 'info',
      message: `Generic CTA detected: "${genericCTAs[0]}"`,
      id: 'generic_cta'
    });
  }

  // Leads with pitch
  if (leadsWithPitch(body)) {
    flags.push({
      severity: 'info',
      message: 'Opens with a pitch ("we built", "we help") instead of an observation or question',
      id: 'leads_with_pitch'
    });
  }

  // Signs off as team
  if (signsOffAsTeam(body)) {
    flags.push({
      severity: 'warning',
      message: 'Signs off as a team instead of a real person (hurts trust)',
      id: 'team_signoff'
    });
  }

  return { flags, wordCount, replyRate, spamWords: allSpam };
}

function analyzeStep(step, stepIndex, stepAnalyticsData) {
  const variants = step.variants || [];
  const variantCount = variants.filter(v => !v.v_disabled).length;
  const flags = [];

  if (variantCount < 2) {
    flags.push({
      severity: 'warning',
      message: `Only ${variantCount} variant(s). Add 2-3 A/B tests for better data.`,
      id: 'missing_ab_test'
    });
  }

  return { flags, variantCount };
}

function analyzeCampaign(campaign, details, analytics, stepsData) {
  const flags = [];
  const recommendations = [];
  let worstScore = 100;

  const sequences = details?.sequences || [];
  const steps = sequences[0]?.steps || [];

  if (steps.length < 2) {
    flags.push({ severity: 'warning', message: 'Fewer than 2 steps. Consider adding follow-ups.' });
  }

  if (steps.length > 5) {
    flags.push({ severity: 'info', message: 'More than 5 steps may feel aggressive to prospects.' });
  }

  // Check subject line variety
  const subjects = steps.flatMap(s =>
    (s.variants || []).filter(v => !v.v_disabled).map(v => (v.subject || '').toLowerCase().trim())
  );
  const uniqueSubjects = new Set(subjects);
  if (subjects.length > 2 && uniqueSubjects.size === 1) {
    flags.push({
      severity: 'info',
      message: 'All steps use the same subject line. Varying subjects can improve engagement.'
    });
  }

  // Analyze each step
  const stepResults = steps.map((step, i) => {
    const stepData = getStepAnalyticsForIndex(stepsData, i);
    const stepAnalysis = analyzeStep(step, i, stepData);

    const variantResults = (step.variants || []).map((variant, vi) => {
      const vData = getVariantAnalytics(stepData, vi);
      return {
        ...variant,
        analysis: analyzeVariant(
          variant.subject || '',
          variant.body || '',
          i,
          vData.sent || 0,
          vData.replied || 0
        ),
        analytics: vData
      };
    });

    return { ...step, stepAnalysis, variantResults, stepData };
  });

  // Generate recommendations
  const hasZeroReplyIntro = stepResults[0]?.variantResults?.some(
    v => v.analysis.flags.some(f => f.id === 'zero_replies')
  );
  if (hasZeroReplyIntro) {
    recommendations.push({
      priority: 'high',
      text: 'Rewrite intro emails. Lead with an observation or question instead of pitching immediately. Use a curiosity-driven subject line.'
    });
  }

  const hasSpam = stepResults.some(s =>
    s.variantResults?.some(v => v.analysis.spamWords.length > 0)
  );
  if (hasSpam) {
    recommendations.push({
      priority: 'medium',
      text: 'Remove spammy trigger words (highlighted in yellow) to improve deliverability.'
    });
  }

  const hasGenericCTA = stepResults.some(s =>
    s.variantResults?.some(v => v.analysis.flags.some(f => f.id === 'generic_cta'))
  );
  if (hasGenericCTA) {
    recommendations.push({
      priority: 'medium',
      text: 'Replace generic CTAs with softer, specific asks like "Want me to share the list?" or "Worth a look?"'
    });
  }

  const missingAB = stepResults.some(s => s.stepAnalysis.flags.some(f => f.id === 'missing_ab_test'));
  if (missingAB) {
    recommendations.push({
      priority: 'medium',
      text: 'Add A/B test variants (2-3 per step) to identify what resonates with your audience.'
    });
  }

  const hasOverLimit = stepResults.some(s =>
    s.variantResults?.some(v => v.analysis.flags.some(f => f.id === 'over_word_limit'))
  );
  if (hasOverLimit) {
    recommendations.push({
      priority: 'low',
      text: `Trim emails to ${WORD_LIMIT} words or under. Shorter emails get more replies in cold outreach.`
    });
  }

  const leadsWithPitchFlag = stepResults.some(s =>
    s.variantResults?.some(v => v.analysis.flags.some(f => f.id === 'leads_with_pitch'))
  );
  if (leadsWithPitchFlag) {
    recommendations.push({
      priority: 'medium',
      text: 'Stop opening with "we built" or "we help". Start with a compliment, observation, or question about their business.'
    });
  }

  // Calculate grade
  let totalFlags = 0;
  let criticalFlags = 0;
  stepResults.forEach(s => {
    totalFlags += s.stepAnalysis.flags.length;
    s.variantResults?.forEach(v => {
      totalFlags += v.analysis.flags.length;
      criticalFlags += v.analysis.flags.filter(f => f.severity === 'critical').length;
    });
  });
  totalFlags += flags.length;

  let grade;
  if (criticalFlags >= 2) grade = 'F';
  else if (criticalFlags === 1) grade = 'D';
  else if (totalFlags >= 6) grade = 'C';
  else if (totalFlags >= 3) grade = 'B';
  else grade = 'A';

  return { flags, recommendations, stepResults, grade };
}

function getStepAnalyticsForIndex(stepsData, index) {
  if (!stepsData) return {};
  // Handle different API response formats
  if (Array.isArray(stepsData)) return stepsData[index] || {};
  if (stepsData.steps && Array.isArray(stepsData.steps)) return stepsData.steps[index] || {};
  if (stepsData.data && Array.isArray(stepsData.data)) return stepsData.data[index] || {};
  return {};
}

function getVariantAnalytics(stepData, variantIndex) {
  if (!stepData) return { sent: 0, replied: 0 };
  const variants = stepData.variants || stepData.variant_analytics || [];
  if (variants[variantIndex]) return variants[variantIndex];
  // Fallback: use step-level data
  return {
    sent: stepData.sent || stepData.total_sent || 0,
    replied: stepData.replied || stepData.total_replied || stepData.unique_replied || 0
  };
}

function getStatusLabel(status) {
  const map = {
    '-99': { label: 'Draft', class: 'badge-draft' },
    '0': { label: 'Draft', class: 'badge-draft' },
    '1': { label: 'Active', class: 'badge-active' },
    '2': { label: 'Paused', class: 'badge-paused' },
    '3': { label: 'Completed', class: 'badge-completed' },
    '4': { label: 'Running Subs', class: 'badge-active' }
  };
  return map[String(status)] || { label: 'Unknown', class: 'badge-draft' };
}

// ============================================================
// RENDERING
// ============================================================
function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(screenId).classList.remove('hidden');
}

function renderDashboard() {
  const campaigns = state.campaigns;

  // Summary stats
  let totalSent = 0, totalReplied = 0, totalBounced = 0;
  campaigns.forEach(c => {
    const a = state.campaignAnalytics[c.id] || {};
    totalSent += a.sent || a.total_sent || a.emails_sent || 0;
    totalReplied += a.replied || a.total_replied || a.unique_replied || 0;
    totalBounced += a.bounced || a.total_bounced || 0;
  });

  const overallReplyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : '0.0';

  document.getElementById('summary-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Campaigns</div>
      <div class="stat-value">${campaigns.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Sent</div>
      <div class="stat-value">${totalSent.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Replies</div>
      <div class="stat-value">${totalReplied.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Reply Rate</div>
      <div class="stat-value">${overallReplyRate}%</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Bounced</div>
      <div class="stat-value">${totalBounced.toLocaleString()}</div>
    </div>
  `;

  document.getElementById('campaign-count').textContent = `${campaigns.length} campaigns`;

  // Campaign cards
  const listEl = document.getElementById('campaign-list');
  if (campaigns.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <h3>No campaigns found</h3>
        <p>Create a campaign in Instantly to see it here.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = campaigns.map(c => {
    const a = state.campaignAnalytics[c.id] || {};
    const sent = a.sent || a.total_sent || a.emails_sent || 0;
    const replied = a.replied || a.total_replied || a.unique_replied || 0;
    const bounced = a.bounced || a.total_bounced || 0;
    const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : '0.0';
    const statusInfo = getStatusLabel(c.status);

    const details = state.campaignDetails[c.id];
    const stepsData = state.stepAnalytics[c.id];
    let grade = '-';
    if (details) {
      const result = analyzeCampaign(c, details, a, stepsData);
      grade = result.grade;
    }

    const gradeClass = `grade-${grade.toLowerCase()}`;

    return `
      <div class="campaign-card" onclick="selectCampaign('${c.id}')">
        <div class="campaign-card-left">
          <div class="campaign-card-name">
            ${escapeHtml(c.name || 'Untitled Campaign')}
            <span class="badge ${statusInfo.class}">${statusInfo.label}</span>
          </div>
          <div class="campaign-card-meta">
            <span>${sent.toLocaleString()} sent</span>
            <span>${replied} replies (${replyRate}%)</span>
            <span>${bounced} bounced</span>
          </div>
        </div>
        <div class="campaign-card-right">
          <div class="campaign-grade ${gradeClass}">${grade}</div>
          <span class="arrow-icon">&rsaquo;</span>
        </div>
      </div>`;
  }).join('');
}

function renderCampaignDetail(campaignId) {
  const campaign = state.campaigns.find(c => c.id === campaignId);
  if (!campaign) return;

  const details = state.campaignDetails[campaignId] || campaign;
  const analytics = state.campaignAnalytics[campaignId] || {};
  const stepsData = state.stepAnalytics[campaignId];
  const result = analyzeCampaign(campaign, details, analytics, stepsData);

  // Header
  const statusInfo = getStatusLabel(campaign.status);
  document.getElementById('detail-header').innerHTML = `
    <div class="detail-title">
      ${escapeHtml(campaign.name || 'Untitled Campaign')}
      <span class="badge ${statusInfo.class}">${statusInfo.label}</span>
      <div class="campaign-grade grade-${result.grade.toLowerCase()}">${result.grade}</div>
    </div>
    <div class="detail-subtitle">
      Campaign ID: ${campaignId}
    </div>`;

  // Analysis panel
  const allFlags = [...result.flags];
  result.stepResults.forEach((s, i) => {
    s.stepAnalysis.flags.forEach(f => {
      allFlags.push({ ...f, message: `Step ${i + 1}: ${f.message}` });
    });
  });

  const criticalFlags = allFlags.filter(f => f.severity === 'critical');
  const warningFlags = allFlags.filter(f => f.severity === 'warning');
  const infoFlags = allFlags.filter(f => f.severity === 'info');

  let analysisHtml = '';

  if (criticalFlags.length > 0 || warningFlags.length > 0) {
    const panelClass = criticalFlags.length > 0 ? 'panel-critical' : 'panel-warning';
    analysisHtml += `
      <div class="analysis-panel ${panelClass}">
        <h3>Issues Found (${allFlags.length})</h3>
        <ul class="flag-list">
          ${criticalFlags.map(f => `
            <li class="flag-critical">
              <span class="flag-icon">!</span>
              <span>${escapeHtml(f.message)}</span>
            </li>`).join('')}
          ${warningFlags.map(f => `
            <li class="flag-warning">
              <span class="flag-icon">!</span>
              <span>${escapeHtml(f.message)}</span>
            </li>`).join('')}
          ${infoFlags.map(f => `
            <li class="flag-info">
              <span class="flag-icon">i</span>
              <span>${escapeHtml(f.message)}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  } else {
    analysisHtml += `
      <div class="analysis-panel panel-success">
        <h3>Looking Good</h3>
        <p style="font-size:13px;color:var(--text-secondary)">No major issues detected with this campaign's copy.</p>
      </div>`;
  }

  if (result.recommendations.length > 0) {
    analysisHtml += `
      <div class="analysis-panel panel-info">
        <h3>Recommendations</h3>
        <ul class="rec-list">
          ${result.recommendations.map(r => `
            <li>
              <strong>${r.priority.toUpperCase()} PRIORITY</strong>
              ${escapeHtml(r.text)}
            </li>`).join('')}
        </ul>
      </div>`;
  }

  document.getElementById('detail-analysis').innerHTML = analysisHtml;

  // Steps
  const steps = result.stepResults;
  let stepsHtml = '';

  steps.forEach((step, si) => {
    const stepData = step.stepData || {};
    const sent = stepData.sent || stepData.total_sent || 0;
    const replied = stepData.replied || stepData.total_replied || stepData.unique_replied || 0;
    const opened = stepData.opened || stepData.total_opened || stepData.unique_opened || 0;
    const bounced = stepData.bounced || stepData.total_bounced || 0;
    const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : '0.0';
    const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(1) : '0.0';
    const variants = step.variantResults || [];
    const enabledVariants = variants.filter(v => !v.v_disabled);

    const stepLabel = si === 0 ? 'Intro Email' : si === steps.length - 1 && si > 0 ? 'Breakup Email' : `Follow-up ${si}`;
    const stepFlags = [...step.stepAnalysis.flags];
    const hasCritical = enabledVariants.some(v => v.analysis.flags.some(f => f.severity === 'critical'));
    const hasWarning = enabledVariants.some(v => v.analysis.flags.some(f => f.severity === 'warning')) || stepFlags.length > 0;

    let statusBadge = '';
    if (hasCritical) statusBadge = '<span class="badge badge-critical">Needs Attention</span>';
    else if (hasWarning) statusBadge = '<span class="badge badge-warning">Issues Found</span>';
    else statusBadge = '<span class="badge badge-success">OK</span>';

    stepsHtml += `
      <div class="step-card">
        <div class="step-header" onclick="toggleStep(${si})">
          <div class="step-header-left">
            <div class="step-number">${si + 1}</div>
            <div>
              <div class="step-title">${stepLabel}</div>
              <div class="step-meta">${enabledVariants.length} variant(s) | ${sent} sent | ${replyRate}% reply rate</div>
            </div>
          </div>
          <div class="step-header-right">
            ${statusBadge}
            ${stepFlags.map(f => `<span class="badge badge-warning">${escapeHtml(f.message)}</span>`).join('')}
            <span class="arrow-icon" id="step-arrow-${si}">&rsaquo;</span>
          </div>
        </div>
        <div class="step-body" id="step-body-${si}">
          <div class="step-analytics">
            <div class="step-stat">
              <div class="step-stat-value">${sent}</div>
              <div class="step-stat-label">Sent</div>
            </div>
            <div class="step-stat">
              <div class="step-stat-value">${openRate}%</div>
              <div class="step-stat-label">Opened</div>
            </div>
            <div class="step-stat">
              <div class="step-stat-value">${replyRate}%</div>
              <div class="step-stat-label">Replied</div>
            </div>
            <div class="step-stat">
              <div class="step-stat-value">${bounced}</div>
              <div class="step-stat-label">Bounced</div>
            </div>
            <div class="step-stat">
              <div class="step-stat-value">${enabledVariants.length}</div>
              <div class="step-stat-label">Variants</div>
            </div>
          </div>
          ${renderVariants(enabledVariants, si)}
        </div>
      </div>`;
  });

  document.getElementById('detail-steps').innerHTML = stepsHtml;
  show('detail-screen');
}

function renderVariants(variants, stepIndex) {
  if (variants.length === 0) {
    return '<div class="variant-container"><p style="color:var(--text-muted);font-size:13px;">No email variants found in this step.</p></div>';
  }

  const tabs = variants.map((v, vi) =>
    `<button class="variant-tab ${vi === 0 ? 'active' : ''}" onclick="switchVariant(${stepIndex}, ${vi})">
      Variant ${String.fromCharCode(65 + vi)}
    </button>`
  ).join('');

  const contents = variants.map((v, vi) => {
    const a = v.analysis;
    const va = v.analytics || {};
    const vSent = va.sent || 0;
    const vReplied = va.replied || 0;
    const vRate = vSent > 0 ? ((vReplied / vSent) * 100).toFixed(1) : '-';

    let flagBadges = '';
    if (a.flags.length > 0) {
      flagBadges = `<div class="variant-flags">
        ${a.flags.map(f => `<span class="flag-inline ${f.severity}">${escapeHtml(f.message)}</span>`).join('')}
      </div>`;
    }

    const bodyHtml = highlightIssues(v.body || '', a.spamWords);
    const wordClass = a.wordCount > WORD_LIMIT ? 'over-limit' : '';

    let recHtml = '';
    const recs = generateVariantRecommendations(a);
    if (recs.length > 0) {
      recHtml = `
        <div class="recommendations-section">
          <h4>Suggestions for this variant</h4>
          <ul>${recs.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>`;
    }

    return `
      <div class="variant-content ${vi === 0 ? 'active' : ''}" id="variant-${stepIndex}-${vi}">
        <div class="variant-stats">
          <span class="variant-stat">Sent: <strong>${vSent}</strong></span>
          <span class="variant-stat">Replied: <strong>${vReplied}</strong></span>
          <span class="variant-stat">Reply Rate: <strong>${vRate}%</strong></span>
        </div>
        ${flagBadges}
        <div class="email-preview">
          <div class="email-subject">Subject: <strong>${escapeHtml(v.subject || '(no subject)')}</strong></div>
          <div class="email-body">${bodyHtml}</div>
          <div class="word-count ${wordClass}">Body word count: ${a.wordCount} / ${WORD_LIMIT}</div>
        </div>
        ${recHtml}
      </div>`;
  }).join('');

  return `
    <div class="variant-container">
      <div class="variant-tabs">${tabs}</div>
      ${contents}
    </div>`;
}

function highlightIssues(html, spamWords) {
  let text = stripHtml(html);
  text = escapeHtml(text);

  // Highlight spam words
  for (const word of spamWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(${escaped})\\b`, 'gi');
    text = text.replace(regex, '<span class="spam-highlight">$1</span>');
  }

  // Highlight em dashes
  text = text.replace(/[—–]/g, '<span class="emdash-highlight">$&</span>');

  return text;
}

function generateVariantRecommendations(analysis) {
  const recs = [];

  if (analysis.flags.some(f => f.id === 'zero_replies')) {
    recs.push('This variant is getting no replies. Consider a complete rewrite with a different angle.');
  }
  if (analysis.flags.some(f => f.id === 'leads_with_pitch')) {
    recs.push('Open with a compliment, observation, or question before mentioning your service.');
  }
  if (analysis.flags.some(f => f.id === 'generic_cta')) {
    recs.push('Replace the generic CTA with a specific, soft ask like "Want me to share it?" or "Worth a look?"');
  }
  if (analysis.flags.some(f => f.id === 'team_signoff')) {
    recs.push('Sign off with a real person\'s name instead of a team name.');
  }
  if (analysis.flags.some(f => f.id === 'spam_words')) {
    recs.push('Remove highlighted spammy words to improve inbox placement.');
  }
  if (analysis.flags.some(f => f.id === 'over_word_limit')) {
    recs.push(`Cut the body down to ${WORD_LIMIT} words or under. Remove filler and get to the point faster.`);
  }
  if (analysis.flags.some(f => f.id === 'em_dash')) {
    recs.push('Replace em/en dashes with commas or periods.');
  }

  return recs;
}

// ============================================================
// ACTIONS
// ============================================================
async function connect() {
  const input = document.getElementById('api-key');
  const key = input.value.trim();

  if (!key) {
    showError('Please enter your API key.');
    return;
  }

  state.apiKey = key;
  show('loading-screen');
  setLoadingText('Fetching campaigns...');

  try {
    // Fetch campaign list
    const campaignData = await api('/api/v2/campaigns?limit=100');
    const campaigns = campaignData.items || campaignData.data || campaignData || [];
    state.campaigns = Array.isArray(campaigns) ? campaigns : [];

    if (state.campaigns.length === 0) {
      show('dashboard-screen');
      renderDashboard();
      return;
    }

    // Fetch details and analytics for each campaign
    setLoadingText(`Loading ${state.campaigns.length} campaign(s)...`);

    const detailPromises = state.campaigns.map(async (c) => {
      try {
        const detail = await api(`/api/v2/campaigns/${c.id}`);
        state.campaignDetails[c.id] = detail;
      } catch {
        state.campaignDetails[c.id] = c;
      }
    });

    const analyticsPromises = state.campaigns.map(async (c) => {
      try {
        const analytics = await api(`/api/v2/campaigns/${c.id}/analytics`);
        state.campaignAnalytics[c.id] = analytics;
      } catch {
        state.campaignAnalytics[c.id] = {};
      }
    });

    const stepsPromises = state.campaigns.map(async (c) => {
      try {
        const steps = await api(`/api/v2/campaigns/${c.id}/steps/analytics`);
        state.stepAnalytics[c.id] = steps;
      } catch {
        state.stepAnalytics[c.id] = null;
      }
    });

    await Promise.all([...detailPromises, ...analyticsPromises, ...stepsPromises]);

    setLoadingText('Analyzing campaigns...');
    await new Promise(r => setTimeout(r, 300));

    renderDashboard();
    show('dashboard-screen');

  } catch (err) {
    show('connect-screen');
    showError(`Failed to connect: ${err.message}. Check your API key and try again.`);
  }
}

function disconnect() {
  state = { apiKey: '', campaigns: [], campaignDetails: {}, campaignAnalytics: {}, stepAnalytics: {} };
  document.getElementById('api-key').value = '';
  document.getElementById('connect-error').classList.add('hidden');
  show('connect-screen');
}

function selectCampaign(id) {
  renderCampaignDetail(id);
}

function goBack() {
  show('dashboard-screen');
}

function toggleStep(stepIndex) {
  const body = document.getElementById(`step-body-${stepIndex}`);
  const arrow = document.getElementById(`step-arrow-${stepIndex}`);
  body.classList.toggle('open');
  arrow.style.transform = body.classList.contains('open') ? 'rotate(90deg)' : '';
}

function switchVariant(stepIndex, variantIndex) {
  // Update tabs
  const card = document.getElementById(`step-body-${stepIndex}`);
  if (!card) return;
  card.querySelectorAll('.variant-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === variantIndex);
  });
  card.querySelectorAll('.variant-content').forEach((content, i) => {
    content.classList.toggle('active', i === variantIndex);
  });
}

function toggleKeyVisibility() {
  const input = document.getElementById('api-key');
  const icon = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = 'Hide';
  } else {
    input.type = 'password';
    icon.textContent = 'Show';
  }
}

// ============================================================
// HELPERS
// ============================================================
function showError(msg) {
  const el = document.getElementById('connect-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setLoadingText(text) {
  document.getElementById('loading-text').textContent = text;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Enter key on API key input
document.getElementById('api-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connect();
});
