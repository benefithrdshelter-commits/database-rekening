/*
 * Parser PDF "Transaction Report" Kopra by Mandiri  ->  baris data upah
 * Deterministik (bukan AI): membaca posisi kolom tetap pada tabel "Transaction Records".
 * Dipakai di browser (window.MandiriParser) dan di Node untuk pengujian (module.exports).
 */
(function (root) {
  'use strict';

  // Posisi awal (x, dalam satuan PDF) tiap kolom tabel Transaction Records.
  // Identik di semua halaman laporan Kopra yang sudah diuji.
  var COL_STARTS = [39.8, 119.6, 199.5, 279.4, 359.2, 439.1, 519.0, 598.9, 678.8, 758.7, 838.6, 918.6, 998.5, 1078.4, 99999];
  var COLS = ['source', 'product', 'bank', 'acct', 'uploaded', 'host', 'cur', 'amount',
              'remark', 'ref', 'charge', 'time', 'info', 'status'];

  // Rekening sumber dana -> nama perusahaan (Site Bisnis).
  // Tambahkan baris baru di sini bila ada rekening sumber dana lain.
  var SUMBER_DANA = {
    '1420001020303': 'SHELTER INDONESIA GEMILANG'
  };

  function colOf(x) {
    for (var i = 0; i < COLS.length; i++) {
      if (x >= COL_STARTS[i] - 2 && x < COL_STARTS[i + 1] - 2) return COLS[i];
    }
    return null;
  }

  function clean(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function toCents(s) {
    var m = /^(\d{1,3}(?:,\d{3})*)\.(\d{2})$/.exec(String(s).trim());
    if (!m) return null;
    return parseInt(m[1].replace(/,/g, ''), 10) * 100 + parseInt(m[2], 10);
  }

  function siteDariDeskripsi(fd) {
    return clean(fd).replace(/^GJD[\/-]SIG[\/-]\S+\s+/, '');
  }

  // items: [{str, x, y(top->baseline), w}] satu halaman  -> baris-baris (lines)
  function toLines(items) {
    var its = items.filter(function (it) { return it.str && it.str.trim() !== ''; })
      .sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [];
    its.forEach(function (it) {
      var last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) <= 1.5) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });
    lines.forEach(function (l) {
      l.items.sort(function (a, b) { return a.x - b.x; });
      l.text = clean(l.items.map(function (i) { return i.str; }).join(' '));
      l.minX = l.items[0].x;
    });
    return lines;
  }

  function joinCell(parts) {
    // parts: item dalam satu sel, urut per baris lalu x
    parts.sort(function (a, b) { return (Math.abs(a.y - b.y) <= 1.5 ? 0 : a.y - b.y) || a.x - b.x; });
    var out = '', prev = null;
    parts.forEach(function (p) {
      var s = clean(p.str);
      if (!s) return;
      if (prev && Math.abs(p.y - prev.y) <= 1.5 && p.x - (prev.x + prev.w) < 0.6) out += s; // potongan kata yang sama
      else out += (out ? ' ' : '') + s;
      prev = p;
    });
    return out;
  }

  /**
   * pages: array of array of items {str, x, y, w}  (y = jarak dari atas halaman ke baseline)
   * return { batches, rows, failed, errors }
   */
  function parse(pages) {
    var batches = [], cur = null, errors = [];
    var LABEL = /^(Transaction ID|File Description|File Name|Total Transaction Record|Total Transaction Amount|Source of Funds|Transaction Date|Transaction Status)\b/;

    pages.forEach(function (items, pi) {
      var lines = toLines(items);
      var stopY = Infinity;
      lines.forEach(function (l) {
        if (/^Transaction History/.test(l.text) || /^For further questions/.test(l.text)) stopY = Math.min(stopY, l.y);
      });

      // ---- metadata batch (label di kiri, nilai di x ~199.5)
      lines.forEach(function (l, li) {
        if (l.minX > 60) return;
        var m = LABEL.exec(l.text);
        if (!m) return;
        var key = m[1];
        var val = clean(l.items.filter(function (i) { return i.x > 150; }).map(function (i) { return i.str; }).join(' '));
        if (key === 'Transaction ID') {
          cur = { trxId: val, page: pi + 1, meta: {}, rows: [] };
          batches.push(cur);
          return;
        }
        if (!cur) return;
        if (key === 'File Description') {
          // nilai yang terpotong ke baris berikutnya (tanpa label di kiri)
          for (var k = li + 1; k < lines.length && lines[k].minX > 150; k++) val += ' ' + lines[k].text;
        }
        if (!(key in cur.meta)) cur.meta[key] = clean(val);
      });

      // ---- baris transaksi: diawali nomor rekening sumber dana di kolom paling kiri
      var anchors = lines.filter(function (l) {
        return l.minX < 60 && /^\d{10,}$/.test(clean(l.items[0].str)) && l.y < stopY;
      }).map(function (l) { return l.y; });
      if (anchors.length && !cur) { errors.push('Hal. ' + (pi + 1) + ': ada transaksi sebelum ringkasan batch.'); return; }

      var all = items.filter(function (it) { return it.str && it.str.trim() !== ''; });
      anchors.forEach(function (y, ai) {
        var ny = ai + 1 < anchors.length ? anchors[ai + 1] : stopY;
        var cells = {};
        COLS.forEach(function (c) { cells[c] = []; });
        all.forEach(function (it) {
          if (it.y >= y - 1 && it.y < ny - 1) {
            var c = colOf(it.x);
            if (!c) { errors.push('Hal. ' + (pi + 1) + ': teks di luar kolom "' + it.str + '"'); return; }
            if (it.x + it.w > COL_STARTS[COLS.indexOf(c) + 1] - 1) errors.push('Hal. ' + (pi + 1) + ': teks melewati batas kolom "' + it.str + '"');
            cells[c].push(it);
          }
        });
        var row = { page: pi + 1 };
        COLS.forEach(function (c) { row[c] = joinCell(cells[c]); });
        cur.rows.push(row);
      });
    });

    // ---- validasi per batch & susun output 5 kolom
    var rows = [], failed = [];
    batches.forEach(function (b, bi) {
      var tag = 'Batch ' + (bi + 1) + ' (' + (b.meta['File Description'] || '?') + ', hal. ' + b.page + ')';
      var fd = b.meta['File Description'];
      if (!fd) errors.push(tag + ': File Description tidak terbaca.');
      var nExp = parseInt((b.meta['Total Transaction Record'] || '').split(' ')[0], 10);
      var totExp = toCents((b.meta['Total Transaction Amount'] || '').split(' ').pop());
      var sum = 0;
      b.rows.forEach(function (r, ri) {
        var c = toCents(r.amount);
        if (c === null) errors.push(tag + ' baris ' + (ri + 1) + ': nominal tidak terbaca "' + r.amount + '"');
        else sum += c;
        if (!/^\d{5,20}$/.test(r.acct)) errors.push(tag + ' baris ' + (ri + 1) + ': no rekening tidak valid "' + r.acct + '"');
        if (!r.host) errors.push(tag + ' baris ' + (ri + 1) + ': nama (From Host) kosong');
        if (r.status !== 'Success' && r.status !== 'Failed') errors.push(tag + ' baris ' + (ri + 1) + ': status tidak dikenal "' + r.status + '"');
      });
      b.count = b.rows.length;
      b.totalCents = sum;
      b.okCount = b.count === nExp;
      b.okTotal = sum === totExp;
      if (!b.okCount) errors.push(tag + ': jumlah transaksi terbaca ' + b.count + ', di PDF ' + nExp + '.');
      if (!b.okTotal) errors.push(tag + ': total nominal terbaca ' + (sum / 100) + ', di PDF ' + (totExp / 100) + '.');

      var srcAcct = (b.meta['Source of Funds'] || '').split(' ')[0];
      var bisnis = SUMBER_DANA[srcAcct];
      if (!bisnis) errors.push(tag + ': rekening sumber dana ' + srcAcct + ' belum terdaftar di SUMBER_DANA (parser.js).');
      b.siteBisnis = bisnis || '';
      b.sitePenempatan = siteDariDeskripsi(fd || '');
      b.success = 0;
      b.rows.forEach(function (r) {
        var out = [r.host, r.bank, r.acct, b.siteBisnis, b.sitePenempatan];
        if (r.status === 'Success') { b.success++; rows.push({ trxId: b.trxId, data: out }); }
        else failed.push({ trxId: b.trxId, data: out, page: r.page });
      });
    });
    if (!batches.length) errors.push('Tidak ditemukan batch transaksi. Pastikan ini PDF "Transaction Report" dari Kopra Mandiri.');
    return { batches: batches, rows: rows, failed: failed, errors: errors };
  }

  // Ambil items dari dokumen pdf.js
  async function extractPages(pdfDoc, onProgress) {
    var pages = [];
    for (var p = 1; p <= pdfDoc.numPages; p++) {
      var page = await pdfDoc.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      var tc = await page.getTextContent();
      pages.push(tc.items.map(function (it) {
        return { str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width };
      }));
      if (onProgress) onProgress(p, pdfDoc.numPages);
    }
    return pages;
  }

  var api = { parse: parse, extractPages: extractPages, SUMBER_DANA: SUMBER_DANA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MandiriParser = api;
})(typeof window !== 'undefined' ? window : this);
