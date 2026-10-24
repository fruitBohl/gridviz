import { rebuild } from "./rebuild";
import { FsStore } from "./store";

const result = await rebuild({
  store: new FsStore("backfill-out"),
  log: (message, fields) => console.log(message, fields ?? ""),
});

console.log(`Done: ${result.days} day(s) through ${result.throughDate}, ${result.written.length} file(s)`);
