# gridviz plan

The working plan, last updated 2026-10-13. It replaces `HANDOVER.md` wherever the two disagree. `HANDOVER.md` remains the record of the original planning session.

## Goal

A personal learning project: a web app visualising the Australian **National Electricity Market (NEM)**, using AEMO NEMWeb data. It is hosted on **AWS** to build AWS skills and served at **andyouandyou.com**.

- The owner wants **step-by-step instructions to run themselves**, not changes made for them. Infra and console work especially should be explained, not done.
- The dev setup borrows from `../raven-agents` (Bun, Next.js, devcontainer).
- The deployment infra borrows from [JohnScolaro/active-statistics](https://github.com/JohnScolaro/active-statistics) (S3 + CloudFront + Lambda).
- [JohnScolaro/personal-website](https://github.com/JohnScolaro/personal-website) was extra inspiration for the app shape (API routes backed by Postgres). It runs on Vercel, and **this project stays 100% on AWS**.

## What changed from HANDOVER.md

1. **The AWS account is a "new AWS experience" project, not a standalone account.** The `gridviz` profile uses account `277389192515`, role `AccountFullAccessRole`. You sign in with `aws login`, not SSO, so IAM Identity Center, `aws configure sso` and `aws sso login` don't apply. Running `aws configure sso` on the `gridviz` profile would overwrite the working login.
2. **Two service control policies (SCPs) block parts of the old plan.** They come from organisation `504420982187`, the AWS-run organisation behind projects, so there is no org admin to ask. Results of read-only checks on 2026-10-10:

   | Needed for | Result |
   |---|---|
   | Route 53, S3, CloudFront, IAM roles, CloudFormation in ap-southeast-2 | ✅ allowed |
   | Lambda, API Gateway HTTP API, Aurora DSQL, EventBridge Scheduler (ap-southeast-2) | ✅ allowed |
   | ACM in us-east-1 | ✅ allowed |
   | **CloudFormation in us-east-1** (`infra/cert.yaml`) | ❌ denied |
   | **IAM OIDC providers** (GitHub Actions role) | ❌ denied |

   These were list and get calls only. A create can still fail on a rule the reads didn't hit.
3. **The certificate is requested directly from ACM** in us-east-1, with no CloudFormation stack. `infra/cert.yaml` is no longer used.
4. **No GitHub Actions deploy for now.** You build and upload by hand from the devcontainer. `GitHubDeployRole` comes out of `infra/site.yaml`. CI is an open decision (see [CI options](#ci-options-open-decision)).
5. **The AWS CLI is already installed** in `~/.local/bin` on the Mac (v2.37.12) and in the devcontainer, so there's no need for `brew install awscli`.
6. **CloudFront's CachingOptimized policy ID `658327ea-f89d-4fab-a63d-7e88639e58f6` is confirmed** against the AWS API.

## Current state

| Area | Status |
|---|---|
| Next.js 16.4 scaffold (Bun, TypeScript, Tailwind v4 via `@tailwindcss/turbopack`) | Done, committed |
| Devcontainer: `docker/development/` + `.devcontainer/` | Done. Builds and runs; `bun dev` and the Postgres check worked |
| Devcontainer AWS additions: AWS CLI v2, read-write `~/.aws` mount, `AWS_PROFILE=gridviz`, uv/uvx (Python 3.13), Claude Code, `claude-home` volume, `CLAUDE_CONFIG_DIR=/home/bun/.claude`, `restart: unless-stopped` | Done and checked 2026-10-13: the container sees account `277389192515`, and Claude Code state survives rebuilds. Committed. The Zed dev container fix (`updateRemoteUserUID: false`, `post-create.sh`) is **not yet confirmed in Zed** |
| AWS MCP + skills for Claude Code: `.mcp.json` (aws-mcp) and `.claude/skills/` (23 Agent Toolkit skills) | Done: aws-mcp connects on the Mac and in the container (approved 2026-10-13). `.mcp.json` committed, with `mcp-proxy-for-aws` pinned to `1.7.0`. The skills are **gitignored**: copy them in per clone (see README) |
| GitHub remote | `fruitBohl/gridviz` |
| AWS resources | **None yet.** No stacks, hosted zones, certificates, buckets or distributions (checked 2026-10-10) |
| Static export config in `next.config.ts` | **Not done** |
| `infra/*.yaml` | `dns.yaml` and `site.yaml` committed and pass `cfn-lint`; never deployed. `cert.yaml` is no longer used and stays untracked |
| CI deploy | **Deferred** |
| Domain DNS | Still on Squarespace, where it points at the old raven-agents deployment |

### Devcontainer to-dos
1. ~~Approve aws-mcp in the container~~ Done 2026-10-13.
2. ~~Make the approval survive rebuilds~~ Done: `ENV CLAUDE_CONFIG_DIR=/home/bun/.claude` in the Dockerfile keeps all Claude Code state (login, MCP approvals, history) in the `claude-home` volume.
3. ~~Add a restart policy~~ Done: `restart: unless-stopped` on the `app` service.
4. ~~Commit the devcontainer changes and `.mcp.json`~~ Done 2026-10-13. `.claude/skills/` is gitignored (removed from git 2026-10-13; still in history). The container sees the local copies through the repo mount, so re-run the README copy step after the toolkit updates its skills. When upgrading `mcp-proxy-for-aws`, bump the pin in `.mcp.json` deliberately.

## Architecture (agreed, adjusted for the project account)

| Piece | AWS service |
|---|---|
| Frontend | Next.js **static export** (`output: 'export'`) → private S3 bucket + CloudFront (OAC) |
| DNS / TLS | Route 53 hosted zone (domain stays **registered** at Squarespace, nameservers point at Route 53) + ACM certificate in **us-east-1**, requested directly (not through CloudFormation) |
| API (later) | TypeScript Lambda behind **API Gateway HTTP API**, routed through CloudFront at `/api/*` |
| NEM ingest (later) | EventBridge Scheduler → Lambda every 5 min, pulling NEMWeb zips into the DB |
| Database (later) | **Aurora DSQL** (serverless, Postgres-compatible, no VPC/NAT needed) |
| IaC | CloudFormation in ap-southeast-2 now; switch to SAM when Lambdas arrive. SAM deploys through CloudFormation, so it works there too |
| Deploy | **Manual** from the devcontainer for now (`aws s3 sync` + invalidation). CI to be decided |
| Local dev | Devcontainer + Postgres 18 container. Postgres is the local stand-in for DSQL |
| Region | `ap-southeast-2` (Sydney); only the certificate lives in `us-east-1` |

### Rejected options and why
- **App Runner:** closed to new customers since 2026-04-30.
- **EC2 + Compose + Caddy:** works, but costs about US$12–15/month and needs server upkeep.
- **ECS Express + ALB:** about US$30/month; the load balancer alone is the main cost.
- **RDS Postgres:** about US$18/month, plus a NAT Gateway (about US$40/month) so Lambdas inside the VPC can reach NEMWeb.
- **DynamoDB:** a poor fit for time-series analytics.
- **Squarespace ALIAS records:** unreliable at the root domain, and CloudFront has no fixed IP. That is why Route 53 is used.
- **Lambda Function URL + CloudFront OAC:** POST needs a client-side body hash. HTTP API avoids that.
- **GitHub Actions + OIDC role:** blocked by an SCP in the project account.
- **Certificate as a CloudFormation stack:** blocked by an SCP (CloudFormation is denied in us-east-1).

### Consequences for app code
- The frontend must stay **fully static**: no SSR, server actions, route handlers or Prisma inside Next.
- All data access goes through the Lambda API (later milestone).
- DSQL supports only a subset of Postgres: no extensions (no TimescaleDB), plus other gaps. Check the unsupported-features list before designing the schema. The local Postgres container can accept SQL that DSQL rejects.

## Cost estimate (agreed)

About **A$2–5/month** in year 1, including GST, at hobby traffic (≤10k page views and ≤100k API calls a month). The worst case is about A$20 if DSQL DPU usage is higher than expected.

- Route 53 hosted zone: about A$0.90/month, the only guaranteed cost. The ACM public certificate is free.
- S3, CloudFront, Lambda and EventBridge Scheduler stay inside their always-free tiers.
- NEMWeb data measured 2026-10-08: about 25 KB zipped per 5-minute interval (DispatchIS 21.5 KB + Dispatch_SCADA 3.8 KB). That is about 220 MB/month, and AWS does not charge for inbound data.
- SCADA has 517 unit rows per interval, about 4.5M rows/month, or roughly 0.3–0.5 GB/month of DSQL storage. The free allowance is 1 GB.
- **Unverified:** DSQL DPU usage per insert, Sydney rates (the estimates use US prices), and whether free-tier and credit terms differ for project accounts.
- **Action:** check DSQL DPU metrics in CloudWatch after week 1. Consider ingesting prices and region summary only until a feature needs SCADA.

## Credentials

- **Sign in:** `aws login --profile gridviz` on the Mac. It opens a browser.
- **How long it lasts:** credentials last 12 hours and refresh automatically for up to 90 days. After that, run `aws login` again.
- **Inside the container:** the container uses the same login through the `~/.aws` mount. Signing in from inside the container needs `aws login --remote --profile gridviz`, because the browser can't call back into the container. Signing in on the Mac is simpler.
- **Which commands need `--profile gridviz`:**
  - **Container:** none. `.env` sets `AWS_PROFILE=gridviz` there.
  - **Mac:** every command, unless you run `export AWS_PROFILE=gridviz` first. The commands below leave the flag off.
- **Check:** `aws sts get-caller-identity` should show account `277389192515`.

## Gotchas already hit

1. **Devcontainer Node feature failed** with `sh: 10: source: not found` (exit 127). The `oven/bun` image gives the `bun` user `/bin/sh` as its login shell. Fixed with `RUN chsh -s /bin/bash bun` in `docker/development/Dockerfile`.
2. **`perl: warning: Setting locale failed`** appears on `psql`. It is harmless. Fix (**not applied yet**): add `locales` to the `apt-get install` and run `sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen en_US.UTF-8` in the same `RUN`, then rebuild the container.
3. **Next.js requires the routes folder to be named `app/`.** It was briefly renamed to `gridviz/`, which breaks routing.
4. **`node_modules` must be installed inside the container** (`postCreateCommand: bun install`). Mac-built native binaries (SWC) do not work in the Linux container. If you ran `bun install` on the Mac, run `rm -rf node_modules` first.
5. Node 22 comes from the devcontainer feature because Debian's `nodejs` package is Node 18, and Next 16 needs Node ≥20.9.
6. **uv picks Python 3.15 by default**, which breaks `mcp-proxy-for-aws` (`ImportError: cannot import name 'no_type_check_decorator'`). The Dockerfile pins `UV_PYTHON=3.13` (marked with a `ponytail:` comment).
7. **`app` doesn't restart after Docker Desktop restarts**: you get `service "app" is not running`. Fixed with `restart: unless-stopped` on `app`. If it ever happens anyway, run `docker compose -f docker/development/docker-compose.yml up -d`.
8. **`aws <command> help` fails in the container** with `Could not find executable named "groff or mandoc"`. Add `mandoc` to the `apt-get install` if you want help pages there.
9. **Project accounts have SCP denies.** If something fails with `explicit deny in a service control policy`, it can't be fixed with IAM. Change the approach instead.
10. **The `claude-home` volume became owned by UID 501** (the Mac user) instead of `bun` (UID 1000). Cause: the devcontainer (opened from Zed) remapped `bun` to the host UID 501, while plain `docker compose exec` uses UID 1000, and both share the volume. Fixed with `"updateRemoteUserUID": false` in `.devcontainer/devcontainer.json`, which is safe on Docker Desktop for Mac. If ownership is ever wrong again: `docker compose -f docker/development/docker-compose.yml exec -u root app chown -R 1000:1000 /home/bun/.claude`.
11. **Zed runs a string `postCreateCommand` word by word** (`sh -c <word> <word>…`), so only the first word runs. `"bun install"` silently ran bare `bun`, and `"sudo chown … && bun install"` failed with sudo's usage message. Keep `postCreateCommand` a single path to `.devcontainer/post-create.sh` and put the commands in the script.
12. **`docker compose up -d --build` replaces the container**, which drops an open Zed dev container connection ("Remote server exited with status 137"). Reopen the dev container in Zed afterwards.

## Next milestone: splash page on andyouandyou.com

Run the `aws` and `bun` commands inside the devcontainer (`docker compose -f docker/development/docker-compose.yml exec app bash`), from `~/workspace`.

### 0. Project basics (console, once)
1. Make sure the sign-in you use for the AWS project has MFA turned on.
2. Create a budget under **Billing and Cost Management → Budgets**: monthly, US$15 (about A$23), with email alerts at 80% and 100%. **Unverified:** whether project accounts allow budgets. If not, check the cost view in your project settings.
3. Run `aws sts get-caller-identity` and confirm the account is `277389192515`.

### 1. Static export (in the devcontainer)
1. Edit `next.config.ts`:
   - add `output: 'export',`;
   - add `images: { unoptimized: true },` (`app/page.tsx` uses `next/image`);
   - keep the rest.
2. Run `bun run build`. Expect `out/index.html` and `out/404.html`.
3. **Untested:** `next.config.ts` currently has `cacheComponents: true` and `partialPrefetching: true`, which may not work with `output: 'export'`. If the build errors, delete them.
4. `/out/` is already in `.gitignore`.
5. Edit `app/page.tsx` into the splash page.

### 2. Infra templates (in `infra/`)

| File | Region | Contents | Used? |
|---|---|---|---|
| `dns.yaml` | ap-southeast-2 | Route 53 hosted zone. Exports `gridviz-hosted-zone-id` and outputs the nameservers | Yes |
| `cert.yaml` | us-east-1 | ACM certificate | **No.** CloudFormation is denied in us-east-1; step 4 replaces it. Delete it, or keep it for reference |
| `site.yaml` | ap-southeast-2 | Private S3 bucket + OAC, CloudFront (rewrites `/path` → `/path.html`, maps 403 → `/404.html`), A/AAAA alias records | Yes |

The deploy order matters: the zone first, then Squarespace delegation, then the certificate, then the site.

### 3. DNS zone and Squarespace delegation
1. Deploy the zone and read its outputs. Note **HostedZoneId** and the four **NameServers**.
   ```bash
   aws cloudformation deploy --stack-name gridviz-dns --template-file infra/dns.yaml
   aws cloudformation describe-stacks --stack-name gridviz-dns --query 'Stacks[0].Outputs' --output table
   ```
2. **Before switching nameservers:** copy every Squarespace DNS record you still need (MX, TXT, verification) into the Route 53 zone. Records that are not copied stop working.
3. In Squarespace, open **Domains → andyouandyou.com → DNS → Nameservers** and switch to custom nameservers. Enter the four values, turning off DNSSEC first if asked. **This takes raven-agents offline on this domain.**
4. Wait until `dig NS andyouandyou.com +short` shows the `awsdns` servers.

### 4. Certificate (ACM in us-east-1, no CloudFormation)
1. Request the certificate:
   ```bash
   aws acm request-certificate --region us-east-1 \
     --domain-name andyouandyou.com \
     --subject-alternative-names www.andyouandyou.com \
     --validation-method DNS \
     --query CertificateArn --output text
   ```
   Note the **CertificateArn**.
2. Add the validation records to Route 53. **Easiest:** in the console, open **ACM** in **us-east-1**, select the certificate, then choose **Create records in Route 53 → Create records**.
   **CLI alternative:**
   1. Run this to show the records. Wait a few seconds after the request if they're empty.
      ```bash
      aws acm describe-certificate --region us-east-1 --certificate-arn <CertificateArn> \
        --query 'Certificate.DomainValidationOptions[].ResourceRecord' --output table
      ```
   2. Create each distinct CNAME with `aws route53 change-resource-record-sets --hosted-zone-id <HostedZoneId>`. Use action `UPSERT`, type `CNAME`, TTL 300, and the name and value from the table.
3. Wait for the certificate to be issued. This usually takes a few minutes once delegation is live:
   ```bash
   aws acm wait certificate-validated --region us-east-1 --certificate-arn <CertificateArn>
   ```
4. **Leave the validation CNAMEs in Route 53 permanently.** ACM uses them to renew the certificate automatically.
5. If it isn't issued within 30 minutes, DNS delegation (step 3) probably isn't live yet.
6. These validation records aren't managed by CloudFormation. A later option is to add them to `dns.yaml` as fixed records.

### 5. ~~GitHub identity provider~~ (dropped)
Blocked by an SCP. See [CI options](#ci-options-open-decision).

### 6. Site stack
1. ~~Remove the GitHub pieces from `infra/site.yaml`~~ Done 2026-10-13: the `GitHubRepo` parameter, `GitHubDeployRole` and the `DeployRoleArn` output are gone (the role can't be created without the OIDC provider). Passes `cfn-lint`.
2. Deploy the site stack and read its outputs. Note **BucketName** and **DistributionId**. `--capabilities CAPABILITY_IAM` is no longer needed.
   ```bash
   aws cloudformation deploy --stack-name gridviz-site --template-file infra/site.yaml \
     --parameter-overrides CertificateArn=<CertificateArn>
   aws cloudformation describe-stacks --stack-name gridviz-site --query 'Stacks[0].Outputs' --output table
   ```
3. The first deploy takes 5–15 minutes because CloudFront is slow to create.

### 7. Deploy (by hand, and again for every site update)
```bash
bun run build
aws s3 sync out/ s3://<BucketName> --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths '/*'
curl -I https://andyouandyou.com        # expect HTTP/2 200
curl -I https://www.andyouandyou.com    # expect HTTP/2 200
```
Optional: save these as a `deploy` script in `package.json` with the bucket and distribution IDs filled in.

### CI options (open decision)
GitHub Actions can't use an OIDC role in this account. Choose one later:
1. **Keep deploying by hand.** Zero cost and no setup. Fine for a learning project with one developer.
2. **AWS CodePipeline + CodeBuild, connected to GitHub through CodeConnections.** It stays fully on AWS and uses no OIDC, and it's useful AWS learning. **Unverified:** whether the SCPs allow it, and the cost (CodeBuild has a small free tier; CodePipeline V2 charges per action-minute).
3. **Move to a standard AWS account** (the "advanced experience"). None of these SCPs apply there, so the original GitHub Actions + OIDC plan in `HANDOVER.md` works. It means a new sign-up and leaving the project setup.

Not recommended: GitHub Actions with long-lived IAM user access keys. It works only if the SCPs allow IAM users, and it means a permanent secret stored in GitHub.

## Later milestones (not designed in detail)

1. **API:** a TypeScript Lambda + HTTP API, a `/api/*` CloudFront behaviour, and a move to SAM (it deploys through CloudFormation in ap-southeast-2, which is allowed).
2. **Database:** an Aurora DSQL cluster in `ap-southeast-2`, with IAM auth from the Lambdas. Check DSQL's Postgres gaps before writing the schema.
3. **Ingest:** EventBridge Scheduler (every 5 min) → Lambda → NEMWeb `Reports/Current/DispatchIS_Reports` (prices, region summary) and, later, `Dispatch_SCADA` (unit output). Set log retention to about 14 days on every Lambda log group.
4. **PR checks:** lint, typecheck and build. GitHub Actions is fine here because it needs no AWS access.
5. **CI deploy:** whichever option above is chosen.

**Re-check SCPs at each milestone.** Lambda, HTTP API, DSQL and Scheduler only passed list calls. Try the first create early, before building around it.

## Useful commands

```bash
# devcontainer without VS Code
docker compose -f docker/development/docker-compose.yml up -d --build
docker compose -f docker/development/docker-compose.yml exec app bash

# inside the container
bun dev                                  # http://localhost:3000
psql "$DATABASE_URL" -c 'select 1'       # db check (db host is `db`, database `gridviz`)
aws sts get-caller-identity              # AWS credentials check (expect 277389192515)
claude mcp list                          # aws-mcp should show as connected

# on the Mac
aws login --profile gridviz              # renew the sign-in (shared with the container through ~/.aws)
```
