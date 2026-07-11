FROM golang:1.24-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-payd ./cmd/ynx-payd

FROM alpine:3.21
COPY --from=build /out/ynx-payd /usr/local/bin/ynx-payd
EXPOSE 6430
ENTRYPOINT ["ynx-payd"]
