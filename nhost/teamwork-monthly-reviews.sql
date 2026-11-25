-- 팀워크 · 월 업무 정리(monthly_reviews) 저장소
-- 적용: Nhost 대시보드 > Database > SQL Editor(또는 Hasura Console > Data > SQL)에서 한 번 실행합니다. 여러 번 실행해도 안전합니다.
-- 권한: 본인 행은 조회·작성·수정, 관리자(admin)는 팀원 행 조회·AI 분석 저장. 브라우저 접근은 teamwork/db 함수가 teamwork_user 역할로 실행합니다.
create table if not exists teamwork.monthly_reviews(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references teamwork.members(id) on delete cascade,
 month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 ai_summary jsonb,
 ai_generated_at timestamptz,
 improvements jsonb not null default '[]'::jsonb check (jsonb_typeof(improvements)='array'),
 mission text not null default '' check (char_length(mission)<=3000),
 updated_at timestamptz not null default now(),
 updated_by uuid,
 unique(user_id,month)
);
create or replace function teamwork.monthly_review_uid() returns uuid language sql stable as $$ select nullif(current_setting('teamwork.user_id',true),'')::uuid $$;
create or replace function teamwork.monthly_review_is_admin() returns boolean language sql stable security definer set search_path=teamwork,public as $$
 select exists(select 1 from teamwork.members where id=teamwork.monthly_review_uid() and role='admin')
$$;
create or replace function teamwork.monthly_review_touch() returns trigger language plpgsql as $$
begin new.updated_at=now();new.updated_by=teamwork.monthly_review_uid();return new;end $$;
drop trigger if exists monthly_review_touch on teamwork.monthly_reviews;
create trigger monthly_review_touch before insert or update on teamwork.monthly_reviews for each row execute function teamwork.monthly_review_touch();
alter table teamwork.monthly_reviews enable row level security;
drop policy if exists monthly_reviews_select on teamwork.monthly_reviews;
drop policy if exists monthly_reviews_insert on teamwork.monthly_reviews;
drop policy if exists monthly_reviews_update on teamwork.monthly_reviews;
create policy monthly_reviews_select on teamwork.monthly_reviews for select using (user_id=teamwork.monthly_review_uid() or teamwork.monthly_review_is_admin());
create policy monthly_reviews_insert on teamwork.monthly_reviews for insert with check (user_id=teamwork.monthly_review_uid() or teamwork.monthly_review_is_admin());
create policy monthly_reviews_update on teamwork.monthly_reviews for update using (user_id=teamwork.monthly_review_uid() or teamwork.monthly_review_is_admin()) with check (user_id=teamwork.monthly_review_uid() or teamwork.monthly_review_is_admin());
grant select,insert,update on teamwork.monthly_reviews to teamwork_user;
grant execute on function teamwork.monthly_review_uid(),teamwork.monthly_review_is_admin() to teamwork_user;
