function padZero(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}

/**
 * Formats a Date or ISO string into DD/MM/YYYY string.
 */
export function formatDateToDDMMYYYY(dateInput: Date | string): string {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  return `${padZero(d.getUTCDate())}/${padZero(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
