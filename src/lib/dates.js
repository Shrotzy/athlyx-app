/** Local-date helper for <input type="date"> values (YYYY-MM-DD). */
export function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
