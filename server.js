require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// รายชื่อจังหวัดพร้อมพิกัด
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

// ระบบแคชแบบง่าย
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000; // 10 นาที

async function fetchAirQuality(city) {
  const cached = cache.get(city.name);
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return cached.data;
  }

  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${city.lat}&longitude=${city.lon}` +
    `&current=pm2_5,pm10,us_aqi` +
    `&hourly=pm2_5&past_days=1&forecast_days=1` +
    `&timezone=Asia%2FBangkok`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ตอบกลับ ${res.status}`);
  const json = await res.json();

  const data = {
    name: city.name,
    lat: city.lat,
    lon: city.lon,
    pm25: json.current.pm2_5,
    pm10: json.current.pm10,
    aqi: json.current.us_aqi,
    updated: json.current.time,
    hourly: json.hourly.time.map((t, i) => ({
      time: t,
      pm25: json.hourly.pm2_5[i],
    })),
  };

  cache.set(city.name, { time: Date.now(), data });
  return data;
}

app.get('/api/air', async (req, res) => {
  // ดึงทุกเมืองพร้อมกัน ถ้าเมืองไหนพังก็ไม่ให้ล้มทั้งหมด
  const results = await Promise.allSettled(CITIES.map(fetchAirQuality));

  const data = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
  const failed = results.filter((r) => r.status === 'rejected').length;

  if (data.length === 0) {
    return res.status(502).json({ error: 'ไม่สามารถดึงข้อมูลคุณภาพอากาศได้ในขณะนี้' });
  }
  res.json({ data, failed });
});

app.listen(PORT, () => {
  console.log(`เปิดที่ http://localhost:${PORT}`);
});