(function () {
  const palette = { mood: '#315d69', energy: '#d6944b', focus: '#766aa0', functioning: '#788b55' };
  const labels = { mood: 'Настроение', energy: 'Энергия', focus: 'Концентрация', functioning: 'Функционирование' };
  function esc(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function linePath(points) { return points.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '); }
  window.ChartLite = {
    renderTrend(container, daily) {
      if (!daily?.length) { container.innerHTML = '<div class="empty">Пока недостаточно данных для графика.</div>'; return; }
      const width = 760, height = 310, left = 42, right = 18, top = 20, bottom = 45;
      const plotW = width - left - right, plotH = height - top - bottom;
      const x = i => left + (daily.length === 1 ? plotW / 2 : i * plotW / (daily.length - 1));
      const y = value => top + (10 - value) * plotH / 10;
      const grid = [0,2,4,6,8,10].map(v => `<line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" stroke="currentColor" opacity=".12"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end" fill="currentColor" opacity=".55" font-size="11">${v}</text>`).join('');
      const dates = daily.map((d, i) => i % Math.max(1, Math.ceil(daily.length / 7)) === 0 ? `<text x="${x(i)}" y="${height-14}" text-anchor="middle" fill="currentColor" opacity=".58" font-size="10">${esc(d.date.slice(5))}</text>` : '').join('');
      const series = ['mood','energy','focus','functioning'].map(field => {
        const points = daily.map((d, i) => [x(i), y(d.rolling?.[field] ?? d[field] ?? 0)]);
        return `<path d="${linePath(points)}" fill="none" stroke="${palette[field]}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>`;
      }).join('');
      container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="График состояния по дням">${grid}${dates}${series}</svg><div class="chart-legend">${Object.entries(palette).map(([field,color]) => `<span class="legend-key"><i class="legend-swatch" style="background:${color}"></i>${labels[field]}</span>`).join('')}</div>`;
    },
    renderBars(container, items) {
      if (!items.length) { container.innerHTML = '<div class="empty">Отметок пока нет.</div>'; return; }
      const max = Math.max(...items.map(item => item.value), 1);
      container.innerHTML = `<div class="data-bars">${items.map(item => `<div class="data-bar"><span>${esc(item.label)}</span><span class="data-bar-track"><span class="data-bar-fill" style="width:${item.value/max*100}%"></span></span><b>${item.value}</b></div>`).join('')}</div>`;
    }
  };
})();
