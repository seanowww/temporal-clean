# GitHub App setup

Temporal uses a GitHub App so PR comments and checks appear as `temporal[bot]`. No personal access token is required.

## Local setup

1. Give `TEMPORAL_APP_URL` a public HTTPS URL that reaches the running app. Keep that tunnel running for the demo.
2. Run `npm run dev`, open `/connections`, expand GitHub, and select **Create Temporal app**.
3. GitHub opens a pre-filled App form named **Temporal**. Confirm it, then select the account and repositories to install it on.
4. Back on Connections, run `npm run github:check` to verify the installation end to end.

The manifest sets the webhook URL, callback URLs, PR and push events, and only the permissions Temporal uses: Contents read; Pull requests, Checks, and Deployments write. Generated credentials and the webhook secret are written to `.env.local` with restrictive file permissions. Existing environment values are preserved.

GitHub App names are globally unique. If `Temporal` is unavailable, GitHub will ask for a unique name; use `Temporal <team>` while keeping the display identity Temporal.

## Add the badge

GitHub does not support setting an App avatar through its manifest or API. This is the sole manual branding step:

1. Open GitHub **Settings → Developer settings → GitHub Apps → Temporal → Edit**.
2. Under **Display information**, upload `public/brand/temporal-github-app.png`.
3. Set the badge background to `#002FA7`, then save.

The supplied PNG is transparent, below GitHub's 1 MB limit, and designed for its circular crop.

## Production

The one-click credential writer is intentionally disabled in production. Create the App with the same manifest, then put `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_BASE64`, and `GITHUB_WEBHOOK_SECRET` in the hosting provider's secret store. Never commit `.env.local` or a private key.

## PR data guarantees

The PR webhook is the source of truth for title, body, author, head branch, base branch, and head SHA. Temporal then reads the PR commits, changed-file totals, additions, and deletions with the installation token before generating the artifact. Commit coverage is counted only for that PR branch; commits from another PR in the repository cannot satisfy it.
