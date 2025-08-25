#!/usr/bin/env bash
# run_all.sh — start 3 python services (DINO+OCR+PARSEC) with logs & graceful stop
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGDIR="$ROOT/logs"
mkdir -p "$LOGDIR"

# ===== Ports =====
DINO_PORT=8000        # DINO (HTTPS)
OCR_PORT=8443         # Flask OCR (HTTPS adhoc)
PARSEC_PORT=8001      # PARSEC (HTTP) — client đang gọi cổng này

# ===== Conda envs =====
DINO_ENV="dinoapi"
OCR_ENV="ocr"
PARSEC_ENV="parseq"

# ===== Paths =====
CERT_DIR="$HOME/emboss/certs"
KEY="$CERT_DIR/server.key"
CRT="$CERT_DIR/server.crt"

# Vị trí mã nguồn (điều chỉnh nếu khác)
DINO_DIR="$ROOT"                            # chứa dino_api:app
OCR_DIR="$ROOT"                             # chứa server.py
# PARSEC nằm trong thư mục ocrapif3 theo log của bạn
PARSEC_DIR="$ROOT/ocrapif3"
PARSEC_ENTRY="$PARSEC_DIR/parsec_ocr_api.py"

# ===== Sanity checks =====
require_file() { [[ -f "$1" ]] || { echo "ERROR: Không thấy file $1"; exit 1; }; }
require_dir()  { [[ -d "$1" ]] || { echo "ERROR: Không thấy thư mục $1"; exit 1; }; }

require_file "$KEY"
require_file "$CRT"
require_dir  "$DINO_DIR"
require_dir  "$OCR_DIR"
require_dir  "$PARSEC_DIR"
require_file "$PARSEC_ENTRY"

# ===== Helpers =====
pids_on_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null \
      | awk -v p=":${port}" '$4 ~ p {print $6}' \
      | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
      | sort -u
  else
    lsof -ti TCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  fi
}

kill_port() {
  local port="$1"
  local pids p
  pids="$(pids_on_port "$port" || true)"
  if [[ -n "${pids:-}" ]]; then
    echo ">>> Port $port đang bận bởi PID(s): $pids -> SIGTERM..."
    kill $pids 2>/dev/null || true
    sleep 1
    for p in $pids; do
      if kill -0 "$p" 2>/dev/null; then
        echo ">>> PID $p chưa thoát -> SIGKILL"
        kill -9 "$p" 2>/dev/null || true
      fi
    done
  fi
}

start_service() {
  local name="$1" cmd="$2" log="$3" workdir="$4"
  echo ">>> Starting $name ..."
  (
    cd "$workdir"
    setsid bash -lc "$cmd" >"$log" 2>&1 &
    echo $! > "$log.pid"
  )
  local pid
  pid="$(cat "$log.pid")"
  echo "    $name PID: $pid (PGID=$pid) | log: $log"
}

stop_service() {
  local name="$1" pidfile="$2"
  if [[ -f "$pidfile" ]]; then
    local pgid
    pgid="$(cat "$pidfile" || true)"
    if [[ -n "${pgid:-}" ]]; then
      echo ">>> Stopping $name (PGID $pgid) ..."
      kill -TERM -- "-$pgid" 2>/dev/null || true
      sleep 1
      pkill -9 -g "$pgid" 2>/dev/null || true
      wait "$pgid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

wait_listen() {
  local port="$1" name="$2" retry=60
  while ((retry--)); do
    if ss -ltn 2>/dev/null | grep -q ":$port "; then
      echo ">>> $name đã lắng nghe trên port $port"
      return 0
    fi
    sleep 0.5
  done
  echo "WARN: $name chưa thấy listen port $port (xem log để biết lỗi)."
}

cleanup() {
  echo
  stop_service "DINO"   "$LOGDIR/dino.log.pid"
  stop_service "OCR"    "$LOGDIR/ocr.log.pid"
  stop_service "PARSEC" "$LOGDIR/parsec.log.pid"
  echo "All stopped."
}
trap cleanup INT TERM EXIT

# ===== Patch PARSEC port (nếu đang hardcode 8000) =====
patch_parsec_port_if_needed() {
  # Tìm dòng uvicorn.run(... port=XXXX) và thay thành PARSEC_PORT
  if grep -Eq 'uvicorn\.run\([^)]*port\s*=\s*[0-9]+' "$PARSEC_ENTRY"; then
    if ! grep -Eq "uvicorn\.run\([^)]*port\s*=\s*${PARSEC_PORT}\b" "$PARSEC_ENTRY"; then
      echo ">>> Patching port PARSEC trong $PARSEC_ENTRY -> $PARSEC_PORT (backup .bak)"
      cp -f "$PARSEC_ENTRY" "$PARSEC_ENTRY.bak"
      sed -E -i "s/(uvicorn\.run\([^)]*port\s*=\s*)[0-9]+/\1${PARSEC_PORT}/" "$PARSEC_ENTRY"
    fi
  else
    echo "NOTE: Không thấy pattern uvicorn.run(... port=...), bỏ qua patch."
  fi
}

# ===== Commands =====
DINO_CMD="conda run -n ${DINO_ENV} uvicorn dino_api:app \
  --host 0.0.0.0 --port ${DINO_PORT} \
  --ssl-keyfile ${KEY} \
  --ssl-certfile ${CRT}"

OCR_CMD="conda run -n ${OCR_ENV} python server.py"

# PARSEC chạy bằng python script trực tiếp (không uvicorn CLI)
# Đảm bảo chạy trong thư mục của nó để tránh lỗi import module
PARSEC_CMD="conda run -n ${PARSEC_ENV} bash -lc 'python $(basename "$PARSEC_ENTRY")'"

# ===== Clean up trước khi chạy =====
stop_service "DINO (old)"   "$LOGDIR/dino.log.pid"   || true
stop_service "OCR  (old)"   "$LOGDIR/ocr.log.pid"    || true
stop_service "PARSEC (old)" "$LOGDIR/parsec.log.pid" || true

kill_port "$DINO_PORT"
kill_port "$OCR_PORT"
kill_port "$PARSEC_PORT"

# ===== Patch & Start =====
patch_parsec_port_if_needed

start_service "DINO (HTTPS :$DINO_PORT)"   "$DINO_CMD"   "$LOGDIR/dino.log"   "$DINO_DIR"
start_service "OCR  (HTTPS :$OCR_PORT)"    "$OCR_CMD"    "$LOGDIR/ocr.log"    "$OCR_DIR"
start_service "PARSEC (HTTP :$PARSEC_PORT)" "$PARSEC_CMD" "$LOGDIR/parsec.log" "$PARSEC_DIR"

wait_listen "$DINO_PORT"   "DINO"
wait_listen "$OCR_PORT"    "OCR"
wait_listen "$PARSEC_PORT" "PARSEC"

echo
echo "Endpoints:"
echo "  DINO   (API)   : https://10.13.32.51:${DINO_PORT}"
echo "  OCR    (Flask) : https://10.13.32.51:${OCR_PORT}"
echo "  PARSEC (FastAPI): http://10.13.32.51:${PARSEC_PORT}"
echo
echo "Logs:"
echo "  $LOGDIR/dino.log"
echo "  $LOGDIR/ocr.log"
echo "  $LOGDIR/parsec.log"
echo
echo "Press Ctrl+C to stop all. Tailing logs..."
echo

tail -n +1 -F "$LOGDIR/ocr.log" "$LOGDIR/dino.log" "$LOGDIR/parsec.log"
