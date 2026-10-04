-- Cargadores de otros países (Colombia): por defecto Ecuador
alter table public.chargers add column if not exists country text not null default 'EC' check (country in ('EC','CO'));
create index if not exists chargers_country_idx on public.chargers (country);
grant select (country) on public.chargers to anon;
