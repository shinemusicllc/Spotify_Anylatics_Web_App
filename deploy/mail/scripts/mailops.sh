#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_PATH}")" && pwd)"
MAIL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${MAIL_DIR}/.env"

usage() {
  cat <<'EOF'
Usage:
  mailops up
  mailops status
  mailops logs [service]
  mailops restart
  mailops dns-records
  mailops add-account <email> [password]
  mailops update-account <email> [password]
  mailops delete-account <email> [email...]
  mailops list-accounts
  mailops add-alias <alias_email> <recipient_email>
  mailops delete-alias <alias_email> <recipient_email>
  mailops list-aliases
  mailops dkim-generate [domain]
  mailops dkim-show [domain]
  mailops use-caddy-cert
EOF
}

require_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}. Copy .env.example to .env first." >&2
    exit 1
  fi
  set -a
  source "${ENV_FILE}"
  set +a
}

command="${1:-}"
shift || true

case "${command}" in
  up)
    require_env
    if [[ "${MAIL_SSL_TYPE:-self-signed}" == "self-signed" ]]; then
      "${SCRIPT_DIR}/generate_self_signed.sh"
    fi
    cd "${MAIL_DIR}"
    docker compose --env-file .env up -d
    ;;
  status)
    require_env
    cd "${MAIL_DIR}"
    docker compose --env-file .env ps
    ;;
  logs)
    require_env
    cd "${MAIL_DIR}"
    if [[ $# -gt 0 ]]; then
      docker compose --env-file .env logs -f "$@"
    else
      docker compose --env-file .env logs -f mailserver
    fi
    ;;
  restart)
    require_env
    cd "${MAIL_DIR}"
    docker compose --env-file .env restart
    ;;
  dns-records)
    require_env
    dkim_file="${MAIL_DIR}/docker-data/dms/config/opendkim/keys/${MAIL_DOMAIN}/mail.txt"
    mail_host_label="${MAIL_HOSTNAME%%.${MAIL_DOMAIN}}"
    echo "Cloudflare DNS records for ${MAIL_DOMAIN}:"
    echo
    echo "A    ${mail_host_label:-mail}              ${MAIL_SERVER_IP:-82.197.71.6}   (DNS only)"
    echo "MX   @                 10 ${MAIL_HOSTNAME:-mail.${MAIL_DOMAIN}}   (DNS only)"
    echo "TXT  @                 v=spf1 mx a -all"
    echo "TXT  _dmarc            v=DMARC1; p=none; rua=mailto:dmarc@${MAIL_DOMAIN}; pct=100"
    if [[ -f "${dkim_file}" ]]; then
      dkim_value="$(tr '\n' ' ' < "${dkim_file}" | sed 's/^[^(]*( //; s/ )[^)]*$//; s/\"[[:space:]]*\"//g; s/\"//g; s/[[:space:]]\\+/ /g; s/^ *//; s/ *$//')"
      echo "TXT  mail._domainkey   ${dkim_value}"
    else
      echo "TXT  mail._domainkey   <missing - run: mailops dkim-generate ${MAIL_DOMAIN}>"
    fi
    echo
    echo "Provider-side requirement:"
    echo "PTR/rDNS  ${MAIL_SERVER_IP:-82.197.71.6} -> ${MAIL_HOSTNAME:-mail.${MAIL_DOMAIN}}"
    ;;
  add-account)
    require_env
    email="${1:-}"
    password="${2:-}"
    if [[ -z "${email}" ]]; then
      echo "Usage: mailops add-account <email> [password]" >&2
      exit 1
    fi
    if [[ -z "${password}" ]]; then
      read -r -s -p "Password for ${email}: " password
      echo
    fi
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup email add "${email}" "${password}"
    ;;
  update-account)
    require_env
    email="${1:-}"
    password="${2:-}"
    if [[ -z "${email}" ]]; then
      echo "Usage: mailops update-account <email> [password]" >&2
      exit 1
    fi
    if [[ -z "${password}" ]]; then
      read -r -s -p "New password for ${email}: " password
      echo
    fi
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup email update "${email}" "${password}"
    ;;
  delete-account)
    require_env
    if [[ $# -lt 1 ]]; then
      echo "Usage: mailops delete-account <email> [email...]" >&2
      exit 1
    fi
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup email del -y "$@"
    ;;
  list-accounts)
    require_env
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup email list
    ;;
  add-alias)
    require_env
    alias_email="${1:-}"
    recipient_email="${2:-}"
    if [[ -z "${alias_email}" || -z "${recipient_email}" ]]; then
      echo "Usage: mailops add-alias <alias_email> <recipient_email>" >&2
      exit 1
    fi
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup alias add "${alias_email}" "${recipient_email}"
    ;;
  delete-alias)
    require_env
    alias_email="${1:-}"
    recipient_email="${2:-}"
    if [[ -z "${alias_email}" || -z "${recipient_email}" ]]; then
      echo "Usage: mailops delete-alias <alias_email> <recipient_email>" >&2
      exit 1
    fi
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup alias del "${alias_email}" "${recipient_email}"
    ;;
  list-aliases)
    require_env
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup alias list
    ;;
  dkim-generate)
    require_env
    domain="${1:-${MAIL_DOMAIN}}"
    cd "${MAIL_DIR}"
    docker compose --env-file .env exec -T mailserver setup config dkim domain "${domain}"
    docker compose --env-file .env restart mailserver
    ;;
  dkim-show)
    require_env
    domain="${1:-${MAIL_DOMAIN}}"
    dkim_file="${MAIL_DIR}/docker-data/dms/config/opendkim/keys/${domain}/mail.txt"
    if [[ ! -f "${dkim_file}" ]]; then
      echo "DKIM file not found for ${domain}. Run: mailops dkim-generate ${domain}" >&2
      exit 1
    fi
    cat "${dkim_file}"
    ;;
  use-caddy-cert)
    require_env
    "${SCRIPT_DIR}/use_caddy_cert.sh"
    ;;
  *)
    usage
    exit 1
    ;;
esac
