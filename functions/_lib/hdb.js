// Hasura GraphQL 위에서 supabase-js 의 .from() 사용법(대시보드에서 쓰는 범위)만 흉내 내는 얇은 계층
//   makeHdb(exec) — exec(query, variables) → Promise<data> (오류면 Error throw)
//   사용: db.from('t').select('a,b').eq('k', v).order('c', { ascending: false }).limit(10).maybeSingle()
//         db.from('t').insert(obj|arr).select() · update(obj).eq() · upsert(obj|arr, { onConflict }) · delete().eq()/like()
//   결과: { data, error, count } — supabase-js 처럼 reject 하지 않고 error 에 { message } 를 담음
export function makeHdb(exec) {
  var T = {
    profiles: { c: 'id email name org role active created_at created_by updated_at updated_by', u: { id: 'profiles_pkey', email: 'profiles_email_key' } },
    datasets: { c: 'key scope data source fetched_at updated_at updated_by', u: { key: 'datasets_pkey' } },
    conferences: { c: 'id date end_date name host_type host start_time end_time place scale pm note created_by created_at updated_by updated_at', u: { id: 'conferences_pkey' } },
    app_secrets: { c: 'key value scope updated_at updated_by', u: { key: 'app_secrets_pkey' } },
    seminar_entries: { c: 'id kind sheet_key sheet_month date time fields created_by created_at updated_by updated_at', u: { id: 'seminar_entries_pkey', sheet_key: 'seminar_entries_sheet_key_key' } },
    ad_entries: { c: 'id year month settle_year settle_month pos slot gu company content dw contact doc_no start_date end_date amount status note issue created_by created_at updated_by updated_at', u: { id: 'ad_entries_pkey' } },
    view_grants: { c: 'user_id view granted_by granted_at', u: { 'user_id,view': 'view_grants_pkey' } }
  };
  var OPS = { eq: '_eq', neq: '_neq', gt: '_gt', gte: '_gte', lt: '_lt', lte: '_lte', like: '_like', ilike: '_ilike' };
  function splitTop(s) {   // 'a,and(b,c),d' → ['a','and(b,c)','d']
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  function parseCond(s) {   // PostgREST or()/and() 문법 일부
    var m = /^(and|or)\((.*)\)$/.exec(s);
    if (m) { var o = {}; o['_' + m[1]] = splitTop(m[2]).map(parseCond); return o; }
    var a = s.indexOf('.'), b = s.indexOf('.', a + 1);
    if (a < 0 || b < 0) throw new Error('조건 해석 실패: ' + s);
    var col = s.slice(0, a), op = s.slice(a + 1, b), val = s.slice(b + 1);
    if (!OPS[op]) throw new Error('지원하지 않는 조건: ' + op);
    var c = {}; c[col] = {}; c[col][OPS[op]] = val; return c;
  }
  function cols(t, sel) {
    var all = T[t].c;
    if (!sel || sel === '*') return all;
    return sel.split(',').map(function (x) { return x.trim(); }).filter(Boolean).join(' ');
  }
  function Q(t) {
    this.t = t; this.op = 'select'; this.w = []; this.ord = []; this.lim = null; this.sel = null; this.ret = false; this.one = null; this.cnt = null;
  }
  Q.prototype.select = function (s, o) {
    if (this.op === 'select') { this.sel = s || '*'; if (o && o.count) { this.cnt = true; this.head = !!o.head; } }
    else { this.ret = true; this.sel = s || '*'; }
    return this;
  };
  Q.prototype.insert = function (v) { this.op = 'insert'; this.val = Array.isArray(v) ? v : [v]; return this; };
  Q.prototype.upsert = function (v, o) { this.op = 'upsert'; this.val = Array.isArray(v) ? v : [v]; this.conf = o && o.onConflict; return this; };
  Q.prototype.update = function (v) { this.op = 'update'; this.val = v; return this; };
  Q.prototype['delete'] = function () { this.op = 'delete'; return this; };
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'].forEach(function (k) {
    Q.prototype[k] = function (col, v) { var c = {}; c[col] = {}; c[col][OPS[k]] = v; this.w.push(c); return this; };
  });
  Q.prototype.or = function (s) { this.w.push({ _or: splitTop(s).map(parseCond) }); return this; };
  Q.prototype.order = function (col, o) { var x = {}; x[col] = o && o.ascending === false ? 'desc' : 'asc'; this.ord.push(x); return this; };
  Q.prototype.limit = function (n) { this.lim = n; return this; };
  Q.prototype.single = function () { this.one = 'single'; return this; };
  Q.prototype.maybeSingle = function () { this.one = 'maybe'; return this; };
  Q.prototype.where = function () { return this.w.length ? { _and: this.w } : {}; };
  Q.prototype.run = function () {
    var t = this.t, self = this, q, v = {}, pick;
    if (!T[t]) throw new Error('알 수 없는 표: ' + t);
    if (this.op === 'select') {
      if (this.cnt) {
        q = 'query($w:' + t + '_bool_exp){a:' + t + '_aggregate(where:$w){aggregate{count}}' + (this.head ? '' : ' r:' + t + '(where:$w){' + cols(t, this.sel) + '}') + '}';
        v.w = this.where();
        return exec(q, v).then(function (d) { return { data: self.head ? null : d.r, count: d.a.aggregate.count }; });
      }
      q = 'query($w:' + t + '_bool_exp,$o:[' + t + '_order_by!],$l:Int){r:' + t + '(where:$w,order_by:$o,limit:$l){' + cols(t, this.sel) + '}}';
      v = { w: this.where(), o: this.ord, l: this.one ? 2 : this.lim };
      pick = function (d) { return d.r; };
    } else if (this.op === 'insert' || this.op === 'upsert') {
      var ret = this.ret ? 'returning{' + cols(t, this.sel) + '}' : 'affected_rows';
      v.v = this.val;
      if (this.op === 'upsert') {
        var u = T[t].u, ck = this.conf ? this.conf.replace(/\s/g, '') : Object.keys(u)[0], keys = {};
        if (!u[ck]) throw new Error('충돌 기준 열을 찾지 못했습니다: ' + ck);
        this.val.forEach(function (r) { Object.keys(r).forEach(function (k) { keys[k] = 1; }); });
        v.c = { constraint: u[ck], update_columns: Object.keys(keys) };
        q = 'mutation($v:[' + t + '_insert_input!]!,$c:' + t + '_on_conflict){r:insert_' + t + '(objects:$v,on_conflict:$c){' + ret + '}}';
      } else q = 'mutation($v:[' + t + '_insert_input!]!){r:insert_' + t + '(objects:$v){' + ret + '}}';
      pick = function (d) { return self.ret ? d.r.returning : null; };
    } else if (this.op === 'update') {
      q = 'mutation($w:' + t + '_bool_exp!,$s:' + t + '_set_input){r:update_' + t + '(where:$w,_set:$s){' + (this.ret ? 'returning{' + cols(t, this.sel) + '}' : 'affected_rows') + '}}';
      v = { w: this.where(), s: this.val };
      pick = function (d) { return self.ret ? d.r.returning : null; };
    } else {
      q = 'mutation($w:' + t + '_bool_exp!){r:delete_' + t + '(where:$w){affected_rows}}';
      v = { w: this.where() };
      pick = function () { return null; };
    }
    return exec(q, v).then(function (d) {
      var data = pick(d);
      if (self.one) {
        var rows = data || [];
        if (self.one === 'single' && rows.length !== 1) throw new Error(rows.length ? '결과가 여러 행입니다.' : '결과가 없습니다.');
        data = rows[0] || null;
      }
      return { data: data };
    });
  };
  Q.prototype.then = function (ok, bad) {
    var p;
    try { p = this.run(); } catch (e) { p = Promise.reject(e); }
    return p.then(function (r) { return { data: r.data, error: null, count: r.count == null ? null : r.count }; },
      function (e) { return { data: null, error: { message: String(e && e.message || e) }, count: null }; }).then(ok, bad);
  };
  Q.prototype['catch'] = function (bad) { return this.then(null, bad); };
  return { from: function (t) { return new Q(t); }, tables: T };
}
