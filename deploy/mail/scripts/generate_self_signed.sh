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

SSL_DIR="${MAIL_DIR}/docker-data/dms/config/ssl"
CA_DIR="${SSL_DIR}/demoCA"
KEY_FILE="${SSL_DIR}/${MAIL_HOSTNAME}-key.pem"
CERT_FILE="${SSL_DIR}/${MAIL_HOSTNAME}-cert.pem"
CA_KEY_FILE="${CA_DIR}/cakey.pem"
CA_CERT_FILE="${CA_DIR}/cacert.pem"
CSR_FILE="${SSL_DIR}/${MAIL_HOSTNAME}.csr"
EXT_FILE="${SSL_DIR}/${MAIL_HOSTNAME}.ext"

mkdir -p "${CA_DIR}"

if [[ -f "${KEY_FILE}" && -f "${CERT_FILE}" && -f "${CA_CERT_FILE}" ]]; then
  echo "Self-signed certificate files already exist."
  exit 0
fi

openssl genrsa -out "${CA_KEY_FILE}" 2048 >/dev/null 2>&1
openssl req -x509 -new -nodes -key "${CA_KEY_FILE}" -sha256 -days 3650 \
  -subj "/CN=${MAIL_HOSTNAME} Local Mail CA" \
  -out "${CA_CERT_FILE}" >/dev/null 2>&1

openssl genrsa -out "${KEY_FILE}" 2048 >/dev/null 2>&1

cat > "${EXT_FILE}" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${MAIL_HOSTNAME}
DNS.2 = ${MAIL_DOMAIN}
EOF

openssl req -new -key "${KEY_FILE}" -subj "/CN=${MAIL_HOSTNAME}" -out "${CSR_FILE}" >/dev/null 2>&1
openssl x509 -req -in "${CSR_FILE}" -CA "${CA_CERT_FILE}" -CAkey "${CA_KEY_FILE}" -CAcreateserial \
  -out "${CERT_FILE}" -days 825 -sha256 -extfile "${EXT_FILE}" >/dev/null 2>&1

rm -f "${CSR_FILE}" "${EXT_FILE}" "${CA_DIR}/cacert.srl"

echo "Generated self-signed certificate for ${MAIL_HOSTNAME}"

