#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies every migration, runs the permission
# regression suite, then tears the cluster down. Nothing touches a real project.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=$(mktemp -d)/data
PGSOCK=$(mktemp -d)
PORT=${PORT:-5433}
PSQL="psql -h $PGSOCK -p $PORT -U postgres"

command -v "$PGBIN/initdb" >/dev/null || { echo "Postgres not found at $PGBIN — set PGBIN."; exit 2; }

# initdb and postgres refuse to run as root, so use an unprivileged account.
RUNAS=${RUNAS:-pgtest}
if [ "$(id -u)" = "0" ]; then
    id "$RUNAS" >/dev/null 2>&1 || useradd -m "$RUNAS"
    mkdir -p "$PGDATA" "$PGSOCK"; chown -R "$RUNAS" "$(dirname "$PGDATA")" "$PGSOCK"
    RUN="su $RUNAS -c"
else
    RUN="bash -c"
fi

cleanup() { $RUN "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true; }
trap cleanup EXIT

$RUN "PATH=$PGBIN:\$PATH initdb -D $PGDATA -A trust -U postgres" >/dev/null
$RUN "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-k $PGSOCK -p $PORT -c listen_addresses=' -l $PGDATA/log start" >/dev/null
sleep 2

$PSQL -q -c "create database academy;"
$PSQL -d academy -q -v ON_ERROR_STOP=1 -f supabase/tests/00_local_shim.sql
for f in supabase/migrations/*.sql; do
    $PSQL -d academy -q -v ON_ERROR_STOP=1 -f "$f" 2>/dev/null
done
$PSQL -d academy -q -c "
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;"

OUT=$($PSQL -d academy -f supabase/tests/01_rbac.test.sql 2>&1)
echo "$OUT" | grep -E "NOTICE|WARNING|==========" | sed 's/^psql.*NOTICE:  /  /; s/^psql.*WARNING:  /  FAIL /'

FAILS=$(echo "$OUT" | grep -c "WARNING" || true)
echo ""
if [ "$FAILS" -eq 0 ]; then echo "✅ all checks passed"; else echo "❌ $FAILS check(s) failed"; exit 1; fi
