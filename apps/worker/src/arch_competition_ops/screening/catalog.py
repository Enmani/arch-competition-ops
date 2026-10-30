"""Supported screening models; standard short-context USD prices, checked 2026-10-30.

Source: https://developers.openai.com/api/docs/pricing
Cached-input discounts are deliberately ignored in the local conservative cost estimate.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScreeningModel:
    id: str
    input_per_million: float
    output_per_million: float
    purpose: str

    def cost(self, input_tokens: int, output_tokens: int) -> float:
        return round(
            (input_tokens * self.input_per_million + output_tokens * self.output_per_million)
            / 1_000_000,
            8,
        )


MODELS = (
    ScreeningModel("gpt-6-luna", 0.10, 0.50, "Default: economical screening / 默认：低成本筛选"),
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
