export interface TrackToken {
  token: string
  fileName: string
  path?: string
  color?: string
  [key: string]: unknown
}

export interface FileViewObject {
  hic_token?: string | null
  mcoolPath?: string | null
  file_token?: string | null
  bed_tokens?: TrackToken[]
  bigwig_tokens?: TrackToken[]
  selected_chroms?: string[]
  cell_line?: string | null
  cell_demo?: string | null
  resolution?: number | null
  bed_token?: string | null
  assembly?: string | null
  source?: string | null
  [key: string]: unknown
}

export interface CounterStoreState {
  file_view_obj: FileViewObject
}

export interface CounterStore extends CounterStoreState {
  $subscribe(
    callback: (mutation: unknown, state: CounterStoreState) => void,
  ): () => void
}

export function useCounterStore(): CounterStore
