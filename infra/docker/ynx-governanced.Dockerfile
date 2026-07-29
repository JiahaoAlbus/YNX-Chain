FROM golang:1.25.0-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ynx-governanced ./cmd/ynx-governanced
COPY internal/governance ./internal/governance
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ynx-governanced ./cmd/ynx-governanced

FROM alpine:3.22
RUN addgroup -S ynx && adduser -S -G ynx -h /var/lib/ynx-chain/governance ynx && mkdir -p /etc/ynx-chain/governance /var/lib/ynx-chain/governance && chown -R ynx:ynx /var/lib/ynx-chain/governance
COPY --from=build /out/ynx-governanced /usr/local/bin/ynx-governanced
USER ynx:ynx
EXPOSE 6441
ENTRYPOINT ["/usr/local/bin/ynx-governanced"]
CMD ["--config", "/etc/ynx-chain/governance/config.json"]
