#!/bin/bash
# infra/backup.sh
set -euo pipefail

BACKUP_DIR="/docker/tinocerto-prod/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILENAME="tinocerto-prod-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

docker exec tinocerto-prod-postgres-1 pg_dump -U tinocerto_prod -d tinocerto -Fc > "${BACKUP_DIR}/${FILENAME}"

# Retencao: apaga dumps com mais de 7 dias
find "$BACKUP_DIR" -name "tinocerto-prod-*.dump" -mtime +7 -delete

echo "Backup criado: ${BACKUP_DIR}/${FILENAME}"
