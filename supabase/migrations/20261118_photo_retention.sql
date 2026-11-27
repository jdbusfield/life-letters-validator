begin;
alter table public.surveys add column if not exists photo_permission_at timestamptz;
alter table public.surveys add column if not exists photo_permission_version text;
alter table public.surveys add column if not exists personalization_purging_at timestamptz;
alter table public.surveys add column if not exists personalization_deleted_at timestamptz;
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists personalization_deleted_at timestamptz;
alter table public.orders add column if not exists pdf_generation_token uuid;
alter table public.orders add column if not exists pdf_generation_started_at timestamptz;

create table if not exists public.survey_retention (
  survey_id uuid primary key references public.surveys(id),
  order_id uuid not null unique references public.orders(id),
  shipped_at timestamptz not null,
  delete_after timestamptz not null,
  state text not null default 'scheduled' check(state in ('scheduled','deleting','app_deleted','complete')),
  hold boolean not null default false,
  hold_reason text,
  claim_token uuid,
  locked_until timestamptz,
  retry_after timestamptz not null default now(),
  attempts integer not null default 0,
  manifest jsonb not null default '[]',
  error_code text,
  app_deleted_at timestamptz,
  external_cleanup_at timestamptz,
  created_at timestamptz not null default now(),
  check(delete_after >= shipped_at + interval '90 days')
);
create table if not exists public.survey_retention_events (
  id bigint generated always as identity primary key,
  survey_id uuid not null references public.surveys(id),
  event text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.survey_retention_worker (
  id boolean primary key default true check(id),
  last_checked_at timestamptz,
  error_code text
);
alter table public.survey_retention enable row level security;
alter table public.survey_retention_events enable row level security;
alter table public.survey_retention_worker enable row level security;
revoke all on public.survey_retention,public.survey_retention_events,public.survey_retention_worker from anon,authenticated;
grant all on public.survey_retention,public.survey_retention_events,public.survey_retention_worker to service_role;
grant usage,select on sequence public.survey_retention_events_id_seq to service_role;
create index if not exists survey_retention_due on public.survey_retention(delete_after) where state in ('scheduled','deleting');

create or replace function public.stamp_life_letters_shipment()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.survey_id is not null and new.status='shipped' and new.shipped_at is null then
    new.shipped_at:=now();
  end if;
  return new;
end $$;
create or replace function public.schedule_life_letters_retention()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.survey_id is not null and new.status='shipped' and new.shipped_at is not null then
    insert into public.survey_retention(survey_id,order_id,shipped_at,delete_after)
      values(new.survey_id,new.id,new.shipped_at,new.shipped_at+interval '90 days') on conflict(survey_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists life_letters_shipped_at on public.orders;
create trigger life_letters_shipped_at before update of status on public.orders for each row execute function public.stamp_life_letters_shipment();
drop trigger if exists life_letters_retention_schedule on public.orders;
create trigger life_letters_retention_schedule after update of status on public.orders for each row execute function public.schedule_life_letters_retention();

-- PDF generation and erasure share locks in survey -> order -> job order.
-- An interrupted PDF lease needs operator review; it never silently expires into deletion.
create or replace function public.begin_life_letters_pdf(p_order_id uuid,p_revision integer)
returns uuid language plpgsql security invoker set search_path=public as $$
declare sid uuid; s public.surveys%rowtype; o public.orders%rowtype; token uuid:=gen_random_uuid();
begin
  select survey_id into sid from public.orders where id=p_order_id;
  select * into s from public.surveys where id=sid for update;
  if not found or s.status<>'submitted' or s.personalization_purging_at is not null or s.personalization_deleted_at is not null then return null; end if;
  select * into o from public.orders where id=p_order_id for update;
  if o.survey_revision is distinct from p_revision or o.pdf_generation_token is not null then return null; end if;
  update public.orders set pdf_generation_token=token,pdf_generation_started_at=now() where id=o.id;
  return token;
end $$;
create or replace function public.finish_life_letters_pdf(p_order_id uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update public.orders set pdf_generation_token=null,pdf_generation_started_at=null where id=p_order_id and pdf_generation_token=p_token;
  return found;
end $$;

create or replace function public.claim_life_letters_retention()
returns setof public.survey_retention language plpgsql security invoker set search_path=public as $$
declare candidate record; s public.surveys%rowtype; o public.orders%rowtype; j public.survey_retention%rowtype;
begin
  for candidate in select r.survey_id from public.survey_retention r join public.orders ord on ord.id=r.order_id where r.state in ('scheduled','deleting')
    and not r.hold and r.delete_after<=now() and r.retry_after<=now() and (r.locked_until is null or r.locked_until<now())
    and ord.status='shipped' and ord.pdf_generation_token is null order by r.delete_after limit 100
  loop
    select * into s from public.surveys where id=candidate.survey_id for update skip locked;
    if not found then continue; end if;
    select * into o from public.orders where id=s.submitted_order_id for update;
    if not found or o.status<>'shipped' or o.pdf_generation_token is not null then continue; end if;
    select * into j from public.survey_retention where survey_id=s.id for update skip locked;
    if not found then continue; end if;
    if j.order_id<>o.id or j.hold or j.state not in ('scheduled','deleting') or j.delete_after>now() or j.retry_after>now() or j.locked_until>now() then continue; end if;
    update public.surveys set personalization_purging_at=coalesce(personalization_purging_at,now()) where id=s.id;
    update public.survey_retention set state='deleting',claim_token=gen_random_uuid(),locked_until=now()+interval '15 minutes',attempts=attempts+1,
      manifest=coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)) from storage.objects
        where bucket_id in ('survey-photos','survey-pdfs') and starts_with(name,'surveys/'||s.id::text||'/')),'[]'::jsonb)
      where survey_id=s.id returning * into j;
    insert into public.survey_retention_events(survey_id,event) values(s.id,'deletion_claimed');
    return next j;
    return;
  end loop;
