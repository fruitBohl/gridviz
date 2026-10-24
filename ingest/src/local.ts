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
