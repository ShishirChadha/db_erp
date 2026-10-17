#!/bin/bash
# Tells the ERP the shop's current public IP, once a minute (cron).
#
# The shop ISP rotates its public IP; the ERP's attendance "office network" check
# follows it via POST /api/attendance/office-heartbeat. The ERP records the IP it
# sees on this request, so this script sends no IP of its own.
#
# Install on the ProDesk:
#   sudo install -m 755 office-heartbeat.sh /usr/local/bin/erp-office-heartbeat.sh
#   echo 'ATTENDANCE_HEARTBEAT_SECRET=<same value as in the ERP env>' | sudo tee /etc/erp-heartbeat.env
#   sudo chmod 600 /etc/erp-heartbeat.env
#   echo '* * * * * root /usr/local/bin/erp-office-heartbeat.sh' | sudo tee /etc/cron.d/erp-office-heartbeat
set -u
. /etc/erp-heartbeat.env
out=$(curl -fsS --max-time 15 -X POST \
  -H "x-heartbeat-secret: ${ATTENDANCE_HEARTBEAT_SECRET}" \
  https://erp.digitalbluez.com/api/attendance/office-heartbeat 2>&1) \
  || logger -t erp-office-heartbeat "FAILED: ${out}"
