.PHONY: build build-linux web dev watch lint clean test coverage dev-docker dev-docker-adduser

BINARY        := vps-pilot
BINARY_LINUX  := vps-pilot-linux

## Build the React SPA (outputs to internal/webapp/dist/)
web:
	cd web && bun run build

## Build binary for the current OS
build: web
	go build -ldflags="-s -w" -o $(BINARY) ./cmd/server

## Cross-compile for Linux amd64
## Requires: brew install FiloSottile/musl-cross/musl-cross
build-linux: web
	GOOS=linux GOARCH=amd64 \
		go build -ldflags="-s -w" -o $(BINARY_LINUX) ./cmd/server

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
	rm -f $(BINARY) $(BINARY_LINUX) coverage.out
