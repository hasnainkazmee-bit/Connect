#!/usr/bin/env bash
# Creates a consistent local snapshot with a short Connect-only maintenance window.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
compose=(docker compose --env-file .env.production -f compose.production.yaml)
backup_dir="$(pwd)/.backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
app_id="$("${compose[@]}" ps -q app)"
storage_id="$("${compose[@]}" ps -q storage)"
[[ -n "$app_id" && -n "$storage_id" ]] || { echo 'Start the Connect production stack before backing it up.' >&2; exit 1; }
object_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/garage"}}{{.Name}}{{end}}{{end}}' "$storage_id")"
attachment_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}' "$app_id")"
[[ "$object_volume" == connect-production_* && "$attachment_volume" == connect-production_* ]] || exit 1
restore_services() { "${compose[@]}" up -d storage app >/dev/null; }
trap restore_services EXIT
"${compose[@]}" stop app storage
"${compose[@]}" exec -T db pg_dump -U connect -d connect -Fc > "$backup_dir/database.dump"
for component in objects attachments; do
  volume="$object_volume"; [[ "$component" == attachments ]] && volume="$attachment_volume"
  docker run --rm --network none --mount "type=volume,source=$volume,target=/source,readonly" --mount "type=bind,source=$backup_dir,target=/backup" postgres:16-alpine sh -c "tar czf /backup/$component.tar.gz -C /source ."
done
"${compose[@]}" exec -T db pg_restore --list < "$backup_dir/database.dump" > "$backup_dir/database-contents.txt"
for archive in "$backup_dir"/*.tar.gz; do tar tzf "$archive" >/dev/null; done
(cd "$backup_dir" && sha256sum database.dump objects.tar.gz attachments.tar.gz > SHA256SUMS)
chmod -R go-rwx "$backup_dir"
echo "Backup complete: $backup_dir"
