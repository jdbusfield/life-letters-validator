begin;
alter table public.surveys add column if not exists internal_test boolean not null default false;
create table if not exists public.pdf_jobs (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id),
 survey_id uuid not null references public.surveys(id),
 revision integer not null,
 state text not null default 'queued' check(state in ('queued','running','retry','ready','failed','superseded')),
 attempts integer not null default 0,
 claim_token uuid, locked_until timestamptz,
 retry_after timestamptz not null default now(), error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(order_id,revision)
);
alter table public.pdf_jobs enable row level security;
revoke all on public.pdf_jobs from anon,authenticated;
grant all on public.pdf_jobs to service_role;
create index if not exists pdf_jobs_pending on public.pdf_jobs(state,retry_after,created_at);

create or replace function public.queue_life_letters_pdf(p_order_id uuid,p_force boolean default false)
returns public.pdf_jobs language plpgsql security invoker set search_path=public as $$
declare sid uuid; s public.surveys%rowtype; o public.orders%rowtype; j public.pdf_jobs%rowtype;
begin
 select survey_id into sid from orders where id=p_order_id;
 select * into s from surveys where id=sid for update;
 select * into o from orders where id=p_order_id for update;
 if s.id is null or s.status<>'submitted' or o.survey_revision is null or s.personalization_purging_at is not null or s.personalization_deleted_at is not null then
   raise exception 'This set is not available for PDF preparation' using errcode='22023';
 end if;
 insert into pdf_jobs(order_id,survey_id,revision) values(o.id,s.id,o.survey_revision) on conflict(order_id,revision) do nothing;
 select * into j from pdf_jobs where order_id=o.id and revision=o.survey_revision for update;
 if p_force and j.state in ('ready','failed') and o.pdf_generation_token is null then
   update pdf_jobs set state='queued',attempts=0,error_code=null,completed_at=null,retry_after=now(),updated_at=now() where id=j.id returning * into j;
 end if;
 return j;
end $$;

-- Submission inserts its order and entries in one transaction. This trigger
-- makes the PDF job part of that same commit, before any HTTP response is sent.
create or replace function public.schedule_life_letters_pdf()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.survey_id is null then return new; end if;
 update pdf_jobs set state='superseded',updated_at=now() where order_id=new.id and revision is distinct from new.survey_revision and state in ('queued','retry');
 if new.survey_revision is not null then
   insert into pdf_jobs(order_id,survey_id,revision) values(new.id,new.survey_id,new.survey_revision) on conflict(order_id,revision) do nothing;
 end if;
 return new;
end $$;
create trigger life_letters_pdf_queue after insert or update of survey_revision on public.orders for each row execute function public.schedule_life_letters_pdf();

create or replace function public.claim_life_letters_pdf()
returns public.pdf_jobs language plpgsql security invoker set search_path=public as $$
declare candidate record; s public.surveys%rowtype; o public.orders%rowtype; j public.pdf_jobs%rowtype; token uuid;
begin
 for candidate in select id,survey_id,order_id from pdf_jobs where
   (state in ('queued','retry') and retry_after<=now()) or (state='running' and locked_until<now()) order by created_at limit 50
 loop
   select * into s from surveys where id=candidate.survey_id for update skip locked;
   if not found then continue; end if;
   select * into o from orders where id=candidate.order_id for update skip locked;
   if not found then continue; end if;
   select * into j from pdf_jobs where id=candidate.id for update skip locked;
   if not found or not ((j.state in ('queued','retry') and j.retry_after<=now()) or (j.state='running' and j.locked_until<now())) then continue; end if;
   -- Reclaim only this queue's expired lease. Never clear an unknown legacy lock.
   if j.state='running' and j.locked_until<now() and o.pdf_generation_token=j.claim_token then
     update orders set pdf_generation_token=null,pdf_generation_started_at=null where id=o.id;
     o.pdf_generation_token:=null;
   end if;
   if s.status<>'submitted' or o.survey_revision is distinct from j.revision or s.personalization_purging_at is not null or s.personalization_deleted_at is not null then
     update pdf_jobs set state='superseded',claim_token=null,locked_until=null,updated_at=now() where id=j.id;
     continue;
   end if;
   if o.pdf_generation_token is not null then continue; end if;
   if j.attempts>=4 then
     update pdf_jobs set state='failed',claim_token=null,locked_until=null,error_code='attempt_limit',updated_at=now() where id=j.id;
     continue;
   end if;
   token:=gen_random_uuid();
   update orders set pdf_generation_token=token,pdf_generation_started_at=now() where id=o.id;
   update pdf_jobs set state='running',attempts=attempts+1,claim_token=token,locked_until=now()+interval '15 minutes',error_code=null,updated_at=now()
     where id=j.id returning * into j;
   return j;
 end loop;
 return null;
end $$;

