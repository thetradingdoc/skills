create table if not exists public.workspace_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slot integer not null check (slot >= 1 and slot <= 5),
  preset text not null check (preset in ('top', 'front', 'side', 'iso')),
  created_at timestamptz not null default now()
);

create unique index if not exists workspace_views_workspace_slot_idx
  on public.workspace_views (workspace_id, slot);

