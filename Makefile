NODE ?= node
CONFIG ?= config.json
BUILD_DIR ?= build

.PHONY: build clean package test new-module worker-dev worker-test worker-deploy help

build:
	$(NODE) build.js $(CONFIG)

clean:
	rm -rf $(BUILD_DIR)

package: build
	cd $(BUILD_DIR) && zip -r ../extension.zip .

test:
	$(NODE) --test test/

# make new-module NAME=meditate TITLE="Meditate 🧘"
new-module:
	@test -n "$(NAME)" || (echo "usage: make new-module NAME=<dir> [TITLE=...]" && exit 1)
	@test ! -e src/modules/$(NAME) || (echo "src/modules/$(NAME) already exists" && exit 1)
	cp -R src/modules/_template src/modules/$(NAME)
	sed -i.bak -e 's/__ID__/$(NAME)/g' -e 's/__TITLE__/$(or $(TITLE),$(NAME))/g' src/modules/$(NAME)/index.js && rm src/modules/$(NAME)/index.js.bak
	@echo "Created src/modules/$(NAME)/index.js. Run make build and reload the extension."

# Sync worker (Cloudflare). Wrangler needs Node 22+; worker/deploy.sh switches via fnm if needed.
worker-dev:
	cd worker && printf 'SYNC_TOKEN=dev-token\n' > .dev.vars && npx wrangler d1 migrations apply block-sites-sync --local && npx wrangler dev --local --port 8787

worker-test:
	cd worker && $(NODE) smoke-test.mjs http://localhost:8787 dev-token

worker-deploy:
	worker/deploy.sh

help:
	@echo "Targets:"
	@echo "  build          - Generate extension into $(BUILD_DIR) (load it unpacked)"
	@echo "  test           - Unit tests"
	@echo "  new-module     - Scaffold a mode: make new-module NAME=x TITLE='X'"
	@echo "  worker-dev     - Run the sync worker locally on :8787"
	@echo "  worker-test    - Smoke-test the local worker"
	@echo "  worker-deploy  - Deploy the worker to Cloudflare, write sync.local.json"
	@echo "  clean          - Remove $(BUILD_DIR)"
