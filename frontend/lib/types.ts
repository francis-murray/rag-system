export type CitedChunk = {
  document_id: string
  source: string
  page: number
  start_index: number
  content: string
  citation_index: number
}

export type QueryResponse = {
  answer: string
  cited_chunks: CitedChunk[]
}