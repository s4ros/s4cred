FROM golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /s4cred ./cmd/s4cred \
    && mkdir /data && chown 65532:65532 /data

FROM scratch
COPY --from=build /s4cred /s4cred
COPY --from=build --chown=65532:65532 /data /data
USER 65532:65532
ENV PUBLIC_ORIGIN=http://localhost:8080 \
    DATABASE_PATH=/data/notes.db \
    LISTEN_ADDR=:8080 \
    MAX_ACTIVE_NOTES=10000 \
    MAX_ACTIVE_BYTES=1000000000
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/s4cred"]
