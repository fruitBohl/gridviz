export default function Home() {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center font-sans">
            <h1 className="text-5xl font-semibold tracking-tight">gridviz</h1>
            <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
                Visualising Australia&apos;s National Electricity Market.
            </p>
            <p className="text-sm text-zinc-500">
                Data from{" "}
                <a
                    href="https://nemweb.com.au"
                    className="underline underline-offset-4 hover:text-foreground"
                >
                    AEMO NEMWeb
                </a>
                . You&apos;ll have to use the navbar to visit another page, there&apos;s
                nothing here.
            </p>
        </div>
    );
}
