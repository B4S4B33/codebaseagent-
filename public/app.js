(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('input-form');
  const urlInput = $('url');
  const fileInput = $('file');
  const fileLabel = $('file-label');
  const submit = $('submit');
  const inputError = $('input-error');
  const statusView = $('status-view');
  const statusDot = $('status-dot');
  const statusText = $('status-text');
  const progress = $('progress');
  const resetBtn = $('reset');
  const resultView = $('result-view');
  const findingsEl = $('findings');
  const resultNotes = $('result-notes');
  const filters = $('filters');
  const template = $('finding-template');

  let currentJob = null;
  let pollTimer = null;
  let currentReport = null;
  let activeFilter = 'all';

  // File input label
  fileInput.addEventListener('change', () => {
    fileLabel.textContent = fileInput.files[0] ? fileInput.files[0].name : 'Choose a zip file';
  });

  // Drag and drop
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) {
      fileInput.files = e.dataTransfer.files;
      fileLabel.textContent = f.name;
    }
  });

  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    inputError.hidden = true;
    const url = urlInput.value.trim();
    const file = fileInput.files[0];

    if (!url && !file) {
      inputError.textContent = 'Enter a GitHub URL or choose a zip file.';
      inputError.hidden = false;
      return;
    }
    if (url && !/^https?:\/\//i.test(url)) {
      inputError.textContent = 'URL must start with http:// or https://';
      inputError.hidden = false;
      return;
    }
    if (file && ! /\.zip$/i.test(file.name)) {
      inputError.textContent = 'Upload a .zip file.';
      inputError.hidden = false;
      return;
    }

    submit.disabled = true;
    form.hidden = true;
    statusView.hidden = false;
    resultView.hidden = true;
    setProgress(0);

    const fd = new FormData();
    if (url) fd.append('url', url);
    else fd.append('file', file);

    let jobId;
    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      jobId = data.jobId;
    } catch (err) {
      setStatus('error', err.message);
      submit.disabled = false;
      form.hidden = false;
      statusView.hidden = true;
      return;
    }

    currentJob = jobId;
    poll();
  });

  function setStatus(state, text) {
    statusDot.className = 'dot ' + (state === 'running' ? 'running' : state);
    statusText.textContent = text;
  }

  function setProgress(p) { progress.value = Math.max(0, Math.min(100, p)); }

  async function poll() {
    if (!currentJob) return;
    try {
      const res = await fetch('/api/jobs/' + currentJob);
      const data = await res.json();
      if (data.status === 'queued') {
        setStatus('running', 'Queued');
        setProgress(5);
      } else if (data.status === 'cloning') {
        setStatus('running', data.progress || 'Cloning repo');
        setProgress(20);
      } else if (data.status === 'analyzing') {
        setStatus('running', data.progress || 'Analyzing');
        setProgress(55);
      } else if (data.status === 'done') {
        setStatus('done', 'Complete');
        setProgress(100);
        currentReport = data.report;
        renderReport();
        resultView.hidden = false;
        stopPoll();
      } else if (data.status === 'error') {
        setStatus('error', 'Failed: ' + (data.error || 'unknown error'));
        stopPoll();
        return;
      }
      pollTimer = setTimeout(poll, 1500);
    } catch (err) {
      pollTimer = setTimeout(poll, 2000);
    }
  }

  function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

  function renderReport() {
    const r = currentReport;
    $('result-language').textContent = r.language || 'Unknown';
    $('result-summary').textContent = r.projectSummary || '';
    findingsEl.innerHTML = '';
    const findings = (r.findings || []).filter((f) => activeFilter === 'all' || f.severity === activeFilter);

    if (findings.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = r.findings && r.findings.length
        ? 'No findings match the selected filter.'
        : 'No bugs found in the reviewed code.';
      findingsEl.appendChild(empty);
    } else {
      for (const f of findings) {
        findingsEl.appendChild(renderFinding(f));
      }
    }
    resultNotes.textContent = r.notes || '';
  }

  function renderFinding(f) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('.sev').setAttribute('data-s', f.severity);
    node.querySelector('.sev').textContent = f.severity;
    node.querySelector('.fid').textContent = f.id;
    node.querySelector('.loc').textContent = [f.file, f.location].filter(Boolean).join(' :: ');
    node.querySelector('.desc').textContent = f.description;
    node.querySelector('.fix-text').textContent = f.proposedFix || 'No proposed fix.';
    return node;
  }

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    activeFilter = btn.dataset.sev;
    [...filters.children].forEach((b) => b.classList.toggle('active', b === btn));
    renderReport();
  });

  resetBtn.addEventListener('click', () => {
    stopPoll();
    currentJob = null;
    currentReport = null;
    activeFilter = 'all';
    submit.disabled = false;
    form.hidden = false;
    statusView.hidden = true;
    resultView.hidden = true;
    urlInput.value = '';
    fileInput.value = '';
    fileLabel.textContent = 'Choose a zip file';
    inputError.hidden = true;
    [...filters.children].forEach((b) => b.classList.toggle('active', b.dataset.sev === 'all'));
  });
})();