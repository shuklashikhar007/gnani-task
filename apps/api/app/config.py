from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, read from environment variables and `.env`."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/audio_notes"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""

    max_upload_bytes: int = 2 * 1024**3  # 2 GiB
    upload_stale_hours: int = 24

    gnani_api_key: str = ""
    gnani_base_url: str = "https://api.vachana.ai"
    gnani_model: str = "gnani-prisma-v2.5"
    # Audio up to this long uses Gnani's synchronous endpoint; longer goes to batch. The endpoint rejects
    # audio over 30 s (MAX_AUDIO_DURATION_EXCEEDED), so stay safely below that.
    sync_max_seconds: float = 25
    # Public base URL Gnani can reach for its completion webhook (e.g. https://<app>.vercel.app/api).
    # Leave empty locally: without it no webhook is registered and polling collects results.
    public_api_url: str = ""
    # Random secret used to sign webhook URLs.
    webhook_secret: str = ""

    # Summaries: any OpenAI-compatible Chat Completions API (OpenAI, Gemini, Anthropic, Groq, OpenRouter, Ollama…).
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = ""
    # Send response_format={"type": "json_object"} (only for providers/models that support it).
    llm_json_mode: bool = False
    llm_timeout_seconds: float = 90
    # Transcripts longer than this (in characters, ~4 per token) are summarized in parts, then combined.
    llm_chunk_chars: int = 24000

    @property
    def is_prod(self) -> bool:
        return self.env == "production"

    @property
    def r2_endpoint_url(self) -> str:
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"


settings = Settings()
