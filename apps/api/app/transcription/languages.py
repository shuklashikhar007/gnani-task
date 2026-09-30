# Languages offered in the UI. All work on both Gnani endpoints except combinations,
# which only batch supports (routing sends those to batch).
LANGUAGES: dict[str, str] = {
    "en-IN": "English",
    "hi-IN": "Hindi",
    "hi-IN,en-IN": "Hindi + English",
    "bn-IN": "Bengali",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
    "mr-IN": "Marathi",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
}
