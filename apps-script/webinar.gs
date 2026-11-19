// 현황 > 세미나 > [웨비나 KPI] 탭 (2026-11-19)
// '(닥터빌) 2026 편성표_NEW' 시트의 RAW 탭(2025-01~, 년·월 열)을 읽어 월·구분·유형·카테고리·회사·설문유형·학술구분만 돌려줍니다.
// 행사명·강사·PM·담당자 등은 읽지 않습니다. 10분 캐시.
var WEBINAR_TAB = 'RAW';
var WEBINAR_COLS = { io: '구분', ac: '학술구분', tx: '송출형태', sv: '설문유형', st: '상태', y: '년', m: '월', cat: '카테고리', type: '유형', co: '회사' };

function webinarData_(fresh) {
  var cache = CacheService.getScriptCache(), ck = 'webinar:v1';
  if (!fresh) { var hit = cache.get(ck); if (hit) { try { return JSON.parse(hit); } catch (e) {} } }
  var ss = SpreadsheetApp.openById(SCHEDULE_SHEET_ID), sh = ss.getSheetByName(WEBINAR_TAB);
  if (!sh) throw new Error('편성표에서 탭을 찾을 수 없습니다: ' + WEBINAR_TAB);
  var v = sh.getDataRange().getDisplayValues(), hi = -1;
  for (var i = 0; i < Math.min(v.length, 15); i++) {
    var ks = v[i].map(schKey_);
    if (ks.indexOf('년') >= 0 && ks.indexOf('월') >= 0 && ks.indexOf('유형') >= 0) { hi = i; break; }
  }
  if (hi < 0) throw new Error(WEBINAR_TAB + ' 탭에서 머리글(년·월·유형) 행을 찾지 못했습니다.');
  var head = v[hi].map(schKey_), col = {}, miss = [];
  Object.keys(WEBINAR_COLS).forEach(function (k) { col[k] = head.indexOf(schKey_(WEBINAR_COLS[k])); if (col[k] < 0 && k !== 'st') miss.push(WEBINAR_COLS[k]); });
  if (miss.length) throw new Error(WEBINAR_TAB + ' 탭에 필요한 열이 없습니다: ' + miss.join(', '));
  var from = (new Date().getFullYear() - 1) * 100 + 1, keys = ['io', 'type', 'cat', 'co', 'sv', 'ac', 'tx', 'st'], rows = [];
  var cell = function (x, k) { return col[k] >= 0 ? String(x[col[k]] || '').replace(/\s+/g, ' ').trim() : ''; };
  for (var r = hi + 1; r < v.length; r++) {
    var x = v[r], y = parseInt(String(x[col.y]).replace(/\D/g, ''), 10), m = parseInt(String(x[col.m]).replace(/\D/g, ''), 10);
    if (!(y > 2000) || !(m >= 1 && m <= 12) || y * 100 + m < from) continue;
    if (!cell(x, 'type') && !cell(x, 'co')) continue;
    rows.push([y + '-' + ('0' + m).slice(-2)].concat(keys.map(function (k) { return cell(x, k); })));
  }
  var out = { fetchedAt: new Date().toISOString(), source: ss.getName() + ' · ' + WEBINAR_TAB, keys: ['ym'].concat(keys), rows: rows };
  try { var j = JSON.stringify(out); if (j.length < 95000) cache.put(ck, j, 600); } catch (e) {}
  return out;
}

// 시트 메뉴에서 직접 실행해 연결 확인 (권한 승인용)
function menuCheckWebinar() {
  var d = webinarData_(true);
  Logger.log(d.source + ' · ' + d.rows.length + '행');
  return d.rows.length;
}