end $$;

create or replace function public.finish_life_letters_retention(p_survey_id uuid,p_claim_token uuid,p_error text default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare s public.surveys%rowtype; o public.orders%rowtype; j public.survey_retention%rowtype;
begin
  select * into s from public.surveys where id=p_survey_id for update;
  if not found then return false; end if;
  select * into o from public.orders where id=s.submitted_order_id for update;
  select * into j from public.survey_retention where survey_id=s.id for update;
  if not found or p_claim_token is null then return false; end if;
  if j.claim_token is distinct from p_claim_token or j.state<>'deleting' or j.locked_until is null or j.locked_until<now() then return false; end if;
  if p_error is null and exists(select 1 from storage.objects where bucket_id in ('survey-photos','survey-pdfs') and starts_with(name,'surveys/'||s.id::text||'/')) then p_error:='files_remain'; end if;
  if p_error is not null then
    update public.survey_retention set error_code=left(p_error,80),claim_token=null,locked_until=null,retry_after=now()+interval '1 hour' where survey_id=s.id;
    insert into public.survey_retention_events(survey_id,event) values(s.id,'deletion_retry_required');
    return false;
  end if;
  delete from public.letter_entries where order_id=o.id;
  delete from public.survey_photos where survey_id=s.id;
  update public.orders set child_name=null,card_color=null,pdf_url=null,personalization_deleted_at=now(),updated_at=now() where id=o.id;
  update public.surveys set draft='{"letters":{}}',customer_name='',set_label='Set '||unit_index::text,
    personalization_deleted_at=now(),revoked_at=now(),revision=revision+1,updated_at=now() where id=s.id;
  update public.survey_submission_alerts set set_label='Set '||s.unit_index::text where survey_id=s.id;
  update public.survey_retention set state='app_deleted',app_deleted_at=now(),manifest='[]',error_code=null,claim_token=null,locked_until=null where survey_id=s.id;
  insert into public.survey_retention_events(survey_id,event) values(s.id,'active_survey_files_deleted');
  return true;
end $$;

create or replace function public.set_life_letters_retention_hold(p_survey_id uuid,p_hold boolean,p_reason text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare s public.surveys%rowtype; j public.survey_retention%rowtype;
begin
  select * into s from public.surveys where id=p_survey_id for update;
  if not found then return false; end if;
  perform 1 from public.orders where id=s.submitted_order_id for update;
  select * into j from public.survey_retention where survey_id=s.id for update;
  if not found or j.state<>'scheduled' then return false; end if;
  if p_hold and p_reason not in ('Open order issue','Legal retention requirement') then return false; end if;
  update public.survey_retention set hold=p_hold,hold_reason=case when p_hold then p_reason else null end where survey_id=s.id;
  insert into public.survey_retention_events(survey_id,event) values(s.id,case when p_hold then 'retention_hold_added' else 'retention_hold_released' end);
  return true;
end $$;
create or replace function public.confirm_life_letters_external_cleanup(p_survey_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update public.survey_retention set state='complete',external_cleanup_at=now() where survey_id=p_survey_id and state='app_deleted';
  if not found then return false; end if;
  insert into public.survey_retention_events(survey_id,event) values(p_survey_id,'managed_external_copies_confirmed');
  return true;
end $$;
create or replace function public.record_life_letters_retention_check(p_error text default null)
returns void language plpgsql security invoker set search_path=public as $$
begin
  insert into public.survey_retention_worker(id,last_checked_at,error_code) values(true,now(),p_error)
    on conflict(id) do update set last_checked_at=excluded.last_checked_at,error_code=excluded.error_code;
end $$;
create or replace function public.life_letters_retention_overview()
returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object(
  'jobs',coalesce((select jsonb_agg(row_to_json(q)) from (select r.survey_id,s.order_reference,r.shipped_at,r.delete_after,r.state,r.hold,r.hold_reason,r.attempts,r.error_code,r.app_deleted_at,r.external_cleanup_at,o.pdf_generation_started_at
    from public.survey_retention r join public.surveys s on s.id=r.survey_id join public.orders o on o.id=r.order_id order by r.delete_after limit 100) q),'[]'::jsonb),
  'historicalShipmentsNeedingDate',(select count(*) from public.orders where survey_id is not null and status='shipped' and shipped_at is null),
  'legacyFilesForReview',(select count(*) from storage.objects where bucket_id in ('letter-photos','order-pdfs')),
  'legacyOrdersForReview',(select count(*) from public.orders where survey_id is null),
  'pdfLocksForReview',(select count(*) from public.orders o join public.survey_retention r on r.order_id=o.id where r.delete_after<=now() and o.pdf_generation_started_at<now()-interval '30 minutes'),
  'inactiveDraftsForReview',(select count(*) from public.surveys where status='draft' and updated_at<now()-interval '90 days' and personalization_deleted_at is null),
  'worker',(select row_to_json(w) from public.survey_retention_worker w where id=true)
 );
$$;

revoke all on function public.stamp_life_letters_shipment(),public.schedule_life_letters_retention(),public.begin_life_letters_pdf(uuid,integer),public.finish_life_letters_pdf(uuid,uuid),public.claim_life_letters_retention(),public.finish_life_letters_retention(uuid,uuid,text),public.set_life_letters_retention_hold(uuid,boolean,text),public.confirm_life_letters_external_cleanup(uuid),public.record_life_letters_retention_check(text),public.life_letters_retention_overview() from public,anon,authenticated;
grant execute on function public.begin_life_letters_pdf(uuid,integer),public.finish_life_letters_pdf(uuid,uuid),public.claim_life_letters_retention(),public.finish_life_letters_retention(uuid,uuid,text),public.set_life_letters_retention_hold(uuid,boolean,text),public.confirm_life_letters_external_cleanup(uuid),public.record_life_letters_retention_check(text),public.life_letters_retention_overview() to service_role;
notify pgrst,'reload schema';
commit;
