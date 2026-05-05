declare module '*.mjs' {
  export const evaluatePromptQuality: (value: unknown) => { ok: boolean; reason: string }
  export const inferImageMetadata: (buffer: Buffer, mime?: string) => {
    mime: string
    width: number | null
    height: number | null
    ext: string
  }
  export const buildR2Endpoint: (accountId?: string) => string
  export const hasS3Config: (input?: Record<string, unknown>) => boolean
  export const normalizeS3Config: (input?: Record<string, unknown>) => {
    endpoint: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    region: string
  }
  export const putS3Object: (
    input: Record<string, unknown>,
    key: string,
    body: Buffer,
    options?: { contentType?: string, cacheControl?: string }
  ) => Promise<Response>
  export const getS3Object: (input: Record<string, unknown>, key: string) => Promise<Response>
  export const createPresignedS3GetUrl: (
    input: Record<string, unknown>,
    key: string,
    options?: { expiresIn?: number, now?: Date }
  ) => string
}
