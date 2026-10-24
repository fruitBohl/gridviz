// bun run ingest:local
// Runs the ingest against live NEMWeb and writes the JSON into public/data/, so `bun dev`
// serves the same /data/* files CloudFront does in production. Raw zips aren't kept.
import { fetchFile, fetchListing } from "./nemweb";
import { run } from "./run";
import { FsStore } from "./store";

const result = await run({
  store: new FsStore("public"),
  fetchListing: () => fetchListing(),
  fetchFile,
  archiveRaw: false,
  log: (message, fields) => console.log(message, fields ?? ""),
});

console.log(`Done: ${result.processed} file(s), latest ${result.settlementDate ?? "none"}`);
