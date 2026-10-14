#!/bin/bash
# ============================================================
# Setup WPPConnect Server para StackOS
# Rodar na VPS (Oracle Cloud / qualquer Ubuntu 22.04+)
#
# Uso: sudo bash setup.sh SEU_DOMINIO SEU_TOKEN
# Ex:  sudo bash setup.sh wa.stackos.com.br MeuTokenSecreto123
# ============================================================

set -e

DOMAIN=${1:-""}
TOKEN=${2:-""}

if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
    echo ""
    echo "=========================================="
    echo "  Setup WPPConnect Server - StackOS"
    echo "=========================================="
    echo ""
    echo "Uso: sudo bash setup.sh <dominio> <token>"
    echo ""
    echo "Exemplos:"
    echo "  sudo bash setup.sh wa.stackos.com.br MeuTokenSecreto123"
    echo "  sudo bash setup.sh wa.meupokersul.com.br SenhaForte456"
    echo ""
    echo "O dominio deve estar apontando pra esse servidor (DNS A record)"
    echo ""
    exit 1
fi

echo ""
echo "================================================="
echo "  Instalando WPPConnect Server"
echo "  Dominio: $DOMAIN"
echo "================================================="
echo ""

# 1. Atualiza sistema
echo "[1/6] Atualizando sistema..."
apt-get update -qq
apt-get upgrade -y -qq

# 2. Instala Docker
echo "[2/6] Instalando Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "  Docker ja instalado"
fi

# Instala docker compose plugin
if ! docker compose version &> /dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi

# 3. Instala Nginx + Certbot
echo "[3/6] Instalando Nginx e Certbot..."
apt-get install -y -qq nginx certbot python3-certbot-nginx

# 4. Configura Nginx
echo "[4/6] Configurando Nginx..."
mkdir -p /var/www/certbot

# Config temporaria pra HTTP (pra pegar certificado)
cat > /etc/nginx/sites-available/wppconnect << NGINX_CONF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:21465;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;

        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, apikey" always;

        if (\$request_method = OPTIONS) {
            return 204;
        }
    }
}
NGINX_CONF

ln -sf /etc/nginx/sites-available/wppconnect /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 5. SSL com Let's Encrypt
echo "[5/6] Gerando certificado SSL..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@$DOMAIN --redirect || {
    echo "  AVISO: Certificado SSL falhou. Verifique se o DNS aponta pra este servidor."
    echo "  Voce pode rodar depois: certbot --nginx -d $DOMAIN"
}

# 6. Sobe WPPConnect
echo "[6/6] Subindo WPPConnect..."
mkdir -p /opt/wppconnect && cd /opt/wppconnect

cat > docker-compose.yml << COMPOSE
version: '3.8'

services:
  wppconnect:
    image: wppconnect/server-cli:latest
    container_name: wppconnect-stackos
    restart: unless-stopped
    ports:
      - "21465:21465"
    volumes:
      - wpp_tokens:/usr/src/wpp-server/tokens
      - wpp_userdata:/usr/src/wpp-server/userDataDir
    environment:
      - SECRETKEY=$TOKEN
      - HOST=0.0.0.0
      - PORT=21465
      - CORS_ORIGIN=*
      - LOG_LEVEL=info

volumes:
  wpp_tokens:
  wpp_userdata:
COMPOSE

docker compose up -d

# Abre portas no firewall (Oracle Cloud usa iptables)
echo ""
echo "Abrindo portas 80 e 443..."
iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
# Salva regras pra sobreviver reboot
if command -v netfilter-persistent &> /dev/null; then
    netfilter-persistent save 2>/dev/null || true
else
    apt-get install -y -qq iptables-persistent 2>/dev/null || true
    netfilter-persistent save 2>/dev/null || true
fi

# Aguarda WPPConnect subir
echo ""
echo "Aguardando WPPConnect iniciar..."
sleep 10

# Testa
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:21465/api/status 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    echo ""
    echo "================================================="
    echo "  SUCESSO! WPPConnect rodando!"
    echo "================================================="
    echo ""
    echo "  URL:   https://$DOMAIN"
    echo "  Token: $TOKEN"
    echo ""
    echo "  Agora no StackOS (como super admin):"
    echo "  1. Va em Convites > Config > WhatsApp API"
    echo "  2. Provider: WPPConnect"
    echo "  3. URL: https://$DOMAIN"
    echo "  4. Token: $TOKEN"
    echo "  5. Salve e clique 'Conectar WhatsApp'"
    echo ""
    echo "  Ou atualize _WA_MANAGED_SERVER no app.html"
    echo "  pra todos os clubes usarem automaticamente."
    echo ""
    echo "================================================="
else
    echo ""
    echo "  AVISO: WPPConnect pode estar demorando pra iniciar."
    echo "  Verifique com: docker logs wppconnect-stackos"
    echo "  URL sera: https://$DOMAIN"
    echo ""
fi
