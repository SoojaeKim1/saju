// Saju (Four Pillars) deterministic calculation API + n8n-free reading service
//
// Endpoints:
//   GET  /health
//   POST /calculate-saju   → deterministic four-pillars calculation
//   POST /saju-reading     → full pipeline: calc → LLM analysis → structure → HTML
//   GET  /                 → saju input form (self-contained)
//
// Required env var for /saju-reading:
//   OPENAI_API_KEY — OpenAI API key (set in Render dashboard → Environment)

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

function parseYmdHms(s) {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

function calculateSaju(body) {
  const { name, gender, calendar, birth_date, birth_time, birth_place, timezone } = body || {};
  const errors = [];
  if (!name || typeof name !== 'string') errors.push('name is required');
  if (!['male', 'female'].includes(gender)) errors.push('gender must be "male" or "female"');
  if (calendar !== 'solar') errors.push('v1 supports calendar="solar" only');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date || '')) errors.push('birth_date must be YYYY-MM-DD');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(birth_time || '')) errors.push('birth_time must be HH:mm (24h)');
  if (errors.length) return { error: errors };

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

  const warnings = [];
  if (hh === 23 || hh === 0) {
    warnings.push('자시(23:00–00:59) 출생: 일주 기준이 학파에 따라 달라질 수 있습니다(야자시/조자시).');
  }
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

  return {
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
    meta: { warnings, engine: 'lunar-javascript' },
  };
}

const ANALYSIS_PROMPT = `당신은 사주명리 전문 해석가입니다.

절대 규칙:
1. 사주 계산 결과는 입력으로 주어진 데이터만 사용합니다. 간지, 십신, 오행, 대운을 스스로 다시 계산하거나 새로 만들지 마세요.
2. 입력 데이터에 없는 정보를 지어내지 마세요.
3. 단정적이거나 공포를 조성하는 표현("반드시", "~할 것이다", "큰일 난다")을 피하고, 경향과 가능성의 어조로 부드럽게 서술하세요.
4. 건강, 수명, 임신, 투기성 투자의 구체적 결과 예측은 하지 마세요.
5. 장점과 주의점을 균형 있게 다루세요.
6. 모든 출력은 한국어로 작성하세요.

출력 형식: 아래 12개 항목을 순서대로 자연스러운 산문으로 작성하세요. 각 항목은 "1. 핵심 요약: 내용"처럼 "번호. 항목명: 내용" 형식으로 시작하고, 항목 사이에는 빈 줄을 두세요. 12개 항목을 모두 포함해야 합니다.
1. 핵심 요약 (한두 문장 요약 + 핵심 키워드 5개를 [키워드] 형태로)
2. 일간 분석 (일간이 무엇인지, 그 기운의 특징, 강점이 드러나는 상황, 주의할 점)
3. 오행의 균형 (강한 기운, 보완이 필요한 기운, 각 기운의 의미)
4. 대운별 흐름 (대운 각각의 의미를 1~2문장씩, 대운 간지와 함께)
5. 인생의 주요 변곡점 (대운 전환기 중심 3~4개)
6. 성격과 기질
7. 강점과 주의점 (강점 4개, 주의점 3개, 명사형)
8. 직업과 적성 (잘 맞는 업무/조직/피로 환경)
9. 재물에 대한 성향 (버는 방식, 관리 방식, 주의점)
10. 대인관계 / 연애와 결혼
11. 현재 시기 (현재 연도 명시, 전체 흐름, 직업/재물/관계/변화, 올해의 키워드 4개 [키워드] 형태)
12. 종합 조언 (실천 가능한 방향 3가지와 따뜻한 마무리)`;

