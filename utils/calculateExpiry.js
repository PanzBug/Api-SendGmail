export const calculateExpiry = (duration) => {
  const now = new Date();
  switch (duration) {
    case '1h': return new Date(now.getTime() + 60 * 60 * 1000);
    case '7h': return new Date(now.getTime() + 7 * 60 * 60 * 1000);
    case '1month': return new Date(now.setMonth(now.getMonth() + 1));
    default: return null;
  }
};