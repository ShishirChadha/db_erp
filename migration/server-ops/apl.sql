-- The BIOS "After Power Loss" setting, read straight from the firmware via the
-- hp-bioscfg sysfs interface. Text, not boolean, because the firmware offers
-- three values (Power Off / Power On / Previous State) and "Previous State" is
-- a real and distinct wrong answer here -- after a mains failure the previous
-- state was off, so it recovers no better than Power Off.
--
-- Read-only by necessity: this platform's firmware (ProDesk 400 G2, 2016 BIOS)
-- accepts no writes through hp-bioscfg -- every attempt, including writing a
-- value's own current value back, returns 0x4 "Invalid command type". So this
-- column reports the setting and the page tells the owner to change it by hand;
-- it can never be set from software.
alter table public.server_metrics
  add column if not exists bios_after_power_loss text;

comment on column public.server_metrics.bios_after_power_loss is
  'BIOS "After Power Loss" value read from hp-bioscfg. "Power On" is the only '
  'value that recovers the machine unattended after a mains failure.';