const STRUCTURE_PROMPT = `당신은 사주 해석 텍스트를 정해진 JSON 구조로 옮기는 변환기입니다.

절대 규칙:
1. 입력 해석 텍스트의 내용을 재배치하고 다듬을 뿐, 새 해석이나 정보를 추가하지 마세요.
2. 사주 데이터(pillars, day_master, five_elements counts, luck_cycles)는 계산 데이터를 그대로 복사하세요.
2-1. five_elements.analysis는 counts 근거로 오행 강약·균형을 1~2문장으로 작성하세요. 빈 문자열 금지.
3. 지정된 JSON 스키마만 출력하세요. 설명/마크다운/코드블록 없이 JSON만.
4. 배열 필드(keywords, strengths, cautions, turning_points, current_period.keywords, luck_cycles[].reading)는 빈 배열로 두지 마세요.

출력 JSON 스키마:
{
  "title": string, "summary": string, "keywords": [string x5],
  "saju_table": { "year_pillar": {"hanja","gan_kr","zhi_kr"}, "month_pillar": {...}, "day_pillar": {...}, "hour_pillar": {...}, "day_master": string },
  "five_elements": { "counts": {"木":n,"火":n,"土":n,"金":n,"水":n}, "analysis": string, "meaning": string },
  "luck_cycles": [ {"start_age","end_age","start_year","end_year","pillar","reading"} ],
  "day_master_analysis": string,
  "strengths": [string x4], "cautions": [string x3],
  "turning_points": [ {"age_range": string, "description": string} ],
  "personality": string, "career": string, "wealth": string, "relationship": string, "love_marriage": string, "life_flow": string,
  "current_period": { "year": number, "overview": string, "career": string, "wealth": string, "relationship": string, "change": string, "keywords": [string x4] },
  "future_flow": string, "actionable_advice": [string x3], "final_message": string
}`;

async function callOpenAI(instructions, userContent, jsonMode) {
  const body = {
    model: 'gpt-4o-mini',
    instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: userContent }] }],
    max_output_tokens: 4096,
  };
  if (jsonMode) body.text = { format: { type: 'json_object' } };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('OpenAI API 오류: ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const msg = (data.output || []).find((o) => o.type === 'message');
  const part = msg && (msg.content || []).find((c) => c.type === 'output_text');
  return part ? part.text : '';
}

const TAEGEUK_SVG = '<svg width="72" height="72" viewBox="0 0 100 100" style="margin:0 auto 16px" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="#c9a35c" stroke-width="2"/><path d="M50 4 A46 46 0 0 1 50 96 A23 23 0 0 1 50 50 A23 23 0 0 0 50 4Z" fill="#c9a35c"/><circle cx="50" cy="27" r="7" fill="#c9a35c"/><circle cx="50" cy="73" r="7" fill="#101418"/></svg>';

