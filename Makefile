.PHONY: start stop check-deps setup compile db shell clean help

ERLANG_VSN  := $(shell cat .tool-versions | grep erlang | awk '{print $$2}')
REBAR_VSN   := $(shell cat .tool-versions | grep rebar | awk '{print $$2}')

# Colors
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
BOLD   := \033[1m
RESET  := \033[0m

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'

start: check-deps db compile ## Start everything (deps check + db + server)
	@echo ""
	@echo "$(BOLD)$(GREEN)Starting Asobi Arena...$(RESET)"
	@echo ""
	@rebar3 nova serve

stop: ## Stop PostgreSQL
	@docker compose down
	@echo "$(GREEN)PostgreSQL stopped.$(RESET)"

check-deps: ## Verify all required tools are installed
	@echo "$(BOLD)Checking dependencies...$(RESET)"
	@echo ""
	@MISSING=0; \
	\
	if command -v erl >/dev/null 2>&1; then \
		INSTALLED=$$(erl -noshell -eval 'io:format("~s", [erlang:system_info(otp_release)]), halt().'); \
		EXPECTED=$$(echo $(ERLANG_VSN) | cut -d. -f1); \
		if [ "$$INSTALLED" = "$$EXPECTED" ]; then \
			echo "  $(GREEN)✓$(RESET) Erlang/OTP $$INSTALLED"; \
		else \
			echo "  $(YELLOW)!$(RESET) Erlang/OTP $$INSTALLED found, expected $(ERLANG_VSN)"; \
		fi; \
	else \
		echo "  $(RED)✗$(RESET) Erlang/OTP not found"; \
		MISSING=1; \
	fi; \
	\
	if command -v rebar3 >/dev/null 2>&1; then \
		echo "  $(GREEN)✓$(RESET) rebar3"; \
	else \
		echo "  $(RED)✗$(RESET) rebar3 not found"; \
		MISSING=1; \
	fi; \
	\
	if command -v docker >/dev/null 2>&1; then \
		echo "  $(GREEN)✓$(RESET) Docker"; \
	else \
		echo "  $(RED)✗$(RESET) Docker not found"; \
		MISSING=1; \
	fi; \
	\
	if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then \
		echo "  $(GREEN)✓$(RESET) Docker Compose"; \
	else \
		echo "  $(RED)✗$(RESET) Docker Compose not found"; \
		MISSING=1; \
	fi; \
	\
	echo ""; \
	if [ "$$MISSING" -eq 1 ]; then \
		echo "$(BOLD)$(RED)Missing dependencies.$(RESET) Install them with:"; \
		echo ""; \
		if command -v mise >/dev/null 2>&1; then \
			echo "  $(BOLD)mise install$(RESET)            # Erlang + rebar3 (from .tool-versions)"; \
		else \
			echo "  $(BOLD)# Option 1: mise (recommended)$(RESET)"; \
			echo "  curl https://mise.run | sh"; \
			echo "  mise install"; \
			echo ""; \
			echo "  $(BOLD)# Option 2: manual$(RESET)"; \
			echo "  # Install Erlang/OTP $(ERLANG_VSN) and rebar3 $(REBAR_VSN)"; \
		fi; \
		echo ""; \
		echo "  Docker: https://docs.docker.com/get-docker/"; \
		echo ""; \
		exit 1; \
	fi; \
	echo "$(GREEN)All good.$(RESET)"

setup: check-deps ## First-time setup (deps check + fetch deps + start db + compile)
	@$(MAKE) db
	@echo ""
	@echo "$(BOLD)Fetching dependencies...$(RESET)"
	@rebar3 get-deps
	@$(MAKE) compile
	@echo ""
	@echo "$(BOLD)$(GREEN)Setup complete!$(RESET) Run $(BOLD)make start$(RESET) to launch."

db: ## Start PostgreSQL (if not already running)
	@if docker compose ps --status running 2>/dev/null | grep -q postgres; then \
		echo "  $(GREEN)✓$(RESET) PostgreSQL already running"; \
	else \
		echo "  Starting PostgreSQL..."; \
		docker compose up -d; \
		echo "  $(GREEN)✓$(RESET) PostgreSQL running on port 5436"; \
	fi

compile: ## Compile the project
	@rebar3 compile

shell: check-deps db compile ## Start an interactive Erlang shell
	@rebar3 shell

clean: ## Remove build artifacts
	@rebar3 clean
	@echo "$(GREEN)Clean.$(RESET)"
