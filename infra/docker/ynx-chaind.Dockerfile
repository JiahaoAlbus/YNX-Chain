FROM golang:1.25-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /out/ynx-chaind ./cmd/ynx-chaind

FROM alpine:3.20
COPY --from=build /out/ynx-chaind /usr/local/bin/ynx-chaind
EXPOSE 6420
ENTRYPOINT ["ynx-chaind"]

