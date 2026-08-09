# CannonMap reconciliation preview deployment

This repository deploys the `agent/mission-control-reconciliation` branch to an isolated preview of the existing Cloudflare Pages project `cannonmap`. The workflow is `.github/workflows/deploy-reconciliation-preview.yml`. It uploads the static site directly from the repository root (`.`); there is no application build step.

The workflow runs automatically only when `agent/mission-control-reconciliation` is pushed. It passes the triggering GitHub SHA and branch name to Cloudflare, publishes the deployment and branch-alias URLs in the GitHub Actions job summary, and records the deployment in GitHub. It does not trigger on `main` or configure a production deployment.

## One-time Cloudflare setup

1. Sign in to the Cloudflare dashboard and select the account that owns the `cannonmap` Pages project.
2. Open **My Profile > API Tokens**, select **Create Token**, then **Create Custom Token > Get started**.
3. Name the token for this workflow, such as `CannonMap GitHub Pages deploy`.
4. Add one permission: **Account > Cloudflare Pages > Edit** (`Pages Write`).
5. Under **Account Resources**, include only the account containing `cannonmap`. No zone permissions or account-administration permissions are required. Add an expiration date or client-IP restriction if that fits the repository's operations.
6. Create the token and copy it once. Store it directly in GitHub; never commit it or paste it into CannonMap or its browser runtime.
7. Obtain the account ID from **Workers & Pages > Account details**, or from the menu beside the account on Cloudflare's Account home page using **Copy account ID**.

Cloudflare API tokens can currently be scoped to the owning account, not to one individual Pages project. `Cloudflare Pages: Edit` on that single account is therefore the minimum deploy permission.

## One-time GitHub setup

In `FooliganADV/CannonMap`, open **Settings > Secrets and variables > Actions**. Use **New repository secret** to add:

- `CLOUDFLARE_API_TOKEN`: the custom Cloudflare API token.
- `CLOUDFLARE_ACCOUNT_ID`: the ID of the account containing `cannonmap`.

The secrets are injected only into the GitHub Actions deployment job. The workflow does not print their values or expose them to deployed browser files. GitHub's short-lived `GITHUB_TOKEN` is used only to publish deployment status and does not require a repository secret.

## Triggering and finding a preview

A push to `agent/mission-control-reconciliation` starts the workflow automatically. After adding secrets, open **Actions > Deploy reconciliation preview**, select the run for the desired SHA, and choose **Re-run all jobs**. Re-running preserves the exact commit and avoids a deployment-only source change. If no run exists, push an empty commit to that branch; do not change application behavior merely to trigger deployment.

The workflow also declares `workflow_dispatch`. GitHub accepts manual dispatch events only when the workflow file exists on the repository's default branch, so the push/re-run path is authoritative while this preview-only workflow remains solely on the reconciliation branch.

Open the successful run's job summary to find the unique Cloudflare deployment URL and branch alias. The expected alias is based on Cloudflare's normalized branch name, such as `agent-mission-control-reconciliation.cannonmap.pages.dev`. Use the unique deployment URL when exact-build identity matters, and confirm the displayed GitHub SHA before field testing.

## Diagnosing failures

- **Missing secret:** the `Verify deployment inputs` step names the absent repository secret without printing a value.
- **Authentication or authorization:** confirm the token is active, belongs to the account ID supplied, and has `Cloudflare Pages: Edit` for that account.
- **Project error:** confirm the Pages project is named exactly `cannonmap` in the selected account.
- **Upload or API error:** inspect the `Deploy repository root to cannonmap preview` step. The official Cloudflare action returns a non-zero status, so the job fails rather than hiding the error.
- **No manual Run workflow button:** use the automatic push run or re-run an existing branch run; `workflow_dispatch` is exposed only from a workflow present on the default branch.

This workflow neither changes CannonMap's production deployment configuration nor deploys `main`.
