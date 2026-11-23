Sample Auto Check hardware reports (the JSON the PowerShell script uploads).
They are hand-built from known WMI output formats, not captured from real
machines yet -- replace/add real ones (the review screen's `?raw=1` view of
GET /api/qc-agent/sessions/[id] shows the exact upload) as the engineer runs
the script on real laptops.

- lenovo-t14-gen2.json      -- clean ThinkPad, admin run: everything should pass
- hp-840-g5-locked.json     -- every lock and repair red flag at once
- dell-5400-nonadmin.json   -- no admin rights, placeholder BIOS serial, unknowns
- hp-elitedesk-800-g4.json  -- desktop: SSD + HDD, discrete GPU, no battery
