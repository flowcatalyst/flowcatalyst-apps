# Photon geocoder — komoot/photon, classic Elasticsearch flavour.
#
# ONE image serves two roles; the command decides which:
#   - build pipeline: `-nominatim-import ...`  (builds /photon/photon_data, exits)
#   - runtime:        `-data-dir /photon`       (serves the prebuilt index on 2322)
#
# The Photon jar is pure Java, so this image is architecture-agnostic
# (no amd64-only headache like the PostGIS images).
ARG PHOTON_VERSION=0.6.2
FROM eclipse-temurin:21-jre

ARG PHOTON_VERSION

# The jar lives OUTSIDE the data dir (/opt/photon, not /photon) so a volume
# mounted at /photon (build pipeline) or /photon/photon_data (runtime) never
# shadows it. /photon is just the data dir.
# curl is kept in the image so the runtime healthcheck can hit the API.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/photon /photon \
 && curl -fL --retry 3 -o /opt/photon/photon.jar \
      "https://github.com/komoot/photon/releases/download/${PHOTON_VERSION}/photon-${PHOTON_VERSION}.jar"

WORKDIR /photon
EXPOSE 2322

# ENTRYPOINT is fixed; CMD (the Photon args) is overridden by the build
# pipeline. Default CMD serves an already-built index in /photon/photon_data.
ENTRYPOINT ["java", "-jar", "/opt/photon/photon.jar"]
CMD ["-data-dir", "/photon"]
