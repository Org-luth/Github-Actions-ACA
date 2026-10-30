FROM ubuntu:24.04 AS build

ARG RUNNER_VERSION=2.338.2
ARG RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gzip tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /actions-runner

RUN curl --fail --location --retry 3 \
        "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
        --output runner.tar.gz \
    && printf '%s  runner.tar.gz\n' "${RUNNER_SHA256}" | sha256sum --check - \
    && tar -xzf runner.tar.gz \
    && rm runner.tar.gz

FROM ubuntu:24.04 AS runtime

LABEL owner="luth2" \
    org.opencontainers.image.authors="luth2 (https://github.com/luth2)"

ENV GH_URL="" \
    RUNNER_LABELS="aca" \
    HOME=/home/runner

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl git jq libgcc-s1 libicu74 libkrb5-3 liblttng-ust1t64 libssl3t64 libstdc++6 zlib1g \
    && useradd --create-home --shell /bin/bash runner \
    && install -d -o runner -g runner -m 0755 /home/runner/actions-runner \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/runner/actions-runner

COPY --from=build --chown=runner:runner /actions-runner/ ./
COPY --chown=runner:runner --chmod=0755 runner/entrypoint.sh ./entrypoint.sh

USER runner

RUN test -w . \
    && mkdir -p _diag _work \
    && test -w _diag \
    && test -w _work \
    && git --version \
    && curl --version \
    && jq --version

ENTRYPOINT ["/home/runner/actions-runner/entrypoint.sh"]