declare module '*.mjs' {
  export const evaluatePromptQuality: (value: unknown) => { ok: boolean; reason: string }
  export const inferImageMetadata: (buffer: Buffer, mime?: string) => {
    mime: string
    width: number | null
    height: number | null
    ext: string
  }
}
