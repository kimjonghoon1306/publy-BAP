begin;

create table if not exists public.publy_place360_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  store_key text not null,
  store_name text not null,
  region text not null default '',
  category text not null default '',
  visitor_reviews integer not null default 0 check (visitor_reviews >= 0),
  blog_reviews integer not null default 0 check (blog_reviews >= 0),
  competitor_count integer not null default 0 check (competitor_count >= 0),
  competitor_avg_visitor integer not null default 0 check (competitor_avg_visitor >= 0),
  competitor_avg_blog integer not null default 0 check (competitor_avg_blog >= 0),
  collected_count integer not null default 0 check (collected_count >= 0),
  measured_on date not null default (timezone('Asia/Seoul', now()))::date,
  created_at timestamptz not null default now(),
  unique (user_id, store_key, measured_on)
);

create index if not exists publy_place360_snapshots_lookup_idx
  on public.publy_place360_snapshots(user_id, store_key, measured_on desc);

alter table public.publy_place360_snapshots enable row level security;
revoke all on public.publy_place360_snapshots from anon, authenticated;

create or replace function public.publy_place360_save_snapshot(
  p_token text, p_store_key text, p_store_name text, p_region text, p_category text,
  p_visitor_reviews integer, p_blog_reviews integer, p_competitor_count integer,
  p_competitor_avg_visitor integer, p_competitor_avg_blog integer, p_collected_count integer
) returns public.publy_place360_snapshots
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_row public.publy_place360_snapshots;
begin
  select user_id into v_user_id from public.publy_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and is_admin is false and expires_at > now() limit 1;
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'INVALID_SESSION'; end if;
  if length(trim(coalesce(p_store_key, ''))) < 2 then raise exception using errcode = 'P0001', message = 'INVALID_STORE'; end if;

  insert into public.publy_place360_snapshots(
    user_id, store_key, store_name, region, category, visitor_reviews, blog_reviews,
    competitor_count, competitor_avg_visitor, competitor_avg_blog, collected_count
  ) values (
    v_user_id, left(trim(p_store_key), 180), left(trim(p_store_name), 180), left(coalesce(p_region, ''), 120), left(coalesce(p_category, ''), 120),
    greatest(coalesce(p_visitor_reviews, 0), 0), greatest(coalesce(p_blog_reviews, 0), 0), greatest(coalesce(p_competitor_count, 0), 0),
    greatest(coalesce(p_competitor_avg_visitor, 0), 0), greatest(coalesce(p_competitor_avg_blog, 0), 0), greatest(coalesce(p_collected_count, 0), 0)
  ) on conflict (user_id, store_key, measured_on) do update set
    store_name = excluded.store_name, region = excluded.region, category = excluded.category,
    visitor_reviews = excluded.visitor_reviews, blog_reviews = excluded.blog_reviews,
    competitor_count = excluded.competitor_count, competitor_avg_visitor = excluded.competitor_avg_visitor,
    competitor_avg_blog = excluded.competitor_avg_blog, collected_count = excluded.collected_count,
    created_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.publy_place360_get_snapshots(p_token text, p_store_key text)
returns setof public.publy_place360_snapshots
language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  select user_id into v_user_id from public.publy_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and is_admin is false and expires_at > now() limit 1;
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'INVALID_SESSION'; end if;
  return query select * from public.publy_place360_snapshots
    where user_id = v_user_id and store_key = p_store_key
    order by measured_on desc limit 120;
end;
$$;

revoke all on function public.publy_place360_save_snapshot(text,text,text,text,text,integer,integer,integer,integer,integer,integer) from public;
revoke all on function public.publy_place360_get_snapshots(text,text) from public;
grant execute on function public.publy_place360_save_snapshot(text,text,text,text,text,integer,integer,integer,integer,integer,integer) to anon, authenticated;
grant execute on function public.publy_place360_get_snapshots(text,text) to anon, authenticated;

commit;
