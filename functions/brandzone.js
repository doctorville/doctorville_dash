// 브랜드존 샘플/데모 신청 (brandzone) · Nhost Functions
//   action 'submit' — 누구나 신청 접수 (로그인 없음). 서버에서 항목·필수값 검증 후 admin secret 으로 저장
//   action 'list'   — 관리자 비밀번호 확인 후 신청 목록 반환
//   action 'check' / 'attach' — 첨부 업로드용 (Apps Script 웹 앱이 호출). 접수 때 받은 1회용 토큰(1시간 유효)으로만 가능
//      check : 업로드 전에 신청 건·토큰 확인 → 폴더 이름에 쓸 정보 반환
//      attach: 드라이브에 저장한 파일 정보를 신청 건에 추가
// 표: public.brandzone_applications (nhost/brandzone.sql). Hasura 공개 권한은 주지 않음.
// 관리자 비밀번호: 환경 변수 BRANDZONE_ADMIN_PW_SHA256(sha256 hex)이 있으면 그 값, 없으면 기본값(qwer1234)의 해시
import crypto from 'node:crypto';
import { cors, adminGql, readBody } from './_lib/common.js';

const DEFAULT_PW_SHA256 = '4d4f26369171994f3a46776ee2d88494fb9955800a5bb6261c016c4bb9f30b56';

// ── 폼 정의 (docs/brandzone/index.html 과 같은 키) ──
const TEAMS = ['내분비', '디지털헬스', '소화기1', '소화기2', '순환기1', '순환기2', '신경골격', '항암', '호흡피부비뇨', '기타'];
const TYPE_DEMO = '브랜드존 메인 데모 신청 (의료기기만 가능)';
const TYPE_NEW = '브랜드존 신규 품목 등록 (의약품, 의료기기)';
const DEMO_ITEMS = ['더-스피로킷', '모비케어', '씽크', '이지듀', '이지에프MD스프레이', '목록에 없음 (브랜드존 미등록·미노출 품목) → 신규등록 진행'];
const NOT_LISTED = DEMO_ITEMS[DEMO_ITEMS.length - 1];
const KINDS = ['전문의약품', '일반의약품', '기타의약품', '의료기기'];
const CATS = ['감염성질환', '근골격질환', '기타질환', '내분비질환', '눈귀질환', '비뇨생식기질환', '비만질환', '소화기질환', '신경질환', '심혈관질환', '알레르기질환', '암질환', '여성 및 소아질환', '정신질환', '피부/성형질환', '호흡기질환'];
const DEPTS = ['가정의학과', '결핵과', '내과', '마취통증의학과', '방사선종양학과', '병리과', '비뇨의학과', '산부인과', '성형외과', '소아청소년과', '신경과', '신경외과', '안과', '영상의학과', '예방의학과', '외과', '응급의학과', '이비인후과', '일반의', '재활의학과', '정신건강의학과', '정형외과', '직업환경의학과', '진단검사의학과', '피부과', '핵의학과', '흉부외과'];
const ALSO_DEMO = ['예 (의료기기)', '아니오 (신규 등록만 신청)'];
const MAIN = ['예 (메인 노출 신청)', '아니오 (브랜드존 상세페이지만)'];

