export type BBox = {
  l: number
  t: number
  r: number
  b: number
}

export type PageLocation = {
  page: number
  boxes: BBox[]
}

export type CitedChunk = {
  chunk_id: string
  document_id: string
  source: string
  page: number
  locations: PageLocation[]
  content: string
  headings?: string[]
  citation_index: number
}

export type CitationTarget = {
  chunk: CitedChunk,
  nonce: number
}

export type LlmUsage = {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens?: number | null
  reasoning_tokens?: number | null
}

export type QueryResponse = {
  answer: string
  cited_chunks: CitedChunk[]
  usage?: LlmUsage | null
}

export type DocumentItem = {
  document_id: string
  filename: string
}

export type DocumentsResponse = {
  documents: DocumentItem[]
}

export type UploadResponse = {
  document_id: string
  filename: string
}

export type QueryProgressStage = "retrieval" | "rerank" | "inference"

export type QueryStreamEventBase = {
  stream_version: 1
  request_id: string
  sequence: number
  timestamp_ms: number
}

export type QueryStreamStartEvent = QueryStreamEventBase & {
  type: "start"
  query: string
}

export type QueryStreamProgressEvent = QueryStreamEventBase & {
  type: "progress"
  stage: QueryProgressStage
  message: string
}

export type QueryStreamDeltaEvent = QueryStreamEventBase & {
  type: "delta"
  delta: string
}

export type QueryStreamCompleteEvent = QueryStreamEventBase & {
  type: "complete"
  data: QueryResponse
  timings_ms: Record<string, number>
  usage?: LlmUsage | null
}

export type QueryStreamFailedEvent = QueryStreamEventBase & {
  type: "failed"
  code: "internal_error"
  message: string
}

export type QueryStreamEvent =
  | QueryStreamStartEvent
  | QueryStreamProgressEvent
  | QueryStreamDeltaEvent
  | QueryStreamCompleteEvent
  | QueryStreamFailedEvent

export type UploadProgressStage = "saving" | "parsing" | "indexing"

export type UploadStreamProgressEvent = {
  type: "progress"
  stage: UploadProgressStage
  message: string
}

export type UploadStreamCompleteEvent = {
  type: "complete"
  document_id: string
  filename: string
}

export type UploadStreamFailedEvent = {
  type: "failed"
  message: string
}

export type UploadStreamEvent =
  | UploadStreamProgressEvent
  | UploadStreamCompleteEvent
  | UploadStreamFailedEvent