create or replace function public.heartbeat_life_letters_pdf(p_job_id uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update pdf_jobs set locked_until=now()+interval '15 minutes',updated_at=now()
 where id=p_job_id and state='running' and claim_token=p_token and locked_until>now();
 return found;
end $$;

-- Each attempt writes to its own private path. A stale worker can never
-- overwrite the winning file or publish after its lease has been replaced.
create or replace function public.finish_life_letters_pdf_job(p_job_id uuid,p_token uuid,p_path text default null,p_error_code text default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare candidate public.pdf_jobs%rowtype; j public.pdf_jobs%rowtype; s public.surveys%rowtype; o public.orders%rowtype; expected text;
begin
 select * into candidate from pdf_jobs where id=p_job_id;
 if not found then return false; end if;
 select * into s from surveys where id=candidate.survey_id for update;
 select * into o from orders where id=candidate.order_id for update;
 select * into j from pdf_jobs where id=p_job_id for update;
 if j.state<>'running' or j.claim_token is distinct from p_token or j.locked_until<=now() or o.pdf_generation_token is distinct from p_token then return false; end if;
 if s.status<>'submitted' or o.survey_revision is distinct from j.revision or s.personalization_purging_at is not null or s.personalization_deleted_at is not null then
   update pdf_jobs set state='superseded',claim_token=null,locked_until=null,updated_at=now() where id=j.id;
 elsif p_error_code is not null then
   update pdf_jobs set state=case when p_error_code='pdf_worker_stopping' then 'queued' when attempts>=4 then 'failed' else 'retry' end,
     attempts=case when p_error_code='pdf_worker_stopping' then greatest(attempts-1,0) else attempts end,
     retry_after=case when p_error_code='pdf_worker_stopping' then now() else now()+make_interval(secs=>least(300,30*(2^(attempts-1))::integer)) end,
     error_code=left(p_error_code,80),claim_token=null,locked_until=null,updated_at=now() where id=j.id;
 else
   expected:='surveys/'||j.survey_id::text||'/cards-'||j.revision::text||'/'||p_token::text||'.pdf';
   if p_path is distinct from expected or not exists(select 1 from storage.objects where bucket_id='survey-pdfs' and name=expected) then
     raise exception 'The private PDF attempt is missing or mismatched' using errcode='23514';
   end if;
   update orders set pdf_url='private:survey-pdfs/'||expected,updated_at=now() where id=o.id;
   update pdf_jobs set state='ready',claim_token=null,locked_until=null,error_code=null,completed_at=now(),updated_at=now() where id=j.id;
 end if;
 update orders set pdf_generation_token=null,pdf_generation_started_at=null where id=o.id and pdf_generation_token=p_token;
 return true;
end $$;

create or replace function public.guard_life_letters_survey_pdf()
returns trigger language plpgsql set search_path=public as $$
declare prefix text;
begin
 if new.survey_id is not null and new.pdf_url is not null then
   prefix:='private:survey-pdfs/surveys/'||new.survey_id::text||'/cards-'||new.survey_revision::text;
   if new.survey_revision is null or not (new.pdf_url=prefix||'.pdf' or
     (starts_with(new.pdf_url,prefix||'/') and substring(new.pdf_url from length(prefix)+2) ~ '^[a-f0-9-]{36}\.pdf$')) then
     raise exception 'Saved surveys require their current private card PDF; use the Life Letters survey admin.' using errcode='23514';
   end if;
 end if;
 return new;
end $$;

-- Existing successful decks stay ready. Missing decks become durable jobs.
insert into pdf_jobs(order_id,survey_id,revision,state,completed_at)
select o.id,o.survey_id,o.survey_revision,case when f.id is not null then 'ready' else 'queued' end,case when f.id is not null then now() else null end
from orders o join surveys s on s.id=o.survey_id
left join storage.objects f on f.bucket_id='survey-pdfs' and 'private:survey-pdfs/'||f.name=o.pdf_url
where s.status='submitted' and o.survey_revision is not null and s.personalization_deleted_at is null and s.personalization_purging_at is null
on conflict(order_id,revision) do nothing;

-- Internal load-test fixtures must never send submission emails.
create or replace function public.skip_internal_pdf_test_alerts()
returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from surveys where id=new.survey_id and internal_test) then return null; end if;
 return new;
end $$;
create trigger life_letters_internal_pdf_test_alert before insert on public.survey_submission_alerts
 for each row execute function public.skip_internal_pdf_test_alerts();

revoke all on function public.queue_life_letters_pdf(uuid,boolean),public.claim_life_letters_pdf(),public.heartbeat_life_letters_pdf(uuid,uuid),public.finish_life_letters_pdf_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.queue_life_letters_pdf(uuid,boolean),public.claim_life_letters_pdf(),public.heartbeat_life_letters_pdf(uuid,uuid),public.finish_life_letters_pdf_job(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
