#!/bin/bash
# ─── OpenEDX (Tutor) en Docker con Aurora PostgreSQL ─────────────────────────
# Réplica ${INSTANCE_INDEX} de 3
set -euo pipefail
exec > /var/log/user-data-openedx.log 2>&1
echo "=== Iniciando OpenEDX Replica ${INSTANCE_INDEX} - $(date) ==="

# ── 1. Sistema base ───────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y \
  docker.io \
  docker-compose \
  awscli \
  jq \
  curl \
  python3-pip \
  postgresql-client \
  git

systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# ── 2. Leer credenciales Aurora desde Secrets Manager ────────────────────────
SECRET=$(aws secretsmanager get-secret-value \
  --region ${AWS_REGION} \
  --secret-id ${SECRET_ARN} \
  --query SecretString \
  --output text)

DB_USER=$(echo "$SECRET" | jq -r '.username')
DB_PASS=$(echo "$SECRET" | jq -r '.password')
DB_HOST="${AURORA_HOST}"
DB_PORT="${AURORA_PORT}"

# ── 3. Crear bases de datos necesarias para OpenEDX en Aurora ─────────────────
# Tutor necesita: openedx, openedx_csmh, notes, discovery, ecommerce, credentials
for DB in openedx openedx_csmh notes discovery ecommerce credentials; do
  PGPASSWORD="$DB_PASS" psql \
    -h "$DB_HOST" -p "$DB_PORT" \
    -U "$DB_USER" -d postgres \
    -c "CREATE DATABASE $DB OWNER $DB_USER;" 2>/dev/null || echo "DB $DB ya existe"
done

# ── 4. Instalar Tutor (gestor de OpenEDX en Docker) ──────────────────────────
pip3 install "tutor[full]==17.0.0"
export PATH="$PATH:/usr/local/bin"

# ── 5. Configurar Tutor ───────────────────────────────────────────────────────
TUTOR_ROOT="/opt/openedx/tutor"
mkdir -p "$TUTOR_ROOT"
export TUTOR_ROOT

# Obtener IP pública de la instancia (para LMS_HOST)
PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/local-ipv4 || echo "localhost")

# Inicializar tutor con configuración no-interactiva
tutor config save \
  --set LMS_HOST="$PUBLIC_IP" \
  --set CMS_HOST="studio.$PUBLIC_IP" \
  --set ENABLE_HTTPS=false \
  --set RUN_MYSQL=false \
  --set RUN_MONGODB=true \
  --set RUN_REDIS=true \
  --set RUN_ELASTICSEARCH=true \
  --set MYSQL_HOST="$DB_HOST" \
  --set MYSQL_PORT=3306 \
  --set OPENEDX_MYSQL_USERNAME="$DB_USER" \
  --set OPENEDX_MYSQL_PASSWORD="$DB_PASS" 2>/dev/null || true

# ── 5b. Sobrescribir config para usar PostgreSQL en lugar de MySQL ─────────────
CONFIG_FILE="$TUTOR_ROOT/config.yml"
if [ -f "$CONFIG_FILE" ]; then
  python3 -c "
import yaml, sys

with open('$CONFIG_FILE') as f:
    cfg = yaml.safe_load(f) or {}

cfg['RUN_MYSQL']             = False
cfg['MYSQL_HOST']            = '$DB_HOST'
cfg['MYSQL_PORT']            = int('$DB_PORT')
cfg['OPENEDX_MYSQL_USERNAME']= '$DB_USER'
cfg['OPENEDX_MYSQL_PASSWORD']= '$DB_PASS'
cfg['OPENEDX_MYSQL_DATABASE']= 'openedx'
cfg['ENABLE_HTTPS']          = False

with open('$CONFIG_FILE', 'w') as f:
    yaml.dump(cfg, f, default_flow_style=False)

print('Config actualizado OK')
"
fi

# ── 6. Crear docker-compose override para PostgreSQL ─────────────────────────
TUTOR_ENV="$TUTOR_ROOT/env"
mkdir -p "$TUTOR_ENV/apps/openedx"

cat > "$TUTOR_ENV/apps/openedx/settings/lms/production.py" <<'PYEOF'
# Configuración adicional de producción - PostgreSQL externo
import os
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'HOST': os.environ.get('AURORA_HOST', ''),
        'PORT': os.environ.get('AURORA_PORT', '5432'),
        'NAME': 'openedx',
        'USER': os.environ.get('DB_USER', ''),
        'PASSWORD': os.environ.get('DB_PASS', ''),
        'OPTIONS': {'sslmode': 'require'},
    }
}
PYEOF

# ── 7. docker-compose.yml personalizado ───────────────────────────────────────
mkdir -p /opt/openedx
cat > /opt/openedx/docker-compose.override.yml <<EOF
version: '3.8'

# Overlay que inyecta variables de Aurora en todos los servicios OpenEDX
x-openedx-env: &openedx-env
  AURORA_HOST: ${DB_HOST}
  AURORA_PORT: ${DB_PORT}
  DB_USER: ${DB_USER}
  DB_PASS: ${DB_PASS}

services:
  lms:
    environment:
      <<: *openedx-env

  cms:
    environment:
      <<: *openedx-env

  lms-worker:
    environment:
      <<: *openedx-env

  cms-worker:
    environment:
      <<: *openedx-env
EOF

# ── 8. Levantar OpenEDX con Tutor ─────────────────────────────────────────────
cd /opt/openedx

# Descargar imágenes primero (evita timeout en primer start)
tutor images pull openedx 2>/dev/null || true

# Iniciar todos los servicios (Tutor levanta docker-compose internamente)
tutor local start --detach 2>/dev/null || true

# ── 9. Script de healthcheck ──────────────────────────────────────────────────
cat > /usr/local/bin/openedx-health <<'EOF'
#!/bin/bash
curl -sf http://localhost:80/heartbeat > /dev/null 2>&1 && echo "OK" || echo "FAIL"
EOF
chmod +x /usr/local/bin/openedx-health

echo "=== OpenEDX Replica ${INSTANCE_INDEX} iniciada - $(date) ==="
