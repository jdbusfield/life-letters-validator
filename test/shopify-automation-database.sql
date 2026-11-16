-- Real database integration checks. Every test record is rolled back.
begin;
do $$
declare shop text := 'life-letters-integration-test.myshopify.com';
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); response jsonb;
  surveys jsonb; sets jsonb; job public.shopify_survey_emails%rowtype; claimed public.shopify_survey_emails%rowtype;
  original_orders integer; original_surveys integer; original_jobs integer;
begin
  select count(*) into original_orders from public.orders;
  select count(*) into original_surveys from public.surveys;
  select count(*) into original_jobs from public.shopify_survey_emails;
  if not(select relrowsecurity from pg_class where oid='public.shopify_survey_emails'::regclass) then raise exception 'RLS missing'; end if;
  if has_table_privilege('anon','public.shopify_survey_emails','SELECT') or has_table_privilege('authenticated','public.shopify_survey_emails','SELECT') then raise exception 'Email queue exposed'; end if;
  if has_function_privilege('anon','public.claim_life_letters_survey_emails()','EXECUTE') or
    has_function_privilege('authenticated','public.provision_life_letters_paid_order(text,text,text,text,text,text,boolean,jsonb,jsonb,text)','EXECUTE') then raise exception 'Email RPC exposed'; end if;
  surveys:=jsonb_build_array(
    jsonb_build_object('id',a,'provisioning_key','integration-test:'||a,'customer_email','parent@example.com','customer_name','Test Parent',
      'order_reference','TEST-ROLLBACK-PAID','set_label','Set 1','unit_index',1,'shopify_shop_domain',shop,'shopify_order_id','991001',
      'shopify_line_item_id','992001','access_token_hash',repeat(replace(a::text,'-',''),2),'expires_at',now()+interval '180 days','draft','{"letters":{}}'::jsonb),
    jsonb_build_object('id',b,'provisioning_key','integration-test:'||b,'customer_email','parent@example.com','customer_name','Test Parent',
      'order_reference','TEST-ROLLBACK-PAID','set_label','Set 2','unit_index',2,'shopify_shop_domain',shop,'shopify_order_id','991001',
      'shopify_line_item_id','992001','access_token_hash',repeat(replace(b::text,'-',''),2),'expires_at',now()+interval '180 days','draft','{"letters":{}}'::jsonb));
  sets:=jsonb_build_array(jsonb_build_object('id',a,'label','Set 1','lineId','992001','unit',1),jsonb_build_object('id',b,'label','Set 2','lineId','992001','unit',2));
  response:=public.provision_life_letters_paid_order(shop,'991001',gen_random_uuid()::text,'TEST-ROLLBACK-PAID','parent@example.com','Test Parent',true,surveys,sets,null);
  if (response->>'duplicate')::boolean then raise exception 'Initial provisioning marked duplicate'; end if;
  if (select count(*) from public.surveys where shopify_shop_domain=shop and shopify_order_id='991001')<>2 then raise exception 'Expected two independent surveys'; end if;
  if (select count(*) from public.orders)<>original_orders then raise exception 'Production order created before customer submission'; end if;
  select * into job from public.shopify_survey_emails where id=(response->>'jobId')::uuid;
  if job.status<>'pending' or jsonb_array_length(job.message->'sets')<>2 then raise exception 'Email queue missing sets'; end if;
  response:=public.provision_life_letters_paid_order(shop,'991001',gen_random_uuid()::text,'TEST-ROLLBACK-PAID','parent@example.com','Test Parent',true,surveys,sets,null);
  if not(response->>'duplicate')::boolean or (select count(*) from public.surveys)<>original_surveys+2 or
    (select count(*) from public.shopify_survey_emails)<>original_jobs+1 then raise exception 'Duplicate webhook repeated work'; end if;

  -- Avoid claiming any real pending jobs while exercising the claim routine.
  update public.shopify_survey_emails set next_attempt_at=now()+interval '1 day' where id<>job.id;
  select * into claimed from public.claim_life_letters_survey_emails() where id=job.id;
  if claimed.status<>'sending' or claimed.attempts<>1 or claimed.claim_token is null then raise exception 'Job not claimed'; end if;
  if exists(select 1 from public.claim_life_letters_survey_emails() where id=job.id) then raise exception 'Active lease double claimed'; end if;
  if public.finish_life_letters_survey_email(job.id,gen_random_uuid(),'wrong-claim',null,false) then raise exception 'Stale worker changed job'; end if;
  if not public.finish_life_letters_survey_email(job.id,claimed.claim_token,null,'email_http_429',false) then raise exception 'Retry not persisted'; end if;
  if (select status from public.shopify_survey_emails where id=job.id)<>'pending' then raise exception 'Temporary failure discarded'; end if;
  update public.shopify_survey_emails set next_attempt_at=now() where id=job.id;
  select * into claimed from public.claim_life_letters_survey_emails() where id=job.id;
  if not public.finish_life_letters_survey_email(job.id,claimed.claim_token,'test-provider-id',null,false) then raise exception 'Accepted email not recorded'; end if;
  if (select status from public.shopify_survey_emails where id=job.id)<>'sent' then raise exception 'Sent state missing'; end if;
  update public.shopify_survey_emails set status='pending',first_attempt_at=now()-interval '21 hours',next_attempt_at=now() where id=job.id;
  perform public.claim_life_letters_survey_emails();
  if (select status from public.shopify_survey_emails where id=job.id)<>'needs_review' then raise exception 'Unconfirmed send retried beyond idempotency window'; end if;

  response:=public.provision_life_letters_paid_order(shop,'991002',gen_random_uuid()::text,'TEST-NO-EMAIL',null,'Test Parent',true,'[]'::jsonb,'[]'::jsonb,'customer_email_missing');
  if (select status from public.shopify_survey_emails where id=(response->>'jobId')::uuid)<>'needs_review' then raise exception 'Missing email hidden'; end if;
  if (select count(*) from public.surveys)<>original_surveys+2 then raise exception 'Invalid order created cards'; end if;
  raise notice 'PASS: paid-order deduplication, two-set provisioning, private queue, leases, retries, sent status, old-send cutoff, missing email. All test changes will roll back.';
end $$;
rollback;
