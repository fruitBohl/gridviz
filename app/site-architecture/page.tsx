import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Site Architecture · gridviz",
    description: "How gridviz is built and deployed on AWS",
};

type Component = {
    service: string;
    url: string;
    role: string;
    details: React.ReactNode[];
};

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
        >
            {children}
        </a>
    );
}

// Add an entry here as each new piece of the stack ships
const components: Component[] = [
    {
        service: "Amazon Route 53",
        url: "https://aws.amazon.com/route53/",
        role: "DNS",
        details: [
            <>
                A public hosted zone for andyouandyou.com. The domain is still
                registered at{" "}
                <Ext href="https://domains.squarespace.com/">Squarespace</Ext>,
                but its nameservers point to Route 53.
            </>,
            "IPv4 and IPv6 alias records (A and AAAA) point the root and www names at CloudFront. CloudFront has no fixed IP, so the root domain needs alias records.",
        ],
    },
    {
        service: "AWS Certificate Manager",
        url: "https://aws.amazon.com/certificate-manager/",
        role: "TLS",
        details: [
            "A public certificate for the root and www names, in us-east-1 as CloudFront requires.",
            "Validated through DNS records in Route 53, so ACM renews it automatically.",
        ],
    },
    {
        service: "Amazon CloudFront",
        url: "https://aws.amazon.com/cloudfront/",
        role: "CDN and HTTPS",
        details: [
            "Serves the site over HTTP/2 and HTTP/3 with TLS 1.2 or later. Plain HTTP redirects to HTTPS.",
            <>
                Uses the managed{" "}
                <Ext href="https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html">
                    CachingOptimized
                </Ext>{" "}
                policy with compression on.
            </>,
            <>
                A{" "}
                <Ext href="https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html">
                    CloudFront Function
                </Ext>{" "}
                (viewer request) rewrites clean URLs like /site-architecture to
                the exported .html file.
            </>,
            "S3's 403 for a missing file becomes a proper 404 page.",
            "A second origin serves /data/* from the data bucket with its own cache policy: 60 seconds by default, never more than 5 minutes, so new prices appear within a minute without cache invalidations.",
        ],
    },
    {
        service: "Amazon S3",
        url: "https://aws.amazon.com/s3/",
        role: "Static hosting and data",
        details: [
            "Two private buckets with all public access blocked: one for the site, one for NEM data.",
            <>
                Only this CloudFront distribution can read from it, through{" "}
                <Ext href="https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html">
                    Origin Access Control
                </Ext>{" "}
                (SigV4) and a bucket policy scoped to the distribution&apos;s
                ARN.
            </>,
            "The data bucket only exposes data/*. The raw AEMO zips under raw/ stay private and expire after 90 days.",
            "Keeping data in its own bucket means a release's s3 sync --delete can never wipe it, and the deploy user can't touch it.",
        ],
    },
    {
        service: "Amazon EventBridge Scheduler",
        url: "https://aws.amazon.com/eventbridge/scheduler/",
        role: "Ingest trigger",
        details: [
            "Invokes the ingest Lambda at 1, 6, 11 … 56 minutes past every hour, just after AEMO publishes each 5-minute dispatch file.",
        ],
    },
    {
        service: "AWS Lambda",
        url: "https://aws.amazon.com/lambda/",
        role: "NEM data ingest",
        details: [
            <>
                A TypeScript function (Node.js 24, arm64) downloads new
                DispatchIS files from{" "}
                <Ext href="https://nemweb.com.au/Reports/Current/DispatchIS_Reports/">
                    AEMO NEMWeb
                </Ext>
                , archives the raw zip and writes data/latest.json plus one
                JSON file per trading day.
            </>,
            <>
                Every row is validated with{" "}
                <Ext href="https://zod.dev/">Zod</Ext>. If AEMO changes its
                format, the run fails before writing anything, so the site
                keeps showing the last good data.
            </>,
            "Each run catches up on every file it missed, so no retries are needed. Reserved concurrency of 1 stops two runs writing the same file.",
            "A normal run takes about 2.5 seconds, well inside the free tier.",
        ],
    },
    {
        service: "Amazon CloudWatch",
        url: "https://aws.amazon.com/cloudwatch/",
        role: "Logs and alarm",
        details: [
            "Lambda logs are kept for 14 days.",
            "An alarm goes into the ALARM state if the ingest fails in any 15-minute window.",
        ],
    },
    {
        service: "Next.js static export",
        url: "https://nextjs.org/docs/app/guides/static-exports",
        role: "Frontend",
        details: [
            <>
                <Ext href="https://nextjs.org/">Next.js</Ext> 16 App Router with{" "}
                <Ext href="https://www.typescriptlang.org/">TypeScript</Ext> and{" "}
                <Ext href="https://tailwindcss.com/">Tailwind CSS</Ext> v4,
                built with <Ext href="https://bun.sh/">Bun</Ext>.
            </>,
            'Uses output: "export", so every page is plain HTML, CSS and JS. No server needs to run.',
        ],
    },
];

