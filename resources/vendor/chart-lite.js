(function () {
  const palette = ['#315d69', '#b65c5c', '#9b6b3d', '#d6944b', '#766aa0', '#788b55', '#4d8b8b', '#a96d9c'];
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
    renderTrend(container, daily, treatmentMarkers = [], selectedFields = [], definitions = []) {
      if (!daily?.length) { container.innerHTML = '<div class="empty">Пока недостаточно данных для графика.</div>'; return; }
      const definitionMap = new Map((Array.isArray(definitions) ? definitions : []).map(definition => [definition.id, definition]));
      const dataIds = new Set(daily.flatMap(day => Object.keys(day.scales ?? {}).concat(Object.keys(day.rolling ?? {}))));
      const fields = [...new Set((Array.isArray(selectedFields) ? selectedFields : [])
        .filter(field => dataIds.has(field) && definitionMap.has(field)))];
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
          const value = d.rolling?.[field] ?? d.scales?.[field];
          return Number.isFinite(value) ? [x(d.date), y(value)] : null;
        });
        return `<path d="${linePath(points)}" fill="none" stroke="${palette[fields.indexOf(field) % palette.length]}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>`;
      }).join('');
      const markers = treatmentMarkers.map(marker => {
        const point = new Date(`${marker.effectiveDate}T00:00:00Z`).getTime();
        if (point < first || point > last) return '';
        const markerX = x(marker.effectiveDate);
        return `<line x1="${markerX}" y1="${top}" x2="${markerX}" y2="${height-bottom}" stroke="currentColor" stroke-dasharray="4 4" opacity=".45"><title>${esc(marker.note || 'Изменение лечения')}</title></line>`;
      }).join('');
      container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="График состояния по дням">${grid}${markers}${dates}${series}</svg><div class="chart-legend">${fields.map((field, index) => `<span class="legend-key"><i class="legend-swatch" style="background:${palette[index % palette.length]}"></i>${esc(definitionMap.get(field).label)}</span>`).join('')}<span class="legend-key">┆ изменение лечения</span></div>`;
    },
    renderEmotionalImpact(container, daily = []) {
      if (!daily.some(day => day.status === 'none' || day.status === 'rated')) { container.innerHTML = '<div class="empty">Пока нет вечерних ответов об эмоциях и действиях.</div>'; return; }
      const width = 760, height = 330, left = 42, right = 18, top = 20, bottom = 75;
      const plotW = width - left - right, plotH = height - top - bottom;
      const x = index => left + (daily.length === 1 ? .5 : index / (daily.length - 1)) * plotW;
      const y = value => top + (10 - value) * plotH / 10;
      const noneY = height - 45;
      const grid = [0,2,4,6,8,10].map(value => `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" stroke="currentColor" opacity=".12"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end" fill="currentColor" font-size="11">${value}</text>`).join('');
      const points = daily.map((day, index) => day.status === 'rated' && Number.isFinite(day.value) ? [x(index), y(day.value)] : null);
      const marks = daily.map((day, index) => {
        const title = esc(`${day.date}: ${day.status === 'rated' ? `помеха ${day.value} из 10` : 'неприятных эмоций не было'}`);
        if (points[index]) return `<circle cx="${x(index)}" cy="${y(day.value)}" r="4" fill="#315d69"><title>${title}</title></circle>`;
        if (day.status === 'none') return `<path d="M ${x(index)} ${noneY-5} l 5 5 l -5 5 l -5 -5 Z" fill="none" stroke="#788b55" stroke-width="2"><title>${title}</title></path>`;
        return '';
      }).join('');
      const dates = daily.map((day, index) => index % Math.max(1, Math.ceil(daily.length / 7)) === 0 ? `<text x="${x(index)}" y="${height-12}" text-anchor="middle" fill="currentColor" font-size="11">${esc(day.date.slice(5))}</text>` : '').join('');
      const table = `<details><summary>Ответы по датам</summary><table class="comparison-table"><caption>Только вечерние плановые отметки</caption><thead><tr><th scope="col">Дата</th><th scope="col">Влияние эмоций</th></tr></thead><tbody>${daily.map(day => `<tr><th scope="row">${esc(day.date)}</th><td>${day.status === 'rated' ? `${esc(day.value)} / 10` : day.status === 'none' ? 'Неприятных эмоций не было' : 'Нет вечерней оценки'}</td></tr>`).join('')}</tbody></table></details>`;
      container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Влияние эмоций на действия: вечерние оценки от 0 до 10; ромбы под шкалой — эмоций не было; разрывы — нет числовой оценки">${grid}<path d="${linePath(points)}" fill="none" stroke="#315d69" stroke-width="2.7"/>${marks}${dates}</svg><div class="chart-legend"><span>● Помеха 0–10</span><span>◇ Неприятных эмоций не было (под шкалой)</span><span>Разрыв — нет числовой оценки</span></div>${table}`;
    },
    renderBars(container, items) {
      if (!items.length) { container.innerHTML = '<div class="empty">Отметок пока нет.</div>'; return; }
      const max = Math.max(...items.map(item => item.value), 1);
      container.innerHTML = `<div class="data-bars">${items.map(item => `<div class="data-bar"><span>${esc(item.label)}</span><span class="data-bar-track"><span class="data-bar-fill" style="width:${item.value/max*100}%"></span></span><b>${item.value}</b></div>`).join('')}</div>`;
    }
  };
})();
