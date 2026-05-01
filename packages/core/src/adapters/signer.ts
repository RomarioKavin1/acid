export interface SignerAdapter {
  identity: string;
  sign(message: Uint8Array): Promise<string>;
  publicKey(): Promise<string>;
}
