#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${MAIL_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.example to .env first." >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

inspect_json="$(docker volume inspect deploy_caddy_data)"
mountpoint="$(python3 - <<'PY' "${inspect_json}"
import json, sys
data = json.loads(sys.argv[1])
print(data[0]["Mountpoint"])
PY
)"

host_cert="${mountpoint}/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${MAIL_HOSTNAME}/${MAIL_HOSTNAME}.crt"
host_key="${mountpoint}/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${MAIL_HOSTNAME}/${MAIL_HOSTNAME}.key"
target_dir="${MAIL_DIR}/docker-data/dms/custom-certs"
target_cert="${target_dir}/public.crt"
target_key="${target_dir}/private.key"

if [[ ! -f "${host_cert}" || ! -f "${host_key}" ]]; then
  echo "Caddy certificate for ${MAIL_HOSTNAME} not found yet. Point DNS A record first and wait for Caddy issuance." >&2
  exit 1
fi

mkdir -p "${target_dir}"
install -m 0644 "${host_cert}" "${target_cert}"
install -m 0600 "${host_key}" "${target_key}"

python3 - <<'PY' "${ENV_FILE}"
import pathlib
import sys

env_path = pathlib.Path(sys.argv[1])
lines = env_path.read_text(encoding="utf-8").splitlines()
result = []
ssl_type_updated = False
cert_path_updated = False
key_path_updated = False
for line in lines:
    if line.startswith("MAIL_SSL_TYPE="):
        result.append("MAIL_SSL_TYPE=manual")
        ssl_type_updated = True
    elif line.startswith("MAIL_CERT_PATH="):
        result.append("MAIL_CERT_PATH=/tmp/dms/custom-certs/public.crt")
        cert_path_updated = True
    elif line.startswith("MAIL_KEY_PATH="):
        result.append("MAIL_KEY_PATH=/tmp/dms/custom-certs/private.key")
        key_path_updated = True
    else:
        result.append(line)
if not ssl_type_updated:
    result.append("MAIL_SSL_TYPE=manual")
if not cert_path_updated:
    result.append("MAIL_CERT_PATH=/tmp/dms/custom-certs/public.crt")
if not key_path_updated:
    result.append("MAIL_KEY_PATH=/tmp/dms/custom-certs/private.key")
env_path.write_text("\n".join(result) + "\n", encoding="utf-8")
PY

cd "${MAIL_DIR}"
export MAIL_SSL_TYPE=manual
export MAIL_CERT_PATH=/tmp/dms/custom-certs/public.crt
export MAIL_KEY_PATH=/tmp/dms/custom-certs/private.key
docker compose --env-file .env up -d --force-recreate
echo "Switched mail stack TLS to the Caddy-issued certificate for ${MAIL_HOSTNAME}."
