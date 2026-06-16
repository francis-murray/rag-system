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

export type StreamEventBase = {
  stream_version: 1
  request_id: string
  sequence: number
  timestamp_ms: number
}

export type StreamStartEvent = StreamEventBase & {
  type: "start"
  query: string
}

export type StreamProgressEvent = StreamEventBase & {
  type: "progress"
  stage: "retrieval" | "rerank" | "inference"
  message: string
}

export type StreamDeltaEvent = StreamEventBase & {
  type: "delta"
  delta: string
}

export type StreamCompleteEvent = StreamEventBase & {
  type: "complete"
  data: QueryResponse
  timings_ms: Record<string, number>
  usage?: LlmUsage | null
}

export type StreamFailedEvent = StreamEventBase & {
  type: "failed"
  code: "internal_error"
  message: string
}

export type StreamEvent =
  | StreamStartEvent
  | StreamProgressEvent
  | StreamDeltaEvent
  | StreamCompleteEvent
  | StreamFailedEvent
