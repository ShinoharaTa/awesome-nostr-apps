/**
 * 配列末尾に値を追加し、最大長を超えたら先頭から落とす。
 * flowmeter のチャート用時系列を一定長に保つために使う。
 */
export function appendWithLimit<T>(arr: T[], value: T, limit: number): T[] {
  const next = [...arr, value];
  if (next.length > limit) {
    return next.slice(next.length - limit);
  }
  return next;
}
