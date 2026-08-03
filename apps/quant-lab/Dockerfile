FROM golang:1.25.0-bookworm@sha256:81dc45d05a7444ead8c92a389621fafabc8e40f8fd1a19d7e5df14e61e98bc1a AS build
WORKDIR /src
RUN mkdir -p /volume-init
COPY go.mod go.sum ./
RUN go mod download github.com/gorilla/websocket@v1.5.3
COPY internal ./internal
COPY cmd/ynx-quantd ./cmd/ynx-quantd
COPY cmd/ynx-quant-worker ./cmd/ynx-quant-worker
COPY cmd/ynx-quant-paperd ./cmd/ynx-quant-paperd
COPY cmd/ynx-quant-riskd ./cmd/ynx-quant-riskd
COPY cmd/ynx-quant-web ./cmd/ynx-quant-web
COPY cmd/ynx-quant-cli ./cmd/ynx-quant-cli
ARG SOURCE_COMMIT=development
RUN CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quantd ./cmd/ynx-quantd && \
    CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quant-worker ./cmd/ynx-quant-worker && \
    CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quant-paperd ./cmd/ynx-quant-paperd && \
    CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags="-s -w -X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=${SOURCE_COMMIT}" -o /out/ynx-quant-riskd ./cmd/ynx-quant-riskd && \
    CGO_ENABLED=0 go build -buildvcs=false -trimpath -o /out/ynx-quant-web ./cmd/ynx-quant-web && \
    CGO_ENABLED=0 go build -buildvcs=false -trimpath -o /out/ynx-quant-cli ./cmd/ynx-quant-cli

FROM gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35
COPY --from=build /out/ /usr/local/bin/
COPY apps/quant-lab/web /srv/quant-web
COPY --from=build --chown=65532:65532 /volume-init/ /var/lib/ynx-quant/
USER 65532:65532
WORKDIR /srv
ENV YNX_QUANT_STATE_PATH=/var/lib/ynx-quant/state.json \
    YNX_QUANT_WEB_ROOT=/srv/quant-web
VOLUME ["/var/lib/ynx-quant"]
ENTRYPOINT ["/usr/local/bin/ynx-quantd"]
