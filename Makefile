.PHONY: build build-linux build-linux-arm64 web dev watch lint clean test coverage dev-docker dev-docker-adduser

BINARY        := vps-pilot
BINARY_LINUX  := vps-pilot-linux
VERSION       ?= $(shell git describe --tags --abbrev=0 2>/dev/null || echo "dev")

## Build the React SPA (outputs to internal/webapp/dist/)
web:
	cd web && bun run build

## Build binary for the current OS
build: web
	go build -ldflags="-s -w -X main.version=$(VERSION)" -o $(BINARY) ./cmd/server

## Cross-compile for Linux amd64 (no CGO required — uses modernc/sqlite)
build-linux: web
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
		go build -ldflags="-s -w -X main.version=$(VERSION)" -o $(BINARY_LINUX)-amd64 ./cmd/server

## Cross-compile for Linux arm64
build-linux-arm64: web
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
		go build -ldflags="-s -w -X main.version=$(VERSION)" -o $(BINARY_LINUX)-arm64 ./cmd/server

## Run the Go API server only on :8080 (no frontend build)
dev-api:
	set -a && [ -f .env ] && . ./.env; set +a; go run ./cmd/server

## Run the Vite dev server on :5173 with HMR (proxies /api → :8080)
dev-web:
	cd web && bun run dev

## Full dev: Go API on :8080 + Vite HMR on :5173, Ctrl-C stops both.
## Open http://localhost:5173 in your browser.
## Run `make web` once first if internal/webapp/dist/ doesn't exist yet.
dev:
	set -a && [ -f .env ] && . ./.env; set +a; \
	trap 'kill 0' INT TERM; \
	go run ./cmd/server & \
	cd web && bun run dev; \
	wait

## Watch frontend changes and rebuild dist/ (for non-proxy dev workflow)
watch:
	cd web && bun run build --watch

test:
	go test ./... -count=1

coverage:
	go test ./... -count=1 -coverprofile=coverage.out
	go tool cover -func=coverage.out

dev-docker: build-linux
	docker compose -f docker-compose.test.yml up

dev-docker-adduser:
	docker compose -f docker-compose.test.yml exec vps-pilot \
		/usr/local/bin/vps-pilot adduser $(USER)

lint:
	go vet ./...

clean:
	rm -f $(BINARY) $(BINARY_LINUX)-amd64 $(BINARY_LINUX)-arm64 coverage.out
