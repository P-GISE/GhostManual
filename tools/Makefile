# Run from any directory: make -f /path/to/GhostManual/tools/Makefile <target>
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export CODEGRAPH_TELEMETRY := 0
export DO_NOT_TRACK := 1
TOOLS_DIR := $(shell cd "$$(dirname "$(MAKEFILE_LIST)")" && pwd)
ROOT := $(shell cd "$(TOOLS_DIR)/.." && pwd)
empty :=
space := $(empty) $(empty)
include $(subst $(space),\$(space),$(TOOLS_DIR))/versions.mk
CACHE := $(ROOT)/.dev-tools
PYTHON := $(CACHE)/venv/bin/python
BIN := $(CACHE)/venv/bin
CODEGRAPH := $(CACHE)/node/node_modules/.bin/codegraph
OMNIROUTE := $(CACHE)/gateway/node_modules/.bin/omniroute
PM_PLUGINS := pm-toolkit pm-product-strategy pm-product-discovery pm-market-research pm-data-analytics pm-marketing-growth pm-go-to-market pm-execution pm-ai-shipping

.PHONY: help install venv install-core install-optional plugins lazycodex index check report strix gateway headroom doctor
help:
	@printf '%s\n' 'install: isolated CLI tools (Node 24, Python 3.12, uv, make)' 'plugins: Superpowers + PM Skills + Ponytail in this user Codex installation' 'lazycodex: optional alternative orchestration plugin' 'index: build local CodeGraph index' 'check/report: Iron Laws check / Markdown report' 'strix: manual local-source pentest (Docker + LLM credentials required)' 'gateway/headroom: foreground local services; provider setup required' 'doctor: installed CLI versions'

install: install-core install-optional

venv:
	@test -x "$(PYTHON)" || uv venv "$(CACHE)/venv" --python 3.12

install-core: venv
	npm install --prefix "$(CACHE)/node" --no-save --package-lock=false @colbymchenry/codegraph@$(CODEGRAPH_VERSION)
	uv pip install --python "$(PYTHON)" "git+https://github.com/JinHo-von-Choi/iron-laws.git@$(IRON_LAWS_REF)"

install-optional: venv
	npm install --prefix "$(CACHE)/gateway" --no-save --package-lock=false --allow-scripts=omniroute,keytar,onnxruntime-node,@parcel/watcher,@swc/core,protobufjs,esbuild omniroute@$(OMNIROUTE_VERSION)
	uv pip install --python "$(PYTHON)" "strix-agent==$(STRIX_VERSION)" "headroom-ai[proxy,mcp]==$(HEADROOM_VERSION)"

# Explicit opt-in: Codex plugins are user-scoped, not part of the app runtime.
plugins:
	codex plugin marketplace add obra/superpowers --ref $(SUPERPOWERS_REF)
	codex plugin add superpowers@superpowers-dev
	codex plugin marketplace add phuryn/pm-skills --ref $(PM_SKILLS_REF)
	@for plugin in $(PM_PLUGINS); do codex plugin add "$$plugin@pm-skills"; done
	codex plugin marketplace add DietrichGebert/ponytail --ref $(PONYTAIL_REF)
	codex plugin add ponytail@ponytail

lazycodex:
	codex plugin marketplace add code-yeongyu/lazycodex --ref $(LAZYCODEX_REF)
	codex plugin add omo@sisyphuslabs

index:
	cd "$(ROOT)" && "$(CODEGRAPH)" init

check:
	cd "$(ROOT)" && "$(BIN)/iron-laws" check . --fail-on HIGH

report:
	mkdir -p "$(CACHE)/reports"
	cd "$(ROOT)" && "$(BIN)/iron-laws" audit . --format markdown -o "$(CACHE)/reports/iron-laws.md"

strix:
	@test -n "$${STRIX_LLM:-}" || { echo 'Set STRIX_LLM and authenticate your LLM provider first.' >&2; exit 2; }
	@mkdir -p "$(CACHE)"
	@scan_dir=$$(mktemp -d "$(CACHE)/strix-source.XXXXXX"); \
	git -C "$(ROOT)" archive HEAD | tar -x -C "$$scan_dir"; \
	cd "$(ROOT)" && "$(BIN)/strix" -n -t "$$scan_dir" --scan-mode quick --fail-on high

gateway:
	cd "$(CACHE)/gateway" && DATA_DIR="$(CACHE)/gateway-data" OMNIROUTE_CLI_SKIP_REPO_ENV=1 OMNIROUTE_SERVER_HOST=127.0.0.1 "$(OMNIROUTE)" serve --port 20128 --no-open --no-tray --no-recovery

headroom:
	cd "$(ROOT)" && HEADROOM_BEACON=off DO_NOT_TRACK=1 "$(BIN)/headroom" proxy --host 127.0.0.1 --port 8787 --disable-kompress --stateless

doctor:
	"$(CODEGRAPH)" --version
	"$(PYTHON)" -c 'from importlib.metadata import version; print("iron-laws " + version("iron-laws"))'
	"$(BIN)/strix" --version
	HEADROOM_BEACON=off "$(BIN)/headroom" --version
	cd "$(CACHE)/gateway" && DATA_DIR="$(CACHE)/gateway-data" OMNIROUTE_CLI_SKIP_REPO_ENV=1 "$(OMNIROUTE)" --version
