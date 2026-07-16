export const parseApiError = (error: any, fallback: string): string => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first === 'string' && first.trim()) return first;
    if (typeof first?.msg === 'string' && first.msg.trim()) return first.msg;
  }
  if (typeof detail === 'string' && detail.trim()) return detail;
  return fallback;
};

