export type CitedChunk = {
  chunk_id: string
  document_id: string
  source: string
  page: number
  start_index: number
  content: string
  citation_index: number
}

export type CitationTarget = {
  chunk: CitedChunk,
  nonce: number
}

export type QueryResponse = {
  answer: string
  cited_chunks: CitedChunk[]
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
