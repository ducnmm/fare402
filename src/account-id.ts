/** Hedera account id: shard.realm.num */
const ACCOUNT_ID_RE = /^\d{1,10}\.\d{1,10}\.\d{1,10}$/;

export function isHederaAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(value);
}