const MAX_FILES = 15, TOKEN_TTL = 3600000;
const FILE_FIELDS = ['제품 이미지(고화질)', '제품 로고(고화질)', '외부 공유용 E브로셔'];
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const s = (v, n = 300) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validate(b) {
  const e = [];
  const v = {};
  const need = (k, label, n) => { v[k] = s(b[k], n); if (!v[k]) e.push(label); };
  const pick = (k, label, list) => { v[k] = s(b[k], 200); if (!list.includes(v[k])) e.push(label); };

  need('email', '신청자 이메일', 200);
  if (v.email && !EMAIL_RE.test(v.email)) e.push('신청자 이메일 형식');
  pick('team', '사업팀', TEAMS);
  need('pm', '담당 PM 이름', 60);
  pick('type', '신청 유형', [TYPE_DEMO, TYPE_NEW]);

  let isNew = v.type === TYPE_NEW, demo = v.type === TYPE_DEMO;
  if (demo) {
    pick('demoItem', '데모 신청 품목', DEMO_ITEMS);
    if (v.demoItem === NOT_LISTED) { isNew = true; demo = false; }
  }
  if (isNew) {
    v.kind = (Array.isArray(b.kind) ? b.kind : []).map((x) => s(x, 20)).filter((x) => KINDS.includes(x));
    if (!v.kind.length) e.push('구분');
    need('seller', '판매사', 100);
    need('maker', '제조사', 300);
    need('product', '제품명', 100);
    pick('cat', '진료과 카테고리', CATS);
    need('ptype', '종류', 200);
    need('ingredient', '주요성분', 300);
    need('keyMsg', '키메세지', 2000);
    v.subMsg = s(b.subMsg, 2000);
    v.depts = (Array.isArray(b.depts) ? b.depts : []).map((x) => s(x, 20)).filter((x) => DEPTS.includes(x));
    if (!v.depts.length) e.push('진료과');
    need('insurance', '보험코드', 1000);
    v.attach = s(b.attach, 1000);
    pick('alsoDemo', '메인 데모 신청 여부', ALSO_DEMO);
    if (v.alsoDemo === ALSO_DEMO[0]) demo = true;
  }
  let main = false;
  if (demo) {
    need('notifyName', '알림 담당자', 60);
    need('notifyEmail', '알림 받을 메일 주소', 200);
    if (v.notifyEmail && !EMAIL_RE.test(v.notifyEmail)) e.push('알림 받을 메일 주소 형식');
    need('notifyPhone', '알림 담당자 연락처', 40);
    need('notifyOrg', '알림 담당자 소속', 100);
    v.mobile = s(b.mobile, 40);
    pick('main', '닥터빌 메인 노출 신청', MAIN);
    main = v.main === MAIN[0];
    if (main) {
      v.mainStart = s(b.mainStart, 10); v.mainEnd = s(b.mainEnd, 10);
      if (!DATE_RE.test(v.mainStart)) e.push('게시 시작일');
      if (!DATE_RE.test(v.mainEnd)) e.push('게시 종료일');
      if (DATE_RE.test(v.mainStart) && DATE_RE.test(v.mainEnd) && v.mainEnd < v.mainStart) e.push('게시 종료일(시작일 이후)');
    }
  }
  return { errors: e, v, isNew, demo, main };
}

// 질문 제목 → 값 (목록·엑셀에서 그대로 보이게)
function toData(r) {
  const v = r.v, d = { '신청자 이메일': v.email, '사업팀': v.team, '담당 PM 이름': v.pm, '신청 유형': v.type };
  if (v.demoItem) d['데모 신청 품목'] = v.demoItem;
  if (r.isNew) Object.assign(d, {
    '구분': v.kind.join(', '), '판매사': v.seller, '제조사': v.maker, '제품명': v.product, '진료과 카테고리': v.cat,
    '종류': v.ptype, '주요성분': v.ingredient, '키메세지': v.keyMsg, '서브메세지': v.subMsg, '진료과': v.depts.join(', '),
    '보험코드': v.insurance, '선택 첨부 사항': v.attach, '메인 데모 신청 여부': v.alsoDemo,
  });
  if (r.demo) Object.assign(d, {
    '데모 신청 알림 메일 받을 담당자': v.notifyName, '알림 받을 메일 주소': v.notifyEmail, '알림 담당자 연락처': v.notifyPhone,
    '알림 담당자 소속': v.notifyOrg, '핸드폰 번호 (선택)': v.mobile, '닥터빌 메인 노출 신청': v.main,
  });
  if (r.main) Object.assign(d, { '닥터빌 메인 데모 게시 시작일': v.mainStart, '닥터빌 메인 데모 게시 종료일': v.mainEnd });
  return d;
}

// 비밀번호 확인 — 같은 인스턴스에서 10분 동안 10회 실패하면 잠시 막음 (best-effort)
const fails = new Map();
function ipOf(req) { return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(); }
function checkPw(req, pw) {
  const ip = ipOf(req), now = Date.now();
  const f = (fails.get(ip) || []).filter((t) => now - t < 600000);
  if (f.length >= 10) return 'locked';
  const want = Buffer.from((process.env.BRANDZONE_ADMIN_PW_SHA256 || DEFAULT_PW_SHA256).toLowerCase(), 'hex');
  const got = crypto.createHash('sha256').update(String(pw ?? ''), 'utf8').digest();
  const ok = want.length === got.length && crypto.timingSafeEqual(want, got);
  if (!ok) { f.push(now); fails.set(ip, f); }
  else fails.delete(ip);
  return ok ? 'ok' : 'bad';
}

