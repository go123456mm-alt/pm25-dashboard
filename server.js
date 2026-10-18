require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---------- รายชื่อจังหวัด ----------
const CITIES = [
  { name: 'กรุงเทพฯ', lat: 13.7563, lon: 100.5018 },
  { name: 'เชียงใหม่', lat: 18.7883, lon: 98.9853 },
  { name: 'ขอนแก่น', lat: 16.4322, lon: 102.8236 },
  { name: 'ภูเก็ต', lat: 7.8804, lon: 98.3923 },
  { name: 'นครราชสีมา', lat: 14.9799, lon: 102.0978 },
  { name: 'ชลบุรี', lat: 13.3611, lon: 100.9847 },
  { name: 'หาดใหญ่', lat: 7.0086, lon: 100.4747 },
  { name: 'อุดรธานี', lat: 17.4138, lon: 102.7872 },
];

// ---------- ฐานข้อมูล SQLite ----------
const db = new Database(path.join(__dirname, 'air.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    city TEXT NOT NULL,
    time TEXT NOT NULL,
    pm25 REAL,
    PRIMARY KEY (city, time)
  )
`);

const upsert = db.prepare(
  'INSERT OR REPLACE INTO readings (city, time, pm25) VALUES (?, ?, ?)'
);
const saveMany = db.transaction((city, rows) => {
  for (const r of rows) upsert.run(city, r.time, r.pm25);
});

// เวลาปัจจุบันของไทย รูปแบบเดียวกับ API (YYYY-MM-DDTHH:00)
function bangkokHour(offsetHours = 0) {
  const d = new Date(Date.now() + 7 * 3600 * 1000 + offsetHours * 3600 * 1000);
  return d.toISOString().slice(0, 13) + ':00';
}

function last24h(cityName) {
  return db
    .prepare(
      `SELECT time, pm25 FROM readings
       WHERE city = ? AND time > ? AND time <= ?
       ORDER BY time`
    )
    .all(cityName, bangkokHour(-24), bangkokHour(0));
}

// ---------- ดึง API + แคช ----------
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function fetchAirQuality(city) {
  const cached = cache.get(city.name);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.data;

  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${city.lat}&longitude=${city.lon}` +
    `&current=pm2_5,pm10,us_aqi` +
    `&hourly=pm2_5&past_days=1&forecast_days=1` +
    `&timezone=Asia%2FBangkok`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ตอบกลับ ${res.status}`);
  const json = await res.json();

  const hourly = json.hourly.time.map((t, i) => ({
    time: t,
    pm25: json.hourly.pm2_5[i],
  }));

  // เก็บลงฐานข้อมูล (ข้ามค่าที่เป็น null)
  saveMany(city.name, hourly.filter((h) => h.pm25 != null));

  const data = {
    name: city.name,
    lat: city.lat,
    lon: city.lon,
    pm25: json.current.pm2_5,
    pm10: json.current.pm10,
    aqi: json.current.us_aqi,
    updated: json.current.time,
    hourly,
  };

  cache.set(city.name, { time: Date.now(), data });
  return data;
}

// ---------- Routes ----------
app.get('/api/air', async (req, res) => {
  const results = await Promise.allSettled(CITIES.map(fetchAirQuality));
  const data = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.filter((r) => r.status === 'rejected').length;

  if (data.length === 0) {
    return res.status(502).json({ error: 'ไม่สามารถดึงข้อมูลคุณภาพอากาศได้ในขณะนี้' });
  }
  res.json({ data, failed });
});

// ข้อมูลย้อนหลัง 24 ชม. ของจังหวัดนั้น จากฐานข้อมูล
app.get('/api/history/:city', (req, res) => {
  const city = CITIES.find((c) => c.name === req.params.city);
  if (!city) return res.status(404).json({ error: 'ไม่พบจังหวัดนี้' });
  res.json({ city: city.name, rows: last24h(city.name) });
});

// รายงาน PDF ของจังหวัดนั้น
app.get('/api/report/:city', async (req, res) => {
  const city = CITIES.find((c) => c.name === req.params.city);
  if (!city) return res.status(404).json({ error: 'ไม่พบจังหวัดนี้' });

  const rows = last24h(city.name);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'ยังไม่มีข้อมูลในฐานข้อมูล ลองโหลดหน้าเว็บก่อน' });
  }

  const fontPath = 'C:\\Windows\\Fonts\\tahoma.ttf';
  const values = rows.map((r) => r.pm25);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pm25-report-${encodeURIComponent(city.name)}.pdf"`
  );
  doc.pipe(res);

  if (fs.existsSync(fontPath)) doc.font(fontPath);

  doc.fontSize(20).text(`รายงานค่าฝุ่น PM2.5 - ${city.name}`);
  doc.moveDown(0.5);
  doc.fontSize(11).text(`สร้างเมื่อ: ${new Date().toLocaleString('th-TH')}`);
  doc.moveDown();
  doc.fontSize(13).text(`ค่าเฉลี่ย: ${avg.toFixed(1)} µg/m³`);
  doc.text(`สูงสุด: ${max.toFixed(1)} µg/m³`);
  doc.text(`ต่ำสุด: ${min.toFixed(1)} µg/m³`);
  doc.moveDown();
  doc.fontSize(14).text('ข้อมูลรายชั่วโมง (24 ชั่วโมงล่าสุด)');
  doc.moveDown(0.5);
  doc.fontSize(11);
  rows.forEach((r) => {
    doc.text(`${r.time.replace('T', ' ')}    ${r.pm25.toFixed(1)} µg/m³`);
  });

  doc.moveDown();
  doc.fontSize(9).text('แหล่งข้อมูล: Open-Meteo (ค่าจากโมเดล ไม่ใช่เครื่องวัดจริง)');
  doc.end();
});

app.listen(PORT, () => {
  console.log(`เปิดที่ http://localhost:${PORT}`);
});