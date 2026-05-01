#!/usr/bin/env bash
# ==============================================================================
# setup.sh — copilot-api + claude-copilot 一键安装引导
#
# 运行方式:
#   ./setup.sh            # 完整安装
#   ./setup.sh --check    # 仅检查环境
#   ./setup.sh --auth     # 仅重新认证
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
_R='\033[0;31m' _G='\033[0;32m' _Y='\033[1;33m' _B='\033[0;34m' _C='\033[0;36m' _N='\033[0m'
log_info()    { echo -e "${_B}▶${_N} $*"; }
log_success() { echo -e "${_G}✓${_N} $*"; }
log_warn()    { echo -e "${_Y}!${_N} $*"; }
log_error()   { echo -e "${_R}✗${_N} $*"; }
log_step()    { echo -e "\n${_C}══ $* ${_N}"; }

MODE="${1:-install}"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         copilot-api + claude-copilot 安装向导                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ==============================================================================
# Step 1: Check dependencies
# ==============================================================================
log_step "Step 1/5: 检查依赖"

MISSING=()

check_cmd() {
    local cmd="$1" install_hint="$2"
    if command -v "$cmd" &>/dev/null; then
        log_success "$cmd: $(command -v "$cmd")"
    else
        log_warn "$cmd 未安装 → $install_hint"
        MISSING+=("$cmd")
    fi
}

check_cmd "node"   "https://nodejs.org  或  brew install node"
check_cmd "curl"   "brew install curl"
check_cmd "jq"     "brew install jq"
check_cmd "claude" "npm install -g @anthropic-ai/claude-code"

# Optional
echo ""
echo "可选依赖:"
command -v bun    &>/dev/null && log_success "bun (可选，用于本地构建)" || log_warn "bun 未安装 (可选)  brew install bun"
command -v docker &>/dev/null && log_success "docker (可选，用于容器化运行)" || log_warn "docker 未安装 (可选)"

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo ""
    log_error "缺少必要依赖: ${MISSING[*]}"
    echo ""
    echo "安装命令:"
    for dep in "${MISSING[@]}"; do
        case "$dep" in
            node)   echo "  brew install node" ;;
            curl)   echo "  brew install curl" ;;
            jq)     echo "  brew install jq" ;;
            claude) echo "  npm install -g @anthropic-ai/claude-code" ;;
        esac
    done
    echo ""
    if [[ "$MODE" != "--check" ]]; then
        read -r -p "是否尝试自动安装？[y/N] " ans
        if [[ "$ans" =~ ^[Yy]$ ]]; then
            for dep in "${MISSING[@]}"; do
                case "$dep" in
                    node)   brew install node ;;
                    curl)   brew install curl ;;
                    jq)     brew install jq ;;
                    claude) npm install -g @anthropic-ai/claude-code ;;
                esac
            done
        else
            log_error "请手动安装后重新运行 setup.sh"
            exit 1
        fi
    fi
fi

[[ "$MODE" == "--check" ]] && { echo ""; log_success "环境检查完成"; exit 0; }

# ==============================================================================
# Step 2: Build / install copilot-api
# ==============================================================================
log_step "Step 2/5: 安装 copilot-api"

if [[ -f "${SCRIPT_DIR}/dist/main.js" ]]; then
    log_success "已存在本地构建：${SCRIPT_DIR}/dist/main.js"
    COPILOT_BIN="${SCRIPT_DIR}/dist/main.js"
    COPILOT_RUN="node ${COPILOT_BIN}"
elif command -v bun &>/dev/null && [[ -f "${SCRIPT_DIR}/package.json" ]]; then
    log_info "使用 bun 构建本地版本..."
    cd "${SCRIPT_DIR}"
    bun install
    bun run build
    log_success "构建完成：${SCRIPT_DIR}/dist/main.js"
    COPILOT_BIN="${SCRIPT_DIR}/dist/main.js"
    COPILOT_RUN="node ${COPILOT_BIN}"
else
    log_warn "未找到本地构建，将使用 npx copilot-api@latest"
    COPILOT_BIN=""
    COPILOT_RUN="npx copilot-api@latest"
fi

# ==============================================================================
# Step 3: GitHub Authentication
# ==============================================================================
log_step "Step 3/5: GitHub Copilot 认证"

TOKEN_DIR="$HOME/.local/share/copilot-api"
TOKEN_FILE="${TOKEN_DIR}/github_token"
mkdir -p "$TOKEN_DIR"

if [[ "$MODE" == "--auth" ]] || [[ ! -f "$TOKEN_FILE" ]]; then
    if [[ -f "$TOKEN_FILE" ]]; then
        BACKUP="${TOKEN_FILE}.backup.$(date +%Y%m%d%H%M%S)"
        cp "$TOKEN_FILE" "$BACKUP"
        log_info "已备份旧 token → $BACKUP"
    fi

    log_info "启动 GitHub OAuth 设备流认证..."
    echo ""
    echo "  操作步骤："
    echo "  1. 复制下方显示的设备码"
    echo "  2. 浏览器打开 https://github.com/login/device"
    echo "  3. 粘贴设备码完成授权"
    echo ""

    if [[ -n "$COPILOT_BIN" ]]; then
        node "$COPILOT_BIN" auth
    else
        npx copilot-api@latest auth
    fi

    if [[ -f "$TOKEN_FILE" ]]; then
        log_success "认证成功，token 保存至：$TOKEN_FILE"
    else
        log_error "认证失败，未找到 token 文件"
        exit 1
    fi