const pipeline = [
    {
        title: "Pull request checks",
        body: (
            <>
                <Ext href="https://github.com/features/actions">
                    GitHub Actions
                </Ext>{" "}
                runs lint, unit tests, a TypeScript type check and a full
                production build on every pull request.
            </>
        ),
    },
    {
        title: "Tag-based releases",
        body: (
            <>
                Pushing a <Ext href="https://semver.org/">semver</Ext> tag
                (v*.*.*) builds the site, runs{" "}
                <Ext href="https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html">
                    aws s3 sync --delete
                </Ext>{" "}
                to the bucket, and invalidates the CloudFront cache.
            </>
        ),
    },
    {
        title: "Least-privilege deploy identity",
        body: (
            <>
                CI uses a dedicated{" "}
                <Ext href="https://aws.amazon.com/iam/">IAM</Ext> user. It can
                only list, upload and delete objects in the site bucket and
                invalidate this one distribution. It can&apos;t change any
                infrastructure.
            </>
        ),
    },
    {
        title: "Infrastructure as code",
        body: (
            <>
                <Ext href="https://aws.amazon.com/cloudformation/">
                    CloudFormation
                </Ext>{" "}
                templates define the hosted zone, buckets, CloudFront
                distribution, function, DNS records and deploy user. The data
                pipeline uses{" "}
                <Ext href="https://aws.amazon.com/serverless/sam/">AWS SAM</Ext>
                . Both are linted with{" "}
                <Ext href="https://github.com/aws-cloudformation/cfn-lint">
                    cfn-lint
                </Ext>
                , and each change is previewed as a change set before it is
                applied by hand.
            </>
        ),
    },
];

const decisions = [
    {
        title: "Static JSON before a database",
        body: (
            <>
                The first version of the data pipeline writes pre-computed
                JSON files to S3 instead of loading a database behind an API.
                It costs cents a month and has almost nothing to break. A
                database (
                <Ext href="https://aws.amazon.com/rds/aurora/dsql/">
                    Aurora DSQL
                </Ext>
                ) and API come later, reusing the same ingest code and the
                archived raw files.
            </>
        ),
    },
    {
        title: "Working within service control policies",
        body: (
            <>
                The AWS account sits under an organization whose{" "}
                <Ext href="https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html">
                    SCPs
                </Ext>{" "}
                deny CloudFormation in us-east-1 and IAM OIDC providers. So I
                requested the certificate directly from ACM, and replaced{" "}
                <Ext href="https://docs.github.com/en/actions/concepts/security/openid-connect">
                    GitHub OIDC
                </Ext>{" "}
                with a narrowly scoped IAM user whose access key lives in{" "}
                <Ext href="https://docs.github.com/en/actions/concepts/security/secrets">
                    GitHub secrets
                </Ext>
                .
            </>
        ),
    },
    {
        title: "Serverless over servers",
        body: (
            <>
                I compared <Ext href="https://aws.amazon.com/ec2/">EC2</Ext>{" "}
                (about US$12–15/month plus upkeep) and{" "}
                <Ext href="https://aws.amazon.com/ecs/">ECS</Ext> with an{" "}
                <Ext href="https://aws.amazon.com/elasticloadbalancing/application-load-balancer/">
                    ALB
                </Ext>{" "}
                (about US$30/month) against a static site on S3 + CloudFront. S3
                and CloudFront stay inside their free tiers at this traffic, so
                the Route 53 hosted zone (about A$1/month) is the only fixed
                charge.
            </>
        ),
    },
    {
        title: "Reproducible development",
        body: (
            <>
                Development happens in a{" "}
                <Ext href="https://containers.dev/">devcontainer</Ext> with Bun,{" "}
                <Ext href="https://nodejs.org/">Node</Ext> and the{" "}
                <Ext href="https://aws.amazon.com/cli/">AWS CLI</Ext>. The CI
                Bun version is pinned to match the container.
            </>
        ),
    },
];

function CardList({
    items,
}: {
    items: { title: string; body: React.ReactNode }[];
}) {
    return (
        <ul className="grid gap-4 sm:grid-cols-2">
            {items.map(({ title, body }) => (
                <li
                    key={title}
                    className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                    <h3 className="font-medium">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                        {body}
                    </p>
                </li>
            ))}
        </ul>
    );
}

export default function SiteArchitecture() {
    return (
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-6 py-16 font-sans">
            <section className="flex flex-col gap-4">
                <h1 className="text-4xl font-semibold tracking-tight">
                    Site architecture
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
                    I designed, provisioned and deployed gridviz end to end on
                    AWS. This page records how it&apos;s built. The purpose of
                    this is to first, learn as much about AWS as possible and
                    secondly to make things as cost effective as possible. As
                    the site develops I will keep this updated.
                </p>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    Request flow
                </h2>
                <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 font-mono text-sm leading-6 dark:bg-zinc-900">
                    {`Browser
  └─▶ Route 53         andyouandyou.com → CloudFront alias (A / AAAA)
       └─▶ CloudFront  TLS (ACM cert) · cache · CloudFront Function URL rewrite
            ├─▶ S3     site bucket, read via Origin Access Control
            └─▶ S3     data bucket for /data/*, 60 s cache

EventBridge Scheduler (every 5 min)
  └─▶ Lambda           AEMO NEMWeb → validate → data/*.json in the data bucket`}
                </pre>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    AWS services
                </h2>
                <ul className="flex flex-col gap-4">
                    {components.map(({ service, url, role, details }) => (
                        <li
                            key={service}
                            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                        >
                            <div className="flex flex-wrap items-center gap-3">
                                <h3 className="font-medium">
                                    <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline-offset-4 hover:underline"
                                    >
                                        {service}
                                    </a>
                                </h3>
                                <span className="text-sm text-zinc-500">
                                    {role}
                                </span>
                            </div>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                                {details.map((detail, i) => (
                                    <li key={i}>{detail}</li>
                                ))}
                            </ul>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    Delivery pipeline
                </h2>
                <CardList items={pipeline} />
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    Decisions and trade-offs
                </h2>
                <CardList items={decisions} />
            </section>
        </div>
    );
}
