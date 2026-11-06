#!/usr/bin/env bash
# Bezels installer.
#   curl -fsSL https://raw.githubusercontent.com/n1th1n-19/bezels/main/install.sh | bash
# Options (after `bash -s --` when piped):
#   --yes          don't ask, accept the plan
#   --dir PATH     install location (default: ~/.bezels)
#   --no-webkit    skip WebKit (no iPhone/iPad devices)
#   --no-mcp       don't offer to register the Claude Code MCP server
#   --source URL   git URL or local path to install from
# Re-running updates an existing install.
set -euo pipefail

REPO_DEFAULT="https://github.com/n1th1n-19/bezels.git"
DIR="${BEZELS_DIR:-$HOME/.bezels}"
SOURCE="${BEZELS_SOURCE:-$REPO_DEFAULT}"
YES=0 WEBKIT=1 MCP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --dir) DIR="$2"; shift ;;
    --source) SOURCE="$2"; shift ;;
    --no-webkit) WEBKIT=0 ;;
    --no-mcp) MCP=0 ;;
    -h|--help) sed -n '2,11p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# ---------- output helpers ----------
if [ -t 1 ]; then B=$'\e[1m' D=$'\e[2m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' X=$'\e[0m'; else B= D= G= Y= R= C= X=; fi
LOG="$(mktemp -t bezels-install.XXXXXX.log)"
STEP=0 TOTAL=0
ok()   { printf "  ${G}✓${X} %s\n" "$*"; }
warn() { printf "  ${Y}!${X} %s\n" "$*"; }
die()  { printf "\n${R}✗ %s${X}\n" "$*" >&2; exit 1; }
# Read answers from the terminal even when the script itself is piped in.
ask() { # ask "question" default(y/n)
  [ "$YES" = 1 ] && return 0
  local a d="${2:-y}"
  if [ -r /dev/tty ]; then printf "%s ${D}[%s]${X} " "$1" "$([ "$d" = y ] && echo Y/n || echo y/N)" >/dev/tty; read -r a </dev/tty || a=""; else a=""; fi
  a="${a:-$d}"; [[ "$a" =~ ^[Yy] ]]
}

# Run a step with a spinner; show the last line of its output (download %, package name...).
run() { # run "label" cmd...
  STEP=$((STEP + 1))
  local label="$1"; shift
  local start=$SECONDS frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
  printf "\n${B}[%d/%d]${X} %s\n" "$STEP" "$TOTAL" "$label" >>"$LOG"
  ( "$@" ) >>"$LOG" 2>&1 &
  local pid=$!
  if [ -t 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      local last; last="$(tail -c 400 "$LOG" | tr '\r' '\n' | grep -v '^\s*$' | tail -n1 | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | cut -c1-60)"
      printf "\r\e[K  ${C}%s${X} ${B}[%d/%d]${X} %s ${D}%ss  %s${X}" "${frames:i++%10:1}" "$STEP" "$TOTAL" "$label" "$((SECONDS - start))" "$last"
      sleep 0.12
    done
  fi
  if wait "$pid"; then
    [ -t 1 ] && printf "\r\e[K"
    printf "  ${G}✓${X} ${B}[%d/%d]${X} %s ${D}(%ss)${X}\n" "$STEP" "$TOTAL" "$label" "$((SECONDS - start))"
  else
    [ -t 1 ] && printf "\r\e[K"
    printf "  ${R}✗${X} ${B}[%d/%d]${X} %s\n\n${D}--- last lines of %s ---${X}\n" "$STEP" "$TOTAL" "$label" "$LOG"
    tail -n 25 "$LOG"
    die "Step failed. Full log: $LOG"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }
OS="$(uname -s)"

printf "\n${B}bezels${X} installer ${D}(real-device responsive tester + Claude Code MCP)${X}\n\n"

case "$OS" in
  Linux|Darwin) ;;
  *) die "Unsupported OS: $OS. On Windows, use WSL2 (Ubuntu) and run this again there." ;;
esac

# ---------- check requirements ----------
printf "${B}Checking requirements${X}\n"
have git || die "git is required. Install it first (Linux: sudo apt install git · macOS: xcode-select --install)."
ok "git $(git --version | awk '{print $3}')"
if ! have node; then die "Node.js 20+ is required: https://nodejs.org (or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22)"; fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ is required (found $(node -v))."
ok "node $(node -v)"
have npm || die "npm is missing (it ships with Node.js)."
ok "npm $(npm -v)"

