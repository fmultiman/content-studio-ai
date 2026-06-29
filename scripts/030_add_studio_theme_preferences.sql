alter table public.user_settings
  drop constraint if exists user_settings_theme_check;

alter table public.user_settings
  add column if not exists studio_intensity text;

update public.user_settings
set studio_intensity = 'balanced'
where studio_intensity is null;

alter table public.user_settings
  alter column studio_intensity set default 'balanced',
  alter column studio_intensity set not null;

alter table public.user_settings
  add constraint user_settings_theme_check
  check (theme = any (array['light'::text, 'dark'::text, 'system'::text, 'studio'::text]));

alter table public.user_settings
  drop constraint if exists user_settings_studio_intensity_check;

alter table public.user_settings
  add constraint user_settings_studio_intensity_check
  check (studio_intensity = any (array['soft'::text, 'balanced'::text, 'expressive'::text]));
