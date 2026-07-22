# syntax=docker/dockerfile:1.7
FROM golang:1.25.0-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY internal ./internal
COPY cmd/ynx-quantd ./cmd/ynx-quantd
COPY cmd/ynx-quant-worker ./cmd/ynx-quant-worker
COPY cmd/ynx-quant-paperd ./cmd/ynx-quant-paperd
COPY cmd/ynx-quant-riskd ./cmd/ynx-quant-riskd
COPY cmd/ynx-quant-web ./cmd/ynx-quant-web
COPY cmd/ynx-quant-cli ./cmd/ynx-quant-cli
ARG SOURCE_COMMIT=development
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quantd ./cmd/ynx-quantd && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quant-worker ./cmd/ynx-quant-worker && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quant-paperd ./cmd/ynx-quant-paperd && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quant-riskd ./cmd/ynx-quant-riskd && \
    CGO_ENABLED=0 go build -trimpath -o /out/ynx-quant-web ./cmd/ynx-quant-web && \
    CGO_ENABLED=0 go build -trimpath -o /out/ynx-quant-cli ./cmd/ynx-quant-cli

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ /usr/local/bin/
COPY apps/quant-lab/web /srv/quant-web
USER 65532:65532
WORKDIR /srv
ENV YNX_QUANT_STATE_PATH=/var/lib/ynx-quant/state.json \
    YNX_QUANT_WEB_ROOT=/srv/quant-web
VOLUME ["/var/lib/ynx-quant"]
ENTRYPOINT ["/usr/local/bin/ynx-quantd"]
