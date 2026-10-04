let token = "";
export function setToken(t: string) {
  token = t;
}
export async function api<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api" + url,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Stocknews-Token": token,
          },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "请求失败");
  return data;
}
