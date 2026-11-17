/**
 * 브랜드존 샘플/데모 신청 — 첨부 파일 업로드 웹 앱 (단독 Apps Script 프로젝트)
 *
 * 소유·실행 계정: doctorville123@gmail.com
 * 저장 위치: 내 드라이브 / 브랜드존신청 / {YYYYMMDD}_{제품명}_{신청ID 앞 8자리} /
 *
 * 흐름: 신청 페이지(docs/brandzone) → Nhost 함수 brandzone 'submit' 으로 접수(1회용 토큰 받음)
 *       → 이 웹 앱에 파일 1개씩 전송 → 'check' 로 토큰 확인 → 드라이브 저장 → 'attach' 로 신청 건에 파일 링크 기록
 *
 * 배포: 새 Apps Script 프로젝트에 이 파일만 붙여넣기 → 배포 → 새 배포 → 웹 앱
 *       실행 사용자: 나(doctorville123) / 액세스: 모든 사용자 → 처음 한 번 권한 승인
 *       발급된 /exec 주소를 docs/data/config.json 의 brandzoneUploadUrl 에 넣음
 * 파일은 기본 비공개 (doctorville123 계정과 폴더를 공유받은 사람만 열람)
 */
var BZ_FN_URL = 'https://ofujfkotwuqgiqiiygpq.functions.ap-southeast-1.nhost.run/v1/brandzone';
var BZ_ROOT = '브랜드존신청';
var BZ_MAX_BYTES = 10 * 1024 * 1024;
var BZ_FIELDS = {
  '제품 이미지(고화질)': /^image\//,
  '제품 로고(고화질)': /^image\//,
  '외부 공유용 E브로셔': /^application\/pdf$/
};

function doGet() {
  return bzJson_({ ok: true, service: 'brandzone-upload' });
}

function doPost(e) {
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var id = String(b.id || ''), token = String(b.token || '');
    var field = String(b.field || ''), name = String(b.name || 'file').replace(/[\\\/:*?"<>|]/g, '_').slice(0, 150);
    var mime = String(b.mime || '');
    if (!BZ_FIELDS[field]) return bzJson_({ ok: false, error: '알 수 없는 첨부 항목입니다.' });
    if (!BZ_FIELDS[field].test(mime)) return bzJson_({ ok: false, error: field + ' 은(는) ' + (field.indexOf('E브로셔') >= 0 ? 'PDF' : '이미지') + ' 파일만 올릴 수 있습니다.' });
    var bytes = Utilities.base64Decode(String(b.b64 || ''));
    if (!bytes.length) return bzJson_({ ok: false, error: '빈 파일입니다.' });
    if (bytes.length > BZ_MAX_BYTES) return bzJson_({ ok: false, error: '파일당 10MB 이하만 올릴 수 있습니다.' });

    var chk = bzCall_({ action: 'check', id: id, token: token });
    if (!chk.ok) return bzJson_(chk);

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    var folder;
    try { folder = bzFolder_(chk); } finally { lock.releaseLock(); }

    var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
    file.setDescription('브랜드존 신청 ' + id + ' · ' + field);
    var info = { field: field, name: name, size: bytes.length, mime: mime, id: file.getId(), url: file.getUrl() };
    var att = bzCall_({ action: 'attach', id: id, token: token, file: info, folderUrl: folder.getUrl() });
    if (!att.ok) return bzJson_(att);
    return bzJson_({ ok: true, file: { field: field, name: name, size: bytes.length } });
  } catch (err) {
    return bzJson_({ ok: false, error: '업로드 오류: ' + (err && err.message || err) });
  }
}

function bzFolder_(chk) {
  var roots = DriveApp.getRootFolder().getFoldersByName(BZ_ROOT);
  var root = roots.hasNext() ? roots.next() : DriveApp.getRootFolder().createFolder(BZ_ROOT);
  var key = String(chk.id).slice(0, 8);
  var it = root.searchFolders('title contains "' + key + '"');
  if (it.hasNext()) return it.next();
  var day = Utilities.formatDate(new Date(chk.created_at), 'Asia/Seoul', 'yyyyMMdd');
  var prod = String(chk.product || '미기재').replace(/[\\\/:*?"<>|]/g, '_').slice(0, 40);
  return root.createFolder(day + '_' + prod + '_' + key);
}

function bzCall_(body) {
  var r = UrlFetchApp.fetch(BZ_FN_URL, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { Origin: 'https://doctorville.github.io' }, muteHttpExceptions: true
  });
  try { return JSON.parse(r.getContentText()); } catch (e) { return { ok: false, error: '서버 응답 오류 (' + r.getResponseCode() + ')' }; }
}

function bzJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** 편집기에서 한 번 실행하면 드라이브 권한 승인 + 「브랜드존신청」 폴더 생성 */
function bzSetup() {
  var roots = DriveApp.getRootFolder().getFoldersByName(BZ_ROOT);
  var root = roots.hasNext() ? roots.next() : DriveApp.getRootFolder().createFolder(BZ_ROOT);
  UrlFetchApp.fetch(BZ_FN_URL, { method: 'post', contentType: 'application/json', payload: '{}', muteHttpExceptions: true });
  Logger.log('폴더: ' + root.getUrl());
}
