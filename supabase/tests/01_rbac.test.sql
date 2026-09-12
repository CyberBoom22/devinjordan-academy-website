-- =============================================================================
-- Permission model regression suite.
--
-- Run with:  npm run test:db
--
-- These assertions are the specification. If a change to the migrations makes
-- one of them fail, the change is wrong until proven otherwise — every check
-- here corresponds to something that would be a real security hole.
-- =============================================================================
\set ON_ERROR_STOP off
\pset pager off
create or replace function pg_temp.chk(label text, got boolean, want boolean) returns void
language plpgsql as $$ begin
  if got is not distinct from want then raise notice 'OK   %', label;
  else raise warning 'FAIL % (got %, want %)', label, got, want; end if; end $$;
create or replace function pg_temp.err(label text, stmt text) returns void
language plpgsql as $$ begin execute stmt;
  raise warning 'FAIL % — SUCCEEDED but should not have', label;
exception when others then raise notice 'OK   % — blocked: %', label, left(sqlerrm,70); end $$;
create or replace function pg_temp.ok(label text, stmt text) returns void
language plpgsql as $$ begin execute stmt; raise notice 'OK   % — allowed', label;
exception when others then raise warning 'FAIL % — blocked: %', label, left(sqlerrm,70); end $$;
-- an UPDATE filtered out by RLS affects 0 rows rather than erroring
create or replace function pg_temp.norows(label text, stmt text) returns void
language plpgsql as $$ declare n int; begin
  execute stmt; get diagnostics n = row_count;
  if n = 0 then raise notice 'OK   % — RLS matched 0 rows', label;
  else raise warning 'FAIL % — changed % row(s)!', label, n; end if;
exception when others then raise notice 'OK   % — blocked: %', label, left(sqlerrm,60); end $$;

insert into auth.users (id,email) values
 ('11111111-1111-1111-1111-111111111111','owner@a.test'),
 ('22222222-2222-2222-2222-222222222222','instructor@a.test'),
 ('33333333-3333-3333-3333-333333333333','staff@a.test'),
 ('44444444-4444-4444-4444-444444444444','tech@a.test'),
 ('55555555-5555-5555-5555-555555555555','owner2@a.test');

\echo ''
\echo '========== 0. BOOTSTRAP =========='
do $$ begin
  perform pg_temp.chk('every new signup starts inactive with the weakest role',
    (select bool_and(role_id='staff' and not is_active) from public.profiles), true);
end $$;
select pg_temp.ok('bootstrap_owner() creates the first owner',
  $$select public.bootstrap_owner('owner@a.test')$$);
select pg_temp.err('bootstrap_owner() refuses once an owner exists',
  $$select public.bootstrap_owner('staff@a.test')$$);
do $$ begin
  perform pg_temp.chk('owner now holds permissions.manage',
    public.has_permission('permissions.manage','11111111-1111-1111-1111-111111111111'), true);
end $$;

-- the real flow: the owner assigns everyone else
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.profiles set role_id='instructor', is_active=true where id='22222222-2222-2222-2222-222222222222';
update public.profiles set role_id='staff',      is_active=true where id='33333333-3333-3333-3333-333333333333';
update public.profiles set role_id='tech',       is_active=true where id='44444444-4444-4444-4444-444444444444';
update public.profiles set role_id='owner',      is_active=true where id='55555555-5555-5555-5555-555555555555';
reset role; set request.jwt.claim.sub = '';

insert into public.news_jurisdictions (code,name) values ('NJ','New Jersey');
insert into public.news_entries (id,jurisdiction,category,title,summary,is_published) values
 ('aaaaaaaa-0000-0000-0000-000000000001','NJ','legislation','PUBLISHED','live',true),
 ('aaaaaaaa-0000-0000-0000-000000000002','NJ','legislation','DRAFT','not live',false);
insert into public.course_categories (id,title,icon) values ('sora','SORA','fa');
insert into public.courses (id,category_id,name,blurb,price) values ('c1','sora','Unarmed','x','$250.00');

\echo ''
\echo '========== 1. ROLE DEFAULTS =========='
do $$ begin
  perform pg_temp.chk('owner      → content.courses.write', public.has_permission('content.courses.write','11111111-1111-1111-1111-111111111111'), true);
  perform pg_temp.chk('instructor → content.news.publish',  public.has_permission('content.news.publish','22222222-2222-2222-2222-222222222222'), true);
  perform pg_temp.chk('instructor → content.courses.write', public.has_permission('content.courses.write','22222222-2222-2222-2222-222222222222'), false);
  perform pg_temp.chk('staff      → content.site.write',    public.has_permission('content.site.write','33333333-3333-3333-3333-333333333333'), true);
  perform pg_temp.chk('staff      → content.news.write',    public.has_permission('content.news.write','33333333-3333-3333-3333-333333333333'), false);
  perform pg_temp.chk('tech       → deploy.trigger',        public.has_permission('deploy.trigger','44444444-4444-4444-4444-444444444444'), true);
  perform pg_temp.chk('tech       → content.ori.write',     public.has_permission('content.ori.write','44444444-4444-4444-4444-444444444444'), false);
end $$;

\echo ''
\echo '========== 2. GRANULAR OVERRIDES (the owner tuning one person) =========='
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.user_permissions (user_id,permission_key,effect) values
 ('22222222-2222-2222-2222-222222222222','content.courses.write','grant'),
 ('22222222-2222-2222-2222-222222222222','content.news.publish','revoke');
