# GitHub Actions ACA Runner

Ephemeral organization runner image for Azure Container Apps Jobs. Linux/amd64 only.

[English](#english) | [Deutsch](#deutsch) | [Releases](https://github.com/Org-luth/Github-Actions-ACA/releases) | [Documentation](https://org-luth.github.io/Github-Actions-ACA/)

## English

### Scope

This repository **builds and publishes the container only**. It does not provision Azure resources or deploy Container Apps Jobs. It is separate from the persistent Linux/Windows runner project.

Based on [Microsoft's ACA runner tutorial](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-ci-cd-runners-jobs?tabs=bash&pivots=container-apps-jobs-self-hosted-ci-cd-github-actions) and its [sample repository](https://github.com/Azure-Samples/container-apps-ci-cd-runner-tutorial), adapted for **organization** registration rather than one repository.

Ubuntu 24.04 with Git, curl, jq and the official GitHub Actions runner, running as the unprivileged `runner` user. The runner archive is pinned and SHA256-verified. No sudo, Azure CLI, Docker daemon, Docker CLI, Buildx, Windows support or preinstalled language toolchains. Install required job tools in a derived image or use actions that support non-root installation. Container actions, service containers and Docker builds requiring a local daemon are not supported on this image in ACA.

### Runtime Configuration

| Variable | Required | Value |
| --- | --- | --- |
| `GH_URL` | Yes | Organization URL, e.g. `https://github.com/Org-luth`; repository URLs are rejected. GitHub.com only. |
| `GITHUB_PAT` | Yes | Runtime PAT used to request a short-lived organization registration token. Supply as an ACA secret reference. |
| `RUNNER_NAME` | No | Automatically generated unique name; explicit names must be unique across concurrent executions, max. 64 characters. |
| `RUNNER_LABELS` | No | Comma-separated labels, default `aca`; no whitespace. |
| `RUNNER_GROUP` | No | Existing organization runner group; otherwise GitHub's default group. Restrict its allowed repositories. |

Each **fresh container registers for exactly one job** using `--ephemeral --disableupdate`, then exits with the runner's exit status. GitHub normally removes an ephemeral runner after the job. Failed startup or forcibly terminated executions can leave offline registrations; monitor and remove those separately. Do not persist the runner directory or reuse an already configured container. An existing `.runner` file is rejected. HTTP, token parsing and registration failures stop startup before jobs can run.

For registration, use a fine-grained PAT owned by the organization with **organization Self-hosted runners: read and write**, subject to organization approval and policy. Classic PATs require `admin:org` and, where applicable, `repo` for private repositories; the account must have the organization access required by [GitHub's registration endpoint](https://docs.github.com/en/rest/actions/self-hosted-runners#create-a-registration-token-for-an-organization). A repository workflow's `GITHUB_TOKEN` is not an organization registration credential. The scaler additionally needs Actions read access to the repositories it polls; a separate least-privilege scaler credential is preferable.

The startup script removes `GITHUB_PAT` before launching configuration and the runner, and does not place the PAT on curl's command line. This is **not a security boundary against container/platform administrators**: the configured container environment and referenced ACA secrets remain sensitive. Restrict ACA job-start and job-update permissions as well as secret access. Never bake tokens into the image, enable shell tracing around secrets, or execute untrusted fork jobs on these runners. Forward logs externally before ephemeral containers disappear.

### Build And Job Selection

```bash
docker build --platform linux/amd64 -t github-actions-runner-aca:local .

# GITHUB_PAT must already be securely exported in the local shell.
docker run --rm --init \
	--env GH_URL=https://github.com/Org-luth \
	--env GITHUB_PAT \
	--env RUNNER_LABELS=aca \
	github-actions-runner-aca:local
```

Use the matching labels in consumer workflows:

```yaml
jobs:
	example:
		runs-on: [self-hosted, linux, x64, aca]
		steps:
			- uses: actions/checkout@v6
			- run: git --version
```

An externally managed ACA event-driven Job must use the published image, organization URL, secret reference, suitable timeout/resources, one runner per execution and no persistent runner state. For the `github-runner` scaler, use `owner=Org-luth`, `runnerScope=org`, labels matching the runner and an appropriate repository filter. Prefer explicit `repos` to avoid polling every repository. Check the [KEDA scaler specification](https://keda.sh/docs/latest/scalers/github-runner/) against the version supported by ACA; do not copy the tutorial's repository scope unchanged. Configure private ACR pulls outside this repository, preferably through managed identity. No Azure subscription, resource group or infrastructure credentials are needed for this repository's builds.

### Releases And Registries

Conventional Commits on `main` drive semantic-release: `feat:` produces a minor release, `fix:` a patch, and breaking changes a major release. Documentation-only commits do not publish new images. An initial `feat: add ephemeral ACA organization runner` commit creates the first release. Repository version and packaged runner version are independent.

The workflow validates tests/docs, creates a GitHub release and then builds and smoke-tests one `linux/amd64` image before publishing **the same image** to:

| Registry | Tags |
| --- | --- |
| Docker Hub | `<USER_DOCKERHUB>/github-actions-runner-aca:<version>` and `:latest` |
| Private ACR | `<URL_AZURECONTAINERREG>/github-actions-runner-aca:<version>` and `:latest` |

PRs build and smoke-test without registry credentials or publication. Manual workflow runs on a non-main branch also build without publishing. A main-branch rerun can retry publication only for the latest stable release whose tag points to the current commit. Publication across two registries is not transactional: version tags are pushed to both before either `latest` tag is pushed, but a failed second push can still leave a partial result. Rerun the workflow to recover. Version tags can be overwritten on retry; use image digests for immutable deployment references.

Configure these **repository secrets** for publication, not runner registration:

| Secret | Purpose |
| --- | --- |
| `USER_DOCKERHUB` | Docker Hub login and namespace; this setup targets that user's namespace. |
| `PAT_DOCKERHUB` | Docker Hub PAT: Read/Write for pushes; Read/Write/Delete for the overview action. |
| `URL_AZURECONTAINERREG` | Registry hostname or HTTPS origin, e.g. `example.azurecr.io`; no path. |
| `USER_AZURECONTAINERREG` | Registry publishing user/service principal. |
| `PW_AZURECONTAINERREG` | Corresponding registry publishing password. |

The Docker Hub repository must exist and the user must be allowed to update its description. GitHub's built-in `GITHUB_TOKEN` creates releases/update PRs; allow GitHub Actions to create pull requests in repository settings. Enable GitHub Pages with **GitHub Actions** as its source. `dockerhub-overview.yml` synchronizes this README; `pages.yml` publishes English/German HTML documentation.

### Maintenance And Checks

The daily/manual runner-update workflow checks the latest stable official `actions/runner` release, validates its Linux x64 asset digest and opens a `fix(deps):` PR assigned to `luth2`. Dependabot checks npm and workflow actions weekly; all PRs are assigned to `luth2`. PRs created with `GITHUB_TOKEN` do not automatically trigger ordinary PR CI: manually run the build workflow on `automation/update-actions-runner` before merging. Protect `main` with required checks and review.

Self-updates are disabled. Merge runner update PRs promptly, publish the new image and **update the externally managed ACA Job image reference**. GitHub can stop assigning jobs to outdated runner versions, generally after 30 days from a new release and sooner for critical security updates. The updater cannot deploy images or guarantee timely PR merges. Refresh/release the image for base OS security updates too; Dependabot here covers npm/actions, not OS packages.

Development requirements: Node.js >=24.10.0, npm, Bash and jq. Docker is additionally needed for real image build/smoke tests.

```bash
npm ci --ignore-scripts
npm test
npm run docs:build
```

Tests use isolated runner/API stubs, not a real PAT or Azure resources. They verify token handling, failure exits, configuration, workflow gates, checksum updates and release retries. Node dependencies are development/release/docs tooling only and are not copied into the image. Review `npm audit` results separately; passing tests do not certify dependency security or real ACA compatibility.

## Deutsch

### Umfang

Dieses Repository **baut und veroeffentlicht nur den Container**. Es erstellt keine Azure-Ressourcen und deployt keine Container Apps Jobs. Der persistente Linux-/Windows-Runner bleibt im separaten Repository.

Grundlage sind das [Microsoft-Tutorial](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-ci-cd-runners-jobs?tabs=bash&pivots=container-apps-jobs-self-hosted-ci-cd-github-actions) und dessen [Beispielrepository](https://github.com/Azure-Samples/container-apps-ci-cd-runner-tutorial). Hier wird der Runner jedoch auf **Organisationsebene**, beispielsweise `Org-luth`, registriert.

Das Image verwendet Ubuntu 24.04, Git, curl, jq und den offiziellen, versionsgebundenen und SHA256-geprueften Runner. Ausfuehrung als unprivilegierter Benutzer `runner`. Keine sudo-Rechte, Azure CLI, Docker-Werkzeuge/-Daemon, Buildx, Windows-Unterstuetzung oder vorinstallierten Sprach-Toolchains. Benoetigte Werkzeuge gehoeren in ein abgeleitetes Image oder muessen ohne Root-Rechte installiert werden. Container-Actions, Service-Container und Builds mit lokalem Docker-Daemon werden in ACA nicht unterstuetzt.

### Konfiguration

| Variable | Bedeutung |
| --- | --- |
| `GH_URL` | Pflicht: Organisations-URL wie `https://github.com/Org-luth`. Keine Repository-URL; nur GitHub.com. |
| `GITHUB_PAT` | Pflicht: Laufzeit-PAT als ACA-Secret-Referenz, nicht ins Image einbauen. |
| `RUNNER_NAME` | Optional: automatisch eindeutig; eigene Namen muessen bei parallelen Ausfuehrungen eindeutig sein, maximal 64 Zeichen. |
| `RUNNER_LABELS` | Optional: kommagetrennt ohne Leerzeichen; Standard `aca`. |
| `RUNNER_GROUP` | Optional: vorhandene Runner-Gruppe der Organisation; Zugriff auf erlaubte Repositories einschraenken. |

Ein frischer Container wird mit `--ephemeral --disableupdate` fuer genau einen Job registriert und beendet sich anschliessend mit dessen Runner-Exit-Code. GitHub entfernt den Runner normalerweise nach dem Job. Startfehler und erzwungene Abbrueche koennen verwaiste Offline-Registrierungen hinterlassen; diese separat ueberwachen/bereinigen. Kein persistentes Runner-Verzeichnis und keine Wiederverwendung konfigurierter Container. HTTP-, JSON- und Registrierungsfehler brechen den Start ab.

Fuer die Registrierung benoetigt ein Fine-grained PAT der Organisation die Organisationsberechtigung **Self-hosted runners: read and write**, unter Beachtung der Freigabe-/Zugriffsrichtlinien. Classic PATs benoetigen `admin:org`, gegebenenfalls `repo` fuer private Repositories, und passenden Organisationszugriff. Siehe [GitHub-API](https://docs.github.com/en/rest/actions/self-hosted-runners#create-a-registration-token-for-an-organization). Der Scaler braucht zusaetzlich Actions-Lesezugriff auf die abgefragten Repositories; getrennte Zugangsdaten mit minimalen Rechten bevorzugen.

Der PAT wird vor Konfiguration und Runner-Start aus deren Umgebung entfernt und nicht als curl-Kommandozeilenargument uebergeben. Container-/Plattformadministratoren koennen konfigurierte Umgebungsvariablen bzw. ACA-Secrets trotzdem einsehen. Auch Job-Start-/Aenderungsrechte einschraenken. Keine unbekannten Fork-Jobs auf diesen Runnern ausfuehren. Logs vor dem Ende der kurzlebigen Container extern sichern.

### Nutzung Und ACA

Die Build-/Startbefehle und das Consumer-Workflow-Beispiel stehen im englischen Abschnitt. Jobs waehlen den Runner mit `runs-on: [self-hosted, linux, x64, aca]`.

Der separat verwaltete ACA Job verwendet das Image, `GH_URL`, eine PAT-Secret-Referenz, passende Ressourcen/Timeouts und einen Runner pro Ausfuehrung. Der Scaler muss zur Organisation passen: `owner=Org-luth`, `runnerScope=org`, passende Labels und moeglichst ein expliziter `repos`-Filter. [KEDA-Dokumentation](https://keda.sh/docs/latest/scalers/github-runner/) mit der von ACA unterstuetzten Version abgleichen. Die Repository-Einstellungen des Tutorials nicht unveraendert uebernehmen. Private ACR-Image-Pulls beispielsweise per Managed Identity ausserhalb dieses Repositories konfigurieren.

### Automatisierung

Conventional Commits auf `main`: `feat:` erzeugt ein Minor-, `fix:` ein Patch-Release, Breaking Changes ein Major-Release. Reine Dokumentationsaenderungen erzeugen kein Image-Release. Fuer die erste Veroeffentlichung einen `feat:`-Commit verwenden. Repository-Version und Runner-Version sind voneinander unabhaengig.

Nach Tests und Dokumentationsbuild erzeugt die Pipeline ein GitHub-Release, baut/testet das Linux/amd64-Image und veroeffentlicht es in Docker Hub und privatem ACR jeweils als `github-actions-runner-aca:<version>` und `:latest`. PRs und manuelle Builds auf anderen Branches veroeffentlichen nichts und verwenden keine Registry-Secrets. Ein erneuter Lauf auf `main` kann die Veroeffentlichung des aktuellen neuesten stabilen Releases wiederholen. Registry-Pushes sind nicht transaktional; bei Teilfehlern erneut ausfuehren. Fuer unveraenderliche Image-Referenzen Digests nutzen.

Repository-Secrets: `USER_DOCKERHUB`, `PAT_DOCKERHUB`, `URL_AZURECONTAINERREG`, `USER_AZURECONTAINERREG`, `PW_AZURECONTAINERREG`. Details siehe englische Tabelle. Docker-Hub-PAT fuer Overview-Synchronisation mit Read/Write/Delete; Zielrepository und Beschreibung muessen fuer den Benutzer beschreibbar sein. Laufzeit-`GITHUB_PAT` ist davon getrennt. Pull-Request-Erstellung durch GitHub Actions erlauben und fuer Pages die Quelle **GitHub Actions** einstellen.

Taegliche/manuelle Runner-Updates und woechentliche Dependabot-Updates erstellen PRs; Zuweisung an `luth2`. Mit `GITHUB_TOKEN` erstellte Update-PRs starten normale PR-CI nicht automatisch: den Build-Workflow vor dem Merge manuell auf `automation/update-actions-runner` ausfuehren. `main` durch Reviews und erforderliche Checks schuetzen.

Runner-Selbstupdates sind deaktiviert. Update-PRs zeitnah mergen und die Image-Referenz im **extern verwalteten ACA Job aktualisieren**. GitHub kann veraltete Runner nach normalerweise 30 Tagen bzw. bei kritischen Sicherheitsupdates frueher ausschliessen. Fuer Betriebssystem-Sicherheitsupdates ebenfalls neu bauen/releasen; Dependabot aktualisiert hier npm und Actions, nicht OS-Pakete.

Lokal: Node.js >=24.10.0, npm, Bash und jq; fuer echte Image-Tests zusaetzlich Docker. `npm ci --ignore-scripts`, `npm test`, `npm run docs:build`. Die Tests verwenden Stubs ohne echte Tokens/Azure-Ressourcen. Node-Pakete werden nicht ins Runner-Image kopiert. `npm audit` separat bewerten; erfolgreiche Tests beweisen weder sichere Abhaengigkeiten noch echte ACA-Lauffaehigkeit.
