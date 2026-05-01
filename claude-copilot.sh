#!/usr/bin/env bash
# ==============================================================================
# claude-copilot — 用 GitHub Copilot 运行 Claude Code 的一键封装
#
# 用法：source claude-copilot.sh 后执行 claude-copilot [options] [claude-args...]
# 或直接 source 到 ~/.zshrc / ~/.bashrc
#
# Options:
#   --stop              停止本地 copilot-api 服务
#   --status            检查服务 / 认证 / 模型状态
#   --usage             查看 Copilot 用量配额
#   --daemon            守护模式（自动重启，Ctrl+C 退出）
#   --setup             完整环境检查和设置向导
#   --port <port>       自定义端口（默认 1234）
#   -m|--model <alias>  选择模型档位（见下方模型说明）
#
# 模型档位（-m 参数）:
#   sonnet       默认。主: sonnet-4.6, 复杂subagent: opus-4.7, 工具: haiku-4.5
#   opus         主: opus-4.7 (effort=high), 编码: sonnet-4.6, 工具: haiku-4.5
#   opus47       同 opus
#   opus-high    同 opus
#   opus-med     主: opus-4.7 (effort=medium)，均衡版
#   opus47-med   同 opus-med
#   opus46       主: opus-4.6（无 effort 支持）
#   haiku        全部使用 haiku-4.5，省配额
#
# Reasoning Effort 说明:
#   仅 claude-opus-4.7 支持 effort (low/medium/high/xhigh/max)
#   其他模型（opus-4.6, sonnet, haiku）设置无效，proxy 会丢弃
#
# 环境变量覆盖（可在调用前 export）:
#   COPILOT_PORT          服务端口（默认 1234）
#   COPILOT_AUTH_FILE     token 文件路径
#   COPILOT_TIMEOUT_MS    API 超时毫秒数（默认 3000000）
#   COPILOT_SCRIPT_DIR    copilot-api 源码目录
# ==============================================================================

