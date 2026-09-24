export interface DiffPullData {
  original: string;
  modified: string;
  language?: string;
  title?: string;
  createdAt?: number;
}

interface ApiResp<T> {
  success: boolean;
  data?: T;
  message?: string;
  id?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  }
  return resp.json() as Promise<T>;
}

export async function pullDiff(id: string): Promise<DiffPullData> {
  const json = await request<ApiResp<DiffPullData>>(`/api/diff/pull/${encodeURIComponent(id)}`);
  if (!json.success || !json.data) throw new Error(json.message || '加载失败');
  return json.data;
}

export async function pushDiff(payload: {
  original: string;
  modified: string;
  language: string;
}): Promise<string> {
  const json = await request<ApiResp<unknown>>('/api/diff/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!json.success || !json.id) throw new Error(json.message || '推送失败');
  return json.id;
}
