(function () {
  const palette = {
    mood: '#315d69', anxiety: '#b65c5c', irritability: '#9b6b3d', energy: '#d6944b',
    focus: '#766aa0', functioning: '#788b55', sleepQuality: '#4d8b8b', appetite: '#a96d9c'
  };
  const labels = {
    mood: 'Настроение', anxiety: 'Тревога', irritability: 'Раздражительность', energy: 'Энергия',
    focus: 'Концентрация', functioning: 'Функционирование', sleepQuality: 'Сон', appetite: 'Аппетит'
  };
  function esc(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function linePath(points) {
    let active = false;
    return points.map((p) => {
      if (!p) { active = false; return ''; }
      const command = active ? 'L' : 'M'; active = true;
      return `${command} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    }).join(' ');
  }
  window.ChartLite = {
    renderTrend(container, daily, treatmentMarkers = [], selectedFields = ['mood', 'energy', 'focus', 'functioning']) {
      if (!daily?.length) { container.innerHTML = '<div class="empty">Пока недостаточно данных для графика.</div>'; return; }
      const fields = [...new Set((Array.isArray(selectedFields) ? selectedFields : [])
        .filter(field => Object.hasOwn(palette, field)))];
      if (!fields.length) { container.innerHTML = '<div class="empty">Выбери хотя бы один показатель для графика.</div>'; return; }
      const width = 760, height = 310, left = 42, right = 18, top = 20, bottom = 45;
      const plotW = width - left - right, plotH = height - top - bottom;
      const first = new Date(`${daily[0].date}T00:00:00Z`).getTime();
      const last = new Date(`${daily[daily.length - 1].date}T00:00:00Z`).getTime();
      const x = date => first === last ? left + plotW / 2 : left + (new Date(`${date}T00:00:00Z`).getTime() - first) / (last - first) * plotW;
      const y = value => top + (10 - value) * plotH / 10;
      const grid = [0,2,4,6,8,10].map(v => `<line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" stroke="currentColor" opacity=".12"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end" fill="currentColor" opacity=".55" font-size="11">${v}</text>`).join('');
      const dates = daily.map((d, i) => i % Math.max(1, Math.ceil(daily.length / 7)) === 0 ? `<text x="${x(d.date)}" y="${height-14}" text-anchor="middle" fill="currentColor" opacity=".58" font-size="10">${esc(d.date.slice(5))}</text>` : '').join('');
      const series = fields.map(field => {
        const points = daily.map((d, i) => {
          const value = d.rolling?.[field] ?? d[field];
          return Number.isFinite(value) ? [x(d.date), y(value)] : null;
        });
        return `<path d="${linePath(points)}" fill="none" stroke="${palette[field]}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>`;
      }).join('');
      const markers = treatmentMarkers.map(marker => {
        const point = new Date(`${marker.effectiveDate}T00:00:00Z`).getTime();
        if (point < first || point > last) return '';
        const markerX = x(marker.effectiveDate);
        return `<line x1="${markerX}" y1="${top}" x2="${markerX}" y2="${height-bottom}" stroke="currentColor" stroke-dasharray="4 4" opacity=".45"><title>${esc(marker.note || 'Изменение лечения')}</title></line>`;
      }).join('');
      container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="График состояния по дням">${grid}${markers}${dates}${series}</svg><div class="chart-legend">${fields.map(field => `<span class="legend-key"><i class="legend-swatch" style="background:${palette[field]}"></i>${labels[field]}</span>`).join('')}<span class="legend-key">┆ изменение лечения</span></div>`;
    },
    renderBars(container, items) {
      if (!items.length) { container.innerHTML = '<div class="empty">Отметок пока нет.</div>'; return; }
      const max = Math.max(...items.map(item => item.value), 1);
      container.innerHTML = `<div class="data-bars">${items.map(item => `<div class="data-bar"><span>${esc(item.label)}</span><span class="data-bar-track"><span class="data-bar-fill" style="width:${item.value/max*100}%"></span></span><b>${item.value}</b></div>`).join('')}</div>`;
    }
  };
})();
