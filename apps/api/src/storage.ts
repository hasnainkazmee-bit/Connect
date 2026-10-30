import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import path from "node:path";
import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import { root, pool, HttpError } from "./db.js";

const directory = () => path.resolve(root, process.env.UPLOAD_DIR || "uploads");
const backend = () => process.env.STORAGE_BACKEND === "s3" ? "s3" : "local";
let client: S3Client | undefined;
function s3() {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new HttpError(503, "File storage is not configured.");
  return client ||= new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 3,
  });
}
function localPath(key: string) {
  const result = path.resolve(directory(), key);
  if (!result.startsWith(directory() + path.sep) || key.includes("..")) throw new HttpError(400, "Invalid file key.");
  return result;
}
export async function storeBuffer(key: string, data: Buffer, mime: string) {
  const sha256 = createHash("sha256").update(data).digest("hex");
  const storage_backend = backend();
  if (storage_backend === "s3") await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: data, ContentType: mime, Metadata: { sha256 } }));
  else { await fs.mkdir(path.dirname(localPath(key)), {recursive:true}); await fs.writeFile(localPath(key), data, {flag:"wx"}); }
  return { storage_backend, sha256 };
}
export async function storeFile(key: string, file: string, mime: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  const storage_backend = backend();
  if (storage_backend === "s3") {
    const stat = await fs.stat(file);
    await s3().send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:createReadStream(file),ContentLength:stat.size,ContentType:mime,Metadata:{sha256}}));
  } else if (path.resolve(file) !== localPath(key)) {
    await fs.mkdir(path.dirname(localPath(key)), {recursive:true});
    await fs.copyFile(file,localPath(key), fs.constants.COPYFILE_EXCL);
  }
  return {storage_backend,sha256};
}
export async function sendStored(req: Request, res: Response, storageBackend: string, key: string) {
  if (storageBackend === "local") return res.sendFile(localPath(key));
  const range = req.get("range");
  if (range && !/^bytes=\d*-\d*$/.test(range)) throw new HttpError(416, "Invalid byte range.");
  try {
    const object = await s3().send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Range:range}));
    res.set("Accept-Ranges", "bytes");
    if (object.ContentRange) { res.status(206); res.set("Content-Range", object.ContentRange); }
    if (object.ContentLength !== undefined) res.set("Content-Length", String(object.ContentLength));
    if (!object.Body) throw new HttpError(404, "File not found.");
    await pipeline(object.Body as Readable, res);
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404) throw new HttpError(404, "File not found.");
    if (error?.$metadata?.httpStatusCode === 416) throw new HttpError(416, "Invalid byte range.");
    throw error;
  }
}
export async function deleteStored(storageBackend: string, key: string) {
  if (storageBackend === "s3") await s3().send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));
  else await fs.unlink(localPath(key)).catch(error => { if (error.code !== "ENOENT") throw error; });
}
export async function deferDelete(storageBackend: string, key: string) {
  await pool.query("INSERT INTO storage_deletions(storage_backend,storage_key) VALUES($1,$2) ON CONFLICT DO NOTHING", [storageBackend,key]);
}
export async function cleanStorage() {
  const {rows} = await pool.query("SELECT * FROM storage_deletions WHERE attempts<10 ORDER BY id LIMIT 20");
  for (const row of rows) {
    try { await deleteStored(row.storage_backend,row.storage_key); await pool.query("DELETE FROM storage_deletions WHERE id=$1",[row.id]); }
    catch { await pool.query("UPDATE storage_deletions SET attempts=attempts+1 WHERE id=$1",[row.id]); }
  }
}
export async function checkQuota(db: PoolClient, companyId: string, bytes: number) {
  if (!bytes) return;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [companyId]);
  const {rows} = await db.query("SELECT COALESCE((SELECT sum(pm.size) FROM post_media pm JOIN posts p ON p.id=pm.post_id WHERE p.company_id=$1),0)+COALESCE((SELECT sum(a.size) FROM attachments a JOIN messages m ON m.id=a.message_id WHERE m.sender_company_id=$1),0) AS used",[companyId]);
  if (Number(rows[0].used)+bytes>Number(process.env.COMPANY_STORAGE_LIMIT_BYTES || 5*1024*1024*1024)) throw new HttpError(413,"Your company’s file storage is full.");
}
export async function storageReady() {
  if (backend() === "s3") await s3().send(new HeadBucketCommand({Bucket:process.env.S3_BUCKET}));
  else await fs.access(directory(), fs.constants.W_OK);
}
