export async function verifyAccessToken(token: string): Promise<boolean> {
  const response = await fetch('/api/auth/verify', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok;
}
