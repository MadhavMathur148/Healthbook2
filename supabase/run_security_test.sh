#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies schema.sql, and tries to break it:
# cross-account reads and writes, forged columns, oversized payloads, signed-out
# access, and account deletion. Nothing here touches the real project.
set -euo pipefail
cd "$(dirname "$0")"
export PATH=/usr/lib/postgresql/16/bin:$PATH
PGD=$(mktemp -d); PORT=${PORT:-5433}
cleanup(){ pg_ctl -D "$PGD" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$PGD"; }
trap cleanup EXIT
chown -R nobody "$PGD" 2>/dev/null || true
AS=""; [ "$(id -u)" = "0" ] && AS="su -s /bin/bash nobody -c"
run(){ if [ -n "$AS" ]; then $AS "PATH=$PATH $*"; else eval "$*"; fi; }
run "initdb -D $PGD -U postgres -A trust" >/dev/null
run "pg_ctl -D $PGD -o '-p $PORT -k /tmp' -l $PGD/log -w start" >/dev/null
psql -h /tmp -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -f _test_stub.sql
psql -h /tmp -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1 -f schema.sql
echo "--- schema applied; running attacks ---"
psql -h /tmp -p "$PORT" -U postgres -f security_test.sql 2>&1 | grep -vE "^SET$|^RESET$|Pager"
