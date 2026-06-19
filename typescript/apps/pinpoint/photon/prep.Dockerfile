# Prep stage of the Photon index build: downloads the Geofabrik per-country
# extracts and merges them into a single PBF for the Nominatim import.
# osmium-tool does the merge (dedupes objects shared across extracts).
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      osmium-tool \
      curl \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY merge.sh /usr/local/bin/merge.sh
RUN chmod +x /usr/local/bin/merge.sh

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/merge.sh"]
