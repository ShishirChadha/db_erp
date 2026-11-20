-- Azure and Google voices for DB. Both are free within their monthly character
-- allowance, so their rows record characters (cost 0) and Settings shows usage
-- against the free allowance.
alter table public.assistant_usage drop constraint if exists assistant_usage_provider_check;
alter table public.assistant_usage add constraint assistant_usage_provider_check
  check (provider in ('anthropic', 'sarvam_stt', 'sarvam_tts', 'azure_tts', 'google_tts'));
