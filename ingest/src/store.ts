import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export interface Store {
  getJson<T>(key: string): Promise<T | undefined>;
  putJson(key: string, value: unknown): Promise<void>;
  putBytes(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

const DATA_CACHE_CONTROL = "public, max-age=60";

export class S3Store implements Store {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async getJson<T>(key: string): Promise<T | undefined> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return JSON.parse(await res.Body!.transformToString()) as T;
    } catch (err) {
      // NoSuchKey needs s3:ListBucket; without it S3 answers AccessDenied instead
      if ((err as Error).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        CacheControl: DATA_CACHE_CONTROL,
      }),
    );
  }

  async putBytes(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
}

export class FsStore implements Store {
  constructor(private readonly root: string) {}

  async getJson<T>(key: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(join(this.root, key), "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.write(key, JSON.stringify(value));
  }

  async putBytes(key: string, body: Uint8Array): Promise<void> {
    await this.write(key, body);
  }

  private async write(key: string, body: string | Uint8Array): Promise<void> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
}