export default async (req, res) => {
  if (cors(req, res)) return;
  const out = (body, status = 200) => res.status(status).json(body);
  try {
    const b = await readBody(req);
    const action = s(b.action, 20);

    if (action === 'submit') {
      if (s(b.website)) return out({ ok: true });  // 스팸 방지용 숨은 칸이 채워지면 저장하지 않음
      const r = validate(b.form || {});
      if (r.errors.length) return out({ ok: false, error: '입력값을 확인해 주세요: ' + r.errors.join(', '), fields: r.errors }, 400);
      const v = r.v;
      const row = {
        applicant_email: v.email, team: v.team, pm_name: v.pm, apply_type: v.type,
        product: r.isNew ? v.product : v.demoItem, demo: r.demo, main_expose: r.main,
        main_start: r.main ? v.mainStart : null, main_end: r.main ? v.mainEnd : null, data: toData(r),
      };
      const files = Math.min(Math.max(parseInt(b.files, 10) || 0, 0), MAX_FILES);
      if (files && r.isNew) row.upload_token = crypto.randomBytes(24).toString('base64url');
      const d = await adminGql('mutation($o:brandzone_applications_insert_input!){r:insert_brandzone_applications_one(object:$o){id created_at}}', { o: row });
      return out({ ok: true, id: d.r.id, created_at: d.r.created_at, uploadToken: row.upload_token || null });
    }

    if (action === 'check' || action === 'attach') {
      const id = s(b.id, 40), token = s(b.token, 64);
      if (!/^[0-9a-f-]{36}$/i.test(id) || token.length < 20) return out({ ok: false, error: '업로드 정보가 올바르지 않습니다.' }, 400);
      const d = await adminGql('query($id:uuid!){r:brandzone_applications_by_pk(id:$id){id created_at product team upload_token files folder_url}}', { id });
      const row = d.r;
      if (!row || !row.upload_token || !safeEq(row.upload_token, token)) return out({ ok: false, error: '업로드 권한이 없습니다.' }, 403);
      if (Date.now() - new Date(row.created_at).getTime() > TOKEN_TTL) return out({ ok: false, error: '업로드 가능 시간(접수 후 1시간)이 지났습니다.' }, 403);
      if ((row.files || []).length >= MAX_FILES) return out({ ok: false, error: '첨부 파일은 최대 ' + MAX_FILES + '개입니다.' }, 400);
      if (action === 'check') return out({ ok: true, id: row.id, created_at: row.created_at, product: row.product, team: row.team, folder_url: row.folder_url });
      const f = b.file || {};
      const file = { field: s(f.field, 40), name: s(f.name, 200), size: Number(f.size) || 0, mime: s(f.mime, 100), id: s(f.id, 100), url: s(f.url, 300) };
      if (!FILE_FIELDS.includes(file.field) || !/^https:\/\/drive\.google\.com\//.test(file.url)) return out({ ok: false, error: '파일 정보가 올바르지 않습니다.' }, 400);
      const folder = s(b.folderUrl, 300);
      await adminGql('mutation($id:uuid!,$f:jsonb,$u:String){r:update_brandzone_applications_by_pk(pk_columns:{id:$id},_append:{files:$f},_set:{folder_url:$u}){id}}',
        { id, f: [file], u: /^https:\/\/drive\.google\.com\//.test(folder) ? folder : row.folder_url });
      return out({ ok: true });
    }

    if (action === 'list') {
      const c = checkPw(req, b.password);
      if (c === 'locked') return out({ ok: false, error: '비밀번호를 여러 번 틀렸습니다. 10분 뒤 다시 시도해 주세요.' }, 429);
      if (c !== 'ok') return out({ ok: false, error: '비밀번호가 맞지 않습니다.' }, 401);
      const d = await adminGql('query{r:brandzone_applications(order_by:{created_at:desc},limit:2000){id created_at applicant_email team pm_name apply_type product demo main_expose main_start main_end data files folder_url}}', {});
      return out({ ok: true, rows: d.r });
    }

    return out({ ok: false, error: '알 수 없는 요청입니다.' }, 400);
  } catch (e) {
    return out({ ok: false, error: '서버 오류: ' + String(e && e.message || e) }, 500);
  }
};
