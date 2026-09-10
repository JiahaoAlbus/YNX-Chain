FROM golang:1.26.8-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-indexerd ./cmd/ynx-indexerd

FROM alpine:3.20
COPY --from=build /out/ynx-indexerd /usr/local/bin/ynx-indexerd
EXPOSE 6426
ENTRYPOINT ["ynx-indexerd"]
