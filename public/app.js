// สีและระดับตามเกณฑ์ PM2.5 (µg/m³)
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

// สร้างแผนที่
const map = L.map('map').setView([13.0, 101.0], 5.5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
}).addTo(map);

function showChart(city) {
  document.getElementById('chart-title').textContent =
    `PM2.5 ย้อนหลัง 24 ชม. และคาดการณ์ – ${city.name}`;

  const labels = city.hourly.map((h) => h.time.slice(5, 16).replace('T', ' '));
  const values = city.hourly.map((h) => h.pm25);

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'PM2.5 (µg/m³)',
        data: values,
        borderColor: getLevel(city.pm25).color,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 8 } } } },
  });
}

function render(cities) {
  cardsEl.innerHTML = '';
  cities.forEach((city) => {
    const level = getLevel(city.pm25);

    // การ์ด
    const card = document.createElement('div');
    card.className = 'card';
    card.style.background = level.color;
    card.innerHTML = `
      <div class="city">${city.name}</div>
      <div class="value">${Math.round(city.pm25)}</div>
      <div class="label">${level.label}</div>`;
    card.onclick = () => showChart(city);
    cardsEl.appendChild(card);

    // หมุดบนแผนที่
    L.circleMarker([city.lat, city.lon], {
      radius: 14,
      color: 'white',
      weight: 2,
      fillColor: level.color,
      fillOpacity: 0.9,
    })
      .addTo(map)
      .bindPopup(`<b>${city.name}</b><br>PM2.5: ${Math.round(city.pm25)} µg/m³<br>${level.label}`)
      .on('click', () => showChart(city));
  });

  showChart(cities[0]);
}

async function load() {
  try {
    statusEl.className = '';
    statusEl.textContent = 'กำลังโหลดข้อมูล...';

    const res = await fetch('/api/air');
    if (!res.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับผิดพลาด');
    const { data, failed } = await res.json();

    render(data);
    const time = new Date().toLocaleTimeString('th-TH');
    statusEl.textContent = `อัปเดตล่าสุด ${time}` +
      (failed ? ` (โหลดไม่สำเร็จ ${failed} เมือง)` : '');
  } catch (err) {
    statusEl.className = 'error';
    statusEl.textContent = 'โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชอีกครั้ง';
    console.error(err);
  }
}

load();