function escH(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ELEM_COLOR = { '木': '#4fa88a', '火': '#c25b4e', '土': '#b8934a', '金': '#d3b566', '水': '#4e7fb5' };
const GAN_ELEM = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
const ZHI_ELEM = { '子': '水', '丑': '土', '寅': '木', '卯': '木', '辰': '土', '巳': '火', '午': '火', '未': '土', '申': '金', '酉': '金', '戌': '土', '亥': '水' };
const ZODIAC = { '子': '🐭', '丑': '🐮', '寅': '🐯', '卯': '🐰', '辰': '🐲', '巳': '🐍', '午': '🐴', '未': '🐑', '申': '🐵', '酉': '🐔', '戌': '🐶', '亥': '🐷' };
const ELEM_LABEL = { '木': '목(木)', '火': '화(火)', '土': '토(土)', '金': '금(金)', '水': '수(水)' };

function pillarCellHtml(label, p) {
  if (!p) return '';
  const gan = p.hanja[0], zhi = p.hanja[1];
  const ganC = ELEM_COLOR[GAN_ELEM[gan]] || '#e6c87e';
  const zhiC = ELEM_COLOR[ZHI_ELEM[zhi]] || '#e6c87e';
  return '<div class="pillar-box"><div class="text-xs dim">' + escH(label) + '</div>'
    + '<div class="pillar-hanja"><span style="color:' + ganC + '">' + escH(gan) + '</span><span style="color:' + zhiC + '">' + escH(zhi) + '</span></div>'
    + '<div class="zodiac">' + (ZODIAC[zhi] || '') + '</div>'
    + '<div class="text-xs dim mt-1">' + escH((p.gan_kr || '') + (p.zhi_kr || '')) + '</div></div>';
}

function polar(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function donutSvg(counts) {
  const keys = ['木', '火', '土', '金', '水'];
  const total = keys.reduce((s, k) => s + (counts[k] || 0), 0);
  if (!total) return '';
  const cx = 90, cy = 90, r = 70, ir = 42;
  let angle = 0, paths = '';
  for (const k of keys) {
    const n = counts[k] || 0;
    if (!n) continue;
    const sweep = n / total * 360, large = sweep > 180 ? 1 : 0;
    const [x0, y0] = polar(cx, cy, r, angle), [x1, y1] = polar(cx, cy, r, angle + sweep);
    const [x2, y2] = polar(cx, cy, ir, angle + sweep), [x3, y3] = polar(cx, cy, ir, angle);
    angle += sweep;
    paths += '<path d="M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1)
      + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' A' + ir + ' ' + ir + ' 0 ' + large + ' 0 ' + x3.toFixed(1) + ' ' + y3.toFixed(1)
      + ' Z" fill="' + ELEM_COLOR[k] + '" opacity="0.9"/>';
  }
  const legend = keys.map((k) =>
    '<div class="flex items-center text-sm mb-1"><span class="legend-dot" style="background:' + ELEM_COLOR[k] + '"></span>' + ELEM_LABEL[k] + ' <b class="ml-2">' + (counts[k] || 0) + '</b></div>'
  ).join('');
  return '<div class="flex items-center gap-6 flex-wrap justify-center mb-4">'
    + '<svg width="180" height="180" viewBox="0 0 180 180">' + paths
    + '<text x="90" y="86" text-anchor="middle" fill="#ece7dd" font-size="15" font-weight="700">오행</text>'
    + '<text x="90" y="104" text-anchor="middle" fill="#a49a86" font-size="11">五行</text></svg><div>' + legend + '</div></div>';
}

function luckHtml(cycles) {
  if (!cycles || !cycles.length) return '';
  const nowYear = new Date().getFullYear();
  const rows = cycles.map((c) => {
    if (!c.pillar || c.pillar === '(대운 시작 전)') return '';
    const span = Math.max(1, (c.end_year || 0) - (c.start_year || 0) + 1);
    const w = Math.min(100, span * 6);
    const cur = nowYear >= c.start_year && nowYear <= c.end_year;
    const ganC = ELEM_COLOR[GAN_ELEM[c.pillar[0]]] || '#c9a35c';
    const zhiC = ELEM_COLOR[ZHI_ELEM[c.pillar[1]]] || '#c9a35c';
    return '<div class="luck-row"><div class="luck-age">' + c.start_age + '–' + c.end_age + '세</div>'
      + '<div class="luck-bar' + (cur ? ' current' : '') + '" style="width:' + w + '%;background:linear-gradient(90deg,' + ganC + ',' + zhiC + ')">' + escH(c.pillar) + (cur ? ' · 현재' : '') + '</div>'
      + '<div class="luck-year">' + c.start_year + '–' + c.end_year + '</div></div>'
      + (c.reading ? '<div class="text-xs dim mt-1 mb-2" style="padding-left:6.1rem">' + escH(c.reading) + '</div>' : '');
  }).join('');
  return '<section class="card p-6 mb-5"><h2 class="section-title serif">대운의 흐름 (大運)</h2>' + rows + '</section>';
}

function cardHtml(title, body) {
  return '<section class="card p-6 mb-5"><h2 class="section-title serif">' + escH(title) + '</h2>'
    + '<div class="leading-relaxed whitespace-pre-line">' + escH(body) + '</div></section>';
}

function badgesHtml(list, color) {
  return (list || []).map((k) =>
    '<span class="inline-block text-xs font-bold px-3 py-1 mr-2 mb-2 rounded-full" style="border:1px solid ' + color + ';color:' + color + '">' + escH(k) + '</span>'
  ).join('');
}

const PAGE_CSS = `
  :root { --ink:#ece7dd; --ink-dim:#a49a86; --gold:#c9a35c; --gold-bright:#e6c87e; --night:#101418; --night2:#171d24; --card:#1a212a; --line:#2c3540; }
  * { font-family:'Noto Sans KR',sans-serif; }
  body { background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(201,163,92,0.08), transparent), radial-gradient(ellipse 60% 40% at 80% 110%, rgba(194,91,78,0.05), transparent), var(--night); color: var(--ink); min-height:100vh; }
  .serif { font-family:'Noto Serif KR',serif; } .gold { color:var(--gold); } .gold-bright { color:var(--gold-bright); } .dim { color:var(--ink-dim); }
  .ornament { color:var(--gold); letter-spacing:0.5em; text-align:center; font-size:0.75rem; }
  .divider { height:1px; border:0; margin:1.75rem auto; width:60%; background:linear-gradient(90deg,transparent,var(--gold),transparent); opacity:0.5; }
  .card { background:linear-gradient(160deg,var(--card),var(--night2)); border:1px solid var(--line); border-radius:1rem; box-shadow:0 8px 30px rgba(0,0,0,0.35); }
  .field { width:100%; background:var(--night); color:var(--ink); border:1px solid var(--line); border-radius:0.6rem; padding:0.65rem 0.9rem; outline:none; color-scheme:dark; }
  .field:focus { border-color:var(--gold); }
  .radio-card { flex:1; text-align:center; padding:0.6rem; cursor:pointer; border:1px solid var(--line); border-radius:0.6rem; background:var(--night); color:var(--ink-dim); }
  .radio-card:has(input:checked) { border-color:var(--gold); color:var(--gold-bright); background:rgba(201,163,92,0.08); }
  .btn-gold { width:100%; padding:0.9rem; border-radius:0.6rem; border:none; font-weight:700; font-size:1.05rem; cursor:pointer; letter-spacing:0.1em; color:#1a1408; background:linear-gradient(135deg,var(--gold-bright),var(--gold)); box-shadow:0 4px 20px rgba(201,163,92,0.25); }
  .btn-gold:disabled { opacity:0.55; cursor:wait; }
  .pillar-box { flex:1; text-align:center; padding:0.9rem 0.25rem 0.8rem; background:var(--night); border:1px solid var(--line); border-radius:0.75rem; }
  .pillar-hanja { font-family:'Noto Serif KR',serif; font-weight:900; font-size:1.8rem; line-height:1.25; writing-mode:vertical-rl; letter-spacing:0.15em; margin:0.4rem auto 0; }
  .zodiac { font-size:1.15rem; margin-top:0.35rem; }
  .spinner { width:64px; height:64px; margin:0 auto 1.25rem; border-radius:50%; border:2px solid var(--line); border-top-color:var(--gold); animation:spin 1.1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .section-title { font-family:'Noto Serif KR',serif; font-weight:700; color:var(--gold); font-size:1.05rem; letter-spacing:0.12em; display:flex; align-items:center; gap:0.75rem; margin-bottom:0.9rem; }
  .section-title::after { content:''; flex:1; height:1px; background:linear-gradient(90deg,var(--line),transparent); }
  .legend-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; }
  .luck-row { display:flex; align-items:center; gap:0.6rem; margin-bottom:0.45rem; }
  .luck-age { width:5.5rem; font-size:0.75rem; color:var(--ink-dim); text-align:right; flex-shrink:0; }
  .luck-bar { height:22px; border-radius:5px; display:flex; align-items:center; padding-left:8px; font-size:0.75rem; font-weight:700; color:rgba(0,0,0,0.55); white-space:nowrap; }
  .luck-bar.current { outline:2px solid var(--gold-bright); outline-offset:1px; }
  .luck-year { font-size:0.7rem; color:var(--ink-dim); flex-shrink:0; }
  .link-btn { color:var(--ink-dim); text-decoration:underline; text-underline-offset:3px; font-size:0.85rem; background:none; border:none; cursor:pointer; }
`;

function pageHead(title) {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>' + escH(title) + '</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700;900&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">'
    + '<script src="https://cdn.tailwindcss.com"></scr' + 'ipt><style>' + PAGE_CSS + '</style></head>';
}

function renderReportHtml(data) {
  let html = pageHead(data.title) + '<body class="py-10 px-4"><div class="max-w-2xl mx-auto">';
  html += '<header class="text-center mb-6"><div class="ornament mb-3 serif">☰ ☱ ☲ ☳ ☴ ☵ ☶ ☷</div>'
    + '<h1 class="serif text-3xl font-black gold-bright">' + escH(data.title) + '</h1>'
    + '<p class="dim mt-3 leading-relaxed">' + escH(data.summary) + '</p></header>';
  if (data.keywords && data.keywords.length) html += '<div class="text-center mb-6">' + badgesHtml(data.keywords, '#e6c87e') + '</div>';
  html += '<hr class="divider">';
  if (data.saju_table) {
    const st = data.saju_table;
    html += '<section class="card p-6 mb-5"><h2 class="section-title serif">사주 팔자 (四柱八字)</h2><div class="flex gap-2">'
      + pillarCellHtml('시주', st.hour_pillar) + pillarCellHtml('일주', st.day_pillar)
      + pillarCellHtml('월주', st.month_pillar) + pillarCellHtml('연주', st.year_pillar) + '</div>'
      + (st.day_master ? '<p class="mt-5 text-center">일간(日主) · <b class="gold-bright serif text-lg">' + escH(st.day_master) + '</b></p>' : '') + '</section>';
  }
  if (data.day_master_analysis) html += cardHtml('나를 나타내는 일간 (日干)', data.day_master_analysis);
  if (data.five_elements) {
    html += '<section class="card p-6 mb-5"><h2 class="section-title serif">오행 분포 (五行)</h2>'
      + donutSvg(data.five_elements.counts || {})
      + '<p class="leading-relaxed whitespace-pre-line">' + escH(data.five_elements.analysis || '') + '</p>'
      + (data.five_elements.meaning ? '<p class="text-sm dim mt-3 leading-relaxed whitespace-pre-line">' + escH(data.five_elements.meaning) + '</p>' : '') + '</section>';
  }
  html += luckHtml(data.luck_cycles);
  if (data.turning_points && data.turning_points.length) {
    html += '<section class="card p-6 mb-5"><h2 class="section-title serif">인생의 주요 변곡점</h2>'
      + data.turning_points.map((t) => '<div class="flex gap-3 mb-3 items-baseline"><span class="gold-bright serif font-bold whitespace-nowrap">' + escH(t.age_range) + '</span><span class="text-sm leading-relaxed">' + escH(t.description) + '</span></div>').join('') + '</section>';
  }
  if ((data.strengths && data.strengths.length) || (data.cautions && data.cautions.length)) {
    const col = (title, items, color) => '<div class="flex-1 min-w-[140px]"><div class="text-sm font-bold mb-2" style="color:' + color + '">' + escH(title) + '</div>'
      + (items || []).map((i) => '<div class="text-sm mb-1.5 flex gap-2"><span style="color:' + color + '">●</span><span>' + escH(i) + '</span></div>').join('') + '</div>';
    html += '<section class="card p-6 mb-5"><h2 class="section-title serif">강점과 주의점</h2><div class="flex gap-4 flex-wrap">'
      + col('강점', data.strengths, '#e6c87e') + col('주의할 점', data.cautions, '#c25b4e') + '</div></section>';
  }
  const sections = [
    ['성격과 기질', data.personality], ['직업과 적성', data.career], ['재물에 대한 성향', data.wealth],
    ['대인관계', data.relationship], ['연애와 결혼', data.love_marriage], ['인생 전체의 흐름', data.life_flow],
  ];
  for (const [t, b] of sections) if (b) html += cardHtml(t, b);
  if (data.current_period) {
    const cp = data.current_period;
    html += '<section class="card p-6 mb-5" style="border-color:rgba(201,163,92,0.45)"><h2 class="section-title serif">현재 시기' + (cp.year ? ' (' + escH(String(cp.year)) + '년)' : '') + '</h2>'
      + '<p class="leading-relaxed whitespace-pre-line mb-4">' + escH(cp.overview || '') + '</p>'
      + '<div class="grid grid-cols-2 gap-3 text-sm mb-4">'
      + (cp.career ? '<div><span class="dim">직업</span><div>' + escH(cp.career) + '</div></div>' : '')
      + (cp.wealth ? '<div><span class="dim">재물</span><div>' + escH(cp.wealth) + '</div></div>' : '')
      + (cp.relationship ? '<div><span class="dim">관계</span><div>' + escH(cp.relationship) + '</div></div>' : '')
      + (cp.change ? '<div><span class="dim">변화</span><div>' + escH(cp.change) + '</div></div>' : '')
      + '</div>' + (cp.keywords && cp.keywords.length ? '<div>' + badgesHtml(cp.keywords, '#4e7fb5') + '</div>' : '') + '</section>';
  }
  if (data.future_flow) html += cardHtml('앞으로의 흐름', data.future_flow);
  if (data.actionable_advice && data.actionable_advice.length) {
    html += '<section class="card p-6 mb-5"><h2 class="section-title serif">종합 조언</h2>'
      + data.actionable_advice.map((a, i) => '<div class="flex gap-3 mb-2 items-baseline"><span class="gold serif font-bold">' + (i + 1) + '.</span><span class="leading-relaxed">' + escH(a) + '</span></div>').join('') + '</section>';
  }
  if (data.final_message) html += cardHtml('마무리 메시지', data.final_message);
  if (data.warnings && data.warnings.length) {
    html += '<section class="card p-4 mb-5 text-sm" style="border-color:rgba(194,91,78,0.4)">'
      + data.warnings.map((w) => '<div class="dim">· ' + escH(w) + '</div>').join('') + '</section>';
  }
  html += '<div class="ornament serif mt-6 mb-2">☰ ☱ ☲ ☳ ☴ ☵ ☶ ☷</div>'
    + '<footer class="text-center text-xs dim pb-8">본 사주풀이는 참고용 콘텐츠이며, 삶의 선택은 본인의 것입니다.</footer></div></body></html>';
  return html;
}

function renderFormHtml() {
  return pageHead('사주풀이 — 운명의 네 기둥') + `<body class="py-10 px-4">
  <div id="formView" class="max-w-md mx-auto">
    <header class="text-center mb-8">` + TAEGEUK_SVG + `
      <h1 class="serif text-4xl font-black gold-bright" style="letter-spacing:0.2em">사주풀이</h1>
      <p class="dim mt-3 text-sm">생년월일시의 네 기둥으로 읽는 당신의 흐름</p>
      <hr class="divider">
    </header>
    <form id="sajuForm" class="card p-6 space-y-5">
      <div><label class="block text-sm dim mb-1.5">이름</label><input name="name" required class="field" placeholder="홍길동"></div>
      <div><label class="block text-sm dim mb-1.5">성별</label>
        <div class="flex gap-2">
          <label class="radio-card"><input type="radio" name="gender" value="남성" checked class="hidden"><span>남성</span></label>
          <label class="radio-card"><input type="radio" name="gender" value="여성" class="hidden"><span>여성</span></label>
        </div></div>
      <div><label class="block text-sm dim mb-1.5">생년월일 (양력)</label><input name="birth_date" type="date" required class="field"></div>
      <div><label class="block text-sm dim mb-1.5">태어난 시간</label><input name="birth_time" type="time" required class="field"></div>
      <div><label class="block text-sm dim mb-1.5">태어난 곳 (선택)</label><input name="birth_place" class="field" placeholder="서울"></div>
      <button type="submit" id="submitBtn" class="btn-gold serif">사 주 보 기</button>
      <p id="err" class="text-red-400 text-sm hidden text-center"></p>
    </form>
    <p class="text-center text-xs dim mt-6">본 사주풀이는 참고용 콘텐츠이며, 삶의 선택은 본인의 것입니다.</p>
  </div>
  <div id="loading" class="hidden max-w-md mx-auto text-center py-24">
    <div class="spinner"></div>
    <p class="serif gold text-lg">사주를 계산하고 해석하는 중입니다</p>
    <p class="dim text-sm mt-2">잠시만 기다려 주세요. 최대 1분 정도 걸릴 수 있습니다.</p>
  </div>
  <script>
    document.getElementById('sajuForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = document.getElementById('err');
      err.classList.add('hidden');
      document.getElementById('submitBtn').disabled = true;
      var f = e.target;
      var payload = {
        name: f.name.value.trim(), gender: f.gender.value, calendar: '양력',
        birth_date: f.birth_date.value, birth_time: f.birth_time.value, birth_place: f.birth_place.value.trim()
      };
      document.getElementById('formView').classList.add('hidden');
      document.getElementById('loading').classList.remove('hidden');
      try {
        var res = await fetch('/saju-reading', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        var html = await res.text();
        if (!res.ok) throw new Error(html.slice(0, 300));
        document.open(); document.write(html); document.close();
      } catch (e2) {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('formView').classList.remove('hidden');
        document.getElementById('submitBtn').disabled = false;
        err.textContent = '오류가 발생했습니다. 입력값을 확인하고 다시 시도해 주세요.';
        err.classList.remove('hidden');
      }
    });
  </scr` + `ipt>
</body></html>`;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => res.type('html').send(renderFormHtml()));

app.post('/calculate-saju', (req, res) => {
  try {
    const result = calculateSaju(req.body);
    if (result.error) return res.status(400).json({ error: 'invalid_input', details: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'calculation_failed', message: err.message });
  }
});

app.post('/saju-reading', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'server_misconfigured', message: 'OPENAI_API_KEY not set' });
    const b = req.body || {};
    const genderMap = { '남성': 'male', '여성': 'female', 'male': 'male', 'female': 'female' };
    const calendarMap = { '양력': 'solar', '음력': 'lunar', 'solar': 'solar', 'lunar': 'lunar' };
    const normalized = {
      name: String(b.name || '').trim(),
      gender: genderMap[String(b.gender || '').trim()] || '',
      calendar: calendarMap[String(b.calendar || b.calender || 'solar').trim()] || '',
      birth_date: String(b.birth_date || '').trim(),
      birth_time: String(b.birth_time || '12:00').trim(),
      birth_place: String(b.birth_place || '').trim(),
    };
    const calc = calculateSaju(normalized);
    if (calc.error) return res.status(400).json({ error: 'invalid_input', details: calc.error });

    const year = new Date().getFullYear();
    const analysisText = await callOpenAI(
      ANALYSIS_PROMPT,
      '다음은 사주 계산 엔진이 결정론적으로 계산한 결과입니다. 이 데이터만을 근거로 해석해 주세요. 현재 연도는 ' + year + '년입니다.\n\n' + JSON.stringify(calc),
      false
    );
    const structuredText = await callOpenAI(
      STRUCTURE_PROMPT,
      '아래 [해석 텍스트]를 지정된 JSON 스키마로 변환하세요. 사주 데이터는 [계산 데이터]를 그대로 복사하세요. 현재 연도는 ' + year + '년이며 current_period.year에는 반드시 이 값을 사용하세요.\n\n[해석 텍스트]\n' + analysisText + '\n\n[계산 데이터]\n' + JSON.stringify(calc),
      true
    );
    let data;
    try { data = JSON.parse(structuredText); } catch (e) { throw new Error('LLM 구조화 결과 JSON 파싱 실패: ' + e.message); }
    data.warnings = (calc.meta && calc.meta.warnings) || [];
    res.type('html').send(renderReportHtml(data));
  } catch (err) {
    res.status(500).json({ error: 'reading_failed', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('saju service listening on :' + PORT));
