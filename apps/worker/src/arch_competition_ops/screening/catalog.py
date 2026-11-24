"""Screening prices in USD per million tokens for short-context requests."""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil


@dataclass(frozen=True)
class ScreeningModel:
    id: str
    input_per_million: float
    output_per_million: float
    purpose: str

    provider: str = "openai"
    cache_read_per_million: float | None = None

    def reservation(self, request_bytes: int, max_output: int) -> float:
        # Count the full serialized schema and framing before applying the tokenizer allowance.
        tokens = request_bytes + 4096
        if self.provider == "anthropic":
            tokens = ceil(tokens * 1.7)
        return self.cost(tokens, max_output)

    def cost(self, input_tokens: int, output_tokens: int, cache_read_tokens: int = 0) -> float:
        discount = 0.0
        if self.cache_read_per_million is not None and input_tokens <= 100_000:
            discount = cache_read_tokens * (self.input_per_million - self.cache_read_per_million)
        return round(
            (
                input_tokens * self.input_per_million
                + output_tokens * self.output_per_million
                - discount
            )
            / 1_000_000,
            8,
        )


MODELS = (
    ScreeningModel(
        "claude-haiku-5-5", 0.10, 0.50, "Default notice screening / 默认公告筛选", "anthropic", 0.01
    ),
    ScreeningModel("gpt-6-luna", 0.10, 0.50, "Economical OpenAI screening / OpenAI 低成本筛选"),
    ScreeningModel(
        "gpt-6.1-terra", 1.00, 5.00, "Efficient analysis and summaries / 高效分析与摘要"
    ),
    ScreeningModel("gpt-6.1-sol", 2.00, 10.00, "Detailed eligibility review / 资格细审"),
    ScreeningModel("gpt-6-astra", 10.00, 50.00, "Complex cases / 复杂个案"),
)


def get_model(model_id: str) -> ScreeningModel:
    for model in MODELS:
        if model.id == model_id:
            return model
    raise ValueError(f"Unsupported screening model {model_id!r}; run show-ai-models")
