import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Site Architecture · gridviz",
    description: "How gridviz is built and deployed on AWS",
};

// Add an entry here as each new piece of the stack ships
const services: { service: string; url: string; role: string }[] = [
    {
        service: "Route 53",
        url: "https://aws.amazon.com/route53/",
        role: "DNS for andyouandyou.com",
    },
    {
        service: "Certificate Manager",
        url: "https://aws.amazon.com/certificate-manager/",
        role: "HTTPS certificate, renewed automatically",
    },
    {
        service: "CloudFront",
        url: "https://aws.amazon.com/cloudfront/",
        role: "CDN serving the site, /data/* and /api/*",
    },
    {
        service: "S3",
        url: "https://aws.amazon.com/s3/",
        role: "Two private buckets: the site, and NEM data",
    },
    {
        service: "EventBridge Scheduler",
        url: "https://aws.amazon.com/eventbridge/scheduler/",
        role: "Runs ingest every 5 minutes and the rebuild nightly",
    },
    {
        service: "Lambda",
        url: "https://aws.amazon.com/lambda/",
        role: "gridviz-ingest fetches AEMO data, gridviz-rebuild makes the plot files, and gridviz-solve runs battery optimisations on demand",
    },
    {
        service: "CloudWatch",
        url: "https://aws.amazon.com/cloudwatch/",
        role: "Logs, an error alarm per Lambda, and an alarm if ingest stops running",
    },
    {
        service: "Pyomo + HiGHS",
        url: "https://www.pyomo.org/",
        role: "Python modelling and open-source MIP solver behind gridviz-solve",
    },
    {
        service: "Next.js static export",
        url: "https://nextjs.org/docs/app/guides/static-exports",
        role: "Frontend as plain HTML and JS, charts with Plotly",
    },
];

const pipeline = [
    "Pull requests: GitHub Actions runs lint, tests, type checks and a build, plus the Python solver's tests (pytest via uv).",
    "Releases: a v*.*.* tag builds the site, syncs it to S3 and invalidates CloudFront.",
    "Infrastructure: CloudFormation and SAM, each change previewed as a change set.",
    "CI's IAM user can only update the site bucket and invalidate the distribution.",
    "The Python solver is bundled with uv for arm64 Lambda and deployed with the data stack.",
];

const decisions = [
    "Static JSON in S3 instead of a database: costs cents a month.",
    "Serverless instead of servers: the only fixed cost is Route 53, about A$1 a month.",
    "Two years backfilled from AEMO's archives, checked against AEMO's own aggregates.",
    "Plot files rebuilt nightly; the browser adds the days since.",
    "Market events are flagged from AEMO's own data fields, not a hand-made list.",
    "Battery solves run on demand rather than precomputed: one region-day solves in about a second, and CloudFront caches each answer.",
    "The solve Lambda sits behind CloudFront with origin access control on a GET-only function URL, so there's no API Gateway, no CORS, and nothing can call it directly.",
    "HiGHS through Pyomo instead of GAMSpy: no licence to manage in Lambda, and no model size limits.",
    "Reserved concurrency of 2 caps what a flood of requests to the public solve endpoint could cost.",
    "The account's SCPs block us-east-1 CloudFormation and OIDC, so the certificate was made by hand and CI uses a scoped IAM user.",
];

function List({ items }: { items: string[] }) {
    return (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {items.map((item) => (
                <li key={item}>{item}</li>
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
                    AWS, to learn as much about AWS as possible while keeping it
                    cheap to run.
                </p>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    Request flow
                </h2>
                <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 font-mono text-sm leading-6 dark:bg-zinc-900">
                    {`Browser
  └─▶ Route 53         andyouandyou.com
       └─▶ CloudFront  HTTPS · cache
            ├─▶ S3     site bucket
            ├─▶ S3     data bucket (/data/*)
            │            latest.json                latest interval (Live)
            │            days/<date>.json           one file per trading day (Live, Plots, Solve)
            │            plots/<measure>-daily      daily means (Plots)
            │            plots/<measure>-extremes   highest and lowest days (Plots)
            └─▶ Lambda solve (/api/solve?region=…&date=…)
                         private function URL, cached per region and day
                         reads days/<date>.json → Pyomo + HiGHS → schedule and bid (Solve)

EventBridge Scheduler (every 5 min)
  └─▶ Lambda ingest    AEMO NEMWeb → latest.json + today's day file

EventBridge Scheduler (00:30 daily)
  └─▶ Lambda rebuild   day files → plot files`}
                </pre>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    AWS services
                </h2>
                <table className="w-full text-left text-sm">
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {services.map(({ service, url, role }) => (
                            <tr key={service}>
                                <th scope="row" className="py-2 pr-6 font-medium whitespace-nowrap">
                                    <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline-offset-4 hover:underline"
                                    >
                                        {service}
                                    </a>
                                </th>
                                <td className="py-2 text-zinc-600 dark:text-zinc-400">
                                    {role}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    Delivery pipeline
                </h2>
                <List items={pipeline} />
            </section>

            <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                    Decisions and trade-offs
                </h2>
                <List items={decisions} />
            </section>
        </div>
    );
}
