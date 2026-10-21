This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Misc notes:
- `docker compose -f docker/development/docker-compose.yml up -d --build`
- `docker compose -f docker/development/docker-compose.yml exec app bash`

This path skips the devcontainer features, so it runs without Node 22 and without bun install.

## AWS skills for Claude Code (optional, one-off per clone)

Claude Code in the container has its own `~/.claude`, so it only sees AWS skills placed in the repo's `.claude/skills/` (gitignored). On the Mac, after setting up the [AWS Agent Toolkit](https://github.com/aws/agent-toolkit-for-aws) (`aws configure agent-toolkit` installs the skills into `~/.claude/skills`), copy them in:

```bash
mkdir -p .claude/skills
for d in ~/.claude/skills/*/; do [ -f "$d.aws-skill-metadata" ] && cp -R "${d%/}" .claude/skills/; done
```

Only folders with the toolkit's `.aws-skill-metadata` marker are copied. Re-run it after the toolkit updates its skills.
## GitHub MCP server for Claude Code (optional)

`.mcp.json` includes GitHub's hosted MCP server. It authenticates with a fine-grained personal access token read from the `GITHUB_PAT` environment variable, so the token is never committed.

1. Create a token at <https://github.com/settings/personal-access-tokens/new>:
   - **Resource owner:** your account.
   - **Repository access:** only `gridviz`.
   - **Expiration:** 90 days.
   - **Permissions:** Contents: read, Actions: read, Pull requests: read & write, Issues: read & write. Add Administration: read & write only if Claude should manage rulesets.
2. **Dev container:** add `GITHUB_PAT=<token>` to `.env` (gitignored; it reaches the container through `env_file`), then recreate the container.
3. **Mac:** keep the token in the Keychain and export it from `~/.zshrc`:
   ```bash
   security add-generic-password -a "$USER" -s github-pat-gridviz -w   # paste the token when prompted
   echo 'export GITHUB_PAT="$(security find-generic-password -a "$USER" -s github-pat-gridviz -w 2>/dev/null)"' >> ~/.zshrc
   ```
4. Restart Claude Code, approve `github` when prompted, and check it with `claude mcp list`.
