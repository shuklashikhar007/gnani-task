// Must match LANGUAGES in apps/api/app/transcription/languages.py.
export const LANGUAGES = [
    { code: "en-IN", label: "English" },
    { code: "hi-IN", label: "Hindi" },
    { code: "hi-IN,en-IN", label: "Hindi + English" },
    { code: "bn-IN", label: "Bengali" },
    { code: "kn-IN", label: "Kannada" },
    { code: "ml-IN", label: "Malayalam" },
    { code: "mr-IN", label: "Marathi" },
    { code: "ta-IN", label: "Tamil" },
    { code: "te-IN", label: "Telugu" },
] as const;

export const DEFAULT_LANGUAGE = "en-IN";

export function languageLabel(code: string) {
    return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
