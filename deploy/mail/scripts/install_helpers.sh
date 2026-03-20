#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

install -d -m 755 "${MAIL_DIR}/docker-data/dms/config"
install -d -m 755 "${MAIL_DIR}/docker-data/dms/mail-data"
install -d -m 755 "${MAIL_DIR}/docker-data/dms/mail-state"
install -d -m 755 "${MAIL_DIR}/docker-data/dms/mail-logs"

ln -sfn "${SCRIPT_DIR}/mailops.sh" /usr/local/bin/mailops

echo "Installed helper command: /usr/local/bin/mailops"

