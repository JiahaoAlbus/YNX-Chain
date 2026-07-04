FROM golang:1.25-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-faucetd ./cmd/ynx-faucetd

FROM alpine:3.21
COPY --from=build /out/ynx-faucetd /usr/local/bin/ynx-faucetd
EXPOSE 6428
ENTRYPOINT ["ynx-faucetd"]
