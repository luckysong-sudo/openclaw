#!/usr/bin/env bash
set -euo pipefail

SPACE_PORT_VALUE="${PORT:-${OPENCLAW_SPACE_PORT:-7860}}"
PORT_VALUE="${OPENCLAW_GATEWAY_INTERNAL_PORT:-18789}"
if [ "$PORT_VALUE" = "$SPACE_PORT_VALUE" ]; then
  PORT_VALUE="18789"
fi
export OPENCLAW_SPACE_PORT="$SPACE_PORT_VALUE"
export OPENCLAW_GATEWAY_INTERNAL_PORT="$PORT_VALUE"

PUBLIC_ORIGIN="${OPENCLAW_PUBLIC_ORIGIN:-}"
if [ -z "$PUBLIC_ORIGIN" ]; then
  if [ -n "${SPACE_HOST:-}" ]; then
    PUBLIC_ORIGIN="https://${SPACE_HOST}"
  else
    PUBLIC_ORIGIN="https://hicos-bot.hf.space"
  fi
fi
PROVIDER_ID="${OPENCLAW_PROVIDER_ID:-agnes}"
BASE_URL="${AGNES_BASE_URL:-https://apihub.agnes-ai.com/v1}"
DISABLE_DEVICE_PAIRING="${OPENCLAW_DISABLE_DEVICE_PAIRING:-true}"
RAW_MODEL="${OPENCLAW_MODEL_ID:-${OPENCLAW_MODEL:-agnes-2.0-flash}}"

# If multiple KEY=VALUE lines were accidentally pasted into OPENCLAW_MODEL,
# recover the real model id instead of treating the whole block as a model name.
if printf '%s' "$RAW_MODEL" | grep -q 'OPENCLAW_MODEL_ID='; then
  RAW_MODEL="$(printf '%s\n' "$RAW_MODEL" | sed -n 's/^OPENCLAW_MODEL_ID=//p' | head -n 1)"
elif printf '%s' "$RAW_MODEL" | grep -q 'OPENCLAW_MODEL='; then
  RAW_MODEL="$(printf '%s\n' "$RAW_MODEL" | sed -n 's/^OPENCLAW_MODEL=//p' | head -n 1)"
fi

