-- Additive migration: preserves existing orders, photos, and public legacy buckets.
begin;
create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  provisioning_key text not null unique,
  customer_email text not null,
  customer_name text not null default '',
  order_reference text not null,
  set_label text not null,
  unit_index integer not null check (unit_index > 0),
  shopify_shop_domain text,
  shopify_order_id text,
  shopify_line_item_id text,
  access_token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  status text not null default 'draft' check (status in ('draft','submitted')),
  revision integer not null default 0,
  draft jsonb not null default '{"letters":{}}',
  submitted_order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shopify_shop_domain, shopify_order_id, shopify_line_item_id, unit_index)
);
create table if not exists public.survey_photos (
  id uuid primary key,
  survey_id uuid not null references public.surveys(id) on delete cascade,
  letter text not null check (letter ~ '^[A-Z]$'),
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg','image/png')),
  created_at timestamptz not null default now()
);
create index if not exists survey_photos_survey_id on public.survey_photos(survey_id);
alter table public.surveys enable row level security;
alter table public.survey_photos enable row level security;
revoke all on public.surveys, public.survey_photos from anon, authenticated;
grant all on public.surveys, public.survey_photos to service_role;
alter table public.orders add column if not exists survey_id uuid references public.surveys(id);
alter table public.orders add column if not exists survey_revision integer;
create unique index if not exists orders_survey_id on public.orders(survey_id) where survey_id is not null;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('survey-photos','survey-photos',false,10485760,array['image/jpeg','image/png']),
       ('survey-pdfs','survey-pdfs',false,52428800,array['application/pdf'])
on conflict(id) do update set public=false;

-- The backend validates phonics first; this transaction prevents stale/duplicate submissions.
create or replace function public.submit_life_letters_survey(
  p_survey_id uuid, p_revision integer, p_token_hash text, p_entries jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare s public.surveys%rowtype; o public.orders%rowtype;
begin
  select * into s from public.surveys where id=p_survey_id for update;
  if not found or s.access_token_hash<>p_token_hash or s.revoked_at is not null or s.expires_at<=now() then
    raise exception 'survey_access_denied' using errcode='42501';
  end if;
  if s.status='submitted' then
    select * into o from public.orders where id=s.submitted_order_id;
    return jsonb_build_object('orderId',o.id,'orderNumber',o.order_number,'alreadySubmitted',true);
  end if;
  if s.revision<>p_revision then raise exception 'survey_revision_conflict' using errcode='40001'; end if;
  if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<>26 or
    (select count(distinct x->>'letter') from jsonb_array_elements(p_entries) x where (x->>'letter')~'^[A-Z]$')<>26 then
    raise exception 'invalid_letters' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_entries) x where
      coalesce((x->>'is_default')::boolean,false)=false and not exists
      (select 1 from public.survey_photos p where p.survey_id=s.id and p.letter=x->>'letter' and p.storage_path=x->>'photo_storage_path')) then
    raise exception 'invalid_photo_owner' using errcode='22023';
  end if;
  if s.submitted_order_id is not null then
    select * into o from public.orders where id=s.submitted_order_id for update;
    if o.status<>'submitted' then raise exception 'fulfillment_started' using errcode='22023'; end if;
    delete from public.letter_entries where order_id=o.id;
    update public.orders set customer_name=coalesce(nullif(s.draft->>'customerName',''),s.customer_name),
      pdf_url=null, survey_revision=s.revision, updated_at=now() where id=o.id returning * into o;
  else
    insert into public.orders(order_number,customer_email,customer_name,letter_style,status,survey_id,survey_revision)
    values ('LL-'||s.id::text,s.customer_email,coalesce(nullif(s.draft->>'customerName',''),s.customer_name),'lower','submitted',s.id,s.revision)
    returning * into o;
  end if;
  insert into public.letter_entries(order_id,letter,word,is_default,photo_url,photo_storage_path,validation_status)
  select o.id,x.letter,x.word,x.is_default,x.photo_url,x.photo_storage_path,x.validation_status
  from jsonb_to_recordset(p_entries) as x(letter text,word text,is_default boolean,photo_url text,photo_storage_path text,validation_status text);
  update public.surveys set status='submitted',submitted_order_id=o.id,revision=revision+1,updated_at=now() where id=s.id;
  return jsonb_build_object('orderId',o.id,'orderNumber',o.order_number,'alreadySubmitted',false);
end $$;
revoke all on function public.submit_life_letters_survey(uuid,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.submit_life_letters_survey(uuid,integer,text,jsonb) to service_role;

create or replace function public.reopen_life_letters_survey(p_survey_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s public.surveys%rowtype; o public.orders%rowtype;
begin
  select * into s from public.surveys where id=p_survey_id for update;
  if not found then raise exception 'survey_not_found' using errcode='22023'; end if;
  if s.status='draft' then return jsonb_build_object('alreadyOpen',true); end if;
  select * into o from public.orders where id=s.submitted_order_id for update;
  if o.status<>'submitted' then raise exception 'fulfillment_started' using errcode='22023'; end if;
  update public.surveys set status='draft',revision=revision+1,updated_at=now() where id=s.id;
  update public.orders set pdf_url=null,survey_revision=null,updated_at=now() where id=o.id;
  return jsonb_build_object('alreadyOpen',false);
end $$;
revoke all on function public.reopen_life_letters_survey(uuid) from public,anon,authenticated;
grant execute on function public.reopen_life_letters_survey(uuid) to service_role;

create or replace function public.set_life_letters_order_status(p_order_id uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare survey uuid; s public.surveys%rowtype; o public.orders%rowtype;
begin
  if p_status not in ('submitted','in_progress','printed','shipped') then raise exception 'invalid_status' using errcode='22023'; end if;
  select survey_id into survey from public.orders where id=p_order_id;
  select * into s from public.surveys where id=survey for update;
  if not found or s.status<>'submitted' then raise exception 'survey_not_submitted' using errcode='22023'; end if;
  select * into o from public.orders where id=p_order_id for update;
  update public.orders set status=p_status,updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o);
end $$;
revoke all on function public.set_life_letters_order_status(uuid,text) from public,anon,authenticated;
grant execute on function public.set_life_letters_order_status(uuid,text) to service_role;
commit;
