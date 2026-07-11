FROM golang:1.25-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-bft-gatewayd ./cmd/ynx-bft-gatewayd

FROM alpine:3.21
COPY --from=build /out/ynx-bft-gatewayd /usr/local/bin/ynx-bft-gatewayd
EXPOSE 27620
ENTRYPOINT ["ynx-bft-gatewayd"]
