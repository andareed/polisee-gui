GO ?= ./scripts/go-local.sh

# Wails v2 uses WebKitGTK 4.1 on this Linux host. Override GUI_TAGS for
# platforms with another native WebView; no GTK tags are needed on Windows/macOS.
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Linux)
GUI_TAGS ?= desktop,production,webkit2_41
else
GUI_TAGS ?= desktop,production
endif

BUILD_LDFLAGS ?=

.PHONY: run build preview check test race smoke clean

run: build
	./bin/polisee-gui

build:
	$(GO) build -mod=readonly -buildvcs=false -ldflags '$(BUILD_LDFLAGS)' -tags '$(GUI_TAGS)' -o bin/polisee-gui .

preview:
	$(GO) run -mod=readonly ./cmd/preview

check:
	@test -z "$$(gofmt -l $$(git ls-files --cached --others --exclude-standard '*.go'))" || (echo 'Run gofmt'; exit 1)
	$(GO) vet -mod=readonly -tags '$(GUI_TAGS)' ./...
	$(GO) test -mod=readonly -tags '$(GUI_TAGS)' ./...
	npm run check

test:
	$(GO) test -mod=readonly ./internal/... ./frontend ./cmd/preview
	npm test

race:
	$(GO) test -mod=readonly -race ./internal/...

smoke: build
	./bin/polisee-gui --smoke

clean:
	rm -f bin/polisee-gui