# Installing from inside a checkout? Use it in place.
SCRIPT_DIR=""
# Only when run as a file (not piped through curl), so the current directory never matters.
[ -f "${BASH_SOURCE[0]:-}" ] && SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"name": "bezels"' "$SCRIPT_DIR/package.json" 2>/dev/null && [ -z "${BEZELS_DIR:-}" ] && [ "$DIR" = "$HOME/.bezels" ]; then
  DIR="$SCRIPT_DIR"; IN_PLACE=1
else IN_PLACE=0; fi

PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$([ "$OS" = Darwin ] && echo "$HOME/Library/Caches/ms-playwright" || echo "$HOME/.cache/ms-playwright")}"
has_browser() { ls -d "$PW_CACHE"/"$1"-* >/dev/null 2>&1; }

NEED_SYSDEPS=0
if [ "$OS" = Linux ] && [ "$WEBKIT" = 1 ]; then
  if have apt-get; then NEED_SYSDEPS=1; else warn "No apt-get: WebKit's system libraries must be installed by hand (see 'npx playwright install-deps webkit')"; fi
fi
CLIP=""
if [ "$OS" = Linux ]; then
  if [ -n "${WAYLAND_DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = wayland ]; then have wl-copy || CLIP="wl-clipboard"; else have xclip || CLIP="xclip"; fi
fi
BIN_DIR="$HOME/.local/bin"
HAS_CLAUDE=0; have claude && HAS_CLAUDE=1

# ---------- the plan ----------
st() { [ "$1" = 1 ] && printf "${G}already there${X}" || printf "${Y}will install${X}"; }
printf "\n${B}This will install${X}\n"
if [ "$IN_PLACE" = 1 ]; then printf "  • Bezels source          %s ${D}(this checkout)${X}\n" "$DIR"
elif [ -d "$DIR/.git" ]; then printf "  • Bezels source          %s ${G}update (git pull)${X}\n" "$DIR"
else printf "  • Bezels source          %s ${Y}will clone${X} ${D}~2 MB${X}\n" "$DIR"; fi
printf "  • npm packages           %s/node_modules ${Y}will install${X} ${D}~150 MB (Playwright, MCP SDK, React, Vite…)${X}\n" "$DIR"
printf "  • Chromium               %s ${D}~180 MB · Android + desktop devices${X}\n" "$(has_browser chromium && st 1 || st 0)"
if [ "$WEBKIT" = 1 ]; then
  printf "  • WebKit                 %s ${D}~100 MB · iPhone + iPad devices${X}\n" "$(has_browser webkit && st 1 || st 0)"
  [ "$NEED_SYSDEPS" = 1 ] && printf "  • WebKit system libs     ${Y}apt, needs sudo, only if missing${X} ${D}(exact packages shown before installing)${X}\n"
else printf "  • WebKit                 ${D}skipped (--no-webkit)${X}\n"; fi
printf "  • Build                  dist/ + ui/dist ${D}(static UI, no dev server at runtime)${X}\n"
printf "  • Command                %s/bezels ${D}(small launcher script)${X}\n" "$BIN_DIR"
[ -n "$CLIP" ] && printf "  • Clipboard tool         %s ${D}optional, for 'bezels shot --copy' (apt, sudo)${X}\n" "$CLIP"
if [ "$MCP" = 1 ]; then
  if [ "$HAS_CLAUDE" = 1 ]; then printf "  • Claude Code MCP        ${Y}will ask${X} ${D}claude mcp add bezels -s user${X}\n"
  else printf "  • Claude Code MCP        ${D}'claude' not found, will print the command${X}\n"; fi
fi
printf "\n${D}Nothing outside %s, %s and the Playwright browser cache (%s) is touched, except apt packages you approve.${X}\n\n" "$DIR" "$BIN_DIR" "$PW_CACHE"

ask "Continue?" y || { echo "Cancelled."; exit 0; }

# ---------- steps ----------
# source, npm, Chromium, build, command (+ WebKit, + system libs)
TOTAL=$((5 + WEBKIT + NEED_SYSDEPS))
printf "\n${B}Installing${X} ${D}(log: %s)${X}\n" "$LOG"

if [ "$IN_PLACE" = 1 ]; then run "Using checkout at $DIR" true
elif [ -d "$DIR/.git" ]; then run "Updating $DIR" git -C "$DIR" pull --ff-only
else run "Downloading Bezels" git clone --depth 1 "$SOURCE" "$DIR"; fi
cd "$DIR"

run "Installing npm packages" npm ci --no-audit --no-fund --loglevel=error
run "Downloading Chromium" npx --yes playwright install chromium
if [ "$WEBKIT" = 1 ]; then run "Downloading WebKit" npx --yes playwright install webkit; fi

if [ "$NEED_SYSDEPS" = 1 ]; then
  STEP=$((STEP + 1))
  printf "\n${B}[%d/%d]${X} WebKit system libraries\n" "$STEP" "$TOTAL"
  # WebKit's launch error names exactly the packages missing on *this* machine (often just 2),
  # unlike `playwright install-deps`, which installs ~45 (xvfb, font packs...).
  MISSING="$(node -e "require('playwright').webkit.launch().then(b=>b.close()).then(()=>console.log('OK'),e=>{const m=e.message.replace(/[\u2550-\u256c\\\\]/g,' ');const a=/apt-get install([\s\S]*?)(\n\s*\n|<3)/.exec(m);console.log(a?a[1].split(/\s+/).filter(x=>/^[a-z0-9][a-z0-9.+:-]+$/.test(x)).join(' '):'UNKNOWN')})" 2>/dev/null || echo UNKNOWN)"
  if [ "$MISSING" = OK ]; then
    ok "already installed"
  else
    if [ "$MISSING" = UNKNOWN ] || [ -z "$MISSING" ]; then APT=(npx --yes playwright install-deps webkit); printf "  needs: ${C}playwright install-deps webkit${X} ${D}(couldn't detect the exact list)${X}\n"
    else APT=(apt-get install -y --no-install-recommends $MISSING); printf "  needs: ${C}%s${X}\n" "$MISSING"; fi
    # Ask for the sudo password up front, so it doesn't fight the progress spinner.
    if have sudo && ask "  Install with sudo?" y && { [ "$YES" = 0 ] && sudo -v </dev/tty || sudo -n true 2>/dev/null; }; then
      STEP=$((STEP - 1)); run "Installing WebKit system libraries (sudo)" sudo env "PATH=$PATH" "${APT[@]}"
    else
      warn "Skipped. iPhone/iPad need it later: sudo ${APT[*]}"
    fi
  fi
fi

run "Building" npm run build

mkdir -p "$BIN_DIR"
cat >"$BIN_DIR/bezels" <<EOF
#!/bin/sh
exec node "$DIR/dist/cli.js" "\$@"
EOF
chmod +x "$BIN_DIR/bezels"
STEP=$((STEP + 1)); ok "${B}[$STEP/$TOTAL]${X} Command: $BIN_DIR/bezels"

# ---------- optional extras ----------
if [ -n "$CLIP" ] && have apt-get && [ "$YES" = 0 ] && ask "Install $CLIP for 'bezels shot --copy' (sudo apt-get)?" n; then
  sudo apt-get install -y "$CLIP" </dev/tty && ok "$CLIP installed" || warn "$CLIP not installed"
fi

MCP_CMD="claude mcp add bezels -s user -- node $DIR/dist/mcp.js"
if [ "$MCP" = 1 ]; then
  if [ "$HAS_CLAUDE" = 1 ]; then
    if claude mcp list 2>/dev/null | grep -q '^bezels'; then ok "Claude Code MCP server already registered"
    elif ask "Register Bezels as an MCP server in Claude Code (all projects)?" y; then
      $MCP_CMD >>"$LOG" 2>&1 && ok "MCP server 'bezels' registered" || warn "Couldn't register. Run: $MCP_CMD"
    fi
  fi
fi

# ---------- done ----------
case ":$PATH:" in *":$BIN_DIR:"*) PATH_OK=1 ;; *) PATH_OK=0 ;; esac
printf "\n${G}${B}Bezels is installed.${X}\n\n"
[ "$PATH_OK" = 0 ] && printf "  ${Y}!${X} Add %s to your PATH:  ${C}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.%src${X}\n\n" "$BIN_DIR" "$(basename "${SHELL:-bash}")"
printf "  Start the UI      ${C}bezels serve${X}   → http://localhost:4477\n"
printf "  Screenshot        ${C}bezels shot http://localhost:3000 --devices phones,folds --framed${X}\n"
printf "  Layout audit      ${C}bezels audit http://localhost:3000 --devices all${X}\n"
[ "$MCP" = 1 ] && [ "$HAS_CLAUDE" = 0 ] && printf "  Claude Code       ${C}%s${X}\n" "$MCP_CMD"
UNINSTALL="rm -rf $DIR $BIN_DIR/bezels"; [ "$HAS_CLAUDE" = 1 ] && UNINSTALL="$UNINSTALL && claude mcp remove bezels -s user"
[ "$IN_PLACE" = 1 ] && UNINSTALL="rm $BIN_DIR/bezels"
printf "\n  ${D}Update: run this installer again · Uninstall: %s${X}\n  ${D}Browsers stay in %s (shared with other Playwright projects).${X}\n\n" "$UNINSTALL" "$PW_CACHE"
rm -f "$LOG"
