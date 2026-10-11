#!/usr/bin/env bash
set +x
set -euo pipefail

: "${GH_URL:?Set GH_URL to https://github.com/<organization>}"
: "${GITHUB_PAT:?Set GITHUB_PAT to a GitHub organization runner registration PAT}"

if [[ ! "$GH_URL" =~ ^https://github\.com/([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)/?$ ]]; then
    printf '%s\n' 'GH_URL must identify one GitHub.com organization, not a repository' >&2
    exit 1
fi
organization="${BASH_REMATCH[1]}"
if [[ ! "$GITHUB_PAT" =~ ^[A-Za-z0-9_-]+$ ]]; then
    printf '%s\n' 'GITHUB_PAT contains invalid characters' >&2
    exit 1
fi

RUNNER_NAME="${RUNNER_NAME:-aca-${HOSTNAME:0:40}-${RANDOM}${RANDOM}}"
RUNNER_LABELS="${RUNNER_LABELS:-aca}"
if [[ ! "$RUNNER_NAME" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
    printf '%s\n' 'RUNNER_NAME must contain 1-64 letters, digits, dots, underscores or hyphens' >&2
    exit 1
fi
if [[ ! "$RUNNER_LABELS" =~ ^[A-Za-z0-9._-]+(,[A-Za-z0-9._-]+)*$ ]]; then
    printf '%s\n' 'RUNNER_LABELS must be comma-separated labels without spaces' >&2
    exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ -e .runner ]]; then
    printf '%s\n' 'Ephemeral runners require a fresh runner directory for every execution' >&2
    exit 1
fi

registration_response="$(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_PAT" \
    | env -u GITHUB_PAT curl --config - --fail --silent --show-error \
        --request POST \
        --header 'Accept: application/vnd.github+json' \
        --header 'X-GitHub-Api-Version: 2022-11-28' \
        "https://api.github.com/orgs/${organization}/actions/runners/registration-token")"
registration_token="$(printf '%s' "$registration_response" \
    | jq --exit-status --raw-output '.token | select(type == "string" and length > 0)')"
unset GITHUB_PAT registration_response

configuration=(--unattended --url "$GH_URL" --token "$registration_token"
    --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --work _work --ephemeral --disableupdate)
if [[ -n "${RUNNER_GROUP:-}" ]]; then
    configuration+=(--runnergroup "$RUNNER_GROUP")
fi
./config.sh "${configuration[@]}"
unset registration_token configuration
exec ./run.sh