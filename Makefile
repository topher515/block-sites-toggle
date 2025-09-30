SHELL := /usr/local/bin/zsh

NODE ?= node
CONFIG ?= config.json
BUILD_DIR ?= build

.PHONY: build clean package help

build:
	$(NODE) build.js $(CONFIG)

clean:
	rm -rf $(BUILD_DIR)

package: build
	cd $(BUILD_DIR) && zip -r ../extension.zip .

help:
	@echo "Targets:"
	@echo "  build   - Generate extension into $(BUILD_DIR)"
	@echo "  clean   - Remove $(BUILD_DIR)"
	@echo "  package - Zip build/ to extension.zip"

