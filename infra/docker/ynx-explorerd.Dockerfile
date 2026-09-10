FROM golang:1.26.8-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-explorerd ./cmd/ynx-explorerd

FROM alpine:3.21
COPY --from=build /out/ynx-explorerd /usr/local/bin/ynx-explorerd
EXPOSE 6427
ENTRYPOINT ["ynx-explorerd"]
