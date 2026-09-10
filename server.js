// Saju (Four Pillars) deterministic calculation API
// Deterministic calculation ONLY — interpretation belongs to the LLM layer downstream.
//
// POST /calculate-saju
// { "name": "홍길동", "gender": "male"|"female", "calendar": "solar",
//   "birth_date": "1990-05-15", "birth_time": "14:30", "birth_place": "Seoul", "timezone": "Asia/Seoul" }

const express = require('express');
const { Solar } = require('lunar-javascript');

const app = express();
app.use(express.json());

const ELEMENT_OF_GAN = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
const ELEMENT_OF_ZHI = { '子': '水', '丑': '土', '寅': '木', '卯': '木', '辰': '土', '巳': '火', '午': '火', '未': '土', '申': '金', '酉': '金', '戌': '土', '亥': '水' };
const GAN_KR = { '甲': '갑', '乙': '을', '丙': '병', '丁': '정', '戊': '무', '己': '기', '庚': '경', '辛': '신', '壬': '임', '癸': '계' };
const ZHI_KR = { '子': '자', '丑': '축', '寅': '인', '卯': '묘', '辰': '진', '巳': '사', '午': '오', '未': '미', '申': '신', '酉': '유', '戌': '술', '亥': '해' };

function splitPillar(p) {
  return { gan: p[0], zhi: p[1], gan_kr: GAN_KR[p[0]] || '', zhi_kr: ZHI_KR[p[1]] || '', hanja: p };
}

function countFiveElements(pillars) {
  const counts = { '木': 0, '火': 0, '土': 0, '金': 0, '水': 0 };
  for (const p of pillars) {
    counts[ELEMENT_OF_GAN[p.gan]]++;
    counts[ELEMENT_OF_ZHI[p.zhi]]++;
  }
  return counts;
}

// Parse "YYYY-MM-DD HH:mm:ss" into epoch ms (treated as local civil time)
function parseYmdHms(s) {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/calculate-saju', (req, res) => {
  try {
    const { name, gender, calendar, birth_date, birth_time, birth_place, timezone } = req.body || {};

    const errors = [];
    if (!name || typeof name !== 'string') errors.push('name is required');
    if (!['male', 'female'].includes(gender)) errors.push('gender must be "male" or "female"');
    if (calendar !== 'solar') errors.push('v1 supports calendar="solar" only');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date || '')) errors.push('birth_date must be YYYY-MM-DD');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(birth_time || '')) errors.push('birth_time must be HH:mm (24h)');
    if (errors.length) return res.status(400).json({ error: 'invalid_input', details: errors });

    const [y, m, d] = birth_date.split('-').map(Number);
    const [hh, mm] = birth_time.split(':').map(Number);

    const solar = Solar.fromYmdHms(y, m, d, hh, mm, 0);
    const lunar = solar.getLunar();
    const ec = lunar.getEightChar();

    const yearPillar = splitPillar(ec.getYear());
    const monthPillar = splitPillar(ec.getMonth());
    const dayPillar = splitPillar(ec.getDay());
    const hourPillar = splitPillar(ec.getTime());
    const pillars = [yearPillar, monthPillar, dayPillar, hourPillar];

    const dayMaster = ec.getDayGan();

    const tenGods = {
      year: { gan: ec.getYearShiShenGan(), zhi: ec.getYearShiShenZhi() },
      month: { gan: ec.getMonthShiShenGan(), zhi: ec.getMonthShiShenZhi() },
      day: { gan: '일간', zhi: ec.getDayShiShenZhi() },
      hour: { gan: ec.getTimeShiShenGan(), zhi: ec.getTimeShiShenZhi() },
    };

    const yun = ec.getYun(gender === 'male' ? 1 : 0);
    const daYun = yun.getDaYun().slice(0, 10).map((dy) => ({
      start_age: dy.getStartAge(),
      end_age: dy.getEndAge(),
      start_year: dy.getStartYear(),
      end_year: dy.getEndYear(),
      pillar: dy.getGanZhi() || '(대운 시작 전)',
    }));

    // ---- edge-case warnings ----
    const warnings = [];
    if (hh === 23 || hh === 0) {
      warnings.push('자시(23:00–00:59) 출생: 일주 기준이 학파에 따라 달라질 수 있습니다(야자시/조자시).');
    }
    // 절기 경계 근접 여부 (월주/연주 기준)
    const jieQi = lunar.getJieQiTable();
    const birthMs = new Date(y, m - 1, d, hh, mm, 0).getTime();
    for (const k of Object.keys(jieQi)) {
      const jqMs = jieQi[k] && typeof jieQi[k].toYmdHms === 'function' ? parseYmdHms(jieQi[k].toYmdHms()) : null;
      if (jqMs == null) continue;
      if (Math.abs(jqMs - birthMs) / 36e5 <= 24) {
        warnings.push('절기(' + k + ') 경계 ±24시간 이내 출생: 월주/연주가 경계에서 달라질 수 있습니다.');
        break;
      }
    }

    res.json({
      person: { name, gender, calendar, birth_date, birth_time, birth_place: birth_place || null, timezone: timezone || 'Asia/Seoul' },
      saju: {
        year_pillar: yearPillar,
        month_pillar: monthPillar,
        day_pillar: dayPillar,
        hour_pillar: hourPillar,
        day_master: { hanja: dayMaster, kr: GAN_KR[dayMaster] || '', element: ELEMENT_OF_GAN[dayMaster] },
        five_elements: countFiveElements(pillars),
        ten_gods: tenGods,
        luck_cycles: daYun,
        lunar_date: lunar.getYear() + '-' + String(lunar.getMonth()).padStart(2, '0') + '-' + String(lunar.getDay()).padStart(2, '0'),
      },
      meta: {
        warnings,
        engine: 'lunar-javascript',
        convention: 'year pillar by 입춘, month pillar by 절기, day boundary at 00:00 (조자시)',
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'calculation_failed', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('saju-calculator-api listening on :' + PORT));
