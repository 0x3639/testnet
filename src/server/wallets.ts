import { KeyFile, KeyStore } from "znn-typescript-sdk";
import { encryptText, randomPassword } from "./crypto.js";
import type { StoredWallet } from "../shared/types.js";

export interface CreatedWallet {
  address: string;
  keyFile: unknown;
  password: string;
}

export async function createWallet(): Promise<CreatedWallet> {
  const keyStore = KeyStore.newRandom();
  const password = randomPassword();
  const keyFile = await KeyFile.setPassword(password).encrypt(keyStore);

  return {
    address: keyStore.getBaseAddress().toString(),
    keyFile,
    password
  };
}

export function toStoredWallet(wallet: CreatedWallet): StoredWallet {
  return {
    address: wallet.address,
    keyFile: wallet.keyFile,
    passwordCipher: encryptText(wallet.password)
  };
}
