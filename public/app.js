function getLevel(pm25) {
  if (pm25 <= 15) return { color: '#0ea5e9', label: 'ดีมาก' };
  if (pm25 <= 25) return { color: '#22c55e', label: 'ดี' };
  if (pm25 <= 37.5) return { color: '#eab308', label: 'ปานกลาง' };
  if (pm25 <= 75) return { color: '#f97316', label: 'เริ่มมีผลต่อสุขภาพ' };
  return { color: '#ef4444', label: 'มีผลต่อสุขภาพ' };
}

const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');
let chart;
let dailyChart;

const map = L.map('map').setView([13.0, 101.0], 5.5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
}).addTo(map);

async function showChart(city) {
  const name = encodeURIComponent(city.name);
  document.getElementById('chart-title').textContent =
    'PM2.5 ย้อนหลัง 24 ชม. – ' + city.name;

  // กราฟเส้น 24 ชม. จากฐานข้อมูล (สำรองด้วยข้อมูลจาก API)
  let rows;
  try {
    const res = await fetch('/api/history/' + name);
    if (!res.ok) throw new Error('history failed');
    rows = (await res.json()).rows;
  } catch (err) {
    console.error(err);
    rows = city.hourly.slice(-24);
  }

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels: rows.map((h) => h.time.slice(5, 16).replace('T', ' ')),
      datasets: [{
        label: 'PM2.5 (µg/m³)',
        data: rows.map((h) => h.pm25),
        borderColor: getLevel(city.pm25).color,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 8 } } } },
  });

  // กราฟแท่งรายวัน
  try {
    const res = await fetch('/api/daily/' + name);
    if (!res.ok) throw new Error('daily failed');
    const daily = (await res.json()).rows;

    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(document.getElementById('daily-chart'), {
      type: 'bar',
      data: {
        labels: daily.map((d) => d.day.slice(5)),
        datasets: [{
          label: 'ค่าเฉลี่ย PM2.5 (µg/m³)',
          data: daily.map((d) => d.avg),
          backgroundColor: daily.map((d) => getLevel(d.avg).color),
        }],
      },
    });
  } catch (err) {
    console.error(err);
  }

  const pdfBtn = document.getElementById('pdf-btn');
  pdfBtn.disabled = false;
  pdfBtn.onclick = () => { window.location.href = '/api/report/' + name; };

  const csvBtn = document.getElementById('csv-btn');
  csvBtn.disabled = false;
  csvBtn.onclick = () => { window.location.href = '/api/csv/' + name; };
}

function render(cities) {
  cardsEl.innerHTML = '';
  cities.forEach((city) => {
    const level = getLevel(city.pm25);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.background = level.color;
    card.innerHTML =
      '<div class="city">' + city.name + '</div>' +
      '<div class="value">' + Math.round(city.pm25) + '</div>' +
      '<div class="label">' + level.label + '</div>';
    card.onclick = () => showChart(city);
    cardsEl.appendChild(card);

    L.circleMarker([city.lat, city.lon], {
      radius: 14,
      color: 'white',
      weight: 2,
      fillColor: level.color,
      fillOpacity: 0.9,
    })
      .addTo(map)
      .bindPopup(
        '<b>' + city.name + '</b><br>PM2.5: ' + Math.round(city.pm25) +
        ' µg/m³<br>' + level.label
      )
      .on('click', () => showChart(city));
  });

  showChart(cities[0]);
}

async function load() {
  try {
    statusEl.className = '';
    statusEl.textContent = 'กำลังโหลดข้อมูล...';

    const res = await fetch('/api/air');
    if (!res.ok) throw new Error('server error');
    const { data, failed } = await res.json();

    render(data);
    const time = new Date().toLocaleTimeString('th-TH');
    statusEl.textContent = 'อัปเดตล่าสุด ' + time +
      (failed ? ' (โหลดไม่สำเร็จ ' + failed + ' เมือง)' : '');
  } catch (err) {
    statusEl.className = 'error';
    statusEl.textContent = 'โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชอีกครั้ง';
    console.error(err);
  }
}

load();