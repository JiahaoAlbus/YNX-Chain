FROM golang:1.24-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-resourced ./cmd/ynx-resourced

FROM alpine:3.21
COPY --from=build /out/ynx-resourced /usr/local/bin/ynx-resourced
EXPOSE 6432
ENTRYPOINT ["ynx-resourced"]