if [[ "$RAW_MODEL" == */* ]]; then
  PROVIDER_ID="${RAW_MODEL%%/*}"
  MODEL_ID="${RAW_MODEL#*/}"
else
  MODEL_ID="$RAW_MODEL"
fi

# Normalize simple provider/model ids. Custom provider ids should be lowercase
# letters, numbers, dashes or underscores.
PROVIDER_ID="$(printf '%s' "$PROVIDER_ID" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')"
MODEL_ID="$(printf '%s' "$MODEL_ID" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
PRIMARY_MODEL="${PROVIDER_ID}/${MODEL_ID}"

# Telegram token aliases. Recommended Secret name is TELEGRAM_BOT_TOKEN.
TELEGRAM_TOKEN_VALUE="${TELEGRAM_BOT_TOKEN:-${TELEGRAM_TOKEN_API:-${TELEGRAM_TOKENAPI:-${TELEGRAM_API_TOKEN:-${TELEGRAM_BOT_API_TOKEN:-${TELEGRAM_BOT_TOKEN_API:-${TELEGRAM_TOKEN:-}}}}}}}"
if [ -n "$TELEGRAM_TOKEN_VALUE" ]; then
  export TELEGRAM_BOT_TOKEN="$TELEGRAM_TOKEN_VALUE"
fi

# Telegram network hardening for Hugging Face Spaces.
# If direct egress to api.telegram.org is unstable, set TELEGRAM_PROXY_URL
# or TELEGRAM_API_ROOT as Space Variables.
export OPENCLAW_TELEGRAM_DNS_RESULT_ORDER="${OPENCLAW_TELEGRAM_DNS_RESULT_ORDER:-ipv4first}"
case " ${NODE_OPTIONS:-} " in
  *" --dns-result-order="*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first" ;;
esac
TELEGRAM_API_ROOT_VALUE="${TELEGRAM_API_ROOT:-${TELEGRAM_API_BASE_URL:-${OPENCLAW_TELEGRAM_API_ROOT:-}}}"
TELEGRAM_PROXY_VALUE="${TELEGRAM_PROXY_URL:-${OPENCLAW_TELEGRAM_PROXY:-${OPENCLAW_PROXY_URL:-}}}"
export TELEGRAM_API_ROOT_VALUE TELEGRAM_PROXY_VALUE

# Hugging Face Storage Bucket / persistent disk support.
# Recommended public Variables:
#   HF_STORAGE_NAME=your-bucket-name
#   HF_STORAGE_MOUNT_PATH=/data
# The bucket itself must be attached to the Space as a read-write volume in the
# Hugging Face UI. This script then detects the mounted path and stores
# OpenClaw state, workspace, logs, Telegram pairing data, and cache there.
HF_STORAGE_NAME_VALUE="${HF_STORAGE_NAME:-${HF_DISK_NAME:-${HF_BUCKET_NAME:-${HUGGINGFACE_STORAGE_NAME:-${HUGGINGFACE_DISK_NAME:-}}}}}"
HF_STORAGE_MOUNT_PATH_VALUE="${HF_STORAGE_MOUNT_PATH:-${HF_DISK_MOUNT_PATH:-${HF_BUCKET_MOUNT_PATH:-${OPENCLAW_STORAGE_MOUNT_PATH:-}}}}"
OPENCLAW_STORAGE_SUBDIR="${OPENCLAW_STORAGE_SUBDIR:-openclaw}"
OPENCLAW_ALLOW_EPHEMERAL_FALLBACK="${OPENCLAW_ALLOW_EPHEMERAL_FALLBACK:-false}"

trim_value() {
  printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

safe_storage_name() {
  trim_value "$1" | sed 's#^hf://buckets/##;s#/#_#g;s#[^A-Za-z0-9._-]#-#g'
}

safe_storage_basename() {
  trim_value "$1" | sed 's#^hf://buckets/##;s#/*$##' | awk -F/ '{print $NF}' | sed 's#[^A-Za-z0-9._-]#-#g'
}

realpath_dir() {
  [ -d "$1" ] || return 1
  (cd "$1" 2>/dev/null && pwd -P) || return 1
}

is_mountpoint() {
  local d
  d="$(realpath_dir "$1" 2>/dev/null)" || return 1
  awk -v d="$d" '$5 == d { found=1 } END { exit found ? 0 : 1 }' /proc/self/mountinfo 2>/dev/null
}

is_writable_dir() {
  [ -d "$1" ] && [ -w "$1" ] || return 1
  local probe="$1/.openclaw-write-test-$$"
  : > "$probe" 2>/dev/null && rm -f "$probe" 2>/dev/null
}

append_candidate() {
  local value
  value="$(trim_value "${1:-}")"
  [ -n "$value" ] || return 0
  STORAGE_CANDIDATES="${STORAGE_CANDIDATES}${value}
"
}

STORAGE_CANDIDATES=""
HF_STORAGE_NAME_VALUE="$(trim_value "$HF_STORAGE_NAME_VALUE")"
HF_STORAGE_MOUNT_PATH_VALUE="$(trim_value "$HF_STORAGE_MOUNT_PATH_VALUE")"
SAFE_STORAGE_NAME="$(safe_storage_name "$HF_STORAGE_NAME_VALUE")"
SAFE_STORAGE_BASENAME="$(safe_storage_basename "$HF_STORAGE_NAME_VALUE")"

append_candidate "$HF_STORAGE_MOUNT_PATH_VALUE"
if [ -n "$SAFE_STORAGE_NAME" ]; then
  append_candidate "/data/$SAFE_STORAGE_NAME"
  append_candidate "/mnt/$SAFE_STORAGE_NAME"
  append_candidate "/storage/$SAFE_STORAGE_NAME"
  append_candidate "/volumes/$SAFE_STORAGE_NAME"
  if [ -n "$SAFE_STORAGE_BASENAME" ] && [ "$SAFE_STORAGE_BASENAME" != "$SAFE_STORAGE_NAME" ]; then
    append_candidate "/data/$SAFE_STORAGE_BASENAME"
    append_candidate "/mnt/$SAFE_STORAGE_BASENAME"
    append_candidate "/storage/$SAFE_STORAGE_BASENAME"
    append_candidate "/volumes/$SAFE_STORAGE_BASENAME"
  fi
  append_candidate "/data"
else
  append_candidate "/data"
fi

REQUIRE_HF_STORAGE="false"
if [ -n "$HF_STORAGE_NAME_VALUE" ] || [ -n "$HF_STORAGE_MOUNT_PATH_VALUE" ]; then
  REQUIRE_HF_STORAGE="true"
fi
if [ "$(printf '%s' "$OPENCLAW_ALLOW_EPHEMERAL_FALLBACK" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  REQUIRE_HF_STORAGE="false"
fi

STORAGE_BASE=""
while IFS= read -r candidate; do
  candidate="$(trim_value "$candidate")"
  [ -n "$candidate" ] || continue
  [ -d "$candidate" ] || continue
  if [ "$REQUIRE_HF_STORAGE" = "true" ] && ! is_mountpoint "$candidate"; then
    echo "Storage candidate exists but is not a mounted Hugging Face volume: $candidate"
    continue
  fi
  if is_writable_dir "$candidate"; then
    STORAGE_BASE="$candidate"
    break
  fi
  echo "Storage candidate exists but is not writable: $candidate"
done <<EOF_CANDIDATES
$STORAGE_CANDIDATES
EOF_CANDIDATES

if [ -z "$STORAGE_BASE" ]; then
  if [ "$REQUIRE_HF_STORAGE" = "true" ]; then
    echo "ERROR: HF_STORAGE_NAME or HF_STORAGE_MOUNT_PATH is set, but no matching read-write mounted volume was found."
    echo "Attach your Hugging Face Storage Bucket to this Space as a read-write volume, preferably with mount path /data."
    echo "Then set public Variable HF_STORAGE_NAME to the bucket name and HF_STORAGE_MOUNT_PATH to the mount path, for example /data."
    echo "Set OPENCLAW_ALLOW_EPHEMERAL_FALLBACK=true only if you accept losing data after Space restarts."
    exit 1
  fi
  if mkdir -p /data 2>/dev/null && is_writable_dir /data; then
    STORAGE_BASE="/data"
    echo "WARNING: No HF_STORAGE_NAME was provided. Using /data if available; without an attached HF volume this can be ephemeral."
  else
    STORAGE_BASE="${HOME}"
    echo "WARNING: No writable /data found. Using HOME; data may be ephemeral."
  fi
fi

case "$OPENCLAW_STORAGE_SUBDIR" in
  ""|".") OPENCLAW_ROOT="$STORAGE_BASE" ;;
  /*) OPENCLAW_ROOT="$OPENCLAW_STORAGE_SUBDIR" ;;
  *)
    if [ "$(basename "$STORAGE_BASE")" = "$OPENCLAW_STORAGE_SUBDIR" ]; then
      OPENCLAW_ROOT="$STORAGE_BASE"
    else
      OPENCLAW_ROOT="$STORAGE_BASE/$OPENCLAW_STORAGE_SUBDIR"
    fi
    ;;
esac

mkdir -p "$OPENCLAW_ROOT"
STORAGE_IS_MOUNT="false"
if is_mountpoint "$STORAGE_BASE"; then
  STORAGE_IS_MOUNT="true"
fi
export HF_HOME="${HF_HOME:-$STORAGE_BASE/.huggingface}"
mkdir -p "$HF_HOME"

cat > "$OPENCLAW_ROOT/.hf-storage-link.json" <<EOF_STORAGE_MARKER
{
  "storageName": "$HF_STORAGE_NAME_VALUE",
  "storageBase": "$STORAGE_BASE",
  "storageBaseIsMount": "$STORAGE_IS_MOUNT",
  "openclawRoot": "$OPENCLAW_ROOT",
  "hfHome": "$HF_HOME"
}
EOF_STORAGE_MARKER

mkdir -p \
  "$OPENCLAW_ROOT/workspace" \
  "$OPENCLAW_ROOT/auth-secrets" \
  "$OPENCLAW_ROOT/logs" \
  "$HOME/.config/openclaw"

export OPENCLAW_CONFIG_DIR="$OPENCLAW_ROOT"
export OPENCLAW_STATE_DIR="$OPENCLAW_ROOT"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_ROOT/openclaw.json"
export OPENCLAW_WORKSPACE_DIR="$OPENCLAW_ROOT/workspace"
export OPENCLAW_AUTH_PROFILE_SECRET_DIR="$OPENCLAW_ROOT/auth-secrets"
export OPENCLAW_GATEWAY_PORT="$PORT_VALUE"
export OPENCLAW_GATEWAY_BIND="lan"
export OPENCLAW_DISABLE_BONJOUR="${OPENCLAW_DISABLE_BONJOUR:-1}"
export PROVIDER_ID MODEL_ID PRIMARY_MODEL BASE_URL PUBLIC_ORIGIN DISABLE_DEVICE_PAIRING

# Stable login token. Set OPENCLAW_GATEWAY_TOKEN as a Space Secret.
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  TOKEN_FILE="$OPENCLAW_ROOT/.gateway-token"
  if [ -f "$TOKEN_FILE" ]; then
    export OPENCLAW_GATEWAY_TOKEN="$(cat "$TOKEN_FILE")"
  else
    export OPENCLAW_GATEWAY_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    umask 077
    printf '%s' "$OPENCLAW_GATEWAY_TOKEN" > "$TOKEN_FILE"
  fi
  echo "WARNING: OPENCLAW_GATEWAY_TOKEN was not set as a Secret. A token was generated for this Space."
  echo "Set OPENCLAW_GATEWAY_TOKEN as a Hugging Face Space Secret for stable login. The generated token is intentionally not printed."
fi

if [ -z "${AGNES_API_KEY:-}" ]; then
  echo "WARNING: AGNES_API_KEY is not set. OpenClaw can start, but Agnes model calls will fail until you add it as a Space Secret."
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "WARNING: TELEGRAM_BOT_TOKEN is not set. Telegram channel will be disabled."
fi


# Optional Telegram proxy discovery.
# This is intentionally opt-in because public free proxies are often unstable
# and untrusted. Set TELEGRAM_AUTO_PROXY_DISCOVERY=true to enable.
mask_proxy_for_log() {
  printf '%s' "${1:-}" | sed -E 's#(://)[^/@]+@#\1***@#'
}

truthy_shell() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

infer_proxy_scheme_from_source() {
  local src lower
  src="${1:-}"
  lower="$(printf '%s' "$src" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *socks5*) printf 'socks5' ;;
    *socks4*) printf 'socks4' ;;
    *) printf 'http' ;;
  esac
}

normalize_proxy_candidate() {
  local raw default_scheme line
  raw="${1:-}"
  default_scheme="${2:-http}"
  line="$(printf '%s' "$raw" | tr -d '\r' | sed 's/[[:space:]]*#.*$//;s/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -n "$line" ] || return 0
  case "$line" in
    http://*|https://*|socks4://*|socks5://*) printf '%s\n' "$line" ;;
    *://*) return 0 ;;
    *)
      if printf '%s' "$line" | grep -Eq '^[A-Za-z0-9._:-]+:[0-9]{2,5}$'; then
        printf '%s://%s\n' "$default_scheme" "$line"
      fi
      ;;
  esac
}

test_telegram_proxy_with_curl() {
  local proxy body_file max_time connect_time
  proxy="${1:-}"
  max_time="${TELEGRAM_PROXY_TEST_TIMEOUT_SECONDS:-8}"
  connect_time="${TELEGRAM_PROXY_CONNECT_TIMEOUT_SECONDS:-4}"
  body_file="$(mktemp)"
  if curl -fsS --connect-timeout "$connect_time" --max-time "$max_time" \
      --proxy "$proxy" \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" \
      -o "$body_file" >/dev/null 2>&1 \
      && grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$body_file"; then
    rm -f "$body_file"
    return 0
  fi
  rm -f "$body_file"
  return 1
}

test_telegram_direct_with_curl() {
  local body_file max_time connect_time
  max_time="${TELEGRAM_DIRECT_TEST_TIMEOUT_SECONDS:-8}"
  connect_time="${TELEGRAM_DIRECT_CONNECT_TIMEOUT_SECONDS:-4}"
  body_file="$(mktemp)"
  if curl -fsS --connect-timeout "$connect_time" --max-time "$max_time" \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" \
      -o "$body_file" >/dev/null 2>&1 \
      && grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$body_file"; then
    rm -f "$body_file"
    return 0
  fi
  rm -f "$body_file"
  return 1
}

collect_manual_proxy_candidates() {
  local default_scheme
  default_scheme="${1:-socks5}"
  printf '%s\n' "${TELEGRAM_PROXY_CANDIDATES:-${OPENCLAW_TELEGRAM_PROXY_CANDIDATES:-}}" \
    | tr ',;' '\n\n' \
    | while IFS= read -r line; do normalize_proxy_candidate "$line" "$default_scheme"; done
}

collect_remote_proxy_candidates() {
  local sources entry scheme url default_sources max_source_time
  max_source_time="${TELEGRAM_PROXY_SOURCE_TIMEOUT_SECONDS:-8}"
  default_sources='socks5|https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt
socks5|https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt
socks4|https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt
http|https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt
http|https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
  sources="${TELEGRAM_PROXY_LIST_URLS:-${TELEGRAM_FREE_PROXY_LIST_URLS:-${OPENCLAW_TELEGRAM_PROXY_LIST_URLS:-$default_sources}}}"
  printf '%s\n' "$sources" | tr ',;' '\n\n' | while IFS= read -r entry; do
    entry="$(trim_value "$entry")"
    [ -n "$entry" ] || continue
    if printf '%s' "$entry" | grep -q '|'; then
      scheme="${entry%%|*}"
      url="${entry#*|}"
    else
      url="$entry"
      scheme="$(infer_proxy_scheme_from_source "$url")"
    fi
    scheme="$(printf '%s' "$scheme" | tr '[:upper:]' '[:lower:]')"
    case "$scheme" in socks5|socks4|http|https) ;; *) scheme='http' ;; esac
    echo "Telegram proxy discovery: downloading candidate list $(mask_proxy_for_log "$url") as $scheme..." >&2
    curl -fsSL --connect-timeout 5 --max-time "$max_source_time" "$url" 2>/dev/null \
      | while IFS= read -r line; do normalize_proxy_candidate "$line" "$scheme"; done || true
  done
}

select_working_telegram_proxy() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || return 1
  command -v curl >/dev/null 2>&1 || {
    echo "Telegram proxy discovery skipped: curl is not available in this image." >&2
    return 1
  }

  local selected_file candidates_file seen_file winner_file max_candidates concurrency saved_proxy explicit_proxy
  selected_file="$OPENCLAW_ROOT/.telegram-proxy-selected"
  candidates_file="$(mktemp)"
  seen_file="$(mktemp)"
  winner_file="$(mktemp)"
  : > "$winner_file"
  max_candidates="${TELEGRAM_PROXY_MAX_CANDIDATES:-80}"
  concurrency="${TELEGRAM_PROXY_TEST_CONCURRENCY:-8}"

  cleanup_proxy_tmp() {
    rm -f "$candidates_file" "$seen_file" "$winner_file" 2>/dev/null || true
  }

  # Prefer direct Telegram access when it works. This avoids routing bot traffic
  # through an untrusted public proxy unnecessarily.
  if truthy_shell "${TELEGRAM_DIRECT_CHECK_BEFORE_PROXY:-true}"; then
    echo "Telegram proxy discovery: testing direct Telegram Bot API first..." >&2
    if test_telegram_direct_with_curl; then
      echo "Telegram proxy discovery: direct Telegram access works; no proxy will be used." >&2
      rm -f "$selected_file" 2>/dev/null || true
      cleanup_proxy_tmp
      return 1
    fi
    echo "Telegram proxy discovery: direct Telegram access failed; trying proxy options." >&2
  fi

  # Test explicitly configured proxy first.
  explicit_proxy="$(trim_value "${TELEGRAM_PROXY_VALUE:-}")"
  if [ -n "$explicit_proxy" ]; then
    echo "Telegram proxy discovery: testing configured proxy $(mask_proxy_for_log "$explicit_proxy")..." >&2
    if test_telegram_proxy_with_curl "$explicit_proxy"; then
      echo "$explicit_proxy" > "$selected_file"
      cleanup_proxy_tmp
      printf '%s\n' "$explicit_proxy"
      return 0
    fi
    echo "Telegram proxy discovery: configured proxy failed." >&2
  fi

  # Reuse a previously discovered proxy if it still works.
  if [ -f "$selected_file" ]; then
    saved_proxy="$(head -n 1 "$selected_file" | tr -d '\r')"
    saved_proxy="$(trim_value "$saved_proxy")"
    if [ -n "$saved_proxy" ]; then
      echo "Telegram proxy discovery: testing saved proxy $(mask_proxy_for_log "$saved_proxy")..." >&2
      if test_telegram_proxy_with_curl "$saved_proxy"; then
        cleanup_proxy_tmp
        printf '%s\n' "$saved_proxy"
        return 0
      fi
      echo "Telegram proxy discovery: saved proxy failed; refreshing candidate list." >&2
      rm -f "$selected_file" 2>/dev/null || true
    fi
  fi

  collect_manual_proxy_candidates socks5 > "$candidates_file" || true
  if truthy_shell "${TELEGRAM_AUTO_PROXY_DISCOVERY_FETCH_SOURCES:-true}"; then
    collect_remote_proxy_candidates >> "$candidates_file" || true
  fi

  # De-duplicate and cap the number of candidates.
  awk 'NF && !seen[$0]++ { print }' "$candidates_file" | head -n "$max_candidates" > "$seen_file"
  local count
  count="$(wc -l < "$seen_file" | tr -d ' ')"
  if [ "${count:-0}" = "0" ]; then
    echo "Telegram proxy discovery: no proxy candidates found." >&2
    cleanup_proxy_tmp
    return 1
  fi

  echo "Telegram proxy discovery: testing $count proxy candidates with concurrency $concurrency..." >&2
  local running proxy
  running=0
  while IFS= read -r proxy; do
    [ -n "$proxy" ] || continue
    [ -s "$winner_file" ] && break
    (
      if [ ! -s "$winner_file" ] && test_telegram_proxy_with_curl "$proxy"; then
        printf '%s\n' "$proxy" > "$winner_file"
      fi
    ) &
    running=$((running + 1))
    if [ "$running" -ge "$concurrency" ]; then
      wait -n || true
      running=$((running - 1))
    fi
  done < "$seen_file"
  wait || true

  if [ -s "$winner_file" ]; then
    local winner
    winner="$(head -n 1 "$winner_file" | tr -d '\r')"
    winner="$(trim_value "$winner")"
    if [ -n "$winner" ]; then
      echo "$winner" > "$selected_file"
      echo "Telegram proxy discovery: selected working proxy $(mask_proxy_for_log "$winner")." >&2
      cleanup_proxy_tmp
      printf '%s\n' "$winner"
      return 0
    fi
  fi

  echo "Telegram proxy discovery: no working proxy found in this run." >&2
  cleanup_proxy_tmp
  return 1
}

if truthy_shell "${TELEGRAM_AUTO_PROXY_DISCOVERY:-false}"; then
  echo "Telegram auto proxy discovery is enabled. Public free proxies can be slow, unstable, and untrusted." >&2
  DISCOVERED_TELEGRAM_PROXY="$(select_working_telegram_proxy || true)"
  DISCOVERED_TELEGRAM_PROXY="$(printf '%s\n' "$DISCOVERED_TELEGRAM_PROXY" | tail -n 1 | tr -d '\r')"
  DISCOVERED_TELEGRAM_PROXY="$(trim_value "$DISCOVERED_TELEGRAM_PROXY")"
  if [ -n "$DISCOVERED_TELEGRAM_PROXY" ]; then
    export TELEGRAM_PROXY_VALUE="$DISCOVERED_TELEGRAM_PROXY"
    export OPENCLAW_TELEGRAM_PROXY="$DISCOVERED_TELEGRAM_PROXY"
    echo "Telegram proxy discovery: using proxy $(mask_proxy_for_log "$DISCOVERED_TELEGRAM_PROXY") for Telegram channel only." >&2
  elif truthy_shell "${TELEGRAM_REQUIRE_WORKING_PROXY:-false}"; then
    echo "ERROR: TELEGRAM_REQUIRE_WORKING_PROXY=true but no working Telegram proxy was found." >&2
    exit 1
  else
    echo "Telegram proxy discovery: continuing without proxy; OpenClaw will still start." >&2
  fi
fi

# Keep startup compatible with OpenClaw's current custom-provider schema.
# The Agnes model supports a larger window, but OpenClaw custom-provider schemas
# have changed across versions. Start safely; opt into the full value later.
REQUESTED_CONTEXT_WINDOW="${OPENCLAW_CONTEXT_WINDOW:-200000}"
REQUESTED_MAX_TOKENS="${OPENCLAW_MAX_TOKENS:-8192}"
ALLOW_LARGE_CONTEXT="${OPENCLAW_ALLOW_LARGE_CONTEXT:-false}"
export REQUESTED_CONTEXT_WINDOW REQUESTED_MAX_TOKENS ALLOW_LARGE_CONTEXT

node <<'NODE'
const fs = require('fs');
const path = require('path');

function asPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function truthy(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function splitList(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeTelegramUserIds(value, { allowWildcard = false } = {}) {
  const out = [];
  for (const raw of splitList(value)) {
    let v = raw.replace(/^telegram:/i, '').replace(/^tg:/i, '').trim();
    if (allowWildcard && v === '*') {
      out.push('*');
      continue;
    }
    // OpenClaw recommends durable numeric Telegram user IDs for allowlists.
    if (/^\d+$/.test(v)) out.push(v);
    else console.log(`WARNING: Ignoring non-numeric Telegram user id in allowlist: ${raw}`);
  }
  return Array.from(new Set(out));
}

function normalizeTelegramGroupIds(value) {
  const out = [];
  for (const raw of splitList(value)) {
    const v = raw.trim();
    if (v === '*' || /^-?\d+$/.test(v)) out.push(v);
    else console.log(`WARNING: Ignoring invalid Telegram group chat id: ${raw}`);
  }
  return Array.from(new Set(out));
}

async function detectFirstPrivateTelegramUserId(token) {
  if (!token || typeof fetch !== 'function') return null;
  const timeoutMs = asPositiveInt(process.env.TELEGRAM_AUTO_ALLOW_TIMEOUT_MS, 5000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const allowed = encodeURIComponent(JSON.stringify(['message']));
    const url = `https://api.telegram.org/bot${token}/getUpdates?limit=20&timeout=2&allowed_updates=${allowed}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.log(`WARNING: Telegram getUpdates returned HTTP ${res.status}; cannot auto-detect owner.`);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true || !Array.isArray(data.result)) return null;
    for (const update of data.result) {
      const msg = update.message || update.edited_message;
      const fromId = msg && msg.from && msg.from.id;
      const chatType = msg && msg.chat && msg.chat.type;
      if (chatType === 'private' && /^\d+$/.test(String(fromId || ''))) {
        return String(fromId);
      }
    }
  } catch (err) {
    console.log(`WARNING: Telegram first-DM auto-detect failed: ${err && err.message ? err.message : err}`);
  } finally {
    clearTimeout(timer);
  }
  return null;
}


function parseUrlList(value) {
  return Array.from(new Set(String(value || '')
    .split(/[\n\r,;]+/)
    .map((v) => v.trim())
    .filter(Boolean)));
}

function redactProxyUrl(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '***';
    }
    return u.toString();
  } catch (_) {
    return String(value || '').replace(/:\/\/([^:@]+):([^@]+)@/, '://***:***@');
  }
}

function candidateLimit() {
  return Math.max(1, Math.min(asPositiveInt(process.env.TELEGRAM_MAX_NETWORK_CANDIDATES, 8), 30));
}

async function directTelegramGetMe(root, token, timeoutMs) {
  if (!token || typeof fetch !== 'function') return { ok: false, reason: 'fetch unavailable' };
  const cleanRoot = String(root || 'https://api.telegram.org').replace(/\/$/, '');
  if (/\/bot[^/]*\/?$/i.test(cleanRoot)) return { ok: false, reason: 'root must not contain /bot<TOKEN>' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cleanRoot}/bot${token}/getMe`, { signal: controller.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const data = JSON.parse(text);
    if (data && data.ok === true) return { ok: true };
    return { ok: false, reason: data && data.description ? data.description : 'Telegram returned ok=false' };
  } catch (err) {
    return { ok: false, reason: err && err.name === 'AbortError' ? 'timeout' : String(err && err.message ? err.message : err) };
  } finally {
    clearTimeout(timer);
  }
}

function connectSocket({ host, port, tlsToProxy = false, servername, timeoutMs }) {
  const net = require('net');
  const tls = require('tls');
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, socket) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(socket);
    };
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch (_) {}
      done(new Error('connect timeout'));
    }, timeoutMs);
    const socket = tlsToProxy
      ? tls.connect({ host, port, servername: servername || host, rejectUnauthorized: true }, () => done(null, socket))
      : net.connect({ host, port }, () => done(null, socket));
    socket.once('error', (err) => done(err));
  });
}

function readUntil(socket, marker, timeoutMs, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let total = 0;
    const timer = setTimeout(() => cleanup(new Error('read timeout')), timeoutMs);
    function cleanup(err, value) {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (err) reject(err); else resolve(value);
    }
    function onError(err) { cleanup(err); }
    function onData(chunk) {
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxBytes) return cleanup(new Error('response too large'));
      const buf = Buffer.concat(chunks, total);
      const idx = buf.indexOf(marker);
      if (idx >= 0) cleanup(null, buf);
    }
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function readExact(socket, bytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let total = 0;
    const timer = setTimeout(() => cleanup(new Error('read timeout')), timeoutMs);
    function cleanup(err, value) {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (err) reject(err); else resolve(value);
    }
    function onError(err) { cleanup(err); }
    function onData(chunk) {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= bytes) {
        const buf = Buffer.concat(chunks, total);
        const need = buf.subarray(0, bytes);
        const rest = buf.subarray(bytes);
        if (rest.length) socket.unshift(rest);
        cleanup(null, need);
      }
    }
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function openHttpConnectTunnel(proxyUrl, targetHost, targetPort, timeoutMs) {
  const u = new URL(proxyUrl);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`unsupported HTTP proxy protocol ${u.protocol}`);
  const proxyPort = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  const socket = await connectSocket({
    host: u.hostname,
    port: proxyPort,
    tlsToProxy: u.protocol === 'https:',
    servername: u.hostname,
    timeoutMs,
  });
  const user = decodeURIComponent(u.username || '');
  const pass = decodeURIComponent(u.password || '');
  const auth = user ? `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}\r\n` : '';
  socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}Connection: keep-alive\r\n\r\n`);
  const header = (await readUntil(socket, Buffer.from('\r\n\r\n'), timeoutMs)).toString('latin1');
  if (!/^HTTP\/1\.[01]\s+2\d\d\b/.test(header)) {
    try { socket.destroy(); } catch (_) {}
    throw new Error((header.split('\r\n')[0] || 'CONNECT failed').slice(0, 120));
  }
  return socket;
}

async function openSocks5Tunnel(proxyUrl, targetHost, targetPort, timeoutMs) {
  const u = new URL(proxyUrl);
  if (!['socks5:', 'socks5h:'].includes(u.protocol)) throw new Error(`unsupported SOCKS proxy protocol ${u.protocol}`);
  const socket = await connectSocket({ host: u.hostname, port: Number(u.port || 1080), timeoutMs });
  const user = decodeURIComponent(u.username || '');
  const pass = decodeURIComponent(u.password || '');
  const methods = user ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
  socket.write(methods);
  const methodReply = await readExact(socket, 2, timeoutMs);
  if (methodReply[0] !== 0x05 || methodReply[1] === 0xff) throw new Error('SOCKS5 auth method rejected');
  if (methodReply[1] === 0x02) {
    const ub = Buffer.from(user);
    const pb = Buffer.from(pass);
    if (ub.length > 255 || pb.length > 255) throw new Error('SOCKS5 credentials too long');
    socket.write(Buffer.concat([Buffer.from([0x01, ub.length]), ub, Buffer.from([pb.length]), pb]));
    const authReply = await readExact(socket, 2, timeoutMs);
    if (authReply[1] !== 0x00) throw new Error('SOCKS5 username/password rejected');
  }
  const hostBuf = Buffer.from(targetHost);
  if (hostBuf.length > 255) throw new Error('target hostname too long');
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(targetPort, 0);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]));
  const head = await readExact(socket, 4, timeoutMs);
  if (head[1] !== 0x00) throw new Error(`SOCKS5 connect failed rep=${head[1]}`);
  const atyp = head[3];
  if (atyp === 0x01) await readExact(socket, 4 + 2, timeoutMs);
  else if (atyp === 0x03) {
    const len = (await readExact(socket, 1, timeoutMs))[0];
    await readExact(socket, len + 2, timeoutMs);
  } else if (atyp === 0x04) await readExact(socket, 16 + 2, timeoutMs);
  else throw new Error('SOCKS5 unknown address type');
  return socket;
}

async function telegramGetMeViaProxy(proxyUrl, token, timeoutMs) {
  const tls = require('tls');
  let raw;
  const u = new URL(proxyUrl);
  if (['http:', 'https:'].includes(u.protocol)) raw = await openHttpConnectTunnel(proxyUrl, 'api.telegram.org', 443, timeoutMs);
  else if (['socks5:', 'socks5h:'].includes(u.protocol)) raw = await openSocks5Tunnel(proxyUrl, 'api.telegram.org', 443, timeoutMs);
  else return { ok: false, reason: `unsupported proxy protocol ${u.protocol}` };

  const secure = await new Promise((resolve, reject) => {
    const socket = tls.connect({ socket: raw, servername: 'api.telegram.org', rejectUnauthorized: true }, () => resolve(socket));
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch (_) {}
      reject(new Error('TLS timeout'));
    }, timeoutMs);
    socket.once('secureConnect', () => clearTimeout(timer));
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const path = `/bot${token}/getMe`;
  secure.write(`GET ${path} HTTP/1.1\r\nHost: api.telegram.org\r\nUser-Agent: openclaw-hf-preflight\r\nConnection: close\r\n\r\n`);
  const data = await new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      try { secure.destroy(); } catch (_) {}
      reject(new Error('read timeout'));
    }, timeoutMs);
    secure.on('data', (c) => chunks.push(c));
    secure.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    secure.once('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
  const status = /^HTTP\/1\.[01]\s+(\d+)/.exec(data);
  if (!status) return { ok: false, reason: 'invalid HTTP response' };
  if (Number(status[1]) < 200 || Number(status[1]) >= 300) return { ok: false, reason: `HTTP ${status[1]}` };
  const body = data.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  const json = JSON.parse(body);
  if (json && json.ok === true) return { ok: true };
  return { ok: false, reason: json && json.description ? json.description : 'Telegram returned ok=false' };
}

async function selectTelegramNetworkRoute(token) {
  const auto = !['0', 'false', 'no', 'off', 'disabled'].includes(String(process.env.TELEGRAM_NETWORK_AUTO_SELECT || 'true').trim().toLowerCase());
  const timeoutMs = asPositiveInt(process.env.TELEGRAM_PROXY_TEST_TIMEOUT_MS || process.env.TELEGRAM_NETWORK_TEST_TIMEOUT_MS, 7000);
  const forceProxy = truthy(process.env.TELEGRAM_FORCE_PROXY || process.env.OPENCLAW_TELEGRAM_FORCE_PROXY || 'false');
  const explicitApiRoot = String(process.env.TELEGRAM_API_ROOT_VALUE || '').trim().replace(/\/$/, '');
  const explicitProxy = String(process.env.TELEGRAM_PROXY_VALUE || '').trim();
  const apiRoots = Array.from(new Set([explicitApiRoot, ...parseUrlList(process.env.TELEGRAM_API_ROOT_CANDIDATES || process.env.OPENCLAW_TELEGRAM_API_ROOT_CANDIDATES)].filter(Boolean))).slice(0, candidateLimit());
  const proxies = Array.from(new Set([explicitProxy, ...parseUrlList(process.env.TELEGRAM_PROXY_CANDIDATES || process.env.OPENCLAW_TELEGRAM_PROXY_CANDIDATES)].filter(Boolean))).slice(0, candidateLimit());

  if (!token || !auto) return { apiRoot: explicitApiRoot, proxy: explicitProxy, summary: auto ? 'not-tested' : 'auto-select disabled' };

  if (!forceProxy) {
    const direct = await directTelegramGetMe('https://api.telegram.org', token, timeoutMs);
    if (direct.ok) return { apiRoot: '', proxy: '', summary: 'direct api.telegram.org OK' };
    console.log(`Telegram network preflight: direct api.telegram.org failed (${direct.reason}). Trying configured candidates.`);
  } else {
    console.log('Telegram network preflight: TELEGRAM_FORCE_PROXY=true; skipping direct api.telegram.org test.');
  }

  for (const root of apiRoots) {
    const clean = root.replace(/\/$/, '');
    if (!/^https?:\/\//i.test(clean)) {
      console.log(`Telegram network preflight: skipping invalid API root ${clean}`);
      continue;
    }
    if (/\/bot[^/]*\/?$/i.test(clean)) {
      console.log(`Telegram network preflight: skipping API root that includes /bot<TOKEN>: ${clean}`);
      continue;
    }
    const r = await directTelegramGetMe(clean, token, timeoutMs);
    if (r.ok) return { apiRoot: clean, proxy: '', summary: `apiRoot OK: ${clean}` };
    console.log(`Telegram network preflight: API root failed ${clean} (${r.reason}).`);
  }

  for (const proxy of proxies) {
    let u;
    try { u = new URL(proxy); } catch (err) {
      console.log(`Telegram network preflight: skipping invalid proxy URL: ${proxy}`);
      continue;
    }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(u.protocol)) {
      console.log(`Telegram network preflight: skipping unsupported proxy protocol ${u.protocol} for ${redactProxyUrl(proxy)}`);
      continue;
    }
    try {
      const r = await telegramGetMeViaProxy(proxy, token, timeoutMs);
      if (r.ok) return { apiRoot: '', proxy, summary: `proxy OK: ${redactProxyUrl(proxy)}` };
      console.log(`Telegram network preflight: proxy failed ${redactProxyUrl(proxy)} (${r.reason}).`);
    } catch (err) {
      console.log(`Telegram network preflight: proxy failed ${redactProxyUrl(proxy)} (${err && err.message ? err.message : err}).`);
    }
  }

  if (apiRoots.length === 0 && proxies.length === 0) {
    console.log('Telegram network preflight: no TELEGRAM_API_ROOT_CANDIDATES or TELEGRAM_PROXY_CANDIDATES provided. Auto-searching random public free proxies is disabled for safety.');
  }
  return { apiRoot: explicitApiRoot, proxy: explicitProxy, summary: 'no working route found during preflight' };
}

async function main() {
const configPath = process.env.OPENCLAW_CONFIG_PATH;
const port = asPositiveInt(process.env.OPENCLAW_GATEWAY_PORT, 18789);
const externalPort = asPositiveInt(process.env.OPENCLAW_SPACE_PORT || process.env.PORT, 7860);
const publicOrigin = (process.env.PUBLIC_ORIGIN || 'https://hicos-bot.hf.space').replace(/\/$/, '').toLowerCase();
const providerId = process.env.PROVIDER_ID || 'agnes';
const modelId = process.env.MODEL_ID || 'agnes-2.0-flash';
const primaryModel = process.env.PRIMARY_MODEL || `${providerId}/${modelId}`;
const baseUrl = (process.env.BASE_URL || 'https://apihub.agnes-ai.com/v1').replace(/\/$/, '');
const disablePairing = truthy(process.env.DISABLE_DEVICE_PAIRING || 'true');

const requestedContextWindow = asPositiveInt(process.env.REQUESTED_CONTEXT_WINDOW, 200000);
const requestedMaxTokens = asPositiveInt(process.env.REQUESTED_MAX_TOKENS, 8192);
const allowLargeContext = truthy(process.env.ALLOW_LARGE_CONTEXT || 'false');
const contextWindow = allowLargeContext ? requestedContextWindow : Math.min(requestedContextWindow, 200000);
const maxTokens = Math.min(requestedMaxTokens, 8192);

const origins = [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://localhost:${externalPort}`,
  `http://127.0.0.1:${externalPort}`,
  'https://huggingface.co',
];
if (publicOrigin) origins.push(publicOrigin);

const cfg = {
  gateway: {
    mode: 'local',
    port,
    bind: 'lan',
    auth: { mode: 'token' },
    controlUi: {
      enabled: true,
      basePath: '/',
      allowedOrigins: Array.from(new Set(origins)),
      dangerouslyDisableDeviceAuth: disablePairing,
    },
    reload: { mode: 'hybrid' },
  },

  models: {
    mode: 'merge',
    providers: {
      [providerId]: {
        baseUrl,
        apiKey: '${AGNES_API_KEY}',
        api: 'openai-completions',
        timeoutSeconds: 300,
        models: [
          {
            id: modelId,
            name: 'Agnes 2.0 Flash',
            contextWindow,
            maxTokens,
          },
        ],
      },
    },
  },

  agents: {
    defaults: {
      workspace: process.env.OPENCLAW_WORKSPACE_DIR || '/data/openclaw/workspace',
      userTimezone: process.env.TZ || 'Asia/Shanghai',
      model: {
        primary: primaryModel,
        fallbacks: [],
      },
      sandbox: { mode: 'off' },
      memorySearch: { enabled: false },
    },
    list: [
      {
        id: 'main',
        default: true,
        identity: {
          name: 'OpenClaw Agnes',
          theme: 'private Hugging Face Space using Agnes AI and Telegram',
          emoji: '',
        },
      },
    ],
  },

  tools: {
    fs: { workspaceOnly: true },
    elevated: { enabled: false },
  },

  skills: {
    install: {
      allowUploadedArchives: false,
    },
  },
};

const hasTelegramToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
const telegramEnableSetting = String(process.env.OPENCLAW_TELEGRAM_ENABLED || 'auto').trim().toLowerCase();
const telegramDisabled = ['0', 'false', 'no', 'off', 'disabled'].includes(telegramEnableSetting);
const selectedTelegramNetwork = (hasTelegramToken && !telegramDisabled)
  ? await selectTelegramNetworkRoute(process.env.TELEGRAM_BOT_TOKEN)
  : { apiRoot: String(process.env.TELEGRAM_API_ROOT_VALUE || '').trim().replace(/\/$/, ''), proxy: String(process.env.TELEGRAM_PROXY_VALUE || '').trim(), summary: 'telegram disabled' };
let telegramSummary = hasTelegramToken ? 'disabled by OPENCLAW_TELEGRAM_ENABLED=false' : 'disabled; TELEGRAM_BOT_TOKEN is not set';
if (hasTelegramToken && !telegramDisabled) {
  let allowedUserIds = normalizeTelegramUserIds([
    process.env.TELEGRAM_OWNER_ID,
    process.env.TELEGRAM_OWNER_IDS,
    process.env.OPENCLAW_TELEGRAM_OWNER_ID,
    process.env.OPENCLAW_TELEGRAM_OWNER_IDS,
    process.env.TELEGRAM_ALLOWED_USER_IDS,
    process.env.TELEGRAM_ALLOWED_USERS,
    process.env.TELEGRAM_ALLOW_FROM,
    process.env.OPENCLAW_TELEGRAM_ALLOWED_USERS,
  ].filter(Boolean).join(','), { allowWildcard: false });

  const autoAllowFirstDm = truthy(process.env.TELEGRAM_AUTO_ALLOW_FIRST_DM || 'true');
  if (allowedUserIds.length === 0 && autoAllowFirstDm) {
    const detected = await detectFirstPrivateTelegramUserId(process.env.TELEGRAM_BOT_TOKEN);
    if (detected) {
      allowedUserIds = [detected];
      console.log(`Telegram auto-link: detected first private DM user id ${detected}; using dmPolicy=allowlist.`);
    } else {
      console.log('Telegram auto-link: no private DM update found. Send /start to your bot, then restart the Space, or set TELEGRAM_ALLOWED_USER_IDS.');
    }
  }

  const groupAllowFrom = normalizeTelegramUserIds([
    process.env.TELEGRAM_GROUP_ALLOW_FROM,
    process.env.OPENCLAW_TELEGRAM_GROUP_ALLOW_FROM,
  ].filter(Boolean).join(','), { allowWildcard: true });
  const groupIds = normalizeTelegramGroupIds([
    truthy(process.env.TELEGRAM_ALLOW_ALL_GROUPS || process.env.OPENCLAW_TELEGRAM_ALLOW_ALL_GROUPS || '') ? '*' : '',
    process.env.TELEGRAM_GROUP_IDS,
    process.env.TELEGRAM_GROUPS,
    process.env.TELEGRAM_ALLOWED_GROUPS,
    process.env.OPENCLAW_TELEGRAM_GROUP_IDS,
    process.env.OPENCLAW_TELEGRAM_ALLOWED_GROUPS,
  ].filter(Boolean).join(','));
  const requireMention = !['0', 'false', 'no', 'off'].includes(String(
    process.env.TELEGRAM_GROUP_REQUIRE_MENTION || process.env.OPENCLAW_TELEGRAM_GROUP_REQUIRE_MENTION || process.env.TELEGRAM_REQUIRE_MENTION || 'true'
  ).trim().toLowerCase());
  const openDmRequested = truthy(process.env.TELEGRAM_OPEN_DM || 'false');
  const telegramApiRoot = String(selectedTelegramNetwork.apiRoot || '').trim().replace(/\/$/, '');
  const telegramProxy = String(selectedTelegramNetwork.proxy || '').trim();

  let dmPolicy = String(process.env.TELEGRAM_DM_POLICY || '').trim().toLowerCase();
  if (!dmPolicy || dmPolicy === 'auto') {
    dmPolicy = allowedUserIds.length > 0 ? 'allowlist' : (openDmRequested ? 'open' : 'pairing');
  }
  if (!['pairing', 'allowlist', 'open', 'disabled'].includes(dmPolicy)) {
    console.log(`WARNING: Invalid TELEGRAM_DM_POLICY=${dmPolicy}; falling back to pairing.`);
    dmPolicy = 'pairing';
  }
  if (dmPolicy === 'allowlist' && allowedUserIds.length === 0) {
    console.log('WARNING: TELEGRAM_DM_POLICY=allowlist requires TELEGRAM_ALLOWED_USER_IDS. Falling back to pairing.');
    dmPolicy = 'pairing';
  }

  const telegram = {
    enabled: true,
    dmPolicy,
    timeoutSeconds: asPositiveInt(process.env.TELEGRAM_TIMEOUT_SECONDS, 60),
    pollingStallThresholdMs: asPositiveInt(process.env.TELEGRAM_POLLING_STALL_THRESHOLD_MS, 300000),
    network: {
      autoSelectFamily: false,
      dnsResultOrder: process.env.OPENCLAW_TELEGRAM_DNS_RESULT_ORDER || 'ipv4first',
    },
  };

  if (telegramApiRoot) {
    if (/\/bot[^/]+\/?$/i.test(telegramApiRoot)) {
      console.log('WARNING: TELEGRAM_API_ROOT must be the Bot API root only, not /bot<TOKEN>. Ignoring invalid value.');
    } else {
      telegram.apiRoot = telegramApiRoot;
    }
  }
  if (telegramProxy) telegram.proxy = telegramProxy;

  if (dmPolicy === 'open') {
    telegram.allowFrom = ['*'];
  } else if (allowedUserIds.length > 0) {
    telegram.allowFrom = allowedUserIds;
  }

  if (groupIds.length > 0) {
    let groupPolicy = String(process.env.TELEGRAM_GROUP_POLICY || 'allowlist').trim().toLowerCase();
    if (!['allowlist', 'open', 'disabled'].includes(groupPolicy)) {
      console.log(`WARNING: Invalid TELEGRAM_GROUP_POLICY=${groupPolicy}; falling back to allowlist.`);
      groupPolicy = 'allowlist';
    }
    telegram.groupPolicy = groupPolicy;
    telegram.groups = Object.fromEntries(groupIds.map((id) => [id, { requireMention }]));
  }

  if (groupAllowFrom.length > 0) telegram.groupAllowFrom = groupAllowFrom;
  if (process.env.TELEGRAM_INCLUDE_GROUP_HISTORY_CONTEXT) {
    telegram.includeGroupHistoryContext = String(process.env.TELEGRAM_INCLUDE_GROUP_HISTORY_CONTEXT).trim();
  }

  cfg.channels = {
    defaults: { groupPolicy: 'allowlist' },
    telegram,
  };

  if (allowedUserIds.length > 0) {
    cfg.commands = {
      ownerAllowFrom: allowedUserIds.map((id) => `telegram:${id}`),
    };
  }
  if (truthy(process.env.TELEGRAM_DISABLE_NATIVE_COMMANDS || 'false') || ['0', 'false', 'no', 'off'].includes(String(process.env.TELEGRAM_NATIVE_COMMANDS || '').trim().toLowerCase())) {
    cfg.commands = cfg.commands || {};
    cfg.commands.native = false;
  }

  telegramSummary = `enabled, dmPolicy=${dmPolicy}, allowedUsers=${allowedUserIds.length || 0}, groups=${groupIds.length || 0}`;
  if (telegram.apiRoot) telegramSummary += `, apiRoot=${telegram.apiRoot}`;
  if (telegram.proxy) telegramSummary += ', proxy=enabled';
  if (selectedTelegramNetwork.summary) telegramSummary += `, route=${selectedTelegramNetwork.summary}`;
}

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

console.log(`Wrote OpenClaw config to ${configPath}`);
console.log(`OpenClaw public origin: ${publicOrigin || '(not set)'}`);
console.log(`OpenClaw provider: ${providerId}`);
console.log(`OpenClaw base URL: ${baseUrl}`);
console.log(`OpenClaw primary model: ${primaryModel}`);
console.log(`OpenClaw context window: ${contextWindow}`);
console.log(`OpenClaw max tokens: ${maxTokens}`);
console.log(`Telegram channel: ${telegramSummary}`);
console.log(`Device pairing disabled: ${disablePairing}`);
if (!allowLargeContext && requestedContextWindow > contextWindow) {
  console.log(`Requested context window ${requestedContextWindow} was clamped to ${contextWindow} for startup compatibility.`);
  console.log('Set OPENCLAW_ALLOW_LARGE_CONTEXT=true after the Space is stable to try the full requested value.');
}
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
NODE

# Do not run `doctor --fix` during Hugging Face startup.
# It can mutate or start managed surfaces before the real Gateway is ready.

echo "HF storage name: ${HF_STORAGE_NAME_VALUE:-not set}"
echo "HF storage base: $STORAGE_BASE"
echo "HF storage base is mount: $STORAGE_IS_MOUNT"
echo "HF_HOME: $HF_HOME"
echo "OpenClaw root: $OPENCLAW_ROOT"
echo "OpenClaw workspace: $OPENCLAW_WORKSPACE_DIR"
echo "OpenClaw internal gateway port: $PORT_VALUE"
echo "Hugging Face exposed web port: $SPACE_PORT_VALUE"
echo "Starting OpenClaw Gateway behind safe HTTP/WebSocket proxy..."

node /app/dist/index.js gateway --bind lan --port "$PORT_VALUE" &
GATEWAY_PID="$!"

cleanup_gateway() {
  kill "$GATEWAY_PID" 2>/dev/null || true
}
trap cleanup_gateway INT TERM EXIT

cat > /tmp/openclaw-hf-proxy.cjs <<'NODE_PROXY'
const http = require('http');
const net = require('net');

const listenPort = Number(process.env.OPENCLAW_SPACE_PORT || process.env.PORT || 7860);
const targetPort = Number(process.env.OPENCLAW_GATEWAY_INTERNAL_PORT || process.env.OPENCLAW_GATEWAY_PORT || 18789);
const targetHost = process.env.OPENCLAW_GATEWAY_INTERNAL_HOST || '127.0.0.1';
const publicOrigin = String(process.env.OPENCLAW_PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function isHopByHop(name) {
  return [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade'
  ].includes(String(name).toLowerCase());
}

function rewriteContentSecurityPolicy(value) {
  const rewriteOne = (policy) => {
    const directives = String(policy || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^frame-ancestors\b/i.test(part));
    directives.push("frame-ancestors 'self' https://huggingface.co");
    return directives.join('; ');
  };
  return Array.isArray(value) ? value.map(rewriteOne) : rewriteOne(value);
}

function responseHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (isHopByHop(lower)) continue;
    if (lower === 'x-frame-options') continue;
    if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
      out[name] = rewriteContentSecurityPolicy(value);
      continue;
    }
    out[name] = value;
  }
  out['cache-control'] = out['cache-control'] || 'no-store';
  return out;
}

function requestHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isHopByHop(name)) continue;
    out[name] = value;
  }
  out.host = `${targetHost}:${targetPort}`;
  if (headers.host) out['x-forwarded-host'] = headers.host;
  out['x-forwarded-proto'] = 'https';
  if (publicOrigin) out['x-forwarded-origin'] = publicOrigin;
  return out;
}

function startingPage(req, res, err) {
  const code = req.url === '/__proxy_health' ? 200 : 503;
  const body = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenClaw Gateway starting</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#0b1020;color:#eef2ff;display:grid;place-items:center;min-height:100vh}
main{max-width:760px;padding:28px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(255,255,255,.06);box-shadow:0 20px 60px rgba(0,0,0,.35)}
h1{margin-top:0;font-size:24px}.muted{color:#b8c1e1}code{background:rgba(255,255,255,.12);padding:2px 6px;border-radius:6px}</style>
</head>
<body><main>
<h1>OpenClaw Gateway 正在启动</h1>
<p class="muted">Hugging Face 外部端口 <code>${listenPort}</code> 已经可访问；代理正在等待内部 OpenClaw Gateway <code>${targetHost}:${targetPort}</code>。</p>
<p class="muted">页面会自动刷新。若长时间停在这里，请查看 Space Logs 里的 OpenClaw 启动错误。</p>
${err ? `<p class="muted">最近一次连接错误：<code>${htmlEscape(err.message || err)}</code></p>` : ''}
<script>setTimeout(()=>location.reload(),3000)</script>
</main></body></html>`;
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function proxyHttp(req, res) {
  if (req.url === '/__proxy_health') {
    res.writeHead(200, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
    res.end('openclaw-hf-proxy ok\n');
    return;
  }

  const upstream = http.request({
    hostname: targetHost,
    port: targetPort,
    method: req.method,
    path: req.url,
    headers: requestHeaders(req.headers),
  }, (upstreamRes) => {
    const headers = responseHeaders(upstreamRes.headers);
    res.writeHead(upstreamRes.statusCode || 502, headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => startingPage(req, res, err));
  req.pipe(upstream);
}

function writeUpgradeRequest(req, upstream, head) {
  upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
  for (const [name, value] of Object.entries(req.headers)) {
    let v = Array.isArray(value) ? value.join(', ') : value;
    if (name.toLowerCase() === 'host') v = `${targetHost}:${targetPort}`;
    upstream.write(`${name}: ${v}\r\n`);
  }
  upstream.write('\r\n');
  if (head && head.length) upstream.write(head);
}

const server = http.createServer(proxyHttp);

server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    writeUpgradeRequest(req, upstream, head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => {
    try {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    } catch (_) {
      socket.destroy();
    }
  });
  socket.on('error', () => upstream.destroy());
});

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`OpenClaw HF proxy listening on 0.0.0.0:${listenPort}; forwarding to ${targetHost}:${targetPort}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
NODE_PROXY

node /tmp/openclaw-hf-proxy.cjs
