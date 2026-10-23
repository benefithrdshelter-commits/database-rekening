/* Database Rekening — logika halaman */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var TOKEN_KEY = 'dbrek_kode_akses';
  var PAGE_SIZE = 25;
  var $ = function (id) { return document.getElementById(id); };

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  /* ---------- penyimpanan kode akses (aman bila storage diblokir) ---------- */
  var memToken = '';
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || memToken; } catch (e) { return memToken; } }
  function setToken(v) { memToken = v; try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* abaikan */ } }

  function urlReady() { return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(CFG.SCRIPT_URL || ''); }
  function connected() { return urlReady() && !!getToken(); }

  /* ---------- util ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n).toLocaleString('id-ID'); }
  function rp(cents) { return (cents / 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function show(id) { ['stPick', 'stRead', 'stResult', 'stDone'].forEach(function (s) { $(s).hidden = s !== id; }); }
  function setStep(n) {
    document.querySelectorAll('.step').forEach(function (el) {
      var s = +el.dataset.step;
      el.classList.toggle('is-active', s === n);
      el.classList.toggle('is-done', s < n);
      if (s === n) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
  }

  /* ---------- koneksi ---------- */
  function refreshConn() {
    var on = connected();
    $('connBtn').classList.toggle('is-on', on);
    $('connText').textContent = !urlReady() ? 'URL belum diatur' : (on ? 'Terhubung' : 'Belum terhubung');
    $('connNotice').hidden = on;
    if (state.res) updateAction();
  }
  ['navSheet', 'heroSheet', 'doneSheet'].forEach(function (id) {
    var a = $(id);
    if (CFG.SPREADSHEET_URL) a.href = CFG.SPREADSHEET_URL; else a.hidden = true;
  });

  async function post(payload) {
    var resp = await fetch(CFG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('Server membalas ' + resp.status + '.');
    return resp.json();
  }

  /* ---------- pengaturan ---------- */
  var dlgSet = $('dlgSet');
  function openSettings() {
    $('tokenIn').value = getToken();
    $('setMsg').textContent = urlReady() ? '' : 'SCRIPT_URL di config.js belum diisi. Hubungi admin.';
    $('setMsg').className = 'field__msg' + (urlReady() ? '' : ' bad');
    dlgSet.showModal();
    $('tokenIn').focus();
  }
  document.querySelectorAll('[data-open-settings]').forEach(function (b) { b.addEventListener('click', openSettings); });
  $('connBtn').addEventListener('click', openSettings);
  $('forgetBtn').addEventListener('click', function () {
    setToken(''); $('tokenIn').value = ''; refreshConn();
    $('setMsg').textContent = 'Kode akses dihapus dari browser ini.'; $('setMsg').className = 'field__msg';
  });
  $('testBtn').addEventListener('click', async function () {
    var v = $('tokenIn').value.trim(), msg = $('setMsg'), btn = this;
    if (!v) { msg.textContent = 'Isi kode akses dulu.'; msg.className = 'field__msg bad'; $('tokenIn').focus(); return; }
    if (!urlReady()) { msg.textContent = 'SCRIPT_URL di config.js belum diisi.'; msg.className = 'field__msg bad'; return; }
    btn.disabled = true; msg.textContent = 'Mengetes koneksi…'; msg.className = 'field__msg';
    try {
      var out = await post({ token: v, action: 'ping' });
      if (!out.ok) throw new Error(out.error || 'Koneksi ditolak.');
      setToken(v); refreshConn();
      msg.textContent = 'Terhubung. Sheet Data Upah berisi ' + num(out.totalBarisSheet) + ' baris.'; msg.className = 'field__msg ok';
    } catch (err) {
      msg.textContent = 'Gagal: ' + err.message; msg.className = 'field__msg bad';
    } finally { btn.disabled = false; }
  });

  /* ---------- pilih & baca PDF ---------- */
  var state = { file: null, pages: 0, res: null, q: '', page: 1, sent: false };
  var drop = $('drop'), input = $('file');

  input.addEventListener('change', function () { if (input.files[0]) handle(input.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
  drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) handle(f); });
  // cegah browser membuka PDF bila dilepas di luar area
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  $('heroStart').addEventListener('click', function (e) {
    e.preventDefault();
    $('kerja').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (!$('stPick').hidden) setTimeout(function () { input.click(); }, 350);
  });

  function pickError(msg) { var e = $('pickErr'); e.textContent = msg; e.hidden = !msg; }

  async function handle(file) {
    pickError('');
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { pickError('File "' + file.name + '" bukan PDF. Pilih Transaction Report dalam format PDF.'); return; }
    state = { file: file, pages: 0, res: null, q: '', page: 1, sent: false };
    show('stRead'); setStep(1);
    $('readName').textContent = file.name;
    var meter = $('meter');
    meter.firstElementChild.style.width = '0'; meter.setAttribute('aria-valuenow', '0');
    $('readTxt').textContent = 'Membuka PDF…';
    try {
      var doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      state.pages = doc.numPages;
      var pages = await MandiriParser.extractPages(doc, function (p, n) {
        var pct = Math.round(p / n * 100);
        meter.firstElementChild.style.width = pct + '%'; meter.setAttribute('aria-valuenow', String(pct));
        $('readTxt').textContent = 'Membaca halaman ' + p + ' dari ' + n;
      });
      state.res = MandiriParser.parse(pages);
      renderResult();
    } catch (err) {
      show('stPick'); setStep(1);
      pickError('PDF tidak bisa dibaca (' + err.message + '). Pastikan file tidak rusak atau terkunci kata sandi.');
    } finally { input.value = ''; }
  }

  /* ---------- hasil ---------- */
  var ICON_OK = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#22C9A0"/><path d="M12.5 20.5l5 5 10-11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_BAD = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#D93B45"/><path d="M14 14l12 12M26 14L14 26" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';

  function renderResult() {
    var r = state.res;
    show('stResult'); setStep(2);
    $('resName').textContent = state.file.name;
    $('resPages').textContent = num(state.pages) + ' halaman';
    var okB = r.batches.filter(function (b) { return b.okCount && b.okTotal; }).length;
    $('fRows').textContent = num(r.rows.length);
    $('fBatch').textContent = num(r.batches.length);
    $('fCheck').textContent = okB + '/' + r.batches.length;
    $('fFailed').textContent = num(r.failed.length);
    $('failedCount').textContent = r.failed.length;

    var bad = r.errors.length > 0;
    $('verdict').className = 'verdict ' + (bad ? 'verdict--bad' : 'verdict--ok');
    $('verdict').innerHTML = bad
      ? ICON_BAD + '<div><b>Belum bisa dikirim</b><span>Ditemukan ' + r.errors.length + ' masalah. Lihat tab Masalah.</span></div>'
      : ICON_OK + '<div><b>Semua batch cocok dengan bank</b><span>Jumlah transaksi dan total nominal sama dengan ringkasan di PDF.</span></div>';

    $('tab-err').hidden = !bad;
    $('errCount').textContent = r.errors.length;
    $('errList').innerHTML = r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');

    $('tBatch').innerHTML = r.batches.map(function (b, i) {
      var ok = b.okCount && b.okTotal;
      return '<tr>' +
        '<td class="hide-m" data-label="No">' + (i + 1) + '</td>' +
        '<td class="lead" data-label="Site penempatan">' + esc(b.sitePenempatan || '-') + '</td>' +
        '<td data-label="Site bisnis">' + esc(b.siteBisnis || 'Tidak dikenal') + '</td>' +
        '<td class="r" data-label="Transaksi">' + num(b.count) + '</td>' +
        '<td class="r" data-label="Masuk">' + num(b.success) + '</td>' +
        '<td class="r" data-label="Total (Rp)">' + rp(b.totalCents) + '</td>' +
        '<td data-label="Cek bank">' + (ok ? '<span class="pill pill--ok">Cocok</span>' : '<span class="pill pill--bad">Tidak cocok</span>') + '</td>' +
        '</tr>';
    }).join('') || '<tr><td class="empty" colspan="7">Tidak ada batch terbaca.</td></tr>';

    $('tFailed').innerHTML = r.failed.map(function (x) {
      return '<tr><td class="lead" data-label="Nama">' + esc(x.data[0]) + '</td><td data-label="Bank">' + esc(x.data[1]) +
        '</td><td class="acct" data-label="No rekening">' + esc(x.data[2]) + '</td><td data-label="Site penempatan">' + esc(x.data[4]) +
        '</td><td class="r" data-label="Halaman">' + x.page + '</td></tr>';
    }).join('') || '<tr><td class="empty" colspan="5">Tidak ada transfer Failed di PDF ini.</td></tr>';

    $('q').value = '';
    state.q = ''; state.page = 1;
    renderData();
    selectTab(bad ? 'tab-err' : 'tab-batch');
    updateAction();
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    if (!q) return state.res.rows;
    return state.res.rows.filter(function (x) { return x.data.join(' ').toLowerCase().indexOf(q) !== -1; });
  }
  function renderData() {
    var list = filtered(), pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE, slice = list.slice(start, start + PAGE_SIZE);
    $('tData').innerHTML = slice.map(function (x) {
      var d = x.data;
      return '<tr><td class="lead" data-label="Nama">' + esc(d[0]) + '</td><td data-label="Bank">' + esc(d[1]) +
        '</td><td class="acct" data-label="No rekening">' + esc(d[2]) + '</td><td data-label="Site bisnis">' + esc(d[3]) +
        '</td><td data-label="Site penempatan">' + esc(d[4]) + '</td></tr>';
    }).join('') || '<tr><td class="empty" colspan="5">' + (state.q ? 'Tidak ada yang cocok dengan "' + esc(state.q) + '".' : 'Tidak ada baris Success.') + '</td></tr>';
    $('qMeta').textContent = state.q ? num(list.length) + ' dari ' + num(state.res.rows.length) + ' baris' : num(list.length) + ' baris';
    $('pageInfo').textContent = 'Halaman ' + state.page + ' dari ' + pages;
    $('prev').disabled = state.page <= 1;
    $('next').disabled = state.page >= pages;
    $('pager').hidden = list.length <= PAGE_SIZE;
  }
  var qTimer;
  $('q').addEventListener('input', function () {
    clearTimeout(qTimer);
    var v = this.value;
    qTimer = setTimeout(function () { state.q = v; state.page = 1; renderData(); }, 150);
  });
  $('prev').addEventListener('click', function () { state.page--; renderData(); $('pane-data').scrollIntoView({ block: 'nearest' }); });
  $('next').addEventListener('click', function () { state.page++; renderData(); $('pane-data').scrollIntoView({ block: 'nearest' }); });

  /* tabs dengan navigasi keyboard */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function selectTab(id) {
    tabs.forEach(function (t) {
      var on = t.id === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { selectTab(t.id); });
    t.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var vis = tabs.filter(function (x) { return !x.hidden; });
      var i = vis.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1);
      var nx = vis[(i + vis.length) % vis.length];
      selectTab(nx.id); nx.focus(); e.preventDefault();
    });
  });

  function updateAction() {
    var r = state.res, btn = $('sendBtn'), txt = $('actionTxt');
    if (r.errors.length) { btn.disabled = true; txt.textContent = 'Tombol kirim terkunci karena ada masalah pada PDF.'; return; }
    if (!r.rows.length) { btn.disabled = true; txt.textContent = 'Tidak ada transfer Success untuk dikirim.'; return; }
    if (!connected()) { btn.disabled = true; txt.innerHTML = 'Masukkan kode akses di <button type="button" class="link" data-open-settings>Pengaturan</button> untuk mengirim.'; txt.querySelector('[data-open-settings]').addEventListener('click', openSettings); return; }
    btn.disabled = false;
    btn.textContent = 'Kirim ' + num(r.rows.length) + ' baris ke spreadsheet';
    txt.textContent = 'Baris ditambahkan di bawah sheet Data Upah. Batch yang sudah pernah dikirim akan dilewati.';
  }

  /* ---------- kirim ---------- */
  var dlgSend = $('dlgSend');
  $('sendBtn').addEventListener('click', function () {
    var r = state.res;
    $('dlgSendTxt').textContent = 'Data dari "' + state.file.name + '" akan ditambahkan ke sheet Data Upah.';
    $('dlgSendList').innerHTML =
      '<li><span>Baris Success</span><b>' + num(r.rows.length) + '</b></li>' +
      '<li><span>Batch</span><b>' + num(r.batches.length) + '</b></li>' +
      '<li><span>Failed (tidak dikirim)</span><b>' + num(r.failed.length) + '</b></li>';
    dlgSend.returnValue = '';
    dlgSend.showModal();
  });
  dlgSend.addEventListener('close', function () { if (dlgSend.returnValue === 'ok') send(); });

  async function send() {
    var r = state.res, btn = $('sendBtn');
    btn.disabled = true; btn.textContent = 'Mengirim…'; setStep(3);
    try {
      var out = await post({
        token: getToken(),
        fileName: state.file.name,
        batches: r.batches.map(function (b) {
          return { trxId: b.trxId, fileDesc: b.meta['File Description'], count: b.count, success: b.success, okCount: b.okCount, okTotal: b.okTotal };
        }),
        rows: r.rows
      });
      if (!out.ok) throw new Error(out.error || 'Server menolak data.');
      state.sent = true;
      show('stDone'); setStep(4);
      var skipped = out.batchDilewati || [];
      $('doneTitle').textContent = out.barisMasuk ? 'Terkirim ke spreadsheet' : 'Tidak ada baris baru';
      $('doneTxt').textContent = out.barisMasuk
        ? num(out.barisMasuk) + ' baris dari ' + num(out.batchMasuk) + ' batch sudah ditambahkan. Sheet Data Upah sekarang berisi ' + num(out.totalBarisSheet) + ' baris.'
        : 'Semua batch di PDF ini sudah pernah dikirim, jadi tidak ada yang ditambahkan. Sheet Data Upah tetap ' + num(out.totalBarisSheet) + ' baris.';
      var sk = $('doneSkip');
      sk.hidden = !skipped.length || !out.barisMasuk;
      if (skipped.length && out.barisMasuk) sk.textContent = num(skipped.length) + ' batch dilewati karena sudah pernah dikirim: ' + skipped.slice(0, 5).join(', ') + (skipped.length > 5 ? ', dan lainnya.' : '.');
      $('doneTitle').focus();
    } catch (err) {
      setStep(2);
      updateAction();
      toast('Gagal mengirim: ' + err.message);
    }
  }

  document.querySelectorAll('[data-reset]').forEach(function (b) {
    b.addEventListener('click', function () {
      state = { file: null, pages: 0, res: null, q: '', page: 1, sent: false };
      show('stPick'); setStep(1); pickError('');
      $('kerja').scrollIntoView({ block: 'start' });
    });
  });

  refreshConn();

  /* ---------- PWA ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { }); });
  }
})();
