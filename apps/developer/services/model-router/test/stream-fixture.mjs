export const streamText = text => `event: metadata\ndata: {"requestId":"qa-request","sessionId":"qa-session"}\n\nevent: token\ndata: ${JSON.stringify({text})}\n\nevent: done\ndata: {"requestId":"qa-request"}\n\n`;
export const streamResponse = text => new Response(streamText(text), { headers: { "content-type": "text/event-stream", "x-ynx-ai-model": "qwen3:4b" } });
