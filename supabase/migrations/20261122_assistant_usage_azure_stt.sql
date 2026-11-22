-- DB listening through Azure speech-to-text (used automatically in browsers
-- without working speech recognition, e.g. DuckDuckGo on Android). Free within
-- the Azure F0 tier's 5 audio hours a month; rows record seconds at cost 0.
alter table public.assistant_usage drop constraint if exists assistant_usage_provider_check;
alter table public.assistant_usage add constraint assistant_usage_provider_check
  check (provider in ('anthropic', 'sarvam_stt', 'sarvam_tts', 'azure_tts', 'google_tts', 'azure_stt'));
