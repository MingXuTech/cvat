# CVAT 安全部署（低资源服务器，无需 build）

本文用于在目标服务器上部署本次安全改动，适用于“服务器资源不足，不能 `docker build`”的场景。

## 适用范围

- 使用预构建镜像（`cvat/server:${CVAT_VERSION}`、`cvat/ui:${CVAT_VERSION}`）
- 开启 HTTPS（自签证书）
- 边缘阻断注册接口：`/api/auth/register`
- 开启 fail2ban，对连续登录失败（400/401）进行封禁

## 变更文件

- `docker-compose.yml`
- `docker-compose.https-selfsigned.yml`
- `docker-compose.security.yml`
- `docker-compose.fail2ban.yml`
- `components/traefik/selfsigned_tls.yml`
- `components/security/deny.conf`
- `components/security/fail2ban/filter.d/traefik-cvat-login.conf`
- `components/security/fail2ban/jail.d/traefik-cvat-login.local`

## 一、服务器准备

```bash
cd /path/to/cvat
```

### 1) 生成证书（示例 IP：172.20.2.148）

```bash
mkdir -p certs
IP=172.20.2.148
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout certs/cvat.key -out certs/cvat.crt \
  -subj "/CN=$IP" \
  -addext "subjectAltName=IP:$IP"
```

### 2) 设置运行环境变量

```bash
export CVAT_VERSION=prod-20260203
export CVAT_HOST=172.20.2.148
export CVAT_BASE_URL=https://172.20.2.148:5826
export CVAT_SHARE_PATH=/data/cvat-share

export CVAT_HTTP_PORT=5824
export CVAT_HTTPS_PORT=5826
export TRAEFIK_WEB_PORT=8081
export TRAEFIK_DASHBOARD_PORT=8091
```

## 二、低资源推荐启动方式（不含 serverless）

`serverless` 组件（Nuclio）较耗资源。低资源服务器建议先不启用。

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.https-selfsigned.yml \
  -f docker-compose.security.yml \
  -f docker-compose.fail2ban.yml \
  pull

docker compose \
  -f docker-compose.yml \
  -f docker-compose.https-selfsigned.yml \
  -f docker-compose.security.yml \
  -f docker-compose.fail2ban.yml \
  up -d
```

注意：全程不需要、也不要执行 `docker compose build`。

## 三、如需 serverless 再启用（可选）

```bash
docker compose \
  -f docker-compose.yml \
  -f components/serverless/docker-compose.serverless.yml \
  -f docker-compose.https-selfsigned.yml \
  -f docker-compose.security.yml \
  -f docker-compose.fail2ban.yml \
  pull

docker compose \
  -f docker-compose.yml \
  -f components/serverless/docker-compose.serverless.yml \
  -f docker-compose.https-selfsigned.yml \
  -f docker-compose.security.yml \
  -f docker-compose.fail2ban.yml \
  up -d
```

## 四、部署后验证

### 1) 服务状态

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | rg 'traefik|cvat_fail2ban|cvat_server|cvat_ui'
```

### 2) HTTPS 可用

```bash
curl -k -I https://172.20.2.148:5826/
```

期望：`HTTP/1.1 200 OK`

### 3) 注册接口被阻断

```bash
curl -k -i https://172.20.2.148:5826/api/auth/register
```

期望：`HTTP/1.1 403 Forbidden`

### 4) fail2ban jail 正常

```bash
docker exec cvat_fail2ban fail2ban-client status
docker exec cvat_fail2ban fail2ban-client status traefik-cvat-login
```

## 五、封禁测试（无外部 IP 场景）

从临时容器发起连续错误登录，触发同一来源 IP 封禁：

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
docker logs --tail 120 cvat_fail2ban | rg 'Found|Ban|Unban'
```

解封示例：

```bash
docker exec cvat_fail2ban fail2ban-client set traefik-cvat-login unbanip <IP>
```

## 六、给 AI 直接执行的最小命令块

将下面命令块直接交给部署 AI（按你的实际路径/IP/版本改值）：

```bash
cd /path/to/cvat
mkdir -p certs
IP=172.20.2.148
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout certs/cvat.key -out certs/cvat.crt \
  -subj "/CN=$IP" -addext "subjectAltName=IP:$IP"

export CVAT_VERSION=prod-20260203
export CVAT_HOST=172.20.2.148
export CVAT_BASE_URL=https://172.20.2.148:5826
export CVAT_SHARE_PATH=/data/cvat-share
export CVAT_HTTP_PORT=5824
export CVAT_HTTPS_PORT=5826
export TRAEFIK_WEB_PORT=8081
export TRAEFIK_DASHBOARD_PORT=8091

docker compose \
  -f docker-compose.yml \
  -f docker-compose.https-selfsigned.yml \
  -f docker-compose.security.yml \
  -f docker-compose.fail2ban.yml \
  pull

docker compose \
  -f docker-compose.yml \
  -f docker-compose.https-selfsigned.yml \
  -f docker-compose.security.yml \
  -f docker-compose.fail2ban.yml \
  up -d

curl -k -I https://172.20.2.148:5826/
curl -k -i https://172.20.2.148:5826/api/auth/register | head -n 8
docker exec cvat_fail2ban fail2ban-client status traefik-cvat-login
```
