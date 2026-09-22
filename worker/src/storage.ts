import { GetObjectCommand, HeadBucketCommand, PutBucketCorsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class R2Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const accountId = required('R2_ACCOUNT_ID');
    this.bucket = required('R2_BUCKET');
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') },
    });
  }

  async download(key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error(`Storage object ${key} has no body.`);
    return response.Body.transformToByteArray();
  }

  async createUploadUrl(key: string, contentType: string) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: 15 * 60 });
  }

  async verifyBucket() { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }

  async configureUploadCors(origins: string[]) {
    await this.client.send(new PutBucketCorsCommand({
      Bucket: this.bucket,
      CORSConfiguration: { CORSRules: [{
        AllowedOrigins: origins,
        AllowedMethods: ['PUT'],
        AllowedHeaders: ['Content-Type'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      }] },
    }));
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
