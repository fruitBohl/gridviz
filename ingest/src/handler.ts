import { S3Client } from "@aws-sdk/client-s3";
import { fetchFile, fetchListing } from "./nemweb";
import { run } from "./run";
import { S3Store } from "./store";

const bucket = process.env.DATA_BUCKET;
if (!bucket) throw new Error("DATA_BUCKET is not set");

const store = new S3Store(new S3Client({}), bucket);

export const handler = () =>
  run({
    store,
    fetchListing: () => fetchListing(),
    fetchFile,
    log: (message, fields) => console.log(JSON.stringify({ message, ...fields })),
  });
