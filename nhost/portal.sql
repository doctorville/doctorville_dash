-- 통합 업무 포털(doctorville.github.io/portal) 계정 테이블
-- Nhost 대시보드 → Database → SQL Editor 에서 실행 (Hasura Track 하지 않음: 서버 함수만 접근)
create schema if not exists portal;

create table if not exists portal.accounts (
  email       text primary key check (email = lower(btrim(email)) and email like '%@%'),
  name        text not null default '',
  org         text not null default '',
  role        text not null default 'member' check (role in ('admin', 'member')),
  active      boolean not null default true,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

revoke all on schema portal from public;
revoke all on all tables in schema portal from public;

-- 최초 관리자 1명 등록 (메일 주소를 바꿔서 실행)
-- insert into portal.accounts (email, name, role) values ('관리자@회사도메인', '이름', 'admin')
--   on conflict (email) do update set role = 'admin', active = true;
