-- Paid-order provisioning and a durable transactional-email queue.
begin;
create table if not exists public.shopify_survey_emails (
  id uuid primary key default gen_random_uuid(),
  shopify_shop_domain text not null,
  shopify_order_id text not null,
  first_webhook_id text not null unique,
  order_reference text not null,
  customer_email text,
  message jsonb not null,
  test_order boolean not null default false,
  status text not null check(status in ('pending','sending','sent','needs_review')),
  attempts integer not null default 0,
  error_code text,
  provider_email_id text,
  claim_token uuid,
  locked_until timestamptz,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(shopify_shop_domain,shopify_order_id)
);
create index if not exists shopify_survey_emails_pending on public.shopify_survey_emails(next_attempt_at) where status in ('pending','sending');
alter table public.shopify_survey_emails enable row level security;
revoke all on public.shopify_survey_emails from anon,authenticated;
grant all on public.shopify_survey_emails to service_role;

create or replace function public.provision_life_letters_paid_order(
  p_shop text,p_order_id text,p_event_id text,p_order_reference text,p_email text,p_name text,
  p_test_order boolean,p_surveys jsonb,p_sets jsonb,p_issue text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare existing public.shopify_survey_emails%rowtype; job uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_shop||':'||p_order_id,0));
  select * into existing from public.shopify_survey_emails where shopify_shop_domain=p_shop and shopify_order_id=p_order_id;
  if found then return jsonb_build_object('duplicate',true,'jobId',existing.id); end if;
  if p_issue is null then
    if p_email is null or jsonb_typeof(p_surveys)<>'array' or jsonb_array_length(p_surveys) not between 1 and 20 or
      jsonb_typeof(p_sets)<>'array' or jsonb_array_length(p_sets)<>jsonb_array_length(p_surveys) then
      raise exception 'invalid_provisioning_data' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_surveys) s where s->>'shopify_shop_domain'<>p_shop or
      s->>'shopify_order_id'<>p_order_id or s->>'customer_email'<>p_email) then
      raise exception 'order_identity_mismatch' using errcode='22023';
    end if;
    insert into public.surveys(id,provisioning_key,customer_email,customer_name,order_reference,set_label,unit_index,
      shopify_shop_domain,shopify_order_id,shopify_line_item_id,access_token_hash,expires_at,draft)
    select s.id,s.provisioning_key,s.customer_email,s.customer_name,s.order_reference,s.set_label,s.unit_index,
      s.shopify_shop_domain,s.shopify_order_id,s.shopify_line_item_id,s.access_token_hash,s.expires_at,s.draft
    from jsonb_to_recordset(p_surveys) as s(id uuid,provisioning_key text,customer_email text,customer_name text,
      order_reference text,set_label text,unit_index integer,shopify_shop_domain text,shopify_order_id text,
      shopify_line_item_id text,access_token_hash text,expires_at timestamptz,draft jsonb);
  elsif p_issue not in ('customer_email_missing','set_quantity_needs_review') then
    raise exception 'invalid_order_issue' using errcode='22023';
  end if;
  insert into public.shopify_survey_emails(shopify_shop_domain,shopify_order_id,first_webhook_id,order_reference,
    customer_email,message,test_order,status,error_code)
  values(p_shop,p_order_id,p_event_id,p_order_reference,p_email,
    jsonb_build_object('customerName',p_name,'sets',case when p_issue is null then p_sets else '[]'::jsonb end),
    p_test_order,case when p_issue is null then 'pending' else 'needs_review' end,p_issue) returning id into job;
  return jsonb_build_object('duplicate',false,'jobId',job);
end $$;
revoke all on function public.provision_life_letters_paid_order(text,text,text,text,text,text,boolean,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.provision_life_letters_paid_order(text,text,text,text,text,text,boolean,jsonb,jsonb,text) to service_role;

create or replace function public.claim_life_letters_survey_emails()
returns setof public.shopify_survey_emails language plpgsql security invoker set search_path=public as $$
begin
  -- Resend's duplicate-send protection lasts 24h. Stop ambiguous retries early
  -- enough to leave a safety margin; an administrator must review older jobs.
  update public.shopify_survey_emails set status='needs_review',error_code=case when attempts>=8 then 'email_attempts_exhausted' else 'delivery_confirmation_needs_review' end,claim_token=null,locked_until=null
  where status in ('pending','sending') and (first_attempt_at<now()-interval '20 hours' or attempts>=8)
    and (locked_until is null or locked_until<now());
  return query
  with due as (
    select id from public.shopify_survey_emails
    where (status='pending' or (status='sending' and locked_until<now())) and next_attempt_at<=now()
      and attempts<8 and (first_attempt_at is null or first_attempt_at>=now()-interval '20 hours')
    order by created_at for update skip locked limit 2
  )
  update public.shopify_survey_emails j set status='sending',claim_token=gen_random_uuid(),locked_until=now()+interval '5 minutes',
    attempts=j.attempts+1,first_attempt_at=coalesce(j.first_attempt_at,now())
  from due where j.id=due.id returning j.*;
end $$;
revoke all on function public.claim_life_letters_survey_emails() from public,anon,authenticated;
grant execute on function public.claim_life_letters_survey_emails() to service_role;

create or replace function public.finish_life_letters_survey_email(
  p_job_id uuid,p_claim_token uuid,p_provider_id text,p_error_code text,p_permanent boolean
) returns boolean language plpgsql security invoker set search_path=public as $$
declare changed integer;
begin
  update public.shopify_survey_emails set
    status=case when p_provider_id is not null then 'sent' when p_permanent or attempts>=8 then 'needs_review' else 'pending' end,
    provider_email_id=p_provider_id,error_code=case when p_provider_id is not null then null else p_error_code end,
    sent_at=case when p_provider_id is not null then now() else null end,claim_token=null,locked_until=null,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts))::integer)
  where id=p_job_id and claim_token=p_claim_token and status='sending';
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.finish_life_letters_survey_email(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.finish_life_letters_survey_email(uuid,uuid,text,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
