// 外部ライブラリ非依存のシンプルなCanvasグラフ描画。

const Charts = (() => {
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  function formatYen(n) {
    return '¥' + Math.round(n).toLocaleString('ja-JP');
  }
  function formatYenShort(n) {
    const v = Math.round(n);
    if (Math.abs(v) >= 10000) return '¥' + (v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万';
    return '¥' + v.toLocaleString('ja-JP');
  }

  // 1-3-5-10 × 10^n の「きりのいい」刻み幅を選ぶ(資産額が増えるほど自動で大きい単位に切り替わる)
  function niceStep(rawStep) {
    if (!(rawStep > 0)) return 1;
    const exponent = Math.floor(Math.log10(rawStep));
    const base = Math.pow(10, exponent);
    const fraction = rawStep / base;
    let niceFraction;
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 3) niceFraction = 3;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * base;
  }

  function computeAxis(allValues, targetLines = 4) {
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    if (min === max) {
      const pad = niceStep(Math.max(1, Math.abs(min) * 0.1));
      min -= pad;
      max += pad;
    }
    const step = niceStep((max - min) / targetLines);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const lines = Math.round((niceMax - niceMin) / step);
    return { niceMin, niceMax, step, lines: Math.max(1, lines) };
  }

  function drawAxisGrid(ctx, axis, padL, padR, width, y, masked = false) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= axis.lines; i++) {
      const v = axis.niceMin + axis.step * i;
      const yy = y(v);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(width - padR, yy);
      ctx.stroke();
      ctx.fillText(masked ? '••••' : formatYenShort(v), padL - 8, yy);
    }
  }

  // points[i].value が null の点は線を描かずに x 位置だけ確保する(1年分の枠を固定したいときなど)
  function drawLineChart(canvas, points, color = '#4f9dff', masked = false, emptyText = '記録がまだありません', keepSelection = false) {
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    // タップで点を選ぶと数値を吹き出しで表示する。データを描き直すときは選択を解除
    if (!keepSelection) canvas._selIdx = null;
    canvas._redraw = () => drawLineChart(canvas, points, color, masked, emptyText, true);
    canvas._hitPoints = [];
    const idx = (points || []).map((p, i) => (p.value == null ? -1 : i)).filter((i) => i >= 0);
    if (idx.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(emptyText, width / 2, height / 2);
      return;
    }
    const padL = 54, padR = 14, padT = 16, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const values = idx.map((i) => points[i].value);
    const axis = computeAxis(values);
    const niceMin = axis.niceMin;
    const niceRange = (axis.niceMax - axis.niceMin) || 1;

    const x = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = (v) => padT + plotH - ((v - niceMin) / niceRange) * plotH;

    drawAxisGrid(ctx, axis, padL, padR, width, y, masked);

    const tracePath = () => {
      idx.forEach((i, k) => {
        const px = x(i), py = y(points[i].value);
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    };
    const first = idx[0], last = idx[idx.length - 1];

    // エリア塗り
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexToRgba(color, 0.35));
    grad.addColorStop(1, hexToRgba(color, 0.02));
    ctx.beginPath();
    tracePath();
    ctx.lineTo(x(last), padT + plotH);
    ctx.lineTo(x(first), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // ライン
    ctx.beginPath();
    tracePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 点(点が多いとき=長期間表示は最新の点だけ描く)
    const dense = points.length > 14;
    idx.forEach((i) => {
      if (points[i].noDot) return; // 記録がない月(前の値で線をつないでいるだけ)は点を描かない
      if (dense && i !== last) return;
      const px = x(i), py = y(points[i].value);
      ctx.beginPath();
      ctx.arc(px, py, i === last ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0b1220';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    });

    canvas._hitPoints = idx.filter((i) => !points[i].noDot).map((i) => ({ i, x: x(i), y: y(points[i].value) }));

    // x軸ラベル(間引き表示)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = Math.max(2, Math.floor(plotW / 56));
    const step = Math.max(1, Math.ceil(points.length / maxLabels));
    // 呼び出し側が showLabel を指定していればそれに従う
    const explicit = points.some((p) => typeof p.showLabel === 'boolean');
    points.forEach((p, i) => {
      if (explicit ? !p.showLabel : (i % step !== 0 && i !== points.length - 1)) return;
      ctx.fillText(p.label, x(i), padT + plotH + 6);
    });

    // 選択中の点の吹き出し
    const sel = canvas._selIdx;
    if (sel != null && points[sel] && points[sel].value != null) {
      const p = points[sel];
      const px = x(sel), py = y(p.value);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      const line1 = p.tip || p.label;
      const line2 = masked ? '¥••••' : formatYen(p.value);
      ctx.font = '600 12px -apple-system, sans-serif';
      const w1 = ctx.measureText(line1).width;
      ctx.font = '700 14px -apple-system, sans-serif';
      const w2 = ctx.measureText(line2).width;
      const bw = Math.max(w1, w2) + 20, bh = 42;
      let bx = px - bw / 2;
      bx = Math.max(padL - 40, Math.min(width - bw - 2, bx));
      let by = py - bh - 10;
      if (by < 2) by = py + 10;
      ctx.fillStyle = 'rgba(20,28,46,0.96)';
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 8); else ctx.rect(bx, by, bw, bh);
      ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '600 12px -apple-system, sans-serif';
      ctx.fillText(line1, bx + bw / 2, by + 6);
      ctx.fillStyle = '#fff';
      ctx.font = '700 14px -apple-system, sans-serif';
      ctx.fillText(line2, bx + bw / 2, by + 22);
    }
  }

  // グラフをタップしたら、いちばん近い点を選んで吹き出しを出す（同じ点をもう一度タップで消す）
  // グラフ以外の場所をタップしたら吹き出しを消す
  const tapCharts = [];
  document.addEventListener('click', (e) => {
    tapCharts.forEach((c) => {
      if (c === e.target || c._selIdx == null || !c._redraw) return;
      c._selIdx = null;
      c._redraw();
    });
  });
  function enableLineChartTap(canvas) {
    tapCharts.push(canvas);
    canvas.addEventListener('click', (e) => {
      const pts = canvas._hitPoints || [];
      if (!pts.length || !canvas._redraw) return;
      const r = canvas.getBoundingClientRect();
      const tx = e.clientX - r.left;
      let best = pts[0];
      pts.forEach((p) => { if (Math.abs(p.x - tx) < Math.abs(best.x - tx)) best = p; });
      canvas._selIdx = canvas._selIdx === best.i ? null : best.i;
      canvas._redraw();
    });
  }

  function drawMultiLineChart(canvas, series) {
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    const withData = (series || []).filter((s) => s.points && s.points.length > 0);
    if (withData.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('記録がまだありません', width / 2, height / 2);
      return;
    }
    const padL = 54, padR = 14, padT = 16, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const pointCount = withData[0].points.length;

    const allValues = withData.flatMap((s) => s.points.map((p) => p.value));
    const axis = computeAxis(allValues);
    const niceMin = axis.niceMin;
    const niceRange = (axis.niceMax - axis.niceMin) || 1;

    const x = (i) => padL + (pointCount === 1 ? plotW / 2 : (i / (pointCount - 1)) * plotW);
    const y = (v) => padT + plotH - ((v - niceMin) / niceRange) * plotH;

    drawAxisGrid(ctx, axis, padL, padR, width, y);

    withData.forEach((s) => {
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const px = x(i), py = y(p.value);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      s.points.forEach((p, i) => {
        const px = x(i), py = y(p.value);
        ctx.beginPath();
        ctx.arc(px, py, i === s.points.length - 1 ? 3.5 : 2, 0, Math.PI * 2);
        ctx.fillStyle = '#0b1220';
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      });
    });

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = Math.max(2, Math.floor(plotW / 56));
    const step = Math.max(1, Math.ceil(pointCount / maxLabels));
    withData[0].points.forEach((p, i) => {
      if (i % step !== 0 && i !== pointCount - 1) return;
      ctx.fillText(p.label, x(i), padT + plotH + 6);
    });
  }

  function drawBreakdownBars(canvas, items) {
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    if (!items || items.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('データがありません', width / 2, height / 2);
      return;
    }
    const total = items.reduce((s, it) => s + Math.max(0, it.value), 0) || 1;
    const rowH = Math.min(34, (height - 8) / items.length);
    const labelW = 92;
    const barMaxW = width - labelW - 60;
    items.forEach((it, i) => {
      const yy = 6 + i * rowH;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.label, 0, yy + rowH / 2 - 6);

      const barW = Math.max(2, (Math.max(0, it.value) / total) * barMaxW);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(labelW, yy + rowH / 2 - 6, barMaxW, 10);
      ctx.fillStyle = it.color || '#4f9dff';
      ctx.fillRect(labelW, yy + rowH / 2 - 6, barW, 10);

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'left';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(formatYenShort(it.value), labelW + barMaxW + 6, yy + rowH / 2 - 1);
    });
  }

  function drawPieChart(canvas, items, masked = false) {
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    const total = items.reduce((s, it) => s + Math.max(0, it.value), 0);
    const cx = width / 2, cy = height / 2;
    const r = Math.min(width, height) / 2 - 6;
    if (!items || items.length === 0 || total <= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('データがありません', cx, cy);
      return;
    }
    let angle = -Math.PI / 2;
    items.forEach((it) => {
      const v = Math.max(0, it.value);
      if (v === 0) return;
      const slice = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = it.color || '#4f9dff';
      ctx.fill();
      angle += slice;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();

    ctx.fillStyle = 'rgba(238,242,255,0.9)';
    ctx.font = 'bold 15px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(masked ? '••••' : formatYenShort(total), cx, cy - 6);
    ctx.fillStyle = 'rgba(238,242,255,0.45)';
    ctx.font = '10.5px -apple-system, sans-serif';
    ctx.fillText('合計', cx, cy + 12);
  }

  return { drawLineChart, enableLineChartTap, drawMultiLineChart, drawBreakdownBars, drawPieChart, formatYen, formatYenShort, hexToRgba };
})();
