'use strict';

/* ═══════════════════════════════════════════════════════════════
   FactCheck AI — Frontend Application
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  // ──────────────────────────────────────────────────────────────
  // 1. DOM REFERENCES
  // ──────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dropZone        = $('#drop-zone');
  const fileInput       = $('#file-input');
  const uploadBtn       = $('#upload-btn');
  const fileInfo        = $('#file-info');
  const fileName        = $('#file-name');
  const fileSize        = $('#file-size');
  const removeFileBtn   = $('#remove-file-btn');
  const uploadError     = $('#upload-error');
  const analyzeBtn      = $('#analyze-btn');

  const apiKeyInput     = $('#api-key-input');
  const toggleApiKeyBtn = $('#toggle-api-key-btn');

  const uploadSection     = $('#upload-section');
  const processingSection = $('#processing-section');
  const resultsSection    = $('#results-section');

  const progressBar     = $('#progress-bar');
  const statusMessage   = $('#status-message');

  const statTotal       = $('#stat-total');
  const statVerified    = $('#stat-verified');
  const statInaccurate  = $('#stat-inaccurate');
  const statFalse       = $('#stat-false');
  const statTotalPct    = $('#stat-total-pct');
  const statVerifiedPct = $('#stat-verified-pct');
  const statInaccuratePct = $('#stat-inaccurate-pct');
  const statFalsePct    = $('#stat-false-pct');

  const donutCanvas     = $('#donut-chart');
  const chartLegend     = $('#chart-legend');
  const filterBtns      = $('#filter-btns');
  const claimsContainer = $('#claims-container');
  const exportBtn       = $('#export-btn');
  const resetBtn        = $('#reset-btn');

  const stepperSteps    = $$('.stepper__step');

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
  const ANALYSIS_TIMEOUT = 300000; // 5 minutes

  let selectedFile = null;
  let analysisResults = null;
  let timeoutTimer = null;


  // ──────────────────────────────────────────────────────────────
  // 2. HELPERS
  // ──────────────────────────────────────────────────────────────

  /** Format bytes to human-readable string */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
    return `${size} ${units[i]}`;
  }

  /** ISO-ish timestamp for filenames */
  function formatTimestamp() {
    const d = new Date();
    return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  /** Animate a counter from 0 → target */
  function animateCounter(element, target, duration = 800) {
    const start = performance.now();
    const initial = 0;

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(initial + (target - initial) * eased);
      element.textContent = value;
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }

  /** Show an inline error below the drop zone */
  function showError(msg) {
    uploadError.textContent = msg;
    uploadError.classList.remove('hidden');
    // Auto-hide after 5 seconds
    setTimeout(() => {
      uploadError.classList.add('hidden');
    }, 5000);
  }

  /** Hide all sections, then show the specified one */
  function showSection(section) {
    [uploadSection, processingSection, resultsSection].forEach(s => s.classList.add('hidden'));
    section.classList.remove('hidden');
  }


  // ──────────────────────────────────────────────────────────────
  // 3. DRAG & DROP + FILE SELECTION
  // ──────────────────────────────────────────────────────────────

  // Prevent default drag behavior on the whole window
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // Visual feedback on the drop zone
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, () => dropZone.classList.add('drag-over'));
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'));
  });

  // Handle file drop
  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelect(files[0]);
  });

  // Click or Enter on drop zone opens file dialog
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  uploadBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Don't double-trigger via dropZone click
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFileSelect(fileInput.files[0]);
  });

  // Remove file
  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFile();
  });

  /** Validate and display selected file */
  function handleFileSelect(file) {
    uploadError.classList.add('hidden');

    // Type check
    if (file.type !== 'application/pdf') {
      showError('Please select a valid PDF file.');
      clearFile();
      return;
    }

    // Size check
    if (file.size > MAX_FILE_SIZE) {
      showError(`File is too large (${formatFileSize(file.size)}). Maximum size is 20 MB.`);
      clearFile();
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileInfo.classList.remove('hidden');
    analyzeBtn.classList.remove('hidden');
  }

  /** Clear current file selection */
  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    analyzeBtn.classList.add('hidden');
  }


  // ──────────────────────────────────────────────────────────────
  // 4. STEPPER MANAGEMENT
  // ──────────────────────────────────────────────────────────────

  const STEP_ORDER = ['upload', 'extracting', 'analyzing', 'verifying'];

  function resetStepper() {
    stepperSteps.forEach(step => {
      step.classList.remove('active', 'completed');
    });
  }

  function activateStep(stepName) {
    const idx = STEP_ORDER.indexOf(stepName);
    stepperSteps.forEach((step, i) => {
      step.classList.remove('active');
      if (i < idx) {
        step.classList.add('completed');
      } else if (i === idx) {
        step.classList.add('active');
      }
    });
  }

  function completeAllSteps() {
    stepperSteps.forEach(step => {
      step.classList.remove('active');
      step.classList.add('completed');
    });
  }


  // ──────────────────────────────────────────────────────────────
  // 5. SSE STREAM PARSER
  // ──────────────────────────────────────────────────────────────

  /**
   * Reads a ReadableStream and yields parsed SSE events.
   * Handles chunked data that may split across reads.
   */
  async function* parseSSEStream(reader) {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split by double newline (SSE event boundary) or single newline
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            yield JSON.parse(jsonStr);
          } catch (e) {
            console.warn('Failed to parse SSE data:', jsonStr, e);
          }
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim().startsWith('data: ')) {
      try {
        yield JSON.parse(buffer.trim().slice(6));
      } catch (e) {
        console.warn('Failed to parse final SSE data:', buffer, e);
      }
    }
  }


  // ──────────────────────────────────────────────────────────────
  // 6. ANALYSIS FLOW
  // ──────────────────────────────────────────────────────────────

  // Initialize API Key from localStorage
  const savedApiKey = localStorage.getItem('gemini_api_key');
  if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
  }

  // Toggle API key visibility
  toggleApiKeyBtn.addEventListener('click', () => {
    const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
    apiKeyInput.setAttribute('type', type);
    $('.eye-icon').classList.toggle('hidden');
    $('.eye-off-icon').classList.toggle('hidden');
  });

  analyzeBtn.addEventListener('click', startAnalysis);

  async function startAnalysis() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showError('Please enter your Gemini API Key before analyzing.');
      apiKeyInput.focus();
      return;
    }

    if (!selectedFile) return;

    // Save key to localStorage for future use
    localStorage.setItem('gemini_api_key', apiKey);

    // Switch to processing view
    showSection(processingSection);
    resetStepper();
    updateProgress(0);
    statusMessage.textContent = 'Preparing analysis...';

    // Immediately mark upload step as active
    activateStep('upload');

    const formData = new FormData();
    formData.append('pdf', selectedFile);
    formData.append('apiKey', apiKey);

    // Set timeout timer
    timeoutTimer = setTimeout(() => {
      showError('The analysis is taking longer than expected. Please try again.');
      showSection(uploadSection);
    }, ANALYSIS_TIMEOUT);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();

      for await (const event of parseSSEStream(reader)) {
        handleSSEEvent(event);
      }

    } catch (error) {
      clearTimeout(timeoutTimer);
      console.error('Analysis error:', error);
      handleAnalysisError(error.message || 'A network error occurred. Please check your connection and try again.');
    }
  }

  /** Handle individual SSE events */
  function handleSSEEvent(event) {
    // Reset timeout since we received an update from the server
    clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      showError('The analysis is taking longer than expected. Please try again.');
      showSection(uploadSection);
    }, ANALYSIS_TIMEOUT);

    const { step, message, progress, data, currentClaim, totalClaims } = event;

    switch (step) {
      case 'extracting':
        activateStep('extracting');
        updateProgress(progress || 10);
        statusMessage.textContent = message || 'Extracting text from PDF...';
        break;

      case 'analyzing':
        activateStep('analyzing');
        updateProgress(progress || 30);
        statusMessage.textContent = message || 'Identifying factual claims...';
        break;

      case 'verifying':
        activateStep('verifying');
        updateProgress(progress || 55);
        if (currentClaim && totalClaims) {
          statusMessage.textContent = `Verifying claim ${currentClaim} of ${totalClaims}...`;
        } else {
          statusMessage.textContent = message || 'Verifying claims...';
        }
        break;

      case 'complete':
        clearTimeout(timeoutTimer);
        completeAllSteps();
        updateProgress(100);
        statusMessage.textContent = 'Analysis complete!';

        // Short delay to let the user see 100%
        setTimeout(() => {
          analysisResults = data;
          showSection(resultsSection);
          renderResults(data);
        }, 600);
        break;

      case 'error':
        clearTimeout(timeoutTimer);
        handleAnalysisError(message || 'An unexpected error occurred during analysis.');
        break;

      default:
        // Unknown step — update message if provided
        if (message) statusMessage.textContent = message;
        if (progress) updateProgress(progress);
    }
  }

  /** Update the progress bar width */
  function updateProgress(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    progressBar.style.width = clamped + '%';
    progressBar.setAttribute('aria-valuenow', clamped);
  }

  /** Handle errors with a retry option */
  function handleAnalysisError(msg) {
    showSection(uploadSection);
    showError(msg);
    // Re-show file info so user can retry
    if (selectedFile) {
      fileInfo.classList.remove('hidden');
      analyzeBtn.classList.remove('hidden');
    }
  }


  // ──────────────────────────────────────────────────────────────
  // 7. RESULTS RENDERING
  // ──────────────────────────────────────────────────────────────

  function renderResults(data) {
    if (!data) return;
    renderSummary(data.summary);
    renderDonutChart(data.summary);
    renderClaims(data.claims);
  }

  // ─── Summary Cards ─────────────────────────────────────────
  function renderSummary(summary) {
    if (!summary) return;
    const { total, verified, inaccurate } = summary;
    const falseCount = summary.false;

    // Animate counters
    animateCounter(statTotal, total);
    animateCounter(statVerified, verified);
    animateCounter(statInaccurate, inaccurate);
    animateCounter(statFalse, falseCount);

    // Percentages
    statTotalPct.textContent = 'analyzed';
    statVerifiedPct.textContent = total > 0 ? `${Math.round((verified / total) * 100)}%` : '0%';
    statInaccuratePct.textContent = total > 0 ? `${Math.round((inaccurate / total) * 100)}%` : '0%';
    statFalsePct.textContent = total > 0 ? `${Math.round((falseCount / total) * 100)}%` : '0%';
  }

  // ─── Donut Chart ───────────────────────────────────────────
  function renderDonutChart(summary) {
    if (!summary) return;

    const ctx = donutCanvas.getContext('2d');
    const w = donutCanvas.width;
    const h = donutCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.min(w, h) / 2 - 10;
    const innerR = outerR * 0.62;

    const total = summary.total || 1;
    const segments = [
      { label: 'Verified',   value: summary.verified,   color: '#10b981' },
      { label: 'Inaccurate', value: summary.inaccurate, color: '#f59e0b' },
      { label: 'False',      value: summary.false,      color: '#ef4444' },
    ];

    ctx.clearRect(0, 0, w, h);

    // Animate the donut drawing
    let animationProgress = 0;
    const animDuration = 1000;
    const animStart = performance.now();

    function drawFrame(now) {
      const elapsed = now - animStart;
      animationProgress = Math.min(elapsed / animDuration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - animationProgress, 3);

      ctx.clearRect(0, 0, w, h);

      // Background track
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fill();

      let currentAngle = -Math.PI / 2; // Start from top

      segments.forEach(seg => {
        const sliceAngle = (seg.value / total) * Math.PI * 2 * eased;
        if (sliceAngle <= 0) return;

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, currentAngle, currentAngle + sliceAngle);
        ctx.arc(cx, cy, innerR, currentAngle + sliceAngle, currentAngle, true);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.fill();

        currentAngle += sliceAngle;
      });

      // Center text
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '700 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(total * eased), cx, cy - 6);

      ctx.fillStyle = '#64748b';
      ctx.font = '400 11px Inter, sans-serif';
      ctx.fillText('claims', cx, cy + 14);

      if (animationProgress < 1) {
        requestAnimationFrame(drawFrame);
      }
    }

    requestAnimationFrame(drawFrame);

    // Legend
    chartLegend.innerHTML = segments.map(seg =>
      `<div class="chart-legend__item">
        <span class="chart-legend__dot" style="background:${seg.color}"></span>
        ${seg.label} (${seg.value})
      </div>`
    ).join('');
  }

  // ─── Claim Cards ───────────────────────────────────────────
  function renderClaims(claims) {
    if (!claims || claims.length === 0) {
      claimsContainer.innerHTML = '<p style="text-align:center;color:var(--text-muted)">No claims found.</p>';
      return;
    }

    claimsContainer.innerHTML = '';

    claims.forEach((claim, index) => {
      const card = document.createElement('div');
      card.className = `claim-card claim-card--${claim.status}`;
      card.dataset.status = claim.status;
      card.style.animationDelay = `${index * 100}ms`;

      // Confidence dots
      const confLevels = { high: 3, medium: 2, low: 1 };
      const filledDots = confLevels[claim.confidence] || 2;
      const dotsHTML = [1, 2, 3].map(i =>
        `<span class="claim-card__confidence-dot${i <= filledDots ? ' filled' : ''}"></span>`
      ).join('');

      // Status badge icon
      const badgeIcons = {
        verified: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        inaccurate: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
        false: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
      };

      // Correct info section (for inaccurate or false claims)
      const correctInfoHTML = claim.correctInfo
        ? `<div class="claim-card__correct-info">
            <strong>Correct Information</strong>
            ${escapeHTML(claim.correctInfo)}
          </div>`
        : '';

      // Sources
      const sourcesHTML = claim.sources && claim.sources.length > 0
        ? `<div class="claim-card__sources">
            ${claim.sources.map(src =>
              `<a href="${escapeHTML(src.url)}" target="_blank" rel="noopener noreferrer" class="claim-card__source-link">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                ${escapeHTML(src.title)}
              </a>`
            ).join('')}
          </div>`
        : '';

      card.innerHTML = `
        <div class="claim-card__header">
          <span class="claim-card__badge claim-card__badge--${claim.status}">
            ${badgeIcons[claim.status] || ''}
            ${claim.status}
          </span>
          ${claim.category ? `<span class="claim-card__category">${escapeHTML(claim.category)}</span>` : ''}
          <div class="claim-card__confidence">
            ${dotsHTML}
            <span class="claim-card__confidence-label">${claim.confidence || 'medium'}</span>
          </div>
        </div>
        <p class="claim-card__text">"${escapeHTML(claim.claim)}"</p>
        <p class="claim-card__explanation">${escapeHTML(claim.explanation)}</p>
        ${correctInfoHTML}
        ${sourcesHTML}
      `;

      claimsContainer.appendChild(card);
    });
  }

  /** Basic HTML escape to prevent XSS */
  function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }


  // ──────────────────────────────────────────────────────────────
  // 8. FILTERING
  // ──────────────────────────────────────────────────────────────

  filterBtns.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    const filter = btn.dataset.filter;

    // Update active state
    filterBtns.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Filter cards
    const cards = claimsContainer.querySelectorAll('.claim-card');
    cards.forEach((card, index) => {
      if (filter === 'all' || card.dataset.status === filter) {
        card.classList.remove('filtered-out');
        // Reset animation for a nice re-entrance
        card.style.animation = 'none';
        card.offsetHeight; // Force reflow
        card.style.animation = '';
        card.style.animationDelay = `${index * 60}ms`;
      } else {
        card.classList.add('filtered-out');
      }
    });
  });


  // ──────────────────────────────────────────────────────────────
  // 9. EXPORT
  // ──────────────────────────────────────────────────────────────

  exportBtn.addEventListener('click', () => {
    if (!analysisResults) return;

    const jsonStr = JSON.stringify(analysisResults, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `factcheck-results-${formatTimestamp()}.json`;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  });


  // ──────────────────────────────────────────────────────────────
  // 10. RESET
  // ──────────────────────────────────────────────────────────────

  resetBtn.addEventListener('click', () => {
    // Clear state
    selectedFile = null;
    analysisResults = null;
    fileInput.value = '';
    clearTimeout(timeoutTimer);

    // Reset UI
    fileInfo.classList.add('hidden');
    analyzeBtn.classList.add('hidden');
    uploadError.classList.add('hidden');
    claimsContainer.innerHTML = '';
    chartLegend.innerHTML = '';

    // Reset progress
    resetStepper();
    updateProgress(0);
    statusMessage.textContent = 'Preparing analysis...';

    // Reset filter buttons
    filterBtns.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    filterBtns.querySelector('[data-filter="all"]').classList.add('active');

    // Reset stat values
    [statTotal, statVerified, statInaccurate, statFalse].forEach(el => { el.textContent = '0'; });
    [statTotalPct, statVerifiedPct, statInaccuratePct, statFalsePct].forEach(el => { el.textContent = ''; });

    // Clear canvas
    const ctx = donutCanvas.getContext('2d');
    ctx.clearRect(0, 0, donutCanvas.width, donutCanvas.height);

    // Show upload section
    showSection(uploadSection);
  });

});
