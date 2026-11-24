-- QC checklist = the Auto Check list (owner decision 2026-11-24): every laptop and
-- desktop is QC'd against the same points, whether by Auto Check or by hand on
-- the unit's QC tab. Generated from CHECKS in apps/erp/lib/qc-agent/checklist.ts;
-- the labels must stay identical so Auto Check folds them in instead of adding
-- them again as "extra checks". Still editable in Settings -> SKU Categories.
-- Previous lists:
--   LAP: Screen, Keyboard, Trackpad, Battery Health, Ports / Connectivity, Body / Cosmetic Condition, Boot / OS, Camera, Audio, WiFi, Charging, Stress Test
--   DES: Boot / OS, Ports / Connectivity, Body / Cosmetic Condition, PSU / Power, Fans / Cooling, Storage Health, RAM Check, Audio, Network / LAN, Stress Test
-- Recorded checks on existing units (asset_qc_checks) are not touched.

begin;
update sku_category_templates set qc_checklist = '["No BIOS password", "No company / MDM lock", "No theft-tracking lock (Computrace)", "Disk not encrypted (BitLocker off)", "Windows activated", "Serial sticker matches the machine", "SSD / HDD health", "Disk read/write test", "No disk errors logged", "RAM test", "Heat test (no slow-down under load)", "Fan runs quietly", "No crashes or hardware errors", "All devices working", "Original parts check", "Battery health", "Charger & charging port", "Screen: no dead or bright dots, no lines", "Screen: no light bleed or pressure marks", "Brightness control, no flicker", "Touch screen", "Keyboard: every key works", "Keyboard: no stuck keys", "Fn / volume / brightness keys", "Keyboard backlight", "Trackpad & clicks", "Speakers (left & right, no rattle)", "Microphone", "Camera", "Headphone / audio jack", "All USB ports", "HDMI / display output", "Ethernet (LAN) port", "Wi-Fi", "Bluetooth", "Hinges firm, lid stays in place", "No cracks or broken plastic", "No signs of being opened or badly repaired", "No liquid damage", "All screws & rubber feet present"]'::jsonb where category = 'LAP';
update sku_category_templates set qc_checklist = '["No BIOS password", "No company / MDM lock", "No theft-tracking lock (Computrace)", "Disk not encrypted (BitLocker off)", "Windows activated", "Serial sticker matches the machine", "SSD / HDD health", "Disk read/write test", "No disk errors logged", "RAM test", "Heat test (no slow-down under load)", "Fan runs quietly", "No crashes or hardware errors", "All devices working", "Original parts check", "Power supply stable", "Camera", "Headphone / audio jack", "All USB ports", "HDMI / display output", "Ethernet (LAN) port", "Wi-Fi", "Bluetooth", "No cracks or broken plastic", "No signs of being opened or badly repaired", "No liquid damage", "All screws & rubber feet present"]'::jsonb where category = 'DES';
commit;
