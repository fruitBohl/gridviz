import { S3Client } from "@aws-sdk/client-s3";
import { rebuild } from "./rebuild";
import { S3Store } from "./store";

const bucket = process.env.DATA_BUCKET;
if (!bucket) throw new Error("DATA_BUCKET is not set");

const store = new S3Store(new S3Client({}), bucket);

export const handler = () =>
  rebuild({
    store,
    log: (message, fields) => console.log(JSON.stringify({ message, ...fields })),
  });