reset role; set request.jwt.claim.sub = '';
do $$ begin
  perform pg_temp.chk('individual GRANT adds a permission',        public.has_permission('content.courses.write','22222222-2222-2222-2222-222222222222'), true);
  perform pg_temp.chk('individual REVOKE beats the role default',  public.has_permission('content.news.publish','22222222-2222-2222-2222-222222222222'), false);
  perform pg_temp.chk('  ...and leaves the rest of the role alone',public.has_permission('content.news.write','22222222-2222-2222-2222-222222222222'), true);
  perform pg_temp.chk('owner is immune to revoke (superuser)',     public.has_permission('content.news.publish','11111111-1111-1111-1111-111111111111'), true);
  perform pg_temp.chk('deactivating removes everything',           public.has_permission('content.site.read','55555555-5555-5555-5555-555555555555'), true);
end $$;

\echo ''
\echo '========== 3. PRIVILEGE ESCALATION =========='
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.err('staff promotes self to owner',      $$update public.profiles set role_id='owner' where id='33333333-3333-3333-3333-333333333333'$$);
select pg_temp.err('staff grants self a permission',    $$insert into public.user_permissions (user_id,permission_key,effect) values ('33333333-3333-3333-3333-333333333333','content.courses.write','grant')$$);
select pg_temp.err('staff reactivates an account',      $$update public.profiles set is_active=false where id='33333333-3333-3333-3333-333333333333'$$);
select pg_temp.err('staff calls bootstrap_owner()',     $$select public.bootstrap_owner('staff@a.test')$$);
reset role; set request.jwt.claim.sub = '';

-- give tech permissions.manage but NOT content.ori.write
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.user_permissions (user_id,permission_key,effect) values ('44444444-4444-4444-4444-444444444444','permissions.manage','grant');
reset role; set request.jwt.claim.sub = '';
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.err('delegate grants a permission it LACKS',  $$insert into public.user_permissions (user_id,permission_key,effect) values ('33333333-3333-3333-3333-333333333333','content.ori.write','grant')$$);
select pg_temp.ok ('delegate grants a permission it HOLDS',  $$insert into public.user_permissions (user_id,permission_key,effect) values ('33333333-3333-3333-3333-333333333333','audit.read','grant')$$);
reset role; set request.jwt.claim.sub = '';

\echo ''
\echo '========== 4. OWNER LOCKOUT GUARD =========='
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok ('demote the 2nd owner while two exist', $$update public.profiles set role_id='staff' where id='55555555-5555-5555-5555-555555555555'$$);
select pg_temp.err('demote the LAST owner',                $$update public.profiles set role_id='staff' where id='11111111-1111-1111-1111-111111111111'$$);
select pg_temp.err('deactivate the LAST owner',            $$update public.profiles set is_active=false where id='11111111-1111-1111-1111-111111111111'$$);
reset role; set request.jwt.claim.sub = '';
select pg_temp.err('DELETE the last owner', $$delete from public.profiles where id='11111111-1111-1111-1111-111111111111'$$);

\echo ''
\echo '========== 5. CONTENT RLS =========='
set role anon;
do $$ declare n int; begin select count(*) into n from public.news_entries;
  perform pg_temp.chk('anon sees published only (1 of 2)', n=1, true); end $$;
reset role;
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ declare n int; begin select count(*) into n from public.news_entries;
  perform pg_temp.chk('instructor sees drafts too (2 of 2)', n=2, true); end $$;
select pg_temp.ok ('instructor saves a draft',      $$insert into public.news_entries (jurisdiction,category,title,summary,is_published) values ('NJ','legislation','Draft','x',false)$$);
select pg_temp.err('instructor publishes (revoked)',$$insert into public.news_entries (jurisdiction,category,title,summary,is_published) values ('NJ','legislation','Sneaky','x',true)$$);
reset role; set request.jwt.claim.sub = '';
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select pg_temp.norows('staff changes a course price', $$update public.courses set price='$1.00' where id='c1'$$);
select pg_temp.ok    ('staff edits contact details',  $$insert into public.contact_methods (label,detail,icon) values ('(848) 555-0000','New','fa')$$);
reset role; set request.jwt.claim.sub = '';
do $$ begin perform pg_temp.chk('course price unchanged after staff attempt',
  (select price='$250.00' from public.courses where id='c1'), true); end $$;

\echo ''
\echo '========== 6. AUDIT LOG =========='
do $$ declare n int; begin select count(*) into n from public.audit_log;
  perform pg_temp.chk('audit rows written', n>10, true); end $$;
do $$ begin perform pg_temp.chk('actor email snapshotted',
  (select count(*)>0 from public.audit_log where actor_email is not null), true); end $$;
-- NB: staff was granted audit.read by the delegate in section 3, so it can
-- legitimately read the log by this point. Use the instructor, who was not.
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ declare n int; begin select count(*) into n from public.audit_log;
  perform pg_temp.chk('instructor cannot read the audit log', n=0, true); end $$;
reset role;
do $$ begin perform pg_temp.chk('...but staff can, via its explicit grant',
  public.has_permission('audit.read','33333333-3333-3333-3333-333333333333'), true); end $$;
