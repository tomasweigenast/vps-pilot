.PHONY: build build-linux web dev watch lint clean test coverage dev-docker dev-docker-adduser

BINARY        := vps-manager
BINARY_LINUX  := vps-manager-linux

## Build the React SPA (outputs to internal/webapp/dist/)
web:
	cd web && bun run build

## Build binary for the current OS
build: web
	CGO_ENABLED=1 go build -ldflags="-s -w" -o $(BINARY) ./cmd/server

## Cross-compile for Linux amd64
## Requires: brew install FiloSottile/musl-cross/musl-cross
build-linux: web
	GOOS=linux GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-linux-musl-gcc \
		go build -ldflags="-s -w -extldflags=-static" -o $(BINARY_LINUX) ./cmd/server

## Build frontend + run server (single command for development)
dev: web
	set -a && [ -f .env ] && . ./.env; set +a; CGO_ENABLED=1 go run ./cmd/server

## Watch frontend changes and rebuild automatically (requires entr or similar)
## Usage: make watch  — rebuilds frontend on file change, restart server manually
watch:
	cd web && bun run build --watch

test:
	CGO_ENABLED=1 go test ./... -count=1

coverage:
	CGO_ENABLED=1 go test ./... -count=1 -coverprofile=coverage.out
	go tool cover -func=coverage.out

dev-docker: build-linux
	docker compose -f docker-compose.test.yml up

dev-docker-adduser:
	docker compose -f docker-compose.test.yml exec vps-manager \
		/usr/local/bin/vps-manager adduser $(USER)

lint:
	go vet ./...

clean:
	rm -f $(BINARY) $(BINARY_LINUX) coverage.out
