FROM golang:1.25-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-ai-gatewayd ./cmd/ynx-ai-gatewayd

FROM alpine:3.21
COPY --from=build /out/ynx-ai-gatewayd /usr/local/bin/ynx-ai-gatewayd
EXPOSE 6429
ENTRYPOINT ["ynx-ai-gatewayd"]
