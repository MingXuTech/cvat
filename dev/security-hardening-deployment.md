# CVAT Security Hardening Deployment

This document describes how to deploy the security hardening changes for:
- HTTPS with self-signed certificate
- Blocking `/api/auth/register` at the edge
- Fail2ban ban on repeated `/api/auth/login` failures (400/401)

## Files Included

- `docker-compose.yml`
- `docker-compose.https-selfsigned.yml`
- `docker-compose.security.yml`
- `docker-compose.fail2ban.yml`
- `components/traefik/selfsigned_tls.yml`
- `components/security/deny.conf`
- `components/security/fail2ban/filter.d/traefik-cvat-login.conf`
- `components/security/fail2ban/jail.d/traefik-cvat-login.local`

## Prerequisites

- Docker Engine + Docker Compose v2
- Ports available on target host:
  - `CVAT_HTTP_PORT` (default `5824`)
  - `CVAT_HTTPS_PORT` (default `5826`)
  - `TRAEFIK_WEB_PORT` (default `8081` in this setup)
  - `TRAEFIK_DASHBOARD_PORT` (default `8091` in this setup)

## 1) Generate TLS Certificate on Target Host

Use the target host IP (example: `172.20.2.148`).

```bash
cd /path/to/cvat
mkdir -p certs
IP=172.20.2.148
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout certs/cvat.key -out certs/cvat.crt \
  -subj "/CN=$IP" \
  -addext "subjectAltName=IP:$IP"
```

## 2) Export Runtime Variables

```bash
export CVAT_VERSION=prod-20260203
export CVAT_HOST=172.20.2.148
export CVAT_BASE_URL=https://172.20.2.148:5826
export CVAT_SHARE_PATH=/home/yview/data/bv_wet_dataset

export CVAT_HTTP_PORT=5824
export CVAT_HTTPS_PORT=5826
export TRAEFIK_WEB_PORT=8081
export TRAEFIK_DASHBOARD_PORT=8091
```

Adjust values for the real target server.

## 3) Start Stack With Security Overrides

```bash
docker compose \
  -f docker-compose.yml \
  -f components/serverless/docker-compose.serverless.yml \
  -f docker-compose.override.yml \
  -f docker-compose.https-selfsigned.yml \
  -f docker-compose.security.yml \
  -f docker-compose.fail2ban.yml \
  up -d
```

## 4) Verify Deployment

### Service state

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | rg 'traefik|cvat_fail2ban|cvat_server|cvat_ui'
```

### HTTPS works

```bash
curl -k -I https://172.20.2.148:5826/
```

Expected: HTTP 200.

### Register endpoint is blocked

```bash
curl -k -i https://172.20.2.148:5826/api/auth/register
```

Expected: HTTP 403.

### Fail2ban jail is active

```bash
docker exec cvat_fail2ban fail2ban-client status
docker exec cvat_fail2ban fail2ban-client status traefik-cvat-login
```

Expected: jail list contains `traefik-cvat-login`.

## 5) Optional Ban Test

```bash
docker run --rm curlimages/curl:8.11.1 sh -lc '
  for i in 1 2 3 4 5 6; do
    curl -k -s -o /dev/null -w "%{http_code}\n" \
      -X POST https://172.20.2.148:5826/api/auth/login \
      -H "Content-Type: application/json" \
      -d "{\"username\":\"bad\",\"password\":\"bad\"}";
  done
'

docker exec cvat_fail2ban fail2ban-client status traefik-cvat-login
docker logs --tail 100 cvat_fail2ban | rg 'Ban|Unban|Found'
```

If needed, unban manually:

```bash
docker exec cvat_fail2ban fail2ban-client set traefik-cvat-login unbanip <IP>
```

## Notes

- Traefik access log is written to: `logs/traefik/access.log`
- Current jail ignores host IP to avoid local lockout during host-side testing:
  - `components/security/fail2ban/jail.d/traefik-cvat-login.local`
- For stricter production behavior, remove host IP from `ignoreip` and restart `cvat_fail2ban`.
