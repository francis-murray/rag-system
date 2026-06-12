import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
from langchain_chroma import Chroma
from openai import AsyncOpenAI
from ragas.llms import llm_factory
from sentence_transformers import CrossEncoder

# https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/
from ragas.metrics.collections import (
    ContextPrecision,  # ranking quality of retrieved_contexts
    ContextRecall,  # golden_answer vs retrieved_contexts
    FactualCorrectness,  # rag_answer vs golden_answer
    Faithfulness,  # rag_answer vs retrieved_contexts
)

from backend.app.config.rag_settings import RagSettings, get_rag_settings
from backend.app.schemas import LlmUsage
from backend.app.core.config import load_and_validate_env
from backend.app.core.logging_config import setup_logging
from backend.app.core.paths import get_project_root
from backend.app.prompts.registry import load_prompt
from backend.app.services.rag_service import (
    build_index,
    build_reranker,
    get_default_pdf_paths,
    remove_citation_markers,
    run_rag_query,
)

logger = logging.getLogger("backend.app.evals.eval")


def default_dataset_path() -> Path:
    """Return the default path to the golden evaluation dataset."""
    return get_project_root() / "data" / "evals" / "golden_eval.jsonl"


def default_output_path(now: str) -> Path:
    """Return the default path to save the evaluation results."""
    return get_project_root() / "data" / "evals" / "results" / f"eval_{now}.csv"


def aggregate_output_path() -> Path:
    """Return the default path to save the aggregate evaluation results."""
    return get_project_root() / "data" / "evals" / "results" / "evals_aggregate.csv"


def resolve_dataset_path(dataset_path: Path) -> Path:
    """Resolve a dataset path relative to the project root when needed."""
    if dataset_path.is_absolute():
        return dataset_path
    return get_project_root() / dataset_path


def format_rag_usage(usage: LlmUsage | None) -> str:
    """Format RAG LLM token usage for eval logs and CSV output."""
    if usage is None:
        return "N/A (generation skipped)"
    return (
        f"Total {usage.total_tokens:,} tokens "
        f"(Input tokens: {usage.input_tokens:,} · Output tokens: {usage.output_tokens:,})"
    )


def load_golden_records(dataset_path: Path) -> list[dict]:
    """Load non-empty records from a golden JSONL dataset."""
    if not dataset_path.is_file():
        raise FileNotFoundError(
            "Golden evaluation dataset not found.\n"
            f"  Path: {dataset_path}\n"
            "  Expected a JSONL file with one object per line, each containing "
            "'question' and 'golden_answer'.\n"
            f"  Default path: {default_dataset_path()}\n"
            "  Pass a different file with --dataset-path."
        )

    required_fields = {"question", "golden_answer"}
    records: list[dict] = []
    with dataset_path.open("r", encoding="utf-8") as fh:
        for line_number, line_str in enumerate(fh, start=1):
            stripped = line_str.strip()
            if not stripped:
                continue
            record = json.loads(stripped)
            missing_fields = required_fields - record.keys()
            if missing_fields:
                raise ValueError(
                    f"Dataset {dataset_path} line {line_number} is missing "
                    f"required fields: {sorted(missing_fields)}"
                )
            records.append(record)
    return records


def parse_args(settings: RagSettings) -> argparse.Namespace:
    """Parse and return command-line arguments for the RAG evaluation."""
    parser = argparse.ArgumentParser(
        description="Run offline RAG evaluation with ragas metrics."
    )
    parser.add_argument(
        "--dataset-path",
        type=Path,
        default=default_dataset_path(),
        help="Path to golden JSONL dataset.",
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=None,
        help="Path to save the evaluation results. If omitted, main() uses a timestamped file under data/evals/results/.",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=settings.models.evaluation,
        help="OpenAI model for ragas metric scoring.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional number of samples to run from dataset start.",
    )
    return parser.parse_args()


