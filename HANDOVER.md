# gridviz handover

Handover from the planning session (last updated 2026-10-10). Read this before continuing work inside the devcontainer.

## Goal

A personal learning project: a web app visualising the Australian **National Electricity Market (NEM)**, using AEMO NEMWeb data. It is hosted on **AWS** to build AWS skills and served at **andyouandyou.com**.

- The owner wants **step-by-step instructions to run themselves**, not changes made for them. Infra and console work especially should be explained, not done.
- The dev setup borrows from `../raven-agents` (Bun, Next.js, devcontainer).
- The deployment infra borrows from [JohnScolaro/active-statistics](https://github.com/JohnScolaro/active-statistics) (S3 + CloudFront + Lambda via SAM, GitHub Actions with OIDC).
- [JohnScolaro/personal-website](https://github.com/JohnScolaro/personal-website) was extra inspiration for the app shape (API routes backed by Postgres). It runs on Vercel, and **this project stays 100% on AWS**.

## Current state

| Area | Status |
|---|---|
| Next.js 16.4 scaffold (Bun, TypeScript, Tailwind v4 via `@tailwindcss/turbopack`) | Done, committed |
| Devcontainer: `docker/development/` + `.devcontainer/` | Done. Builds and runs; `bun dev` and the Postgres check worked |
| Devcontainer additions: AWS CLI v2, `~/.aws` mount, `AWS_PROFILE=gridviz`, uv/uvx (Python 3.13), Claude Code, `claude-home` volume, `.mcp.json` (aws-mcp) | **Uncommitted** changes in `Dockerfile`, `docker-compose.yml`, `.env.example`, plus untracked `.mcp.json` and `.claude/` |
| GitHub remote | `fruitBohl/gridviz` |
| AWS account setup | **Not started.** No CloudFormation stacks in ap-southeast-2 and no Route 53 zones (checked 2026-10-10) |
| Static export config in `next.config.ts` | **Not done** |
| `infra/*.yaml` CloudFormation templates | Written and passed `cfn-lint`. **Never deployed. Not committed yet** |
| `.github/workflows/deploy.yml` | **Not created** (contents below) |
| Domain DNS | Still on Squarespace, where it points at the old raven-agents deployment |

### ⚠️ Open blocker: us-east-1 is denied by an SCP

On 2026-10-10 the AWS credentials available to Claude (account `277389192515`, role `AccountFullAccessRole`) got `AccessDenied` for `cloudformation:ListStacks` in **us-east-1**. The cause is an **explicit deny in an AWS Organizations service control policy**. ap-southeast-2 worked.

The CloudFront certificate **must** live in us-east-1, so `infra/cert.yaml` (step 4) will fail in that account. Before step 4:
1. Confirm which account your `gridviz` profile uses: `aws sts get-caller-identity`. If it is a different, standalone account, this may not apply.
2. If it is this account, either ask the org admin to allow CloudFormation + ACM in us-east-1, or check whether ACM alone is allowed there. If it is, request the certificate directly with `aws acm request-certificate --region us-east-1` and add the validation records to Route 53 by hand.

## Architecture decision (agreed)

| Piece | AWS service |
|---|---|
| Frontend | Next.js **static export** (`output: 'export'`) → private S3 bucket + CloudFront (OAC) |
| DNS / TLS | Route 53 hosted zone (domain stays **registered** at Squarespace, nameservers point at Route 53) + ACM certificate in **us-east-1** |
| API (later) | TypeScript Lambda behind **API Gateway HTTP API**, routed through CloudFront at `/api/*` |
| NEM ingest (later) | EventBridge Scheduler → Lambda every 5 min, pulling NEMWeb zips into the DB |
| Database (later) | **Aurora DSQL** (serverless, Postgres-compatible, no VPC/NAT needed) |
| IaC | CloudFormation now; switch to SAM when Lambdas arrive (SAM accepts these templates unchanged) |
| CI/CD | GitHub Actions + OIDC role; deploys site content on push to `main` |
| Local dev | Devcontainer + Postgres 18 container |
| Region | `ap-southeast-2` (Sydney); only the certificate stack lives in `us-east-1` |

### Rejected options and why
- **App Runner:** closed to new customers since 2026-04-30.
- **EC2 + Compose + Caddy:** works, but costs about US$12–15/month and needs server upkeep.
- **ECS Express + ALB:** about US$30/month; the load balancer alone is the main cost.
- **RDS Postgres:** about US$18/month, plus a NAT Gateway (about US$40/month) so Lambdas inside the VPC can reach NEMWeb.
- **DynamoDB:** a poor fit for time-series analytics.
- **Squarespace ALIAS records:** unreliable at the root domain, and CloudFront has no fixed IP. That is why Route 53 is used.
- **Lambda Function URL + CloudFront OAC:** POST needs a client-side body hash. HTTP API avoids that.

### Consequences for app code
- The frontend must stay **fully static**: no SSR, server actions, route handlers or Prisma inside Next.
- All data access goes through the Lambda API (later milestone).
- DSQL supports only a subset of Postgres: no extensions (no TimescaleDB), plus other gaps. Check the unsupported-features list before designing the schema. The local Postgres container can accept SQL that DSQL rejects.

## Cost estimate (agreed)

About **A$2–5/month** in year 1, including GST, at hobby traffic (≤10k page views and ≤100k API calls a month). The worst case is about A$20 if DSQL DPU usage is higher than expected.

- Route 53 hosted zone: about A$0.90/month, the only guaranteed cost.
- S3, CloudFront, Lambda and EventBridge Scheduler stay inside their always-free tiers.
- NEMWeb data measured 2026-10-08: about 25 KB zipped per 5-minute interval (DispatchIS 21.5 KB + Dispatch_SCADA 3.8 KB). That is about 220 MB/month, and AWS does not charge for inbound data.
- SCADA has 517 unit rows per interval, about 4.5M rows/month, or roughly 0.3–0.5 GB/month of DSQL storage. The free allowance is 1 GB.
- **Unverified:** DSQL DPU usage per insert, and Sydney rates (the estimates use US prices).
- **Action:** check DSQL DPU metrics in CloudWatch after week 1. Consider ingesting prices and region summary only until a feature needs SCADA.

## Gotchas already hit

1. **Devcontainer Node feature failed** with `sh: 10: source: not found` (exit 127). The `oven/bun` image gives the `bun` user `/bin/sh` as its login shell. Fixed with `RUN chsh -s /bin/bash bun` in `docker/development/Dockerfile`.
2. **`perl: warning: Setting locale failed`** appears on `psql`. It is harmless. Fix (**not applied yet**): add `locales` to the `apt-get install` and run `sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen en_US.UTF-8` in the same `RUN`, then rebuild the container.
3. **Next.js requires the routes folder to be named `app/`.** It was briefly renamed to `gridviz/`, which breaks routing.
4. **`node_modules` must be installed inside the container** (`postCreateCommand: bun install`). Mac-built native binaries (SWC) do not work in the Linux container. If you ran `bun install` on the Mac, run `rm -rf node_modules` first.
5. Node 22 comes from the devcontainer feature because Debian's `nodejs` package is Node 18, and Next 16 needs Node ≥20.9.
6. **uv picks Python 3.15 by default**, which breaks `mcp-proxy-for-aws`. The Dockerfile pins `UV_PYTHON=3.13` (marked with a `ponytail:` comment).

## Next milestone: splash page on andyouandyou.com

The devcontainer now has the AWS CLI and mounts `~/.aws`, with `AWS_PROFILE=gridviz` set from `.env`. You can run the `aws` commands inside the container or on the Mac. If the SSO session has expired, run `aws sso login` on the Mac; the token is shared through the mount.

### 0. AWS account basics (console, once)
1. Turn on MFA for the root user, then stop using the root user.
2. Create a budget under **Billing → Budgets**: monthly, US$15 (about A$23), with email alerts at 80% and 100%.
3. Enable **IAM Identity Center** in `ap-southeast-2`. Create a user for yourself and assign it to the account with `AdministratorAccess`.
4. On the Mac, run `brew install awscli`, then `aws configure sso` (region `ap-southeast-2`, profile `gridviz`).
5. Run `aws sts get-caller-identity` and check the account against the SCP blocker above.

### 1. Static export (in the devcontainer)
1. Add these two lines to `next.config.ts` and keep the rest:
   ```ts
   output: 'export',
   images: { unoptimized: true }, // app/page.tsx uses next/image
   ```
2. Run `bun run build`. Expect `out/index.html` and `out/404.html`.
3. **Untested:** `cacheComponents: true` may not work with `output: 'export'`. If the build errors, delete it.
4. `/out/` is already in `.gitignore`.
5. Edit `app/page.tsx` into the splash page.

### 2. Infra templates (in `infra/`)

| File | Region | Contents |
|---|---|---|
| `dns.yaml` | ap-southeast-2 | Route 53 hosted zone. Exports `gridviz-hosted-zone-id` and outputs the nameservers |
| `cert.yaml` | **us-east-1** | ACM certificate for the root and `www`, with DNS validation records created automatically in the zone |
| `site.yaml` | ap-southeast-2 | Private S3 bucket + OAC, CloudFront (rewrites `/path` → `/path.html`, maps 403 → `/404.html`), A/AAAA alias records, and the GitHub deploy role (S3 write and invalidation only, `main` branch of `fruitBohl/gridviz` only) |

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

### 4. Certificate (us-east-1)
1. Deploy the certificate stack and read its outputs. Note **CertificateArn**. See the SCP blocker above first.
   ```bash
   aws cloudformation deploy --stack-name gridviz-cert --template-file infra/cert.yaml \
     --region us-east-1 --parameter-overrides HostedZoneId=<HostedZoneId>
   aws cloudformation describe-stacks --stack-name gridviz-cert --region us-east-1 \
     --query 'Stacks[0].Outputs' --output table
   ```
2. If the stack hangs for more than 30 minutes, DNS delegation is not live yet.

### 5. GitHub identity provider (console, once per account)
Go to **IAM → Identity providers → Add provider** and choose **OpenID Connect**. Set the URL to `https://token.actions.githubusercontent.com` and the audience to `sts.amazonaws.com`.

### 6. Site stack
1. Deploy the site stack and read its outputs. Note **BucketName**, **DistributionId** and **DeployRoleArn**.
   ```bash
   aws cloudformation deploy --stack-name gridviz-site --template-file infra/site.yaml \
     --capabilities CAPABILITY_IAM --parameter-overrides CertificateArn=<CertificateArn>
   aws cloudformation describe-stacks --stack-name gridviz-site --query 'Stacks[0].Outputs' --output table
   ```
2. The first deploy takes 5–15 minutes because CloudFront is slow to create.

### 7. First upload by hand
```bash
aws s3 sync out/ s3://<BucketName> --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths '/*'
curl -I https://andyouandyou.com        # expect HTTP/2 200
curl -I https://www.andyouandyou.com    # expect HTTP/2 200
```

### 8. CI deploy
1. In GitHub, open **Settings → Secrets and variables → Actions → Variables**. Add `AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET` and `DISTRIBUTION_ID`.
2. Create `.github/workflows/deploy.yml`:
   ```yaml
   name: Deploy site

   on:
     push:
       branches: [main]
     workflow_dispatch:

   permissions:
     id-token: write
     contents: read

   concurrency:
     group: deploy-site
     cancel-in-progress: false

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v5
         - uses: oven-sh/setup-bun@v2
         - run: bun install --frozen-lockfile
         - run: bun run build
         - uses: aws-actions/configure-aws-credentials@v5
           with:
             role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
             aws-region: ap-southeast-2
         - run: aws s3 sync out/ s3://${{ vars.SITE_BUCKET }} --delete
         - run: aws cloudfront create-invalidation --distribution-id ${{ vars.DISTRIBUTION_ID }} --paths '/*'
   ```
3. Push to `main` and confirm the site updates.

Infra changes stay manual (`aws cloudformation deploy`). The CI role can only upload files and invalidate the cache.

**Unverified:**
- The templates passed `cfn-lint`, but nothing has been deployed.
- The action versions (`checkout@v5`, `configure-aws-credentials@v5`) have not been checked.
- The CachingOptimized policy ID `658327ea-f89d-4fab-a63d-7e88639e58f6` is from memory.

## Later milestones (not designed in detail)

1. **API:** a TypeScript Lambda + HTTP API, a `/api/*` CloudFront behaviour, and a move to SAM.
2. **Database:** an Aurora DSQL cluster in `ap-southeast-2`, with IAM auth from the Lambdas. Check DSQL's Postgres gaps before writing the schema.
3. **Ingest:** EventBridge Scheduler (every 5 min) → Lambda → NEMWeb `Reports/Current/DispatchIS_Reports` (prices, region summary) and, later, `Dispatch_SCADA` (unit output). Set log retention to about 14 days on every Lambda log group.
4. **PR checks:** lint, typecheck and build on pull requests.

## Useful commands

```bash
# devcontainer without VS Code
docker compose -f docker/development/docker-compose.yml up -d --build
docker compose -f docker/development/docker-compose.yml exec app bash

# inside the container
bun dev                                  # http://localhost:3000
psql "$DATABASE_URL" -c 'select 1'       # db check (db host is `db`, database `gridviz`)
aws sts get-caller-identity              # AWS credentials check
```
