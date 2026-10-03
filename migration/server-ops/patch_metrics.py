import pathlib
p = pathlib.Path("/usr/local/bin/erp-metrics.sh")
t = p.read_text()

probe = '''# BIOS "After Power Loss", read from the firmware through hp-bioscfg. Only
# "Power On" brings the machine back by itself after a mains failure; the
# default "Power Off" leaves it waiting for somebody to press the button, which
# is what cost 9h29m of downtime on 2026-10-02.
#
# Read-only here, and not by choice: this platform's firmware refuses every
# write through this interface (0x4 "Invalid command type"), so the value is
# reported and a human changes it in BIOS. NULL if the interface is absent,
# which keeps this working on non-HP hardware.
APL=$(cat "/sys/class/firmware-attributes/hp-bioscfg/attributes/After Power Loss/current_value" 2>/dev/null | tr -d '\\n')

'''

anchor = "# Pending upgrades, split out by security."
assert anchor in t, "anchor missing"
t = t.replace(anchor, probe + anchor, 1)

old_cols = "pending_updates,pending_security_updates) values"
assert old_cols in t
t = t.replace(old_cols, "pending_updates,pending_security_updates,bios_after_power_loss) values", 1)

old_ph = "%s,%s,%s,%s,%s,%s,%s,%s);"
assert t.count(old_ph) == 1, "placeholder count %d" % t.count(old_ph)
t = t.replace(old_ph, "%s,%s,%s,%s,%s,%s,%s,%s,%s);", 1)

old_args = '"$(num "$UPD_ALL")" "$(num "$UPD_SEC")")'
assert old_args in t
t = t.replace(old_args, '"$(num "$UPD_ALL")" "$(num "$UPD_SEC")" "$(txt "$APL")")', 1)

p.write_text(t)
print("patched ok")
