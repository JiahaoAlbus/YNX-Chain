FROM golang:1.26.8-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-trustd ./cmd/ynx-trustd

FROM alpine:3.21
COPY --from=build /out/ynx-trustd /usr/local/bin/ynx-trustd
EXPOSE 6431
ENTRYPOINT ["ynx-trustd"]