async def evaluate(
    args: argparse.Namespace,
    records: list[dict],
    vector_store: Chroma,
    reranker: CrossEncoder,
    settings: RagSettings,
) -> pd.DataFrame:
    """Run the full RAG evaluation pipeline."""
    logger.info("RAG generation model: %s", settings.models.rag)
    logger.info("Ragas evaluation model: %s", args.model)
    logger.info("Initializing ragas metrics...")
    evaluation_llm = llm_factory(args.model, client=AsyncOpenAI())

    factual_correctness_metric = FactualCorrectness(llm=evaluation_llm)
    faithfulness_metric = Faithfulness(llm=evaluation_llm)
    context_recall_metric = ContextRecall(llm=evaluation_llm)
    context_precision_metric = ContextPrecision(llm=evaluation_llm)

    scores = []
    for samples_run, record in enumerate(records, start=1):
        logger.info("Evaluating sample [%d]", samples_run)

        user_input = record["question"]
        reference = record["golden_answer"]

        logger.debug("Sample [%d] - user_input: %s", samples_run, user_input)
        logger.debug("Sample [%d] - reference: %s", samples_run, reference)

        rag_results = run_rag_query(
            query=user_input,
            vector_store=vector_store,
            reranker=reranker,
            settings=settings,
        )

        usage_line = format_rag_usage(rag_results.usage)
        logger.info("Sample [%d] - RAG usage: %s", samples_run, usage_line)

        response = rag_results.answer_with_citations.answer
        response_no_cit = remove_citation_markers(response)
        logger.debug(
            "Sample [%d] - response (no inline citations): %s",
            samples_run,
            response_no_cit,
        )

        retrieved_contexts = [chunk.content for chunk in rag_results.top_k_chunks]
        logger.debug(
            "Sample [%d] - nb retrieved contexts: %d",
            samples_run,
            len(retrieved_contexts),
        )

        ###### Retrieval evaluation metrics ######
        context_recall = await context_recall_metric.ascore(
            user_input=user_input,
            reference=reference,
            retrieved_contexts=retrieved_contexts,
        )
        logger.info(
            "Sample [%d] - Context Recall Score: %.2f",
            samples_run,
            context_recall.value,
        )

        context_precision = await context_precision_metric.ascore(
            user_input=user_input,
            reference=reference,
            retrieved_contexts=retrieved_contexts,
        )
        logger.info(
            "Sample [%d] - Context Precision Score: %.2f",
            samples_run,
            context_precision.value,
        )

        ###### Generation evaluation metrics ######
        factual_correctness = await factual_correctness_metric.ascore(
            response=response_no_cit, reference=reference
        )
        logger.info(
            "Sample [%d] - Factual Correctness Score: %.2f",
            samples_run,
            factual_correctness.value,
        )

        faithfulness = await faithfulness_metric.ascore(
            user_input=user_input,
            response=response_no_cit,
            retrieved_contexts=retrieved_contexts,
        )
        logger.info(
            "Sample [%d] - Faithfulness Score: %.2f",
            samples_run,
            faithfulness.value,
        )

        scores.append(
            {
                "user_input": user_input,
                "retrieved_contexts": retrieved_contexts,
                "response_no_cit": response_no_cit,
                "reference": reference,
                "rag_usage": usage_line,
                "context_recall": context_recall.value,
                "context_precision": context_precision.value,
                "faithfulness": faithfulness.value,
                "factual_correctness": factual_correctness.value,
            }
        )

    df_scores = pd.DataFrame(scores)
    return df_scores


