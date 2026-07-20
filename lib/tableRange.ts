/** Resume numérico das mesas: "1:20", "1,3,5" ou "—". */
export function formatTablesRange(tableNames: Array<string | number>): string {
  const nums = [
    ...new Set(
      tableNames
        .map((n) => Number(String(n).trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);

  if (!nums.length) return '—';
  if (nums.length === 1) return String(nums[0]);

  const min = nums[0];
  const max = nums[nums.length - 1];
  const contiguous = nums.length === max - min + 1 && nums.every((n, i) => n === min + i);
  if (contiguous) return `${min}:${max}`;
  return nums.join(',');
}
