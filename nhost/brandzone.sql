-- 브랜드존 샘플/데모 신청 (docs/brandzone/) — Nhost(Postgres)
-- 실행: Nhost 대시보드 → Database → SQL Editor → 실행 후 "Track this" (Hasura)
-- 첨부: apps-script/brandzone_upload.gs (doctorville123 소유 웹 앱)이 드라이브에 저장 → 함수 'attach' 로 링크 기록
-- 권한: 별도 Hasura 권한을 주지 않습니다. 쓰기·읽기는 모두 서버 함수 functions/brandzone.js 가
--       admin secret 으로만 처리합니다 (신청 = 공개 접수, 목록 = 관리자 비밀번호 확인 후).

create table if not exists public.brandzone_applications (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  applicant_email text not null,           -- 신청자 이메일 (주관식 입력)
  team            text not null,           -- 사업팀
  pm_name         text not null,           -- 담당 PM 이름
  apply_type      text not null,           -- 신청 유형 (메인 데모 / 신규 품목 등록)
  product         text,                    -- 데모 신청 품목 또는 신규 등록 제품명
  demo            boolean not null default false,  -- 메인 데모 신청 포함 여부
  main_expose     boolean not null default false,  -- 닥터빌 메인 노출 신청 여부
  main_start      date,
  main_end        date,
  data            jsonb not null default '{}'::jsonb, -- 폼 전체 응답 (질문 제목 → 값)
  files           jsonb not null default '[]'::jsonb, -- 첨부 파일 [{field, name, size, url, id}] (구글 드라이브 doctorville123 「브랜드존신청」)
  folder_url      text,                                -- 신청 건별 드라이브 폴더
  upload_token    text                                 -- 첨부 업로드용 1회용 토큰 (접수 후 1시간 유효)
);

create index if not exists brandzone_applications_created_at_idx
  on public.brandzone_applications (created_at desc);