def aggregate_scores(
    now: str,
    df_scores: pd.DataFrame,
    settings: RagSettings,
    evaluation_model: str,
    dataset_name: str,
) -> pd.DataFrame:
    """Return a single-row DataFrame of mean metric scores for one eval run."""
    if df_scores.empty:
        raise ValueError("Cannot aggregate scores from an empty evaluation run.")

    qa_prompt = load_prompt(settings.prompt.name)
    metric_cols = df_scores.drop(
        columns=[
            "user_input",
            "retrieved_contexts",
            "response_no_cit",
            "reference",
            "rag_usage",
        ]
    )
    metric_means = metric_cols.mean().rename(lambda col: f"{col}_mean")
    return pd.DataFrame(
        [
            {
                "now": now,
                "eval_dataset": dataset_name,
                "rag_model": settings.models.rag,
                "embedding_model": settings.models.embedding,
                "evaluation_model": evaluation_model,
                "prompt": qa_prompt.name,
                "prompt_version": qa_prompt.version,
                "chunk_size": settings.index.chunk_size,
                "chunk_overlap": settings.index.chunk_overlap,
                "samples_evaluated": len(df_scores),
                **metric_means.to_dict(),
            }
        ]
    )


def compute_and_save_aggregate_row(
    now: str,
    df_scores: pd.DataFrame,
    settings: RagSettings,
    evaluation_model: str,
    dataset_name: str,
) -> None:
    """Append one aggregate row for this run to evals_aggregate.csv."""
    agg_path = aggregate_output_path()
    logger.info("Compute and append aggregate row to %s", agg_path)
    agg_path.parent.mkdir(parents=True, exist_ok=True)
    row_df = aggregate_scores(
        now, df_scores, settings, evaluation_model, dataset_name
    )
    write_header = not agg_path.exists() or agg_path.stat().st_size == 0
    row_df.to_csv(agg_path, mode="a", header=write_header, index=False)


def prepare_eval_records(dataset_path: Path, limit: int | None) -> list[dict]:
    """Load golden records, apply an optional limit, and log the run size."""
    dataset_path = resolve_dataset_path(dataset_path)
    logger.info("Loading golden dataset from %s...", dataset_path)
    try:
        records = load_golden_records(dataset_path)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1) from None

    dataset_size = len(records)
    if limit is not None:
        records = records[:limit]

    num_samples = len(records)
    if limit is None:
        logger.info("Evaluating %d sample(s)", num_samples)
    else:
        logger.info(
            "Evaluating %d sample(s) (dataset size: %d, limit: %d)",
            num_samples,
            dataset_size,
            limit,
        )
    return records


def build_rag_runtime(
    settings: RagSettings,
) -> tuple[Chroma, CrossEncoder]:
    """Build the vector store and reranker used during evaluation."""
    pdf_paths = get_default_pdf_paths()
    if not pdf_paths:
        logger.info("No indexed documents — upload at least one PDF.")

    logger.info("Building index...")
    vector_store = build_index(pdf_paths, settings)

    logger.info("Building reranker...")
    reranker = build_reranker(settings)
    return vector_store, reranker


def save_eval_results(
    df_scores: pd.DataFrame,
    output_path: Path | None,
    settings: RagSettings,
    evaluation_model: str,
    dataset_path: Path,
) -> None:
    """Write per-run scores and append the aggregate summary row."""
    now = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = output_path or default_output_path(now)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Saving scores to %s", output_path)
    df_scores.to_csv(output_path, index=False)

    if df_scores.empty:
        logger.warning("No evaluation samples were run; skipping aggregate row.")
        return

    compute_and_save_aggregate_row(
        now,
        df_scores,
        settings,
        evaluation_model,
        resolve_dataset_path(dataset_path).name,
    )


def main() -> None:
    """Entry point for the RAG evaluation CLI."""
    load_and_validate_env()
    setup_logging()
    settings = get_rag_settings()
    args = parse_args(settings)

    records = prepare_eval_records(args.dataset_path, args.limit)

    vector_store, reranker = build_rag_runtime(settings)
    df_scores = asyncio.run(
        evaluate(args, records, vector_store, reranker, settings)
    )
    save_eval_results(
        df_scores, args.output_path, settings, args.model, args.dataset_path
    )


if __name__ == "__main__":
    main()
