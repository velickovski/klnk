export type VoiceInput = { text?: string; audioBase64?: string; mimeType?: string };
export type VoiceReply = { text: string; audioBase64?: string; audioMimeType?: string };
export type VoiceIOOptions = { onInput: (input: VoiceInput) => Promise<void>; onError: (message: string) => void; onPlaybackEnd?: () => void; manualSend?: boolean };
export type VoiceIO = { listening: boolean; speaking: boolean; pending: boolean; available: boolean; source: string; start: () => Promise<void>; stop: () => Promise<void>; send: () => Promise<void>; cancel: () => Promise<void>; speak: (reply: VoiceReply) => Promise<void>; silence: () => void };
