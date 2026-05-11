.PHONY: build build-linux web dev dev-web lint clean test coverage dev-docker dev-docker-adduser dev-docker-user

BINARY        := vps-manager
BINARY_LINUX  := vps-manager-linux

## Build the React SPA (outputs to internal/webapp/dist/)
web:
	cd web && bun run build

## Build for the current OS (macOS/Linux)
build: web
	CGO_ENABLED=1 go build -ldflags="-s -w" -o $(BINARY) ./cmd/server

## Cross-compile for Linux amd64 (for docker-compose.test.yml)
## Requires: brew install FiloSottile/musl-cross/musl-cross
build-linux: web
	GOOS=linux GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-linux-musl-gcc \
		go build -ldflags="-s -w -extldflags=-static" -o $(BINARY_LINUX) ./cmd/server

## Run tests (unit + integration)
test:
	CGO_ENABLED=1 go test ./... -count=1

## Test with coverage report
coverage:
	CGO_ENABLED=1 go test ./... -count=1 -coverprofile=coverage.out
	go tool cover -func=coverage.out

## Start the dev container (requires build-linux first)
dev-docker: build-linux
	docker compose -f docker-compose.test.yml up

## Create a user inside the running dev container
## Usage: make dev-docker-adduser USER=myuser
dev-docker-adduser:
	docker compose -f docker-compose.test.yml exec vps-manager \
		/usr/local/bin/vps-manager adduser $(USER)

## Run the Go server locally
dev:
	CGO_ENABLED=1 go run ./cmd/server

## Run the Vite dev server (proxy to Go backend on :8080)
dev-web:
	cd web && bun run dev

lint:
	go vet ./...

clean:
	rm -f $(BINARY) $(BINARY_LINUX) coverage.out
