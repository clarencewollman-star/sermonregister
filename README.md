# Sermon Register

A private, self-hosted register for Lehr and Gebet services. The desktop view is a spreadsheet-style register with inline entry; the iPhone view uses a compact list and form. Data is stored in a local SQLite file and does not require a database subscription.

The current application supports creating, editing, deleting, and listing services, including reusable Songs, Texts, Vorraden, and People created while a service is saved. The complete architecture, finalized schema, staged plan, and remaining decisions are in [DESIGN.md](DESIGN.md).

## Run locally

Requirements: Node.js 22 or newer, pnpm, and Python 3.

In one terminal:

```bash
python database/server.py
```

In another terminal:

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The SQLite database is created automatically at `data/sermon-register.db` and is intentionally excluded from Git.

## Run with Docker

```bash
docker compose pull
docker compose up -d
```

Docker Compose always pulls the latest `main` image from `ghcr.io/clarencewollman-star/sermonregister:main`. Open <http://localhost:3810>. The web app securely forwards database requests to SQLite inside the same container. The host directory `/docker/sermonregister/data` is mounted into the container, so database records survive image and container replacement.

The `main` image is refreshed whenever the GitHub Actions publish job succeeds on the `main` branch. If the GitHub package is private, sign in first with `docker login ghcr.io`.

If the app is opened with a server name or private IP instead of `localhost`, set `APP_ORIGIN` in `compose.yaml` to the exact browser origin, including port `3810` when used.

## GitHub container image

The workflow in `.github/workflows/docker-image.yml` builds the Docker image for pull requests. After changes reach `main`, it also publishes the image to GitHub Container Registry as:

```text
ghcr.io/clarencewollman-star/sermonregister
```

The repository's package visibility settings determine who can download that image.

## Application version

The current release is `0.17.2`. It is shown in the application header, stored in the image's OCI version label, and published as the matching GHCR tag. `package.json` is the release-version source used by the frontend and GitHub Actions. Portainer follows the rolling `main` image tag from `compose.yaml`.

When editing an existing service, the Text field now identifies reusable Text records by database ID. A correction can rename the same Text everywhere without losing descriptions, Scripture references, tags, notes, PDFs, service history, or Lehr progress. Selecting another existing Text relinks the service, while an explicit choice creates a separate Text. Existing services do not start or recalculate Lehr progress merely because their Text was edited.

The Text editor can safely merge into an existing Text name. Services, Lehr progress, tags, and attachments are combined automatically; conflicting information fields require an explicit choice. Empty unused Texts are removed after service relinks or deletions, while any Text containing information is preserved.

Version 0.17.0 adds private PDF and photo attachments to Text records. Phone photos can be reviewed, cropped, rotated, and renamed before saving. The untouched original and an optimized viewing copy are both retained and included in full backups. The built-in full-screen viewer supports continuous PDF pages, photo viewing, attachment navigation, manual ordering, and a reading position that follows the database between devices.

Version 0.17.2 fixes the attachment viewer's layering on iPhone. The viewer and photo editor now open outside the Text editor window, the background is locked while viewing an attachment, and the viewer has one clear Back To Text control.

## Private CSV Import

Import a compatible private CSV without adding it to GitHub:

```bash
python database/import_csv.py "/path/to/ccw notion.csv"
```

The importer creates a database backup first, skips blank CSV rows, accepts the supported source date formats, preserves unavailable fields as blank, and safely skips records it has already imported. It supports the detailed CCW export and the two-column JRW `Text`/`Date` export. Tags are not imported.

## Interface design

All application layout and control styling is based on [AdminLTE 4](https://github.com/ColorlibHQ/AdminLTE) and Bootstrap 5. AdminLTE is included locally in the Docker image; the application does not depend on a design CDN or subscription service.

## Private data and backups

These paths remain local and are not committed or copied into the image:

- `data/sermon-register.db`
- `data/uploads/`
- `data/backups/`
- `.env*`

Use **Settings → Backup And Restore → Create And Download Backup** to download a validated full ZIP containing the SQLite snapshot, uploads, manifest, and restore instructions. The quiet Settings indicator is amber after 14 days and red after 30 days. Move the ZIP to `Documents\Lehr Register Backups` on the private Windows computer. The initial ZIP is not encrypted, and a user-facing Restore action is intentionally deferred until an isolated restore test is complete.

Do not expose the current application directly to the public internet: authentication, private HTTPS access, encrypted/off-server automation, and the tested restore workflow remain later stages documented in `DESIGN.md`.

## Verification

```bash
pnpm run build
```

The SQLite API also initializes a new database automatically from `database/schema.sql`.
