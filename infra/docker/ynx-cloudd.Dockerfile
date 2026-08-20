FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY internal/cloud ./internal/cloud
COPY apps/cloud/cmd/ynx-cloudd ./apps/cloud/cmd/ynx-cloudd

RUN CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/ynx-cloudd \
    ./apps/cloud/cmd/ynx-cloudd

FROM alpine:3.22

RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 ynx \
    && adduser -S -D -H -u 10001 -G ynx ynx \
    && mkdir -p /var/lib/ynx-cloud /opt/ynx/cloud-web \
    && chown -R 10001:10001 /var/lib/ynx-cloud /opt/ynx

COPY --from=build /out/ynx-cloudd /usr/local/bin/ynx-cloudd
COPY --chown=10001:10001 apps/cloud/web /opt/ynx/cloud-web

USER 10001:10001
WORKDIR /var/lib/ynx-cloud

EXPOSE 8092
VOLUME ["/var/lib/ynx-cloud"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-qO-", "http://127.0.0.1:8092/health/live"]

ENTRYPOINT ["/usr/local/bin/ynx-cloudd"]
CMD ["-addr", "0.0.0.0:8092", "-data", "/var/lib/ynx-cloud", "-cloud-ui", "/opt/ynx/cloud-web"]
