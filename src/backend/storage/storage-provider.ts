/**
 * Storage Layer — object storage contract.
 *
 * No provider is wired in Week 2. The interface exists so document upload
 * (Week 4+) can plug in Lovable Cloud storage or S3 without touching services.
 */

export interface StoredObject {
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

export interface StorageProvider {
  readonly id: string;
  putObject(key: string, body: Blob | ArrayBuffer, contentType: string): Promise<StoredObject>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

export const storageProvider: StorageProvider | null = null;
