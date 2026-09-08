let tokenPromise: Promise<string> | null = null;

async function getBotToken(): Promise<string> {
  if (!window.electron?.getBotSecret) return "";
  tokenPromise ||= window.electron.getBotSecret().catch(() => "");
  const t = await tokenPromise;
  // ★2026-09-08(테리): 빈 토큰("")은 캐시하지 않는다 — 앱 시작·프리로드 타이밍으로 한 번 ""가 나오면 그 세션 내내
  //   Authorization이 안 붙어 봇이 401 Unauthorized(재연결 실패·버퍼링). 다음 호출 때 재시도하게 캐시 비운다.
  if (!t) tokenPromise = null;
  return t;
}

export async function botFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getBotToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// Native EventSource cannot attach Authorization headers, so local-bot SSE uses fetch streaming.
export class BotEventStream {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;   // 스트림이 어떤 식으로든 끝나면 호출(버튼 잠금 해제용)
  private controller = new AbortController();

  constructor(url: string, init?: RequestInit) {
    void this.connect(url, init);
  }

  private async connect(url: string, init?: RequestInit) {
    try {
      const response = await botFetch(url, {
        signal: this.controller.signal,
        method: init?.method,
        body: init?.body,
        headers: { Accept: "text/event-stream", ...(init?.headers as Record<string,string> || {}) },
      });
      if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!this.controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const data = chunk.split(/\r?\n/).filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart()).join("\n");
          if (data) this.onmessage?.(new MessageEvent("message", { data }));
        }
      }
    } catch (error) {
      if (!this.controller.signal.aborted) this.onerror?.();
    } finally {
      if (!this.controller.signal.aborted) this.onclose?.();
    }
  }

  close() { this.controller.abort(); }
}
