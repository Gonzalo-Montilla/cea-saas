const CURRENCY_FORMATTER_CO = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

export const formatCurrencyCOP = (value?: number | string | null): string => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return CURRENCY_FORMATTER_CO.format(0);
  return CURRENCY_FORMATTER_CO.format(numeric);
};

export const formatDateCO = (value?: string | Date | null): string => {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-CO');
};

export const formatDateTimeCO = (value?: string | Date | null): string => {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-CO');
};

export const formatPercent = (value?: number | string | null, digits = 1): string => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return `${(0).toFixed(digits)}%`;
  return `${numeric.toFixed(digits)}%`;
};

