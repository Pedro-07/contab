/**
 * Storage de arquivos (CLAUDE.md, regra 7): Cloudflare R2 em produção; SeaweedFS (S3)
 * em desenvolvimento, testes e CI. Bucket privado, tudo sob tenants/{tenant_id}/.
 * Toda operação recebe o tenant e recusa chave fora do prefixo dele antes de chamar o
 * provedor. URLs assinadas valem 5 min e só são geradas depois da checagem de permissão,
 * que é de quem chama (casos de uso).
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@contab/config/logger';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

export const SIGNED_URL_TTL_SECONDS = 5 * 60;

export type StorageConfig = {
  STORAGE_ENDPOINT: string;
  STORAGE_BUCKET: string;
  STORAGE_ACCESS_KEY_ID: string;
  STORAGE_SECRET_ACCESS_KEY: string;
  STORAGE_REGION?: string | undefined;
};

export class StorageKeyError extends Error {
  constructor() {
    super('Chave de storage fora do prefixo do tenant');
    this.name = 'StorageKeyError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** Monta tenants/{tenant_id}/{partes...}. Cada parte é um identificador simples. */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  if (!UUID.test(tenantId)) throw new StorageKeyError();
  for (const part of parts) {
    if (!SEGMENT.test(part) || part.includes('..')) throw new StorageKeyError();
  }
  return ['tenants', tenantId, ...parts].join('/');
}

function assertTenantKey(tenantId: string, key: string): void {
  if (!UUID.test(tenantId)) throw new StorageKeyError();
  const prefix = `tenants/${tenantId}/`;
  if (!key.startsWith(prefix) || key.includes('..') || key.includes('//')) {
    throw new StorageKeyError();
  }
}

export type SignedUpload = { url: string; headers: Record<string, string> };

export interface FileStorage {
  /**
   * URL de PUT para o navegador, com os cabeçalhos que ele precisa mandar iguais.
   * Tipo, tamanho e nome de download entram na assinatura.
   */
  presignUpload(
    tenantId: string,
    key: string,
    file: { contentType: string; size: number; fileName: string },
  ): Promise<SignedUpload>;
  /** URL de GET com download forçado e nome de arquivo. */
  presignDownload(
    tenantId: string,
    key: string,
    file: { fileName: string; contentType: string },
  ): Promise<string>;
  /** Tamanho real do objeto, ou null se ele não existe. */
  size(tenantId: string, key: string): Promise<number | null>;
  /** Primeiros bytes (para conferir o tipo pelo conteúdo). */
  readStart(tenantId: string, key: string, bytes: number): Promise<Uint8Array>;
  /** Arquivo inteiro (até 10 MB), para anexar no WhatsApp ou no e-mail. */
  readAll(tenantId: string, key: string): Promise<Uint8Array>;
  /** SHA-256 em hexadecimal, lendo o objeto em fluxo. */
  sha256(tenantId: string, key: string): Promise<string>;
  delete(tenantId: string, key: string): Promise<void>;
  /**
   * Só para dev e testes: cria o bucket se faltar e libera o envio direto do navegador
   * (PUT) a partir das origens dadas. Em produção, a regra de CORS do R2 é a do runbook.
   */
  ensureBucket(corsOrigins: string[]): Promise<void>;
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createFileStorage(config: StorageConfig): FileStorage {
  const client = new S3Client({
    endpoint: config.STORAGE_ENDPOINT,
    region: config.STORAGE_REGION ?? 'auto',
    // R2 e SeaweedFS aceitam o bucket no caminho da URL.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
    },
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 15_000 },
    // O R2 não aceita os checksums CRC novos do SDK em URLs assinadas.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Bucket = config.STORAGE_BUCKET;

  return {
    async presignUpload(tenantId, key, file) {
      assertTenantKey(tenantId, key);
      // O nome de download fica gravado no objeto: nem todo provedor S3 respeita o
      // response-content-disposition da URL de GET (o SeaweedFS, por exemplo, não).
      const disposition = contentDisposition(file.fileName);
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: file.contentType,
          ContentLength: file.size,
          ContentDisposition: disposition,
        }),
        {
          expiresIn: SIGNED_URL_TTL_SECONDS,
          signableHeaders: new Set(['content-type', 'content-length', 'content-disposition']),
        },
      );
      return {
        url,
        headers: { 'content-type': file.contentType, 'content-disposition': disposition },
      };
    },

    async presignDownload(tenantId, key, file) {
      assertTenantKey(tenantId, key);
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(file.fileName),
          ResponseContentType: file.contentType,
        }),
        { expiresIn: SIGNED_URL_TTL_SECONDS },
      );
    },

    async size(tenantId, key) {
      assertTenantKey(tenantId, key);
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return head.ContentLength ?? 0;
      } catch (error) {
        if (error instanceof NotFound) return null;
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
          return null;
        throw error;
      }
    },

    async readStart(tenantId, key, bytes) {
      assertTenantKey(tenantId, key);
      const object = await client.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
      );
      const body = await object.Body?.transformToByteArray();
      return (body ?? new Uint8Array()).slice(0, bytes);
    },

    async readAll(tenantId, key) {
      assertTenantKey(tenantId, key);
      const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return (await object.Body?.transformToByteArray()) ?? new Uint8Array();
    },

    async sha256(tenantId, key) {
      assertTenantKey(tenantId, key);
      const object = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      const hash = createHash('sha256');
      for await (const chunk of object.Body as Readable) hash.update(chunk as Buffer);
      return hash.digest('hex');
    },

    async delete(tenantId, key) {
      assertTenantKey(tenantId, key);
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      logger.info({ op: 'storage.delete' }, 'objeto apagado');
    },

    async ensureBucket(corsOrigins) {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket }));
      }
      await client.send(
        new PutBucketCorsCommand({
          Bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: corsOrigins,
                AllowedMethods: ['PUT'],
                AllowedHeaders: ['content-type', 'content-disposition'],
                MaxAgeSeconds: 300,
              },
            ],
          },
        }),
      );
    },
  };
}
