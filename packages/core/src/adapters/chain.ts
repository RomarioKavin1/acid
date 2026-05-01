export type TxStatus =
  | "pending"
  | "mined"
  | "finalized"
  | "replaced"
  | "failed";

export interface ChainAdapter {
  chainId: number;
  getTxByHash(hash: string): Promise<TxStatus | null>;
  getTxByNonce(address: string, nonce: number): Promise<TxStatus | null>;
  waitForFinality(hash: string, confirmations: number): Promise<TxStatus>;
  getBlockNumber(): Promise<number>;
}