else
    log_success "Token 已存在：$TOKEN_FILE"
    echo "  (如需重新认证，运行：./setup.sh --auth)"
fi

[[ "$MODE" == "--auth" ]] && exit 0

# ==============================================================================
# Step 4: Configure shell (add source to zshrc/bashrc)
# ==============================================================================
log_step "Step 4/5: 配置 shell"

SHELL_RC=""
if [[ -n "${ZSH_VERSION:-}" ]] || [[ "$SHELL" == */zsh ]]; then
    SHELL_RC="$HOME/.zshrc"
elif [[ -n "${BASH_VERSION:-}" ]] || [[ "$SHELL" == */bash ]]; then
    SHELL_RC="$HOME/.bashrc"
fi

SOURCE_LINE="source \"${SCRIPT_DIR}/claude-copilot.sh\""
EXPORT_LINE="export COPILOT_SCRIPT_DIR=\"${SCRIPT_DIR}\""

if [[ -n "$SHELL_RC" ]]; then
    if grep -qF "claude-copilot.sh" "$SHELL_RC" 2>/dev/null; then
        log_success "claude-copilot.sh 已在 $SHELL_RC 中配置"
    else
        echo "" >> "$SHELL_RC"
        echo "# copilot-api + claude-copilot" >> "$SHELL_RC"
        echo "$EXPORT_LINE" >> "$SHELL_RC"
        echo "$SOURCE_LINE" >> "$SHELL_RC"
        log_success "已添加到 $SHELL_RC"
        echo ""
        echo "  请运行以下命令使配置生效："
        echo "  source $SHELL_RC"
    fi
else
    log_warn "无法检测 shell 类型，请手动添加到 shell 配置文件："
    echo ""
    echo "  $EXPORT_LINE"
    echo "  $SOURCE_LINE"
fi

# ==============================================================================
# Step 5: Generate launchd plist (macOS only)
# ==============================================================================
log_step "Step 5/5: 配置 macOS 开机自启 (launchd)"

PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="${PLIST_DIR}/dev.copilot-api.plist"
PORT="${COPILOT_PORT:-1234}"
LOG_FILE="${SCRIPT_DIR}/server.log"

if [[ "$(uname)" != "Darwin" ]]; then
    log_warn "非 macOS 系统，跳过 launchd 配置"
else
    mkdir -p "$PLIST_DIR"

    if [[ -f "$PLIST_FILE" ]]; then
        log_warn "launchd plist 已存在：$PLIST_FILE"
        read -r -p "是否覆盖？[y/N] " ans
        [[ "$ans" =~ ^[Yy]$ ]] || { log_info "跳过 launchd 配置"; echo ""; }
    fi

    if [[ ! -f "$PLIST_FILE" ]] || [[ "${ans:-n}" =~ ^[Yy]$ ]]; then
        # Determine node path
        NODE_PATH="$(command -v node)"

        if [[ -n "$COPILOT_BIN" ]]; then
            PROGRAM_ARG1="$NODE_PATH"
            PROGRAM_ARG2="$COPILOT_BIN"
            EXTRA_ARGS="start"
        else
            PROGRAM_ARG1="$(command -v npx)"
            PROGRAM_ARG2="copilot-api@latest"
            EXTRA_ARGS="start"
        fi

        cat > "$PLIST_FILE" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.copilot-api</string>

    <key>ProgramArguments</key>
    <array>
        <string>${PROGRAM_ARG1}</string>
        <string>${PROGRAM_ARG2}</string>
        <string>${EXTRA_ARGS}</string>
        <string>--port</string>
        <string>${PORT}</string>
        <string>--account-type</string>
        <string>business</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>

    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>

    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
PLIST

        log_success "launchd plist 已生成：$PLIST_FILE"
        echo ""
        echo "  加载服务（开机自启）："
        echo "    launchctl load $PLIST_FILE"
        echo ""
        echo "  立即启动："
        echo "    launchctl start dev.copilot-api"
        echo ""
        echo "  查看状态："
        echo "    launchctl list dev.copilot-api"
        echo ""

        read -r -p "是否立即加载 launchd 服务？[y/N] " load_ans
        if [[ "${load_ans:-n}" =~ ^[Yy]$ ]]; then
            launchctl load "$PLIST_FILE"
            log_success "launchd 服务已加载"
        fi
    fi
fi

# ==============================================================================
# Done
# ==============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    安装完成！                                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "快速上手："
echo "  claude-copilot                # 默认 sonnet，自动启动服务"
echo "  claude-copilot -m opus        # opus-4.7，高 effort"
echo "  claude-copilot -m opus-med    # opus-4.7，中 effort（均衡）"
echo "  claude-copilot -m haiku       # haiku，省配额"
echo "  claude-copilot --status       # 检查服务状态"
echo "  claude-copilot --usage        # 查看配额用量"
echo "  claude-copilot --daemon       # 守护模式（自动重启）"
echo ""
echo "如果 claude-copilot 命令不可用，请先运行："
echo "  source $SHELL_RC"
echo ""
