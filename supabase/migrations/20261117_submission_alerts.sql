-- Queue one staff alert per submitted revision, in the submission transaction.
-- No historical surveys are backfilled or emailed by this migration.
begin;
create table if not exists public.survey_submission_alerts (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id),
  order_id uuid not null references public.orders(id),
  survey_revision integer not null,
  order_reference text not null,
  set_label text not null,
  recipient_email text,
  status text not null default 'pending' check(status in ('pending','sending','sent','needs_review','cancelled')),
  attempts integer not null default 0,
  error_code text,
  provider_email_id text,
  claim_token uuid,
  locked_until timestamptz,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(survey_id,survey_revision)
);
create index if not exists survey_submission_alerts_due on public.survey_submission_alerts(next_attempt_at) where status in ('pending','sending');
alter table public.survey_submission_alerts enable row level security;
revoke all on public.survey_submission_alerts from anon,authenticated;
grant all on public.survey_submission_alerts to service_role;

create or replace function public.queue_life_letters_submission_alert()
returns trigger language plpgsql security invoker set search_path=public as $$
declare submitted_revision integer;
begin
  if new.status='submitted' and old.status='draft' then
    select survey_revision into submitted_revision from public.orders where id=new.submitted_order_id and survey_id=new.id;
    if submitted_revision is null then raise exception 'submission_revision_missing' using errcode='22023'; end if;
    insert into public.survey_submission_alerts(survey_id,order_id,survey_revision,order_reference,set_label)
    values(new.id,new.submitted_order_id,submitted_revision,new.order_reference,new.set_label)
    on conflict(survey_id,survey_revision) do nothing;
  elsif new.status='draft' and old.status='submitted' then
    update public.survey_submission_alerts set status='cancelled',error_code='survey_reopened',claim_token=null,locked_until=null
    where survey_id=new.id and status in ('pending','sending');
  end if;
  return new;
end $$;
revoke all on function public.queue_life_letters_submission_alert() from public,anon,authenticated;
grant execute on function public.queue_life_letters_submission_alert() to service_role;
drop trigger if exists life_letters_submission_alert on public.surveys;
create trigger life_letters_submission_alert after update of status on public.surveys
for each row when (old.status is distinct from new.status) execute function public.queue_life_letters_submission_alert();

create or replace function public.claim_life_letters_submission_alerts(p_recipient text)
returns setof public.survey_submission_alerts language plpgsql security invoker set search_path=public as $$
begin
  if p_recipient is null or length(p_recipient)>254 or p_recipient!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_notification_recipient' using errcode='22023';
  end if;
  update public.survey_submission_alerts j set status='cancelled',error_code='survey_revision_changed',claim_token=null,locked_until=null
  where j.status in ('pending','sending') and not exists(
    select 1 from public.surveys s join public.orders o on o.id=j.order_id
    where s.id=j.survey_id and s.status='submitted' and s.submitted_order_id=o.id
      and o.survey_revision=j.survey_revision and o.status='submitted');
  update public.survey_submission_alerts set status='needs_review',
    error_code=case when attempts>=8 then 'notification_attempts_exhausted' else 'notification_confirmation_needs_review' end,
    claim_token=null,locked_until=null
  where status in ('pending','sending') and (first_attempt_at<now()-interval '20 hours' or attempts>=8)
    and (locked_until is null or locked_until<now());
  return query with due as (
    select id from public.survey_submission_alerts
    where (status='pending' or (status='sending' and locked_until<now())) and next_attempt_at<=now()
      and attempts<8 and (first_attempt_at is null or first_attempt_at>=now()-interval '20 hours')
    order by created_at for update skip locked limit 2
  ) update public.survey_submission_alerts j set status='sending',recipient_email=coalesce(j.recipient_email,p_recipient),
      claim_token=gen_random_uuid(),locked_until=now()+interval '5 minutes',attempts=j.attempts+1,
      first_attempt_at=coalesce(j.first_attempt_at,now())
    from due where j.id=due.id returning j.*;
end $$;
revoke all on function public.claim_life_letters_submission_alerts(text) from public,anon,authenticated;
grant execute on function public.claim_life_letters_submission_alerts(text) to service_role;

create or replace function public.finish_life_letters_submission_alert(
  p_job_id uuid,p_claim_token uuid,p_provider_id text,p_error_code text,p_permanent boolean
) returns boolean language plpgsql security invoker set search_path=public as $$
declare changed integer;
begin
  update public.survey_submission_alerts set
    status=case when p_provider_id is not null then 'sent' when p_permanent or attempts>=8 then 'needs_review' else 'pending' end,
    provider_email_id=p_provider_id,error_code=case when p_provider_id is not null then null else p_error_code end,
    sent_at=case when p_provider_id is not null then now() else null end,claim_token=null,locked_until=null,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts))::integer)
  where id=p_job_id and claim_token=p_claim_token and status='sending';
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.finish_life_letters_submission_alert(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_life_letters_submission_alert(uuid,uuid,text,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
