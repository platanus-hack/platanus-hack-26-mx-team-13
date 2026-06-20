import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 storage layer (S3-compatible).
//
// Clients upload CSF PDFs (and later CFDI files) directly to R2 via a presigned
// PUT URL — bytes never pass through Next.js, which avoids serverless body limits.
// The server reads files back by key with getObjectBuffer.
//
// Env (see .env.example):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

// Cache the client on globalThis so Next.js dev hot-reload reuses one instance
// instead of opening a new S3Client on every module re-evaluation.
let client = globalThis._r2Client;

function getClient() {
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 storage is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env.local"
    );
  }

  client = globalThis._r2Client = new S3Client({
    // R2 ignores the region but the SDK requires one; 'auto' is the documented value.
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

function getBucket() {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error(
      "R2 storage is not configured — set R2_BUCKET in .env.local"
    );
  }
  return bucket;
}

/**
 * Generate a presigned PUT URL so a client can upload a single object directly
 * to R2. The contentType is baked into the signature, so the client MUST send
 * the same `Content-Type` header on its PUT or R2 rejects the request.
 *
 * @param {Object} params
 * @param {string} params.key - Object key (path) in the bucket, e.g. "csf/{userId}/{ts}-file.pdf".
 * @param {string} params.contentType - MIME type the client will upload with.
 * @param {number} [params.expiresIn=900] - URL lifetime in seconds (default 15 min).
 * @returns {Promise<string>} A presigned URL valid for `expiresIn` seconds.
 */
export async function getPresignedPutUrl({ key, contentType, expiresIn = 900 }) {
  if (!key) throw new Error("getPresignedPutUrl: key is required");

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(getClient(), command, { expiresIn });
}

/**
 * Upload a buffer to R2 directly from the server. Used for bytes the server
 * produces itself (e.g. engine browser screenshots) rather than client uploads,
 * which go through a presigned PUT instead.
 *
 * @param {Object} params
 * @param {string} params.key - Object key (path) in the bucket.
 * @param {Buffer|Uint8Array} params.body - The bytes to store.
 * @param {string} [params.contentType] - MIME type to store the object as.
 * @returns {Promise<string>} The key the object was stored under.
 */
export async function putObjectBuffer({ key, body, contentType }) {
  if (!key) throw new Error("putObjectBuffer: key is required");
  if (!body) throw new Error("putObjectBuffer: body is required");

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return key;
}

/**
 * Read an object back from R2 by key and return its full bytes as a Buffer.
 *
 * @param {string} key - Object key in the bucket.
 * @returns {Promise<Buffer>} The object's bytes.
 */
export async function getObjectBuffer(key) {
  if (!key) throw new Error("getObjectBuffer: key is required");

  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );

  // AWS SDK v3 streams expose transformToByteArray() in Node and the browser.
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Delete an object from R2 by key. Optional helper for cleanup / replacement.
 *
 * @param {string} key - Object key in the bucket.
 * @returns {Promise<void>}
 */
export async function deleteObject(key) {
  if (!key) throw new Error("deleteObject: key is required");

  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  );
}