claude-copilot() {
    # --------------------------------------------------------------------------
    # Configuration defaults (overridable via env vars)
    # --------------------------------------------------------------------------
    local COPILOT_PORT="${COPILOT_PORT:-1234}"
    local COPILOT_HOST="http://localhost"
    local COPILOT_BASE_URL="${COPILOT_HOST}:${COPILOT_PORT}"
    local COPILOT_API_TIMEOUT="${COPILOT_TIMEOUT_MS:-3000000}"
    local COPILOT_ACCOUNT_TYPE="business"
    local SELECTED_MODEL="sonnet"
    local REASONING_EFFORT=""
    local ACTION="start"
    local COPILOT_DIR="${COPILOT_SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

    # --------------------------------------------------------------------------
    # Logging helpers
    # --------------------------------------------------------------------------
    local _R='\033[0;31m' _G='\033[0;32m' _Y='\033[1;33m' _B='\033[0;34m' _N='\033[0m'
    log_info()    { echo -e "${_B}▶${_N} $*"; }
    log_success() { echo -e "${_G}✓${_N} $*"; }
    log_warn()    { echo -e "${_Y}!${_N} $*"; }
    log_error()   { echo -e "${_R}✗${_N} $*"; }

    # --------------------------------------------------------------------------
    # Argument parsing
    # --------------------------------------------------------------------------
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --stop)      ACTION="stop";   shift ;;
            --status)    ACTION="status"; shift ;;
            --usage)     ACTION="usage";  shift ;;
            --daemon)    ACTION="daemon"; shift ;;
            --setup)     ACTION="setup";  shift ;;
            --port)      COPILOT_PORT="$2"; COPILOT_BASE_URL="${COPILOT_HOST}:${COPILOT_PORT}"; shift 2 ;;
            -m|--model)  SELECTED_MODEL="$2"; shift 2 ;;
            --)          shift; break ;;
            -*)          break ;;
            *)           break ;;
        esac
    done

    # --------------------------------------------------------------------------
    # Model tier resolution
    # --------------------------------------------------------------------------
    # Tier design:
    #   ANTHROPIC_DEFAULT_OPUS_MODEL   → complex tasks  (planning, orchestration)
    #   ANTHROPIC_MODEL / SONNET       → normal tasks   (coding, testing)
    #   ANTHROPIC_SMALL_FAST_MODEL     → simple tasks   (tool calls, background)
    #
    # Note: COPILOT_REASONING_EFFORT only takes effect on claude-opus-4.7.
    #       All other models silently discard it.
    local COPILOT_MODEL COPILOT_SONNET_MODEL COPILOT_OPUS_MODEL
    local COPILOT_HAIKU_MODEL COPILOT_SMALL_MODEL

    case "$SELECTED_MODEL" in
        opus|opus47|opus-high)
            # Full power: opus-4.7 as main with high effort
            COPILOT_MODEL="claude-opus-4.7"
            COPILOT_SONNET_MODEL="claude-sonnet-4.6"
            COPILOT_OPUS_MODEL="claude-opus-4.7"
            COPILOT_HAIKU_MODEL="claude-haiku-4.5"
            COPILOT_SMALL_MODEL="claude-haiku-4.5"
            REASONING_EFFORT="high"
            ;;
        opus-med|opus47-med)
            # Balanced: opus-4.7 with medium effort
            COPILOT_MODEL="claude-opus-4.7"
            COPILOT_SONNET_MODEL="claude-sonnet-4.6"
            COPILOT_OPUS_MODEL="claude-opus-4.7"
            COPILOT_HAIKU_MODEL="claude-haiku-4.5"
            COPILOT_SMALL_MODEL="claude-haiku-4.5"
            REASONING_EFFORT="medium"
            ;;
        opus46)
            # opus-4.6 — no effort support
            COPILOT_MODEL="claude-opus-4.6"
            COPILOT_SONNET_MODEL="claude-sonnet-4.6"
            COPILOT_OPUS_MODEL="claude-opus-4.6"
            COPILOT_HAIKU_MODEL="claude-haiku-4.5"
            COPILOT_SMALL_MODEL="claude-haiku-4.5"
            REASONING_EFFORT=""
            ;;
        haiku)
            # Fast/quota-efficient
            COPILOT_MODEL="claude-haiku-4.5"
            COPILOT_SONNET_MODEL="claude-sonnet-4.6"
            COPILOT_OPUS_MODEL="claude-opus-4.7"
            COPILOT_HAIKU_MODEL="claude-haiku-4.5"
            COPILOT_SMALL_MODEL="claude-haiku-4.5"
            REASONING_EFFORT=""
            ;;
        sonnet|*)
            # Default: sonnet main, opus for heavy subagent tasks, haiku for tools
            COPILOT_MODEL="claude-sonnet-4.6"
            COPILOT_SONNET_MODEL="claude-sonnet-4.6"
            COPILOT_OPUS_MODEL="claude-opus-4.7"
            COPILOT_HAIKU_MODEL="claude-haiku-4.5"
            COPILOT_SMALL_MODEL="claude-haiku-4.5"
            REASONING_EFFORT=""
            ;;
    esac

    # --------------------------------------------------------------------------
    # Helper: check jq installed
    # --------------------------------------------------------------------------
    _check_jq() {
        if ! command -v jq &>/dev/null; then
            log_warn "jq 未安装，正在通过 brew 安装..."
            brew install jq || { log_error "jq 安装失败，请手动运行：brew install jq"; return 1; }
            log_success "jq 安装完成"
        fi
    }

    # --------------------------------------------------------------------------
    # Helper: check server responding
    # --------------------------------------------------------------------------
    _server_running() {
        curl -sf "${COPILOT_BASE_URL}/v1/models" &>/dev/null
    }

    # --------------------------------------------------------------------------
    # Helper: ensure service is running (start if not)
    # --------------------------------------------------------------------------
    _ensure_service_running() {
        if curl -s "${COPILOT_BASE_URL}/usage" &>/dev/null; then
            log_success "copilot-api 服务已在端口 ${COPILOT_PORT} 运行"
            return 0
        fi

        log_info "正在启动 copilot-api 服务..."
        local bin="${COPILOT_DIR}/dist/main.js"
        if [[ -f "$bin" ]]; then
            node "$bin" start -p "${COPILOT_PORT}" -a "${COPILOT_ACCOUNT_TYPE}" &
        else
            npx copilot-api@latest start -p "${COPILOT_PORT}" -a "${COPILOT_ACCOUNT_TYPE}" &
        fi
        local pid=$!

        log_info "等待服务启动..."
        for i in {1..30}; do
            if curl -s "${COPILOT_BASE_URL}/usage" &>/dev/null; then
                log_success "服务已启动 (PID: $pid)"
                return 0
            fi
            sleep 1
        done
        log_error "服务启动超时，请检查日志：${COPILOT_DIR}/server.log"
        return 1
    }

    # --------------------------------------------------------------------------
    # Helper: start service foreground (for daemon loop)
    # --------------------------------------------------------------------------
    _start_service_fg() {
        local bin="${COPILOT_DIR}/dist/main.js"
        if [[ -f "$bin" ]]; then
            node "$bin" start -p "${COPILOT_PORT}" -a "${COPILOT_ACCOUNT_TYPE}"
        else
            npx copilot-api@latest start -p "${COPILOT_PORT}" -a "${COPILOT_ACCOUNT_TYPE}"
        fi
    }

    # --------------------------------------------------------------------------
    # Action: stop
    # --------------------------------------------------------------------------
    if [[ "$ACTION" == "stop" ]]; then
        log_info "正在停止 copilot-api 服务 (port ${COPILOT_PORT})..."
        local pid; pid=$(lsof -ti tcp:"${COPILOT_PORT}" 2>/dev/null | head -1)
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null
            log_success "服务已停止 (PID: $pid)"
        else
            log_warn "未找到运行在端口 ${COPILOT_PORT} 的服务"
        fi
        return 0
    fi

    # --------------------------------------------------------------------------
    # Action: daemon — watch loop with auto-restart
    # --------------------------------------------------------------------------
    if [[ "$ACTION" == "daemon" ]]; then
        local LOG_FILE="${COPILOT_DIR}/server.log"

        echo "╔══════════════════════════════════════════════════════════╗"
        echo "║     copilot-api 守护模式 (Ctrl+C 停止)                   ║"
        echo "╚══════════════════════════════════════════════════════════╝"
        echo "端口:     ${COPILOT_PORT}"
        echo "日志:     ${LOG_FILE}"
        echo "用量:     ${COPILOT_BASE_URL}/usage"
        echo "本地面板: ${COPILOT_BASE_URL}/usage/view"
        echo "Dashboard: https://ericc-ch.github.io/copilot-api?endpoint=${COPILOT_BASE_URL}/usage"
        echo ""

        # Start service if not already running
        if ! curl -s "${COPILOT_BASE_URL}/usage" &>/dev/null; then
            log_info "正在启动服务..."
            local bin="${COPILOT_DIR}/dist/main.js"
            if [[ -f "$bin" ]]; then
                nohup node "$bin" start -p "${COPILOT_PORT}" -a "${COPILOT_ACCOUNT_TYPE}" >> "$LOG_FILE" 2>&1 &
            else
                nohup npx copilot-api@latest start -p "${COPILOT_PORT}" -a "${COPILOT_ACCOUNT_TYPE}" >> "$LOG_FILE" 2>&1 &
            fi
            local svc_pid=$!
            log_info "等待服务启动 (PID: $svc_pid)..."
            for i in {1..30}; do
                if curl -s "${COPILOT_BASE_URL}/usage" &>/dev/null; then
                    log_success "服务已启动 (PID: $svc_pid)"
                    break
                fi
                sleep 1
            done
            if ! curl -s "${COPILOT_BASE_URL}/usage" &>/dev/null; then
                log_error "服务启动失败，查看日志：$LOG_FILE"
                return 1
            fi
        else
            log_success "服务已在运行 (PID: $(lsof -ti tcp:"${COPILOT_PORT}" 2>/dev/null | head -1))"
        fi

        echo ""
        log_info "开始输出日志 (Ctrl+C 退出 tail，服务继续运行)..."
        echo ""
        tail -f "$LOG_FILE"
        return 0
    fi

    # --------------------------------------------------------------------------
    # Action: status
    # --------------------------------------------------------------------------
    if [[ "$ACTION" == "status" ]]; then
        echo "=== Copilot API Status (port ${COPILOT_PORT}) ==="
        echo ""
        echo "依赖:"
        command -v jq     &>/dev/null && echo "  ✅ jq"     || echo "  ❌ jq (未安装)"
        command -v curl   &>/dev/null && echo "  ✅ curl"   || echo "  ❌ curl (未安装)"
        command -v node   &>/dev/null && echo "  ✅ node"   || echo "  ❌ node (未安装)"
        command -v bun    &>/dev/null && echo "  ✅ bun"    || echo "  ⚠️  bun (可选)"
        command -v docker &>/dev/null && echo "  ✅ docker" || echo "  ⚠️  docker (可选)"

        echo ""
        echo "认证:"
        local tf="$HOME/.local/share/copilot-api/github_token"
        [[ -f "$tf" ]] && echo "  ✅ Token 存在" || echo "  ❌ Token 不存在 (运行 setup)"

        echo ""
        echo "服务:"
        if curl -s "${COPILOT_BASE_URL}/usage" &>/dev/null; then
            echo "  🟢 运行中"
            echo "  Dashboard: https://ericc-ch.github.io/copilot-api?endpoint=${COPILOT_BASE_URL}/usage"
            echo ""
            echo "  可用 Claude 模型:"
            curl -s "${COPILOT_BASE_URL}/v1/models" \
                | jq -r '.data[] | select(.id | contains("claude")) | "    - \(.id)"' 2>/dev/null || true
        else
            echo "  🔴 未运行"
        fi
        return 0
    fi

    # --------------------------------------------------------------------------
    # Action: usage
    # --------------------------------------------------------------------------
    if [[ "$ACTION" == "usage" ]]; then
        _check_jq || return 1
        echo "=== GitHub Copilot 用量 ==="

        if ! curl -s "${COPILOT_BASE_URL}/usage" &>/dev/null; then
            log_error "服务未运行，请先启动：claude-copilot --status"
            return 1
        fi

        local usage; usage=$(curl -s "${COPILOT_BASE_URL}/usage")
        echo ""
        echo "用户：$(echo "$usage" | jq -r '.login')"
        echo "计划：$(echo "$usage" | jq -r '.copilot_plan')"
        echo "组织：$(echo "$usage" | jq -r '.organization_list[0].name // "N/A"')"
        echo ""
        echo "配额:"

        local chat_unlimited; chat_unlimited=$(echo "$usage" | jq -r '.quota_snapshots.chat.unlimited')
        if [[ "$chat_unlimited" == "true" ]]; then
            echo "  💬 Chat:      无限"
        else
            echo "  💬 Chat:      $(echo "$usage" | jq -r '.quota_snapshots.chat.remaining') 次剩余"
        fi

        local comp_unlimited; comp_unlimited=$(echo "$usage" | jq -r '.quota_snapshots.completions.unlimited')
        [[ "$comp_unlimited" == "true" ]] && echo "  ⌨️  Completions: 无限"

        local pr pe pp
        pr=$(echo "$usage" | jq -r '.quota_snapshots.premium_interactions.remaining')
        pe=$(echo "$usage" | jq -r '.quota_snapshots.premium_interactions.entitlement')
        pp=$(echo "$usage" | jq -r '.quota_snapshots.premium_interactions.percent_remaining')
        echo "  ⭐ Premium:   ${pr}/${pe} (${pp}%)"

        echo ""
        echo "重置时间：$(echo "$usage" | jq -r '.quota_reset_date' | cut -d'T' -f1)"
        echo "Dashboard: https://ericc-ch.github.io/copilot-api?endpoint=${COPILOT_BASE_URL}/usage"
        return 0
    fi

    # --------------------------------------------------------------------------
    # Action: setup — verbose environment check + first-run guide
    # --------------------------------------------------------------------------
    if [[ "$ACTION" == "setup" ]]; then
        echo "╔══════════════════════════════════════════════════════════╗"
        echo "║       GitHub Copilot API 环境检查和设置                   ║"
        echo "╚══════════════════════════════════════════════════════════╝"
        echo ""

        log_info "步骤 1/4: 检查依赖..."
        _check_jq || return 1
        command -v curl &>/dev/null || { log_error "curl 未安装"; return 1; }
        command -v node &>/dev/null || { log_error "node 未安装，请安装 Node.js"; return 1; }
        log_success "依赖检查完成"
        echo ""

        log_info "步骤 2/4: 检查认证..."
        local tf="$HOME/.local/share/copilot-api/github_token"
        if [[ -f "$tf" ]]; then
            log_success "Token 已存在：$tf"
        else
            log_warn "未找到 token，请运行认证："
            echo "  cd ${COPILOT_DIR} && node dist/main.js auth"
            echo "  或：npx copilot-api@latest auth"
            return 1
        fi
        echo ""

        log_info "步骤 3/4: 确保服务运行..."
        _ensure_service_running || return 1
        echo ""

        log_info "步骤 4/4: 验证模型..."
        local cnt; cnt=$(curl -s "${COPILOT_BASE_URL}/v1/models" | jq -r '.data | length' 2>/dev/null || echo 0)
        if [[ "$cnt" -gt 0 ]]; then
            log_success "获取到 ${cnt} 个模型"
            echo ""
            echo "Claude 系列模型:"
            curl -s "${COPILOT_BASE_URL}/v1/models" \
                | jq -r '.data[] | select(.id | contains("claude")) | "  - \(.id)"' 2>/dev/null
        else
            log_warn "无法获取模型列表"
        fi
        echo ""

        echo "╔══════════════════════════════════════════════════════════╗"
        echo "║                    设置完成！                             ║"
        echo "╚══════════════════════════════════════════════════════════╝"
        echo ""
        echo "启动方式："
        echo "  claude-copilot               # sonnet (默认)"
        echo "  claude-copilot -m opus       # opus-4.7 high effort"
        echo "  claude-copilot -m opus-med   # opus-4.7 medium effort"
        echo "  claude-copilot -m haiku      # 省配额"
        return 0
    fi

    # --------------------------------------------------------------------------
    # Action: start (default) — ensure service, launch claude
    # --------------------------------------------------------------------------
    _ensure_service_running || return 1

    log_success "已连接到 copilot-api (${COPILOT_BASE_URL})"
    echo ""
    echo "🤖 模型配置:"
    local effort_display="${REASONING_EFFORT:+ (effort=$REASONING_EFFORT)}"
    echo "   主模型:  ${COPILOT_MODEL}${effort_display}"
    echo "   Sonnet:  ${COPILOT_SONNET_MODEL}  ← 编码/测试"
    echo "   Opus:    ${COPILOT_OPUS_MODEL}  ← 规划/复杂推理"
    echo "   Haiku:   ${COPILOT_HAIKU_MODEL}  ← 工具调用/背景任务"
    echo ""
    echo "📊 Dashboard: https://ericc-ch.github.io/copilot-api?endpoint=${COPILOT_BASE_URL}/usage"
    echo ""

    # Inner launcher — subshell isolates env changes
    _run_claude() {
        (
            local AUTH_FILE="${COPILOT_AUTH_FILE:-$HOME/.local/share/copilot-api/github_token}"
            export ANTHROPIC_BASE_URL="${COPILOT_BASE_URL}"
            export ANTHROPIC_MODEL="${COPILOT_MODEL}"
            export ANTHROPIC_DEFAULT_SONNET_MODEL="${COPILOT_SONNET_MODEL}"
            export ANTHROPIC_SMALL_FAST_MODEL="${COPILOT_SMALL_MODEL}"
            export ANTHROPIC_DEFAULT_HAIKU_MODEL="${COPILOT_HAIKU_MODEL}"
            export ANTHROPIC_DEFAULT_OPUS_MODEL="${COPILOT_OPUS_MODEL}"
            export DISABLE_NON_ESSENTIAL_MODEL_CALLS="1"
            export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"
            export API_TIMEOUT_MS="${COPILOT_API_TIMEOUT}"
            export UV_THREADPOOL_SIZE="16"
            export NODE_OPTIONS="${NODE_OPTIONS:---no-warnings}"
            unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY
            [[ -n "$REASONING_EFFORT" ]] && export COPILOT_REASONING_EFFORT="${REASONING_EFFORT}"
            if [[ -f "$AUTH_FILE" ]]; then
                export ANTHROPIC_API_KEY="$(cat "$AUTH_FILE")"
            else
                export ANTHROPIC_API_KEY="copilot"
            fi
            claude "$@"
        )
    }

    # Launch with socket-error auto-retry
    local _tmplog; _tmplog=$(mktemp -t claude-copilot.XXXXXX)
    _run_claude "$@" 2> >(tee "$_tmplog" >&2)
    local result=$?

    if [[ $result -ne 0 ]] && grep -qiE "socket.*closed|ECONNRESET|ETIMEDOUT|EPIPE|fetch failed" "$_tmplog" 2>/dev/null; then
        echo ""
        log_warn "Socket 错误，正在重启服务并重试..."
        lsof -ti tcp:"${COPILOT_PORT}" | xargs kill -9 2>/dev/null
        sleep 1
        _ensure_service_running && {
            local waited=0
            while [[ $waited -lt 30 ]] && ! _server_running; do sleep 1; ((waited++)); done
            _server_running && {
                log_info "服务恢复，正在重试 claude session..."
                _run_claude "$@"
                result=$?
            }
        }
    fi

    rm -f "$_tmplog" 2>/dev/null
    unset -f _run_claude _check_jq _server_running _ensure_service_running _start_service_fg 2>/dev/null
    return $result
}
